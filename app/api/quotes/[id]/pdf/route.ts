import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { renderQuoteHtml } from "@/lib/quote-pdf-template";
import { STAFF_ROLES } from "@/types/auth.types";

export const maxDuration = 30;

const QUOTE_PDF_BUCKET = "quotes";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const quoteId = Number(id);
    if (!Number.isFinite(quoteId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { data: quote, error: quoteError } = await (supabase as any)
      .from("quotes")
      .select(
        "id,created_at,created_by,partner_tracking_code,customer_name,title,line_items,total,notes,valid_until",
      )
      .eq("id", quoteId)
      .maybeSingle();

    if (quoteError) {
      console.error("quote pdf: fetch quote failed", JSON.stringify(quoteError));
      return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
    }
    // 404 (not 403) for both "doesn't exist" and "not yours" — don't confirm foreign quote ids.
    if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Non-staff must be an AGENT and own the quote. Role first: without it an
    // influencer could still mint PDFs for legacy quotes on their code, and a
    // null partner_code would match a quote whose code is also null.
    if (!STAFF_ROLES.includes(session.role)) {
      const ownsIt =
        session.role === "agent" &&
        !!session.partner_code &&
        quote.partner_tracking_code === session.partner_code;
      if (!ownsIt) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    let partnerName: string | null = null;
    if (quote.partner_tracking_code) {
      const { data: partnerRow, error: partnerError } = await (supabase as any)
        .from("partners")
        .select("name_hebrew")
        .eq("partner_tracking_code", quote.partner_tracking_code)
        .maybeSingle();
      if (partnerError) {
        console.error("quote pdf: fetch partner failed", JSON.stringify(partnerError));
      }
      partnerName = partnerRow?.name_hebrew ?? null;
    }

    // Prefer the quote creator's profile (their logo/contact); fall back to any
    // profile sharing the partner code (e.g. a teammate on the same account).
    let profile: { logo_url: string | null; phone: string | null; email: string | null } | null =
      null;
    const { data: creatorProfile, error: creatorError } = await (supabase as any)
      .from("user_profiles")
      .select("logo_url,phone,email")
      .eq("id", quote.created_by)
      .maybeSingle();
    if (creatorError) {
      console.error("quote pdf: fetch creator profile failed", JSON.stringify(creatorError));
    }
    if (creatorProfile) {
      profile = creatorProfile;
    } else if (quote.partner_tracking_code) {
      const { data: anyProfile, error: anyProfileError } = await (supabase as any)
        .from("user_profiles")
        .select("logo_url,phone,email")
        .eq("partner_tracking_code", quote.partner_tracking_code)
        .limit(1)
        .maybeSingle();
      if (anyProfileError) {
        console.error("quote pdf: fetch fallback profile failed", JSON.stringify(anyProfileError));
      }
      profile = anyProfile ?? null;
    }

    const html = renderQuoteHtml({
      quote: {
        id: quote.id,
        created_at: quote.created_at,
        customer_name: quote.customer_name,
        title: quote.title,
        line_items: quote.line_items ?? [],
        total: quote.total,
        notes: quote.notes,
        valid_until: quote.valid_until,
      },
      partner: {
        name_hebrew: partnerName,
        logo_url: profile?.logo_url ?? null,
        email: profile?.email ?? null,
        phone: profile?.phone ?? null,
      },
    });

    let pdf: Buffer | null = null;

    if (process.env.NODE_ENV === "development") {
      // Dev fallback: try a locally installed Chrome; if unavailable, hand back
      // the raw HTML so the flow is testable without chromium installed.
      try {
        const playwright = require("playwright-core");
        const browser = await playwright.chromium.launch({ channel: "chrome", headless: true });
        try {
          const page = await browser.newPage();
          await page.setContent(html, { waitUntil: "networkidle" });
          pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" },
          });
        } finally {
          await browser.close();
        }
      } catch (devLaunchError) {
        console.error("quote pdf: dev chromium unavailable, returning HTML", devLaunchError);
        return new NextResponse(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": `inline; filename="quote-${quoteId}.html"`,
          },
        });
      }
    } else {
      const chromium = require("@sparticuz/chromium");
      const playwright = require("playwright-core");
      const browser = await playwright.chromium.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });
        pdf = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" },
        });
      } finally {
        await browser.close();
      }
    }

    if (!pdf) {
      console.error("quote pdf: no pdf buffer produced");
      return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
    }

    const storagePath = `quote-${quoteId}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(QUOTE_PDF_BUCKET)
      .upload(storagePath, pdf, { upsert: true, contentType: "application/pdf" });
    if (uploadError) {
      console.error("quote pdf: upload failed", JSON.stringify(uploadError));
      return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
    }

    const { error: updateError } = await (supabase as any)
      .from("quotes")
      .update({ pdf_storage_path: storagePath })
      .eq("id", quoteId);
    if (updateError) {
      console.error("quote pdf: update pdf_storage_path failed", JSON.stringify(updateError));
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(QUOTE_PDF_BUCKET)
      .createSignedUrl(storagePath, 60 * 60);
    if (signedUrlError || !signedUrlData) {
      console.error("quote pdf: signed url failed", JSON.stringify(signedUrlError));
      return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
    }

    await logAudit({ action: "pdf_generated", entityType: "quote", entityId: quoteId });

    return NextResponse.json({ ok: true, url: signedUrlData.signedUrl });
  } catch (error) {
    console.error("quote pdf: unhandled error", error);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}

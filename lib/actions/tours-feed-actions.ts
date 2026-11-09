"use server";

/**
 * Website > Product Feed (mega-family docs/plans/PRODUCT-FEED-PLAN.md): what the company's Meta catalog gets, what is
 * left out and why, and "Sync now". Behind the backoffice login and the company (requireCompany refuses a tours_agent):
 * the screen only reads what the last publish left in Storage, plus the tours' editor ids for the links.
 */
import { requireCompany } from "@/lib/company";
import { supabase } from "@/lib/supabase-server";
import { toursDb } from "@/lib/tours/db";
import { actionFail, actionOk, type ActionResult } from "@/lib/tours/action-kit";
import { STORAGE_BUCKET } from "@/lib/feed/publish-meta-feed";
import { readPublishedToursReport, toursFeedPath, type PublishedToursReport } from "@/lib/feed/tours-feed";
import { companyFeedSummary, publishCompanyFeed, type CompanyFeedResult } from "@/lib/feed/tours-publish";

const SCOPE = "tours-feed";

export type FeedScreenData = {
  company: { slug: string; name: string; siteUrl: string | null };
  /** The address to register in Commerce Manager (the file may not exist before the first publish). */
  feedUrl: string;
  /** The last publish, or null before the first one. */
  published: PublishedToursReport | null;
  /** Tour slug -> its editor id (/tours/packages/<id>). */
  editors: Record<string, string>;
  /** The company's tags as /tours/settings holds them: both set = the pixel may count twice. */
  analytics: { pixel: boolean; gtm: boolean };
};

async function screenData(company: { id: string; slug: string; name: string; siteUrl: string | null }): Promise<FeedScreenData> {
  const [published, packages, row] = await Promise.all([
    readPublishedToursReport(company.slug),
    toursDb().from("packages").select("id, slug").eq("company_id", company.id).is("is_deleted", null),
    supabase.from("companies").select("analytics").eq("id", company.id).maybeSingle(),
  ]);
  const editors: Record<string, string> = {};
  for (const p of (packages.data ?? []) as { id: string; slug: string }[]) editors[p.slug] = p.id;
  const analytics = ((row.data as { analytics?: Record<string, unknown> } | null)?.analytics ?? {}) as Record<string, unknown>;
  return {
    company: { slug: company.slug, name: company.name, siteUrl: company.siteUrl },
    feedUrl: supabase.storage.from(STORAGE_BUCKET).getPublicUrl(toursFeedPath(company.slug)).data.publicUrl,
    published,
    editors,
    analytics: { pixel: !!String(analytics.pixel ?? "").trim(), gtm: !!String(analytics.gtm ?? "").trim() },
  };
}

export async function getFeedScreen(): Promise<ActionResult<FeedScreenData>> {
  try {
    const { company } = await requireCompany("tours");
    return actionOk(await screenData(company));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the product feed");
  }
}

/** Draws the pictures the tours lack and the worlds' covers (up to ~3 minutes), then publishes the company's feed - what the crons do, now. */
export async function syncToursFeedNow(): Promise<ActionResult<{ screen: FeedScreenData; result: CompanyFeedResult }>> {
  try {
    const { company } = await requireCompany("tours");
    const { published, drawn, coversDrawn } = await publishCompanyFeed(company, { deadline: Date.now() + 180_000 });
    const result = companyFeedSummary(company, published, drawn, coversDrawn);
    const left = (drawn?.remaining ?? 0) + (coversDrawn?.remaining ?? 0);
    const failed = coversDrawn?.errors.length ?? 0;
    const warning =
      left > 0
        ? `${left} pictures are still to be drawn - the hourly run finishes them.`
        : failed > 0
          ? `${failed} world cover${failed === 1 ? "" : "s"} could not be drawn: ${coversDrawn?.errors.map((e) => `${e.key} (${e.error})`).join(", ")}`
          : undefined;
    return actionOk({ screen: await screenData(company), result }, warning);
  } catch (e) {
    return actionFail(e, SCOPE, undefined);
  }
}

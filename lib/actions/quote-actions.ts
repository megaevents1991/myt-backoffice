"use server";

import { requirePartner } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { computePackagePrice, type PackagePriceEvent } from "@/lib/package-price";
import { round2, type CommissionTerms } from "@/lib/partner-commission";
import { PUBLIC_SITE_URL } from "@/lib/site";
import type { CommissionType } from "@/types/partner.types";

export interface QuoteEventOption {
  id: number;
  name: string;
  date: string | null;
  location: string | null;
  suggested_price: number | null;
}

export interface QuoteLineItem {
  label: string;
  qty: number;
  unit_price: number;
}

export interface PortalQuote {
  id: number;
  created_at: string;
  customer_name: string | null;
  title: string | null;
  total: number | null;
  valid_until: string | null;
  status: string;
  pdf_storage_path: string | null;
  event_id: number | null;
}

type QuoteEventRow = PackagePriceEvent & {
  id: number;
  name: string;
  date: string | null;
  location: { name: string } | null;
};

export async function getQuoteEvents(): Promise<QuoteEventOption[]> {
  await requirePartner();
  const { data, error } = await (supabase as any)
    .from("events")
    .select(
      "id,name,date,location,base_flight_price,base_hotel_price,tickets_and_rates,event_additional_markup,markup_ticket,markup_flight,markup_hotel",
    )
    .is("is_deleted", null)
    .gte("date", new Date().toISOString().slice(0, 10))
    .order("date", { ascending: true })
    .limit(300);
  if (error) {
    console.error("getQuoteEvents:", JSON.stringify(error));
    return [];
  }
  return ((data ?? []) as QuoteEventRow[]).map((event) => ({
    id: event.id,
    name: event.name,
    date: event.date ?? null,
    location: event.location?.name ?? null,
    suggested_price: computePackagePrice(event),
  }));
}

/**
 * What the system would price ONE package at for this event, right now.
 *
 * Per traveller, matching computePackagePrice — the order flow multiplies it by
 * the number of travellers. Recomputed server-side rather than accepting a
 * number from the quote form: the whole point of storing it is to measure what
 * the partner did to the price, so the partner's browser cannot be the source
 * of the baseline.
 */
async function suggestedUnitPriceFor(eventId: number | null): Promise<number | null> {
  if (eventId == null) return null;
  const { data, error } = await (supabase as any)
    .from("events")
    .select(
      "id,name,date,location,base_flight_price,base_hotel_price,tickets_and_rates,event_additional_markup,markup_ticket,markup_flight,markup_hotel",
    )
    .eq("id", eventId)
    .is("is_deleted", null)
    .maybeSingle();
  if (error) {
    // A missing baseline is recorded as NULL rather than failing the quote —
    // the partner's work is not lost over a reporting field.
    console.error("suggestedUnitPriceFor:", JSON.stringify(error));
    return null;
  }
  return data ? computePackagePrice(data as QuoteEventRow) : null;
}

/**
 * The partner's commission terms. Null only when the row is missing or the
 * lookup failed — the agent/influencer decision is made on the session role,
 * not here, so a legacy row still typed 'affiliate' does not block a real agent.
 */
async function commissionTermsFor(trackingCode: string): Promise<CommissionTerms | null> {
  const { data, error } = await (supabase as any)
    .from("partners")
    .select("commission, commission_type")
    .eq("partner_tracking_code", trackingCode)
    .maybeSingle();
  if (error) {
    console.error("commissionTermsFor:", JSON.stringify(error));
    return null;
  }
  if (!data) return null;
  return {
    type: (data.commission_type as CommissionType | null) ?? "fixed_per_ticket",
    rate: data.commission ?? 0,
  };
}

/** The signed-in agent's commission terms, for the quote form's discount cap. */
export async function getMyAgentTerms(): Promise<{
  type: CommissionType;
  rate: number;
} | null> {
  const session = await requirePartner();
  if (session.role !== "agent") return null;
  const terms = await commissionTermsFor(session.partner_code);
  return terms
    ? { type: terms.type ?? "fixed_per_ticket", rate: terms.rate ?? 0 }
    : null;
}

export async function getPortalQuotes(): Promise<PortalQuote[]> {
  const session = await requirePartner();
  // Server gate, not just a hidden tab — the page guard and the nav are UI.
  if (session.role !== "agent") return [];
  const { data, error } = await (supabase as any)
    .from("quotes")
    .select(
      "id,created_at,customer_name,title,total,valid_until,status,pdf_storage_path,event_id",
    )
    .eq("partner_tracking_code", session.partner_code)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getPortalQuotes:", JSON.stringify(error));
    return [];
  }
  return (data as PortalQuote[]) ?? [];
}

export async function createQuote(input: {
  event_id?: number | null;
  customer_name: string;
  title: string;
  line_items: QuoteLineItem[];
  /**
   * The package row, when the quote was built from an event. Sent explicitly
   * rather than inferred from the line items: the discount rule is measured
   * against it, and guessing which row it is left the rule bypassable.
   */
  package?: { qty: number; unit_price: number } | null;
  notes?: string | null;
  valid_until?: string | null;
  /** Site order link rendered as the PDF's pay CTA; null/absent = info-only. */
  payment_link?: string | null;
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const session = await requirePartner();

  // Quotes are an agent tool. An influencer promotes a link and earns on what
  // it brings in; they never price a package for a named customer.
  //
  // Gated on the user's ROLE, which is what the pages and nav gate on too.
  // Reading `partners.type` here instead would have rejected an agent whose
  // partner row predates the type column and defaulted to 'affiliate' — after
  // letting them fill in the whole quote.
  if (session.role !== "agent") {
    return { ok: false, error: "הצעות מחיר זמינות לסוכנים בלבד" };
  }
  const terms = await commissionTermsFor(session.partner_code);
  if (!terms) {
    return { ok: false, error: "לא הצלחנו לקרוא את תנאי העמלה שלכם. נסו שוב." };
  }

  const customer_name = input.customer_name?.trim();
  const title = input.title?.trim();
  if (!customer_name) return { ok: false, error: "Customer name is required" };
  if (!title) return { ok: false, error: "Title is required" };
  if (!Array.isArray(input.line_items) || input.line_items.length === 0) {
    return { ok: false, error: "At least one line item is required" };
  }

  for (const item of input.line_items) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Invalid line item" };
    }
    if (typeof item.label !== "string" || !item.label.trim()) {
      return { ok: false, error: "Every line item needs a label" };
    }
    if (
      !Number.isFinite(item.qty) ||
      !Number.isInteger(item.qty) ||
      item.qty <= 0 ||
      item.qty > 999
    ) {
      return { ok: false, error: `Invalid quantity for "${item.label}"` };
    }
    if (!Number.isFinite(item.unit_price) || item.unit_price < 0) {
      return { ok: false, error: `Invalid unit price for "${item.label}"` };
    }
    if (item.unit_price > 1_000_000) {
      return { ok: false, error: "Amount too large" };
    }
  }

  const total =
    Math.round(
      input.line_items.reduce((s, i) => s + i.qty * i.unit_price, 0) * 100,
    ) / 100;
  if (total > 10_000_000) {
    return { ok: false, error: "Amount too large" };
  }

  // Snapshot what the system would have charged per traveller, computed HERE
  // from the event row — never taken from the client, which is the side being
  // measured.
  const base_unit_price = await suggestedUnitPriceFor(input.event_id ?? null);

  // An event-backed quote must carry its package row and a baseline, or the
  // discount rule has nothing to measure. Failing open here would make the cap
  // opt-out: pick an event, omit the package, quote anything.
  if (input.event_id != null) {
    if (base_unit_price == null) {
      return {
        ok: false,
        error: "לא הצלחנו לחשב את מחיר החבילה לאירוע הזה. נסו שוב.",
      };
    }
    if (
      !input.package ||
      !Number.isFinite(input.package.unit_price) ||
      input.package.unit_price < 0
    ) {
      return { ok: false, error: "חסר מחיר החבילה בהצעה" };
    }
  }

  // An agent may give away their own commission, never more — below that they
  // would owe us the difference on a sale we cannot collect it from.
  //
  // Measured PER TRAVELLER on the package row alone, which is what makes the
  // rule hold. Comparing whole-quote totals let a discount hide behind either
  // an added extra or a re-shaped package row: quoting four travellers as a
  // single lump-sum line made the baseline look like one traveller, the delta
  // came out negative, and the check never ran. Per traveller there is no
  // quantity to understate.
  const pkg = input.package;
  if (base_unit_price != null && pkg) {
    const quoted = round2(pkg.unit_price);
    const discountPerTraveller = round2(base_unit_price - quoted);
    if (discountPerTraveller > 0) {
      // Percent commission is paid on what the CUSTOMER pays, so the ceiling
      // has to be derived from the discounted price, not the list price.
      const commissionPerTraveller = round2(
        terms.type === "percent_of_sale"
          ? (quoted * (terms.rate ?? 0)) / 100
          : terms.rate ?? 0
      );
      if (discountPerTraveller > commissionPerTraveller + 0.001) {
        return {
          ok: false,
          error: `ההנחה המקסימלית שלכם היא $${commissionPerTraveller} לנוסע. הורדתם $${discountPerTraveller}.`,
        };
      }
    }
  }

  // The CTA link may only point at OUR site carrying THIS agent's code — a
  // quote PDF must never route a customer through someone else's attribution
  // (or off-site entirely).
  let payment_link: string | null = null;
  if (input.payment_link) {
    const link = String(input.payment_link);
    const carriesOwnCode =
      link.startsWith(`${PUBLIC_SITE_URL}/`) &&
      link.includes(`utm_source=${encodeURIComponent(session.partner_code ?? "")}`);
    if (!carriesOwnCode || link.length > 500) {
      return { ok: false, error: "לינק התשלום אינו תקין" };
    }
    payment_link = link;
  }

  const row = {
    created_by: session.sub,
    partner_tracking_code: session.partner_code,
    event_id: input.event_id ?? null,
    customer_name,
    title,
    line_items: input.line_items,
    currency: "USD",
    total,
    notes: input.notes ?? null,
    valid_until: input.valid_until ?? null,
    status: "final",
  };

  // The migrations adding these columns and the deploy that writes them ship
  // from the same merge, so there is a window where a column does not exist
  // yet. Optional fields must not stop a partner creating quotes then — try
  // the fullest payload first and shed the newest columns on PGRST204.
  // Until the payment_link column lands, the link degrades into the notes —
  // still on the PDF, just as text instead of a styled CTA.
  const notesWithLink = payment_link
    ? [row.notes, `להזמנה ותשלום מאובטח: ${payment_link}`].filter(Boolean).join("\n\n")
    : row.notes;
  const payloads = [
    { ...row, base_unit_price, payment_link },
    { ...row, notes: notesWithLink, base_unit_price },
    { ...row, notes: notesWithLink },
  ];
  let data = null;
  let error = null;
  for (const payload of payloads) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ data, error } = await (supabase as any)
      .from("quotes")
      .insert(payload)
      .select("id")
      .single());
    if (error?.code !== "PGRST204") break;
    console.error("createQuote: column missing, retrying with a slimmer payload");
  }

  if (error) {
    console.error("createQuote:", JSON.stringify(error));
    return { ok: false, error: "Failed to create quote" };
  }

  await logAudit({
    action: "quote_created",
    entityType: "quote",
    entityId: data.id,
    changes: { customer_name, title, total, event_id: input.event_id ?? null },
  });

  return { ok: true, id: data.id };
}

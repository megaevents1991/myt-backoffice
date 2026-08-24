"use server";

import { requirePartner } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { resolvePortalScope } from "@/lib/portal-attribution";
import {
  computePackagePrice,
  computePerPersonPackagePrice,
  type PackagePriceEvent,
  type PerPersonPricingFields,
} from "@/lib/package-price";
import {
  PAID_STATUS,
  round2,
  type CommissionTerms,
} from "@/lib/partner-commission";
import { signQuoteLink } from "@/lib/quote-link-sig";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { SELLER_ROLES } from "@/types/auth.types";
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
  /** Manager-only "נוצר ע"י" column - display name (falling back to email) of
   *  the office user who created the quote. Null for a non-manager viewer
   *  (agents in a multi-user office only ever see their own quotes anyway) or
   *  an unattributed/legacy row. */
  creator_name: string | null;
}

/** A quote's lifecycle as the agent manages it. `final` = still open/sent;
 *  the other two are set from the quotes list. Free-text column, no enum. */
export type PartnerQuoteStatus = "final" | "closed" | "not_relevant";

export interface PortalQuoteWithState extends PortalQuote {
  /** A Paid order arrived through this quote's signed link - closed for real,
   *  whatever the manual status says. */
  closed_by_order: boolean;
  /** valid_until has passed (and the quote isn't closed / not-relevant). */
  expired: boolean;
}

/** The doc's summary numbers: closed / expired / not relevant / to chase. */
export interface PortalQuoteStats {
  total: number;
  closed: number;
  expired: number;
  notRelevant: number;
  /** Still open and in force - the ones the agent should follow up on. */
  openForFollowUp: number;
}

export interface PortalQuotesOverview {
  quotes: PortalQuoteWithState[];
  stats: PortalQuoteStats;
}

type QuoteEventRow = PackagePriceEvent & {
  id: number;
  name: string;
  date: string | null;
  location: { name: string } | null;
};

export async function getQuoteEvents(): Promise<QuoteEventOption[]> {
  await requirePartner();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * Per traveller, matching computePackagePrice - the order flow multiplies it by
 * the number of travellers. Recomputed server-side rather than accepting a
 * number from the quote form: the whole point of storing it is to measure what
 * the partner did to the price, so the partner's browser cannot be the source
 * of the baseline.
 */
async function suggestedUnitPriceFor(
  eventId: number | null,
): Promise<number | null> {
  if (eventId == null) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("events")
    .select(
      "id,name,date,location,base_flight_price,base_hotel_price,tickets_and_rates,event_additional_markup,markup_ticket,markup_flight,markup_hotel",
    )
    .eq("id", eventId)
    .is("is_deleted", null)
    .maybeSingle();
  if (error) {
    // A missing baseline is recorded as NULL rather than failing the quote -
    // the partner's work is not lost over a reporting field.
    console.error("suggestedUnitPriceFor:", JSON.stringify(error));
    return null;
  }
  return data ? computePackagePrice(data as QuoteEventRow) : null;
}

/**
 * Per-traveller price of a prepared package - the quote baseline when the
 * quote starts from a package (מחיר היחידה חייב לשקף את ההרכבה, לא את מחיר
 * האירוע הגנרי - a no-flight package priced $1,238 must not baseline $2,033).
 *
 * The stamp written at package creation wins; packages from before the stamp
 * fall back to recomputing from the composition flags at event baselines
 * (component upgrades unknown → delta 0). Null when the package is gone.
 */
async function packageBaselineFor(
  trackingCode: string,
  packageId: number,
): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("prepared_packages")
    .select("event_id,event_order_info,flight_skipped,hotel_skipped")
    .eq("id", packageId)
    .eq("partner_tracking_code", trackingCode)
    .maybeSingle();
  if (error) {
    console.error("packageBaselineFor:", JSON.stringify(error));
    return null;
  }
  if (!data) return null;
  const row = data as {
    event_id: number;
    event_order_info: {
      price_per_person?: number;
      price_per_ticket?: number;
    } | null;
    flight_skipped: boolean | null;
    hotel_skipped: boolean | null;
  };

  const stamped = Number(row.event_order_info?.price_per_person);
  if (Number.isFinite(stamped) && stamped > 0) return stamped;

  const ticketPrice = Number(row.event_order_info?.price_per_ticket);
  if (!Number.isFinite(ticketPrice) || ticketPrice <= 0) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: eventData, error: eventError } = await (supabase as any)
    .from("events")
    .select(
      "base_flight_price,base_hotel_price,event_additional_markup,markup_ticket,markup_flight,markup_hotel,skip_flight,skip_flight_markup,skip_hotel_markup,ticket_only_markup",
    )
    .eq("id", row.event_id)
    .maybeSingle();
  if (eventError || !eventData) {
    if (eventError)
      console.error("packageBaselineFor event:", JSON.stringify(eventError));
    return null;
  }
  return computePerPersonPackagePrice(eventData as PerPersonPricingFields, {
    ticketPrice,
    flightSkipped: row.flight_skipped === true,
    hotelSkipped: row.hotel_skipped === true,
  });
}

/** The seeded unit price for the quote form's package prefill. */
export async function getQuotePackageUnitPrice(
  packageId: number,
): Promise<number | null> {
  const session = await requirePartner();
  const id = Number(packageId);
  if (!Number.isFinite(id)) return null;
  return packageBaselineFor(session.partner_code, id);
}

/**
 * The partner's commission terms. Null only when the row is missing or the
 * lookup failed - the agent/influencer decision is made on the session role,
 * not here, so a legacy row still typed 'affiliate' does not block a real agent.
 */
async function commissionTermsFor(
  trackingCode: string,
): Promise<CommissionTerms | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  if (!SELLER_ROLES.includes(session.role)) return null;
  const terms = await commissionTermsFor(session.partner_code);
  return terms
    ? { type: terms.type ?? "fixed_per_ticket", rate: terms.rate ?? 0 }
    : null;
}

type PortalQuoteRow = Omit<PortalQuote, "creator_name"> & {
  created_by: string | null;
};

export async function getPortalQuotes(): Promise<PortalQuote[]> {
  const session = await requirePartner();
  // Server gate, not just a hidden tab - the page guard and the nav are UI.
  if (!SELLER_ROLES.includes(session.role)) return [];
  const scope = await resolvePortalScope(session);

  // An agent in a multi-user office only ever sees quotes they created;
  // managers and solo agents see the whole office.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("quotes")
    .select(
      "id,created_at,customer_name,title,total,valid_until,status,pdf_storage_path,event_id,created_by",
    )
    .eq("partner_tracking_code", session.partner_code)
    .order("created_at", { ascending: false });
  if (session.role === "agent" && !scope.soloOffice) {
    query = query.eq("created_by", session.sub);
  }
  const { data, error } = await query;
  if (error) {
    console.error("getPortalQuotes:", JSON.stringify(error));
    return [];
  }
  // Only a manager sees who created each quote - an agent already sees only
  // their own (or the whole solo office, where the column would be redundant).
  const nameBySub = scope.isManager
    ? new Map(scope.officeUsers.map((u) => [u.id, u.display_name || u.email]))
    : null;
  return ((data ?? []) as PortalQuoteRow[]).map(({ created_by, ...quote }) => ({
    ...quote,
    creator_name:
      nameBySub && created_by ? (nameBySub.get(created_by) ?? null) : null,
  }));
}

/**
 * The quotes list plus its summary numbers, in one action.
 *
 * "Closed" is a union of two facts: the agent marked it closed, or a Paid
 * reservation arrived through the quote's signed link (reservations.quote_id -
 * best-effort until that migration lands; a 42703 just turns auto-closing off).
 */
export async function getPortalQuotesOverview(): Promise<PortalQuotesOverview> {
  const empty: PortalQuotesOverview = {
    quotes: [],
    stats: {
      total: 0,
      closed: 0,
      expired: 0,
      notRelevant: 0,
      openForFollowUp: 0,
    },
  };
  const session = await requirePartner();
  if (!SELLER_ROLES.includes(session.role)) return empty;

  const [quotes, linkedResult] = await Promise.all([
    getPortalQuotes(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("reservations")
      .select("quote_id,status")
      .is("is_deleted", null)
      .eq("aff_partner_tracking_code", session.partner_code)
      .not("quote_id", "is", null),
  ]);

  const paidQuoteIds = new Set<number>();
  if (linkedResult.error) {
    if (linkedResult.error.code !== "42703") {
      console.error(
        "getPortalQuotesOverview linked:",
        JSON.stringify(linkedResult.error),
      );
    }
  } else {
    for (const row of (linkedResult.data ?? []) as {
      quote_id: number | null;
      status: string | null;
    }[]) {
      if (row.quote_id != null && row.status === PAID_STATUS)
        paidQuoteIds.add(row.quote_id);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const withState: PortalQuoteWithState[] = quotes.map((quote) => {
    const closedByOrder = paidQuoteIds.has(quote.id);
    const pastValidity =
      !!quote.valid_until && quote.valid_until.slice(0, 10) < today;
    return {
      ...quote,
      closed_by_order: closedByOrder,
      expired:
        pastValidity &&
        !closedByOrder &&
        quote.status !== "closed" &&
        quote.status !== "not_relevant",
    };
  });

  const stats = withState.reduce(
    (acc, quote) => {
      acc.total += 1;
      if (quote.closed_by_order || quote.status === "closed") acc.closed += 1;
      else if (quote.status === "not_relevant") acc.notRelevant += 1;
      else if (quote.expired) acc.expired += 1;
      else acc.openForFollowUp += 1;
      return acc;
    },
    { total: 0, closed: 0, expired: 0, notRelevant: 0, openForFollowUp: 0 },
  );

  return { quotes: withState, stats };
}

/** The agent updates their OWN quote's lifecycle from the list. */
export async function updateQuoteStatus(
  quoteId: number,
  status: PartnerQuoteStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requirePartner();
  if (!SELLER_ROLES.includes(session.role)) {
    return { ok: false, error: "הצעות מחיר זמינות לסוכנים בלבד" };
  }
  const scope = await resolvePortalScope(session);
  if (!Number.isInteger(quoteId) || quoteId <= 0) {
    return { ok: false, error: "הצעה לא תקינה" };
  }
  if (!["final", "closed", "not_relevant"].includes(status)) {
    return { ok: false, error: "סטטוס לא מוכר" };
  }
  // An agent in a multi-user office may only update their OWN quotes;
  // managers may update any office quote.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let updateQuery = (supabase as any)
    .from("quotes")
    .update({ status })
    .eq("id", quoteId)
    .eq("partner_tracking_code", session.partner_code);
  if (session.role === "agent" && !scope.soloOffice) {
    updateQuery = updateQuery.eq("created_by", session.sub);
  }
  const { data, error } = await updateQuery.select("id").maybeSingle();
  if (error) {
    console.error("updateQuoteStatus:", JSON.stringify(error));
    return { ok: false, error: "העדכון נכשל. נסו שוב." };
  }
  if (!data) return { ok: false, error: "ההצעה לא נמצאה" };
  return { ok: true };
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
  /** The prepared package the quote was seeded from - its composition price
   *  becomes the discount baseline instead of the generic event price. */
  package_id?: number | null;
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
  // partner row predates the type column and defaulted to 'affiliate' - after
  // letting them fill in the whole quote.
  if (!SELLER_ROLES.includes(session.role)) {
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
  // from the event/package rows - never taken from the client, which is the
  // side being measured. A package-seeded quote baselines on the package's own
  // composition price (H5: a no-flight package must not baseline the generic
  // full-package figure).
  const packageId = Number(input.package_id);
  const packageBaseline = Number.isFinite(packageId)
    ? await packageBaselineFor(session.partner_code, packageId)
    : null;
  const base_unit_price =
    packageBaseline ?? (await suggestedUnitPriceFor(input.event_id ?? null));

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

  // An agent may give away their own commission, never more - below that they
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
          : (terms.rate ?? 0),
      );
      if (discountPerTraveller > commissionPerTraveller + 0.001) {
        return {
          ok: false,
          error: `ההנחה המקסימלית שלכם היא $${commissionPerTraveller} לנוסע. הורדתם $${discountPerTraveller}.`,
        };
      }
    }
  }

  // The CTA link may only point at OUR site carrying THIS agent's code - a
  // quote PDF must never route a customer through someone else's attribution
  // (or off-site entirely).
  let payment_link: string | null = null;
  if (input.payment_link) {
    const link = String(input.payment_link);
    const carriesOwnCode =
      link.startsWith(`${PUBLIC_SITE_URL}/`) &&
      link.includes(
        `utm_source=${encodeURIComponent(session.partner_code ?? "")}`,
      );
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
  // yet. Optional fields must not stop a partner creating quotes then - try
  // the fullest payload first and shed the newest columns on PGRST204.
  // Until the payment_link column lands, the link degrades into the notes -
  // still on the PDF, just as text instead of a styled CTA.
  const notesWithLink = payment_link
    ? [row.notes, `להזמנה ותשלום מאובטח: ${payment_link}`]
        .filter(Boolean)
        .join("\n\n")
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
    console.error(
      "createQuote: column missing, retrying with a slimmer payload",
    );
  }

  if (error) {
    console.error("createQuote:", JSON.stringify(error));
    return { ok: false, error: "Failed to create quote" };
  }

  // Sign the quote INTO its pay link (`&quote={id}&qsig=…`): main's order page
  // verifies the signature, shows the offer's line items and charges the
  // agent's total - dearer than site price sends the delta to the agent,
  // cheaper comes out of their commission. Needs the row id, hence the
  // post-insert update; best-effort - the plain package link still works.
  if (payment_link) {
    try {
      const signedLink = await signQuoteLink(payment_link, data.id, total);
      if (signedLink !== payment_link) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: linkError } = await (supabase as any)
          .from("quotes")
          .update({ payment_link: signedLink })
          .eq("id", data.id);
        if (linkError && linkError.code !== "PGRST204") {
          console.error("createQuote sign link:", JSON.stringify(linkError));
        }
      }
    } catch (e) {
      console.error("createQuote sign link:", e);
    }
  }

  await logAudit({
    action: "quote_created",
    entityType: "quote",
    entityId: data.id,
    changes: { customer_name, title, total, event_id: input.event_id ?? null },
  });

  return { ok: true, id: data.id };
}

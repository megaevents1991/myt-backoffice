// The live listings of the booking dialog, ranked: the category the order was sold with first, cheapest first, each
// with its gap to the ticket cost the order was sold with. Which listings may be offered at all is the site's own
// rule, imported (never re-written): `listingsTheSiteSells` - excluded sections, restricted view, split rules.
// Pure - no DB, no network. Selftest: scripts/tixstock-booking-rank-selftest.ts.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.2.
import { listingsTheSiteSells, type TixStockListingRuleFields } from "../tixstock-listings";

/** A /tickets/feed listing as the dialog reads it: the rule fields, and what the card shows. */
export type RankableListing = TixStockListingRuleFields & {
  id?: unknown;
  requires_lead_booker?: unknown;
  seat_details?: { category?: string | null; section?: string | null; row?: string | null } | null;
  ticket?: { split_type?: string | null; type?: string | null; instant_download?: unknown; general_admission?: unknown } | null;
  proceed_price?: { amount?: unknown; currency?: unknown } | null;
  delivery?: { type?: unknown; shipped_date_or_date_in_hand?: unknown } | null;
};

export type RankedListing = {
  listingId: string;
  category: string;
  section: string | null;
  row: string | null;
  ticketType: string;
  splitType: string;
  generalAdmission: boolean;
  /** The feed's amount exactly as received - never rounded: it is what orders/add states. */
  pricePerTicketUsd: number;
  totalUsd: number;
  /** This listing's total minus the ticket cost the order was sold with. Null when that cost is not known. */
  gapUsd: number | null;
  gapPct: number | null;
  /** Dearer than the cost sold: booking it needs staff's explicit yes. */
  dearer: boolean;
  restrictions: string[];
  deliveryDate: string | null;
  deliveryType: string | null;
  instantDownload: boolean;
  /** A paper ticket: it is shipped, so the order needs an address. */
  paper: boolean;
  leadBooker: boolean;
};

export type RankInput = {
  /** The category the order was sold with; null when it is not known (every listing is then "another category"). */
  soldCategory: string | null;
  quantity: number;
  /** The customer was promised seats together: a single-seats listing is not offered. */
  together: boolean;
  excludedSections: string[];
  /** What the order's tickets were costed at when it was sold, for the whole party. */
  costSoldTotalUsd: number | null;
};

// Ported verbatim from myt-main `lib/tixstock-category.ts` (`normalizeTxCategory`): the comparable form of a
// TixStock category name - no accents, no parenthesised codes, no punctuation. Change both.
const normalizeTxCategory = (category: string | undefined | null): string =>
  (category ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// Ported verbatim from myt-main `lib/tixstock-quantity.ts` (`listingSeatsTogether`): an all-or-nothing listing is
// one block of seats, and sellers who do not publish the row write "TOGETHER" in it. Change both.
const ROW_SAYS_TOGETHER = /\btogether\b/i;
const listingSeatsTogether = (listing: RankableListing): boolean =>
  (listing.ticket?.split_type ?? "").trim().toLowerCase().includes("together") ||
  ROW_SAYS_TOGETHER.test(listing.seat_details?.row ?? "");

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** The feed sends booleans as strings: the string "false" must read as false. */
const flag = (v: unknown): boolean =>
  v === true || v === 1 || (typeof v === "string" && ["true", "1", "yes"].includes(v.trim().toLowerCase()));

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** An option is a plain string, or `{ name, value }` - as the site's ticket step reads it. */
const restrictionsOf = (listing: RankableListing): string[] => {
  const rb = listing.restrictions_benefits;
  const options: unknown[] = Array.isArray(rb?.options) ? rb.options : [];
  const out = options.map((option) => {
    if (typeof option === "string") return option;
    if (!option || typeof option !== "object") return "";
    const fields: { name?: unknown; value?: unknown } = option;
    return `${text(fields.name)}: ${text(fields.value)}`;
  });
  const other: unknown[] = Array.isArray(rb?.other) ? rb.other : [rb?.other];
  for (const line of other) if (typeof line === "string") out.push(line);
  return out.map((line) => line.trim()).filter((line) => line !== "" && line !== ":");
};

/**
 * The listings a member of staff may book for this order, in two groups: the category it was sold with, then every
 * other category - each cheapest first. A listing with no id or no price is never offered.
 */
export function rankListings(
  listings: readonly RankableListing[],
  input: RankInput,
): { sameCategory: RankedListing[]; others: RankedListing[] } {
  const sold = normalizeTxCategory(input.soldCategory);
  const cost = input.costSoldTotalUsd !== null && Number.isFinite(input.costSoldTotalUsd) ? input.costSoldTotalUsd : null;
  const sameCategory: RankedListing[] = [];
  const others: RankedListing[] = [];

  for (const listing of listingsTheSiteSells(listings, input.excludedSections, input.quantity)) {
    if (input.together && !listingSeatsTogether(listing)) continue;
    const listingId = text(listing.id);
    const amount = Number.parseFloat(text(listing.proceed_price?.amount));
    if (listingId === "" || !Number.isFinite(amount) || amount <= 0) continue;

    const totalUsd = round2(amount * input.quantity);
    const gapUsd = cost === null ? null : round2(totalUsd - cost);
    const ticketType = text(listing.ticket?.type);
    const ranked: RankedListing = {
      listingId,
      category: text(listing.seat_details?.category),
      section: text(listing.seat_details?.section) || null,
      row: text(listing.seat_details?.row) || null,
      ticketType,
      splitType: text(listing.ticket?.split_type),
      generalAdmission: flag(listing.ticket?.general_admission),
      pricePerTicketUsd: amount,
      totalUsd,
      gapUsd,
      gapPct: gapUsd === null || cost === null || cost <= 0 ? null : round2((gapUsd / cost) * 100),
      dearer: gapUsd !== null && gapUsd > 0,
      restrictions: restrictionsOf(listing),
      deliveryDate: text(listing.delivery?.shipped_date_or_date_in_hand) || null,
      deliveryType: text(listing.delivery?.type) || null,
      instantDownload: flag(listing.ticket?.instant_download),
      paper: /paper/i.test(ticketType),
      leadBooker: flag(listing.requires_lead_booker),
    };
    (sold !== "" && normalizeTxCategory(ranked.category) === sold ? sameCategory : others).push(ranked);
  }

  const cheapestFirst = (a: RankedListing, b: RankedListing): number =>
    a.pricePerTicketUsd - b.pricePerTicketUsd || a.listingId.localeCompare(b.listingId);
  return { sameCategory: sameCategory.sort(cheapestFirst), others: others.sort(cheapestFirst) };
}

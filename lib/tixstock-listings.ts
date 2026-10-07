/**
 * Which TixStock listings the site would actually sell - the three rules main applies
 * before it prices a ticket for a customer, mirrored here so the price sync picks the SAME
 * listing the order page will:
 *
 *   1. not in a section staff excluded on the event's map (`events.tx_excluded_sections`);
 *   2. not a restricted / limited / side / partial view;
 *   3. the seller will sell this party size (split rules).
 *
 * Mirrors main: `listingCanSatisfyQuantity` = `lib/tixstock-quantity.ts`;
 * `hasObstructedViewRestriction` and `isExcludedSection` = `app/api/tixstock/tickets/route.ts`;
 * `categoryMatchesMapId` = `lib/tixstock-map.ts`. A rule changed there changes here, or the
 * two write different prices to the same ticket again (2026-10-07: the sync took the
 * cheapest listing with 2+ seats and nothing else - on 24 events a visitor had just priced,
 * 17 of 106 tickets came out more than 4.5% under the site, one at a third of its price).
 *
 * Pure - no DB, no network. Selftest: scripts/tixstock-listings-selftest.ts.
 */
import { normalizeSupplierCategory } from "@/lib/suppliers";
import { slugify, UNLABELED_SECTION_MARK } from "@/lib/tixstock-map";

/** The slice of a TixStock /tickets/feed listing the three rules read. */
export interface TixStockListingRuleFields {
  seat_details?: { category?: string | null; section?: string | null } | null;
  ticket?: { split_type?: string | null } | null;
  number_of_tickets_for_sale?: {
    quantity_available?: number | null;
    split_quantity?: number | null;
  } | null;
  restrictions_benefits?: { other?: unknown; options?: unknown } | null;
}

/**
 * The party a stored ticket price is for. Main writes the price back only from a search
 * for two (`requestedQuantity !== 2` writes nothing), so that is the price the sync keeps.
 */
export const PRICED_PARTY = 2;

const splitTypeOf = (listing: TixStockListingRuleFields): string =>
  (listing.ticket?.split_type ?? "").trim().toLowerCase();

/**
 * Can a listing fulfil a purchase of `qty` tickets? TixStock encodes the seller's split
 * rules in `ticket.split_type` ("No Preferences" | "Avoid Leaving One Ticket" |
 * "Sell Together" / "All Together" | "Multiples") and in
 * `number_of_tickets_for_sale.split_quantity` (the multiple; 0 = no constraint).
 */
export function listingCanSatisfyQuantity(
  listing: TixStockListingRuleFields,
  qty: number,
): boolean {
  if (!Number.isFinite(qty) || qty < 1) return false;

  const available = listing.number_of_tickets_for_sale?.quantity_available ?? 0;
  if (available < qty) return false;

  const splitType = splitTypeOf(listing);
  const splitQty = listing.number_of_tickets_for_sale?.split_quantity ?? 0;

  // All-or-nothing listings.
  if (splitType.includes("together") || splitType.includes("no split")) {
    return qty === available;
  }

  // Seller won't leave a single orphan ticket behind.
  if (splitType.includes("avoid") && available - qty === 1) {
    return false;
  }

  // Sell-in-multiples listings (split_quantity is the multiple).
  if (splitQty > 0 && qty % splitQty !== 0) {
    return false;
  }

  return true;
}

/** True when a restriction text signals any kind of obstructed / degraded view. */
function isObstructedViewText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    (lower.includes("limited") ||
      lower.includes("side") ||
      lower.includes("restricted") ||
      lower.includes("partial")) &&
    lower.includes("view")
  );
}

/** An option is a plain string, or `{ name, value }`. */
function optionText(option: unknown): string {
  if (typeof option === "string") return option;
  if (!option || typeof option !== "object") return " ";
  const fields: { name?: unknown; value?: unknown } = option;
  return `${fields.name ?? ""} ${fields.value ?? ""}`;
}

export function hasObstructedViewRestriction(
  listing: TixStockListingRuleFields,
): boolean {
  const rb = listing.restrictions_benefits;
  if (!rb) return false;
  if (rb.other && isObstructedViewText(String(rb.other))) return true;
  const options: unknown[] = Array.isArray(rb.options) ? rb.options : [];
  return options.some((option) => isObstructedViewText(optionText(option)));
}

/**
 * Is this ticket category the one a map id names? Exact slug first, then the rename-proof
 * form (no accents, no parenthesised codes, no punctuation): the excluded id carries the
 * category as the DRAWING names it, the listing as TixStock names it today.
 */
export function categoryMatchesMapId(
  ticketCategory: string | null | undefined,
  mapId: string | null | undefined,
): boolean {
  if (!ticketCategory || !mapId) return false;
  if (slugify(ticketCategory) === mapId.toLowerCase()) return true;
  const normalized = normalizeSupplierCategory(ticketCategory);
  return !!normalized && normalized === normalizeSupplierCategory(mapId);
}

/**
 * True when a listing sits in one of the excluded section ids (format
 * "{category-slug}_{section}"). A listing that names only its category is excluded when a
 * concrete section of that category is - nobody can say it is not in that section.
 */
export function isExcludedSection(
  listing: TixStockListingRuleFields,
  excludedSections: readonly string[],
): boolean {
  if (excludedSections.length === 0) return false;
  const listingCategory = listing.seat_details?.category ?? "";
  const listingCatSlug = slugify(listingCategory);
  const sameCategory = (catSlug: string) =>
    catSlug === listingCatSlug || categoryMatchesMapId(listingCategory, catSlug);
  const listingSection = (listing.seat_details?.section ?? "").trim().toLowerCase();
  const listingSectionSlug = slugify(listingSection);

  const parsed = excludedSections.flatMap((excluded) => {
    const lastUnderscore = excluded.lastIndexOf("_");
    if (lastUnderscore === -1) return [];
    return [
      {
        catSlug: excluded.substring(0, lastUnderscore),
        sectionId: excluded.substring(lastUnderscore + 1).toLowerCase(),
      },
    ];
  });

  const isCategoryOnlyListing =
    listingCatSlug !== "" && listingSectionSlug === listingCatSlug;
  // Numbered unlabeled wedges (`lower-tier_~3`) carry no tickets - like the legacy empty
  // id, they are not a concrete section that hides category-only listings.
  const hasConcreteExcludedSectionInCategory = parsed.some(
    ({ catSlug, sectionId }) =>
      sameCategory(catSlug) &&
      sectionId !== "" &&
      !sectionId.startsWith(UNLABELED_SECTION_MARK) &&
      sectionId !== listingCatSlug,
  );

  return parsed.some(({ catSlug, sectionId }) => {
    if (!sameCategory(catSlug)) return false;
    if (isCategoryOnlyListing) return hasConcreteExcludedSectionInCategory;
    return listingSection === sectionId;
  });
}

/** The listings the site would offer a party of `quantity` - all three rules at once. */
export function listingsTheSiteSells<T extends TixStockListingRuleFields>(
  listings: readonly T[],
  excludedSections: readonly string[],
  quantity: number = PRICED_PARTY,
): T[] {
  return listings.filter(
    (listing) =>
      !isExcludedSection(listing, excludedSections) &&
      !hasObstructedViewRestriction(listing) &&
      listingCanSatisfyQuantity(listing, quantity),
  );
}

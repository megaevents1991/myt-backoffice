/**
 * Supplier rows -> the tickets a new event carries (tour uploader, build step "tickets first").
 *
 * Two pure functions, one per supplier the uploader sells from:
 *  - `ticketsFromTixStockFeed`: a show's /tickets/feed listings -> one ticket per category, the
 *    cheapest listing the SITE would sell to a pair (`listingsTheSiteSells`, main's three rules),
 *    priced by the function the caller hands in (the build passes `tixstockTicketPriceUsd`, so the
 *    price is the one formula both repos use and the nightly price sync keeps rewriting).
 *  - `ticketsFromLiveStock`: a LiveTickets event's categories -> tickets in the exact shape
 *    `buildLiveTicketsDrafts` (lib/actions/supplier-attach-actions.ts) gives the editor, SELLABLE only.
 *
 * Nothing here fetches, prices by itself or generates an id: the stock, the price function and the
 * id source come in as arguments, which is what lets the selftest run it with synthetic rows. The
 * value imports are the pure rule modules only - `LiveTicketsStock` is a type import because
 * lib/services/livetickets-offers.ts pulls the exchange-rate service (env-dependent) at load.
 *
 * Selftest: scripts/tour-uploader-selftest.ts. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md (build, step 1).
 */
import type { LiveTicketsStock } from "@/lib/services/livetickets-offers";
import { normalizeSupplierCategory, type SupplierCurrency } from "@/lib/suppliers";
import {
  hasObstructedViewRestriction,
  isExcludedSection,
  listingsTheSiteSells,
  PRICED_PARTY,
  type TixStockListingRuleFields,
} from "@/lib/tixstock-listings";
import type { EventTicket } from "@/types/app.types";

/**
 * A listing of TixStock's /tickets/feed: the slice the three site rules read plus the price.
 * Structurally the same as `TixStockFeedTicket` in lib/services/tixstock-price-sync.ts (not
 * imported: that module reads the TixStock env at load).
 */
export interface TixListing extends TixStockListingRuleFields {
  proceed_price?: { amount?: string; currency?: string };
  face_value?: { currency?: string };
}

/**
 * Why a category (or a listing with none) did not become a ticket. `sections` = every listing of the category sits in
 * a map section the hall excludes (round 2, Task 10); `excluded` = no category, or no usable price.
 */
export type TixDropReason = "restricted" | "split" | "excluded" | "sections";

/**
 * The colour every supplier ticket wears on the map: the editor's TixStock tickets (events/[id]/page.tsx,
 * page-local TX_TICKET_COLOR) and `buildLiveTicketsDrafts` write the same value, and the editor rewrites
 * a tx_event ticket whose colour differs - so do not use lib/tixstock-map's CSS-variable constant here.
 */
export const SUPPLIER_TICKET_COLOR = "rgb(5, 32, 60)";

/** Plain code-unit order: the same on every machine, unlike `localeCompare`. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The category as TixStock names it on the listing, trimmed ("" = the listing names none). */
const categoryOf = (listing: TixListing): string =>
  (listing.seat_details?.category ?? "").trim();

/**
 * One listing through the price function, in the currency the supplier quotes it in.
 * The currency fallback mirrors `listingPriceUsd` in tixstock-price-sync.ts (proceed price, then
 * the face value's, then GBP). Null = the listing carries no usable price: it must never become a
 * ticket at the markup alone.
 */
function pricedUsd(
  listing: TixListing,
  priceUsd: (cost: number, currency: string) => number,
): number | null {
  const cost = parseFloat(listing.proceed_price?.amount ?? "");
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const currency = (
    listing.proceed_price?.currency ||
    listing.face_value?.currency ||
    "GBP"
  ).toUpperCase();
  const price = priceUsd(cost, currency);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * The TixStock tickets of a show: one per category, priced from the cheapest listing the site
 * would sell to a pair - cheapest AS PRICED (each listing goes through `priceUsd` first, so a
 * dearer listing in a stronger currency can win).
 *
 * `excludedSections` = the hall's excluded map sections (the venue template's `tixstock_sections`,
 * "<category slug>_<section>"): a listing in one of them is never sold nor priced - main's first rule,
 * through the same `listingsTheSiteSells`; the event is built with the same list, so the site agrees.
 *
 * `dropped` is what the operator is told about, once per CATEGORY - a category whose every listing
 * the rules refused: `sections` when every one of them sits in an excluded section, else `restricted`
 * when any of its listings in the open sections fails the obstructed-view rule, else
 * `split` (the seller will not sell a pair); a category that has a sellable listing keeps its
 * ticket and is not reported even if other listings of it were refused. A category whose sellable
 * listings carry no price is `excluded`, like a listing with no `seat_details.category` at all
 * (reported with category "", once per such listing). Sorted by category, then in feed order.
 * Listings are grouped by `normalizeSupplierCategory` of the category - the key the TixStock price
 * sync and main match a ticket to its listings by (case, accents, punctuation and parenthesised
 * codes do not split a category) - and the ticket carries the group's first-seen raw trimmed name.
 * A category that normalizes to nothing (no letters or digits) counts as no category.
 * `categoriesSeen` = the distinct (normalized) categories of ALL listings, before any rule.
 * Tickets come out sorted by that name, and `newId` is called once per ticket in that order,
 * so the same feed and a counting `newId` always give the same result.
 */
export function ticketsFromTixStockFeed(
  listings: TixListing[],
  eid: string,
  priceUsd: (cost: number, currency: string) => number,
  newId: () => string,
  excludedSections: readonly string[] = [],
): {
  tickets: EventTicket[];
  dropped: { category: string; reason: TixDropReason }[];
  categoriesSeen: number;
} {
  const dropped: { category: string; reason: TixDropReason }[] = [];
  const byCategory = new Map<string, { name: string; listings: TixListing[] }>();
  for (const listing of listings) {
    const name = categoryOf(listing);
    const key = normalizeSupplierCategory(name);
    if (!key) {
      dropped.push({ category: "", reason: "excluded" });
      continue;
    }
    const group = byCategory.get(key);
    if (group) group.listings.push(listing);
    else byCategory.set(key, { name, listings: [listing] });
  }

  // The hall's excluded sections (none on a hall nobody classified) - the list the event is built with.
  const sellable = new Set<TixListing>(listingsTheSiteSells(listings, excludedSections, PRICED_PARTY));

  const tickets: EventTicket[] = [];
  for (const { name: category, listings: group } of [...byCategory.values()].sort((a, b) => byText(a.name, b.name))) {
    const offered = group.filter((listing) => sellable.has(listing));
    if (offered.length === 0) {
      const open = group.filter((listing) => !isExcludedSection(listing, excludedSections));
      dropped.push({
        category,
        reason: open.length === 0 ? "sections" : open.some(hasObstructedViewRestriction) ? "restricted" : "split",
      });
      continue;
    }
    let price: number | null = null;
    for (const listing of offered) {
      const candidate = pricedUsd(listing, priceUsd);
      if (candidate !== null && (price === null || candidate < price)) price = candidate;
    }
    if (price === null) {
      dropped.push({ category, reason: "excluded" });
      continue;
    }
    tickets.push({
      id: newId(),
      eid,
      supplier: "tixstock",
      vendor: "TixStock",
      category,
      supplierCategory: category,
      description: "",
      price,
      colorOnTheMap: SUPPLIER_TICKET_COLOR,
      available: true,
    });
  }

  return { tickets, dropped, categoriesSeen: byCategory.size };
}

/** A LiveTickets category dropped for having no usable cost (the build names it in a decision line). */
export const NO_PRICE_REASON = "no price";

/**
 * The LiveTickets tickets of one of their events. `stock` is what `fetchLiveTicketsStock` answers:
 * the stock, "SOLD_OUT" (they have the event, no categories on sale) or null (no answer and no
 * snapshot). `sellable` categories become tickets; a category that is blocked is dropped with its
 * `blockedReason`, so the operator can name it ("3 categories left out"). The one exception is the
 * category blocked ONLY for not confirming instantly: with `opts.nonInstant` it becomes a ticket
 * marked `nonInstant: true` (the shape the attach flow writes and the price sync keeps on sale; the
 * site sells it with a warning) as long as it has a usable cost, and `nonInstant` counts those
 * tickets. Without the option it is dropped like any blocked category. An unusable stock is a
 * `state`, never an empty "ok": the build must tell "sold out" and "LiveTickets did not answer" apart.
 * Ticket shape = `buildLiveTicketsDrafts`: `id` is THEIR category id (what the price sync and main
 * match on), `eid` their event id, the price is `priceUsd(cost, currency)`. Input order is kept.
 */
export function ticketsFromLiveStock(
  stock: LiveTicketsStock | "SOLD_OUT" | null,
  eid: string,
  priceUsd: (cost: number, currency: SupplierCurrency) => number,
  opts: { nonInstant: boolean } = { nonInstant: false },
): {
  tickets: EventTicket[];
  dropped: { title: string; reason: string }[];
  state: "ok" | "sold_out" | "unreachable";
  /** How many of `tickets` are marked `nonInstant` (always 0 without `opts.nonInstant`). */
  nonInstant: number;
} {
  if (stock === null) return { tickets: [], dropped: [], state: "unreachable", nonInstant: 0 };
  if (stock === "SOLD_OUT") return { tickets: [], dropped: [], state: "sold_out", nonInstant: 0 };

  const tickets: EventTicket[] = [];
  const dropped: { title: string; reason: string }[] = [];
  let nonInstant = 0;
  for (const category of stock.categories) {
    const title = category.title || category.hebTitle;
    const asNonInstant = opts.nonInstant && category.nonInstantOnly;
    if (!asNonInstant && (!category.sellable || category.nonInstantOnly)) {
      dropped.push({ title, reason: category.blockedReason || "Not sellable" });
      continue;
    }
    // The TixStock side's rule: a category with no usable cost (0, negative, NaN) never becomes a
    // ticket at the markup alone - and neither does one the price function cannot price.
    const price = Number.isFinite(category.cost) && category.cost > 0 ? priceUsd(category.cost, stock.currency) : NaN;
    if (!Number.isFinite(price) || price <= 0) {
      dropped.push({ title, reason: NO_PRICE_REASON });
      continue;
    }
    tickets.push({
      id: category.id,
      eid,
      supplier: "livetickets",
      vendor: "LiveTickets",
      category: title,
      supplierCategory: title,
      description: category.description,
      price,
      colorOnTheMap: SUPPLIER_TICKET_COLOR,
      available: true,
      ...(asNonInstant ? { nonInstant: true } : {}),
    });
    if (asNonInstant) nonInstant += 1;
  }
  return { tickets, dropped, state: "ok", nonInstant };
}

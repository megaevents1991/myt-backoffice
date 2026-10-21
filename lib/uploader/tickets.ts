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
import type { SupplierCurrency } from "@/lib/suppliers";
import {
  hasObstructedViewRestriction,
  listingsTheSiteSells,
  PRICED_PARTY,
  type TixStockListingRuleFields,
} from "@/lib/tixstock-listings";
import { TX_TICKET_COLOR } from "@/lib/tixstock-map";
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

/** Why a category (or a listing with none) did not become a ticket. */
export type TixDropReason = "restricted" | "split" | "excluded";

/** The colour LiveTickets tickets wear on the map - `buildLiveTicketsDrafts`' own value. */
const LIVE_TICKET_COLOR = "rgb(5, 32, 60)";

/** Plain code-unit order: the same on every machine, unlike `localeCompare`. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
 * `dropped` is what the operator is told about, once per CATEGORY - a category whose every listing
 * the rules refused, `restricted` when any of its listings fails the obstructed-view rule, else
 * `split` (the seller will not sell a pair); a category that has a sellable listing keeps its
 * ticket and is not reported even if other listings of it were refused. A category whose sellable
 * listings carry no price is `excluded`, like a listing with no `seat_details.category` at all
 * (reported with category "", once per such listing). Sorted by category, then in feed order.
 * `categoriesSeen` = the distinct categories of ALL listings, before any rule.
 * Tickets come out sorted by category name, and `newId` is called once per ticket in that order,
 * so the same feed and a counting `newId` always give the same result.
 */
export function ticketsFromTixStockFeed(
  listings: TixListing[],
  eid: string,
  priceUsd: (cost: number, currency: string) => number,
  newId: () => string,
): {
  tickets: EventTicket[];
  dropped: { category: string; reason: TixDropReason }[];
  categoriesSeen: number;
} {
  const dropped: { category: string; reason: TixDropReason }[] = [];
  const byCategory = new Map<string, TixListing[]>();
  for (const listing of listings) {
    const category = categoryOf(listing);
    if (!category) {
      dropped.push({ category: "", reason: "excluded" });
      continue;
    }
    const group = byCategory.get(category);
    if (group) group.push(listing);
    else byCategory.set(category, [listing]);
  }

  // No section is excluded on a brand-new event (staff set `tx_excluded_sections` later).
  const sellable = new Set<TixListing>(listingsTheSiteSells(listings, [], PRICED_PARTY));

  const tickets: EventTicket[] = [];
  for (const category of [...byCategory.keys()].sort(byText)) {
    const group = byCategory.get(category) ?? [];
    const offered = group.filter((listing) => sellable.has(listing));
    if (offered.length === 0) {
      dropped.push({
        category,
        reason: group.some(hasObstructedViewRestriction) ? "restricted" : "split",
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
      colorOnTheMap: TX_TICKET_COLOR,
      available: true,
    });
  }

  return { tickets, dropped, categoriesSeen: byCategory.size };
}

/**
 * The LiveTickets tickets of one of their events. `stock` is what `fetchLiveTicketsStock` answers:
 * the stock, "SOLD_OUT" (they have the event, no categories on sale) or null (no answer and no
 * snapshot). Only `sellable` categories become tickets; a category that is blocked - including the
 * one blocked ONLY for not confirming instantly - is dropped with its `blockedReason`, so the
 * operator can name it ("3 non-instant categories left out"). An unusable stock is a `state`, never
 * an empty "ok": the build must tell "sold out" and "LiveTickets did not answer" apart.
 * Ticket shape = `buildLiveTicketsDrafts`: `id` is THEIR category id (what the price sync and main
 * match on), `eid` their event id, the price is `priceUsd(cost, currency)`. Input order is kept.
 */
export function ticketsFromLiveStock(
  stock: LiveTicketsStock | "SOLD_OUT" | null,
  eid: string,
  priceUsd: (cost: number, currency: SupplierCurrency) => number,
): {
  tickets: EventTicket[];
  dropped: { title: string; reason: string }[];
  state: "ok" | "sold_out" | "unreachable";
} {
  if (stock === null) return { tickets: [], dropped: [], state: "unreachable" };
  if (stock === "SOLD_OUT") return { tickets: [], dropped: [], state: "sold_out" };

  const tickets: EventTicket[] = [];
  const dropped: { title: string; reason: string }[] = [];
  for (const category of stock.categories) {
    const title = category.title || category.hebTitle;
    if (!category.sellable || category.nonInstantOnly) {
      dropped.push({ title, reason: category.blockedReason || "Not sellable" });
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
      price: priceUsd(category.cost, stock.currency),
      colorOnTheMap: LIVE_TICKET_COLOR,
      available: true,
    });
  }
  return { tickets, dropped, state: "ok" };
}

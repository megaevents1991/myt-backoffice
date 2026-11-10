// The two hidden test events of TixStock's health check, as data: which tickets a SANDBOX feed becomes and the
// exact `events` rows scripts/tixstock-sandbox-test-events.ts writes. Pure - no DB, no network, no env.
//
//   A  `tixstock_booking: "sandbox_site"`    TixStock's testers buy on the site, the site books after payment.
//   B  `tixstock_booking: "sandbox_office"`  staff book from the reservation's "Book ticket" button.
//
// Every row is built field by field - never copied from a real event, which would carry its prices, pictures,
// ready package and campaign fields. Both rows are `is_test` (no list, no feed, no partner list, noindex) and NOT
// hidden: confirm-order refuses a hidden event, and the testers must be able to pay.
// Test: scripts/tixstock-sandbox-events-selftest.ts. Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.8, 7.13.
import type { RawListing } from "../tixstock-booking/client";
import type { TixstockBookingMode } from "../tixstock-booking/rules";

/** "Juventus FC vs Como" in TixStock's SANDBOX - the event their health check runs on (Serie A, venue in Italy). */
export const SANDBOX_TIXSTOCK_EVENT_ID = "01kja2n8zk31zyv0z7zxkzf8vd";

/** The script finds its rows by these names, so a second run never creates a third event. */
export const SANDBOX_EVENT_NAMES: Record<TixstockBookingMode, string> = {
  sandbox_site: "TEST · Juventus FC vs Como (TixStock sandbox)",
  sandbox_office: "TEST · Juventus FC vs Como (TixStock sandbox · office)",
};

/** What the customer pays over the ticket, in USD. Small on purpose: the testers pay real money and are refunded. */
export const SANDBOX_TICKET_ONLY_MARKUP_USD = 5;

/** The colour every supplier ticket wears (lib/uploader/tickets.ts `SUPPLIER_TICKET_COLOR`). */
const SUPPLIER_TICKET_COLOR = "rgb(5, 32, 60)";

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** The feed sends booleans as strings ("false" / "true", seen 10.11.2026): `"false"` must read as false. */
const flag = (v: unknown): boolean => v === true || v === 1 || (typeof v === "string" && ["true", "1", "yes"].includes(v.trim().toLowerCase()));

export type ListingFacts = {
  id: string;
  category: string;
  section: string;
  row: string;
  type: string;
  splitType: string;
  deliveryType: string;
  leadBooker: boolean;
  instantDownload: boolean;
  quantity: number;
  displayQuantity: number;
  /** `proceed_price.amount` as a number; null when the listing has no price. */
  amount: number | null;
  currency: string;
};

/** One listing in the feed's own words - what the script prints, so the sandbox's real spellings are on record. */
export function listingFacts(listing: RawListing): ListingFacts {
  const ticket = rec(listing.ticket);
  const seat = rec(listing.seat_details);
  const sale = rec(listing.number_of_tickets_for_sale);
  const price = rec(listing.proceed_price);
  const amount = text(price.amount) === "" ? NaN : Number(text(price.amount));
  return {
    id: text(listing.id),
    category: text(seat.category),
    section: text(seat.section),
    row: text(seat.row),
    type: text(ticket.type),
    splitType: text(ticket.split_type),
    deliveryType: text(rec(listing.delivery).type),
    leadBooker: flag(listing.requires_lead_booker),
    instantDownload: flag(ticket.instant_download),
    quantity: count(sale.quantity_available),
    displayQuantity: count(sale.display_quantity),
    amount: Number.isFinite(amount) ? amount : null,
    currency: text(price.currency).toUpperCase(),
  };
}

/**
 * Comparable form of a TixStock category name - a copy of myt-main `lib/tixstock-category.ts` `normalizeTxCategory`
 * (accents, parenthesised codes and punctuation dropped), so a row here is found by the site's own matching.
 */
const categoryKey = (category: string): string =>
  category
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A `tickets_and_rates` row. Open-ended: a row the event editor touched carries more (zone, description). */
export type SandboxTicket = Record<string, unknown> & { id: string; category: string; price: number };

/**
 * The event's `tickets_and_rates` from the sandbox feed: one row per category, priced like the card the site will
 * show - the cheapest listing of the category, rounded up to a whole dollar. Only a listing that can get a card
 * counts: on sale, priced in USD (the client asks for `target_currency=USD`; another currency is never converted
 * here) and not a lead-booker listing.
 *
 * `existing` = the rows the event has now. A row of the same category keeps its id and everything the editor
 * added (zone, colour, description) and takes the new price; a row whose category left the feed is returned
 * untouched, because an order may point at its id.
 */
export function sandboxTickets(listings: RawListing[], tixEventId: string, existing: SandboxTicket[], newId: () => string): SandboxTicket[] {
  const cheapest = new Map<string, { category: string; amount: number }>();
  for (const listing of listings) {
    const facts = listingFacts(listing);
    const key = categoryKey(facts.category);
    if (!key || facts.amount === null || facts.amount <= 0 || facts.currency !== "USD") continue;
    if (facts.quantity < 1 || facts.leadBooker) continue;
    const seen = cheapest.get(key);
    if (!seen) cheapest.set(key, { category: facts.category, amount: facts.amount });
    else if (facts.amount < seen.amount) seen.amount = facts.amount;
  }

  const out: SandboxTicket[] = [];
  const used = new Set<string>();
  for (const row of existing) {
    const key = categoryKey(row.category);
    const live = used.has(key) ? undefined : cheapest.get(key);
    if (!live) {
      out.push(row);
      continue;
    }
    used.add(key);
    out.push({ ...row, price: Math.ceil(live.amount), eid: tixEventId, available: true });
  }
  for (const [key, live] of cheapest) {
    if (used.has(key)) continue;
    out.push({
      id: newId(),
      category: live.category,
      description: "",
      colorOnTheMap: SUPPLIER_TICKET_COLOR,
      price: Math.ceil(live.amount),
      eid: tixEventId,
      available: true,
      supplier: "tixstock",
    });
  }
  return out;
}

/**
 * One test event, every column it sets. Left to their defaults on purpose: the venue map (attached in the event
 * editor, "Suppliers & zones", where the categories get their zones), pictures, ready package, campaign fields
 * and every per-event markup except the ticket-only one.
 */
export function sandboxEventRow(mode: TixstockBookingMode, tickets: SandboxTicket[]): Record<string, unknown> {
  return {
    name: SANDBOX_EVENT_NAMES[mode],
    name_english: "Juventus FC vs Como",
    type: "tx_event",
    date: "2027-06-11",
    description: "",
    def_date_depart: "2027-06-10",
    def_date_return: "2027-06-12",
    // Allianz Stadium, Torino. The Italian attendee form does not read this: it follows the TixStock event's own
    // venue.country_code (the sandbox feed answers IT).
    location: { name: "טורינו, איטליה", latitude: 45.1096, longitude: 7.6413, city_iata: "TRN", country_code: "IT" },
    card_image_url: "",
    tags: "",
    is_test: true,
    is_hidden: false,
    is_deleted: null,
    package_mode: "ticket_only",
    skip_flight: true,
    ticket_only_markup: SANDBOX_TICKET_ONLY_MARKUP_USD,
    base_flight_price: 0,
    base_hotel_price: 0,
    usual_price: 0,
    tickets_and_rates: tickets,
    tixstock_booking: mode,
  };
}

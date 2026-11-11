// Run: npx tsx scripts/tixstock-booking-rank-selftest.ts
// Who sees the ticket-booking card (lib/fulfilment/visibility.ts) and how the booking dialog ranks the live
// listings and states the gap to the cost the order was sold with (lib/tixstock-booking/rank.ts). Pure - no DB,
// no network. Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.1, 7.2.
import assert from "node:assert/strict";
import { adminOrHidden, fulfilmentVisibleTo } from "../lib/fulfilment/visibility";
import { rankListings, type RankInput } from "../lib/tixstock-booking/rank";
import {
  bookingAvailability,
  eventForBooking,
  fitAttendees,
  hotelShippingOf,
  reservationAttendees,
  reservationBuyer,
  soldTicketOf,
  venueItaly,
} from "../lib/tixstock-booking/office-open";
import { toBookingView, toFileView, waitingReservations } from "../lib/tixstock-booking/booking-view";

const cases: Array<[string, () => void | Promise<void>]> = [];
const it = (name: string, run: () => void | Promise<void>): void => {
  cases.push([name, run]);
};

type Over = {
  id?: string;
  category?: string;
  amount?: string;
  available?: number;
  split?: string;
  splitQty?: number;
  type?: string;
  row?: string;
  lead?: unknown;
  options?: unknown[];
  instant?: string;
  delivery?: string;
};

/** A listing as the feed sends it: amounts and booleans are strings. */
const listing = (over: Over = {}) => ({
  id: over.id ?? "L1",
  requires_lead_booker: over.lead ?? "false",
  ticket: { general_admission: "false", type: over.type ?? "eTicket", split_type: over.split ?? "No Preferences", instant_download: over.instant ?? "false" },
  number_of_tickets_for_sale: { quantity_available: over.available ?? 4, display_quantity: 0, split_quantity: over.splitQty ?? 0 },
  seat_details: { category: over.category ?? "Longside", section: "101", row: over.row ?? "5" },
  proceed_price: { currency: "USD", amount: over.amount ?? "70.00" },
  restrictions_benefits: { options: over.options ?? [], other: "" },
  delivery: { type: "EMAIL", shipped_date_or_date_in_hand: over.delivery ?? "2027-06-09" },
});

const input = (over: Partial<RankInput> = {}): RankInput => ({
  soldCategory: "longside",
  quantity: 2,
  together: false,
  excludedSections: [],
  costSoldTotalUsd: null,
  ...over,
});

it("visibility", () => {
  assert.equal(fulfilmentVisibleTo("superadmin", undefined), true);
  assert.equal(fulfilmentVisibleTo("superadmin", "false"), true);
  assert.equal(fulfilmentVisibleTo("admin", undefined), false);
  assert.equal(fulfilmentVisibleTo("admin", "false"), false);
  assert.equal(fulfilmentVisibleTo("admin", "true"), true);
  assert.equal(fulfilmentVisibleTo("editor", "true"), false);
  assert.equal(fulfilmentVisibleTo("agent", "true"), false);
  assert.equal(fulfilmentVisibleTo(undefined, "true"), false);
});

it("guard never throws", async () => {
  assert.equal(await adminOrHidden(async () => { throw new Error("Unauthorized"); }), false);
  assert.equal(await adminOrHidden(async () => ({ role: "admin" })), true);
});

it("same category first, cheapest first", () => {
  const ranked = rankListings(
    [
      listing({ id: "dear", category: "Longside", amount: "90.00" }),
      listing({ id: "cheap", category: "Longside", amount: "70.00" }),
      listing({ id: "goal", category: "Behind Goal", amount: "50.00" }),
    ],
    input(),
  );
  assert.deepEqual(ranked.sameCategory.map((l) => l.listingId), ["cheap", "dear"]);
  assert.deepEqual(ranked.others.map((l) => l.listingId), ["goal"]);
});

it("the sold category is matched the way the site matches TixStock names", () => {
  const ranked = rankListings([listing({ id: "a", category: "Categoría 2 (CAT2) - Fondo" })], input({ soldCategory: "categoria 2 fondo" }));
  assert.deepEqual(ranked.sameCategory.map((l) => l.listingId), ["a"]);
  const unknown = rankListings([listing({ id: "a" })], input({ soldCategory: null }));
  assert.deepEqual([unknown.sameCategory.length, unknown.others.length], [0, 1]);
});

it("gap", () => {
  const [dearer] = rankListings([listing({ amount: "70.00" })], input({ costSoldTotalUsd: 120 })).sameCategory;
  assert.equal(dearer.pricePerTicketUsd, 70);
  assert.equal(dearer.totalUsd, 140);
  assert.equal(dearer.gapUsd, 20);
  assert.ok(dearer.gapPct !== null && Math.abs(dearer.gapPct - 16.67) < 0.01, String(dearer.gapPct));
  assert.equal(dearer.dearer, true);

  const [cheaper] = rankListings([listing({ amount: "55.10" })], input({ costSoldTotalUsd: 120 })).sameCategory;
  assert.equal(cheaper.pricePerTicketUsd, 55.1, "the feed's amount, not rounded");
  assert.equal(cheaper.totalUsd, 110.2);
  assert.equal(cheaper.gapUsd, -9.8);
  assert.equal(cheaper.dearer, false);

  const [unknown] = rankListings([listing()], input({ costSoldTotalUsd: null })).sameCategory;
  assert.equal(unknown.gapUsd, null);
  assert.equal(unknown.gapPct, null);
  assert.equal(unknown.dearer, false);
});

it("together excludes single seats", () => {
  const listings = [listing({ id: "single", split: "Single Seats" }), listing({ id: "block", split: "All Together", available: 2 }), listing({ id: "said", row: "*TOGETHER*" })];
  const together = rankListings(listings, input({ together: true }));
  assert.deepEqual(together.sameCategory.map((l) => l.listingId).sort(), ["block", "said"]);
  const any = rankListings(listings, input({ together: false }));
  assert.equal(any.sameCategory.some((l) => l.listingId === "single"), true);
});

it("restricted view excluded", () => {
  const ranked = rankListings([listing({ id: "blocked", options: ["Restricted view"] }), listing({ id: "clear" })], input());
  assert.deepEqual(ranked.sameCategory.map((l) => l.listingId), ["clear"]);
});

it("a listing that cannot sell the party is not offered", () => {
  const ranked = rankListings([listing({ id: "one", available: 1 }), listing({ id: "orphan", available: 3, split: "Avoid Leaving One Ticket" })], input());
  assert.deepEqual([...ranked.sameCategory, ...ranked.others], []);
});

it("paper flagged", () => {
  const [paper] = rankListings([listing({ type: "PAPER" })], input()).sameCategory;
  assert.equal(paper.paper, true);
  const [eTicket] = rankListings([listing({ type: "eTicket" })], input()).sameCategory;
  assert.equal(eTicket.paper, false);
});

it("lead booker flagged", () => {
  const [lead] = rankListings([listing({ lead: true })], input()).sameCategory;
  assert.equal(lead.leadBooker, true);
  const [asString] = rankListings([listing({ lead: "true" })], input()).sameCategory;
  assert.equal(asString.leadBooker, true);
  const [plain] = rankListings([listing({ lead: "false" })], input()).sameCategory;
  assert.equal(plain.leadBooker, false, 'the string "false" is false');
});

it("the listing's own details ride with it", () => {
  const [l] = rankListings([listing({ options: ["Away fans section", { name: "Age", value: "16+" }], instant: "true", delivery: "2027-06-09" })], input()).sameCategory;
  assert.deepEqual(l.restrictions, ["Away fans section", "Age: 16+"]);
  assert.equal(l.instantDownload, true);
  assert.equal(l.deliveryDate, "2027-06-09");
  assert.deepEqual([l.category, l.section, l.row, l.ticketType, l.splitType], ["Longside", "101", "5", "eTicket", "No Preferences"]);
});

it("a listing with no price or no id is not offered", () => {
  const ranked = rankListings([listing({ amount: "" }), listing({ id: "", amount: "50" }), listing({ id: "zero", amount: "0" })], input());
  assert.deepEqual([...ranked.sameCategory, ...ranked.others], []);
});

it("the buyer is the order's main contact, the attendees are the lead and then the other travellers", () => {
  const reservation = {
    main_contact_first_name: " Dana ",
    main_contact_last_name: "Levi",
    main_contact_email: " dana@example.com ",
    main_contact_phone_number: "0501234567",
    more_pax_info: [{ first_name: "Omer", last_name: " Levi " }, null, { first_name: 7 }, "x"],
  };
  assert.deepEqual(reservationBuyer(reservation), { first_name: "Dana", last_name: "Levi", email: "dana@example.com", phone: "0501234567" });
  assert.deepEqual(reservationAttendees(reservation), [
    { first_name: "Dana", last_name: "Levi" },
    { first_name: "Omer", last_name: "Levi" },
    { first_name: "", last_name: "" },
    { first_name: "", last_name: "" },
    { first_name: "", last_name: "" },
  ]);
  assert.deepEqual(reservationAttendees({ ...reservation, more_pax_info: null }), [{ first_name: "Dana", last_name: "Levi" }]);
});

it("the ticket the order was sold with: supplier, TixStock event, category, party, seating promise", () => {
  assert.deepEqual(
    soldTicketOf({ supplier: "tixstock", supplier_event_id: " TX9 ", supplier_category: "Longside Lower", category: "Longside", number_of_ticket: 3, seating_choice: "together", event_type: "tx_event" }),
    { supplier: "tixstock", tixEventId: "TX9", category: "Longside Lower", quantity: 3, together: true },
  );
  // A ticket that names no supplier is TixStock's on a `tx_event`, exactly as the site reads it.
  assert.deepEqual(soldTicketOf({ category: "Longside", number_of_ticket: "2", event_type: "tx_event" }), { supplier: "tixstock", tixEventId: null, category: "Longside", quantity: 2, together: false });
  assert.equal(soldTicketOf({ supplier: "livetickets", supplier_event_id: "77", category: "A", number_of_ticket: 2, event_type: "tx_event" }).supplier, "livetickets");
  assert.equal(soldTicketOf({ category: "A", number_of_ticket: 2, event_type: "sports_event" }).supplier, "static");
  assert.equal(soldTicketOf(null).quantity, 0);
});

it("a paper ticket can be shipped to the order's hotel: its name, address and check-in day", () => {
  assert.deepEqual(hotelShippingOf({ name: " Hotel Roma ", address: "Via Roma 1, Torino", checkin: "2027-06-10", rate: {} }), { name: "Hotel Roma", address: "Via Roma 1, Torino", check_in: "2027-06-10" });
  assert.equal(hotelShippingOf({}), null, "a skipped hotel is an empty object");
  assert.equal(hotelShippingOf(null), null);
  assert.equal(hotelShippingOf({ name: "Hotel", address: "" }), null);
});

const BOOKING_ROW = {
  id: "9f3a1c2e-1111-4222-8333-444455556666",
  reservation_id: 2233,
  env: "sandbox",
  source: "office",
  status: "sale_on_hold",
  tixstock_order_id: "TX-1",
  quantity: 2,
  listing: { category: "Longside", ticketType: "eTicket", restrictions: ["Away fans"], italian: true },
  price_per_ticket: "59.20",
  total: "118.40",
  order_currency: "USD",
  order_total: 118.4,
  cost_sold_usd: 110,
  buyer: { first_name: "Dana", last_name: "Levi", email: "dana@example.com", phone: "050" },
  attendees: [{ first_name: "Dana", last_name: "Levi", passport: "123" }, "junk"],
  last_error: null,
  created_at: "2026-11-11T08:00:00Z",
  updated_at: "2026-11-11T08:00:00Z",
  approved_at: null,
  checked_at: null,
  checked_by: null,
  sent_to_customer_at: null,
  sent_channels: ["email"],
  released_to_customer_at: null,
  customer_token: "t".repeat(43),
  uncertain_resolution: null,
};

it("the card's view of a booking row", () => {
  const view = toBookingView(BOOKING_ROW, new Date("2026-11-11T09:45:00Z"));
  assert.ok(view);
  assert.deepEqual(
    [view.env, view.source, view.status, view.tixstockOrderId, view.ourOrderId, view.quantity, view.pricePerTicket, view.total, view.costSoldUsd],
    ["sandbox", "office", "sale_on_hold", "TX-1", "2233-9f3a1c2e", 2, 59.2, 118.4, 110],
  );
  assert.equal(view.listing.category, "Longside");
  assert.equal(view.listing.italian, true);
  assert.deepEqual(view.attendees, [{ first_name: "Dana", last_name: "Levi", passport: "123" }]);
  assert.equal(view.customerPageUrl, `https://www.mega-events.co.il/ticket/${"t".repeat(43)}`);
  assert.equal(view.saleOnHoldMinutes, 105, "sale on hold since the row's last status change");
  assert.equal(toBookingView({ ...BOOKING_ROW, status: "approved" }, new Date("2026-11-11T09:45:00Z"))?.saleOnHoldMinutes, null);
  assert.equal(toBookingView({ ...BOOKING_ROW, status: "bogus" }, new Date()), null, "a row with a status we do not know is not shown");
  assert.equal(toBookingView({ ...BOOKING_ROW, env: "staging" }, new Date()), null);
});

it("a file is a link staff can open only when it is safe to open", () => {
  const base = { id: "f1", row: "5", seat: "12", received_at: "2026-11-11T09:00:00Z" };
  assert.deepEqual(toFileView({ ...base, kind: "pdf", url: null }, "https://signed.example/x"), { id: "f1", kind: "pdf", row: "5", seat: "12", href: "https://signed.example/x", text: null, receivedAt: "2026-11-11T09:00:00Z" });
  assert.equal(toFileView({ ...base, kind: "mobile_link", url: "https://tickets.example/a" }, null).href, "https://tickets.example/a");
  assert.equal(toFileView({ ...base, kind: "proof", url: "http://proof.example/a" }, null).href, "http://proof.example/a");
  // A seller's text that is not an http(s) link is shown to staff as text, never as a link.
  const hostile = toFileView({ ...base, kind: "mobile_link", url: "javascript:alert(1)" }, null);
  assert.deepEqual([hostile.href, hostile.text], [null, "javascript:alert(1)"]);
  // A stored file whose signed URL could not be made has nothing to open.
  assert.deepEqual([toFileView({ ...base, kind: "pdf", url: null }, null).href, toFileView({ ...base, kind: "pdf", url: null }, null).text], [null, null]);
});

it("tickets waiting: an office booking with at least one file that nobody sent yet", () => {
  const bookings = [
    { id: "b1", reservation_id: 11 },
    { id: "b2", reservation_id: 12 },
    { id: "b3", reservation_id: 11 },
  ];
  assert.deepEqual([...waitingReservations(bookings, new Set(["b1", "b3"]))], [11], "one mark per reservation");
  assert.deepEqual([...waitingReservations(bookings, new Set(["b2"]))], [12]);
  assert.deepEqual([...waitingReservations(bookings, new Set())], [], "a booking with no file yet is not waiting");
});

it("the attendees are fitted to the tickets: blank rows for names nobody typed, never more rows than tickets", () => {
  const dana = { first_name: "Dana", last_name: "Levi" };
  const omer = { first_name: "Omer", last_name: "Levi" };
  assert.deepEqual(fitAttendees([dana], 3), [dana, { first_name: "", last_name: "" }, { first_name: "", last_name: "" }], "a hand-typed reservation of three with one name can still be booked: staff type the rest");
  assert.deepEqual(fitAttendees([dana, omer, { first_name: "X", last_name: "Y" }], 2), [dana, omer]);
  assert.deepEqual(fitAttendees([dana, omer], 2), [dana, omer]);
  assert.deepEqual(fitAttendees([], 0), []);
});

it("an Italian venue is never guessed: a venue that could not be read is unknown, not 'not Italian'", () => {
  const ok = (data: string | null) => ({ ok: true as const, data });
  const failed = { ok: false as const, kind: "no_answer" as const, detail: "timeout" };
  assert.equal(venueItaly(ok("IT"), null), true);
  assert.equal(venueItaly(ok("it"), null), true);
  assert.equal(venueItaly(ok("GB"), "IT"), false, "the live venue wins over the table");
  assert.equal(venueItaly(ok(null), "IT"), true, "a venue with no country falls back to what the sync knows");
  assert.equal(venueItaly(ok(null), null), false, "a venue that was read and names no country is not Italian (staff can still tick the details)");
  assert.equal(venueItaly(failed, "IT"), true);
  assert.equal(venueItaly(failed, "gb"), false);
  assert.equal(venueItaly(failed, null), null, "nothing to go by: the dialog refuses instead of dropping the identity details");
  assert.equal(venueItaly(failed, "  "), null);
});

it("which TixStock event a reservation may be booked on", () => {
  const sold = (over: Partial<ReturnType<typeof soldTicketOf>> = {}) => ({ supplier: "tixstock", tixEventId: "TX9", category: "Longside", quantity: 2, together: false, ...over });
  assert.deepEqual(eventForBooking(sold(), ""), { ok: true, eventId: "TX9", soldCategory: "Longside" });
  assert.deepEqual(eventForBooking(sold(), " TX7 "), { ok: true, eventId: "TX7", soldCategory: "Longside" }, "staff may pick another TixStock event for a TixStock order");
  assert.deepEqual(eventForBooking(sold({ tixEventId: null }), ""), { ok: false, kind: "no_event" });
  // Our own stock, or a hand-typed order: no event of its own - staff pick one, and no category is "the sold one".
  assert.deepEqual(eventForBooking(sold({ supplier: "static", tixEventId: null }), ""), { ok: false, kind: "no_event" });
  assert.deepEqual(eventForBooking(sold({ supplier: "static", tixEventId: null }), "TX7"), { ok: true, eventId: "TX7", soldCategory: null });
  // Sold from another supplier: its ticket is bought THERE. Booking it at TixStock too would be a second, final
  // purchase - refused, whatever event was picked (spec 7.1: other suppliers get the manual mark only).
  assert.deepEqual(eventForBooking(sold({ supplier: "livetickets", tixEventId: "77" }), ""), { ok: false, kind: "not_tixstock" });
  assert.deepEqual(eventForBooking(sold({ supplier: "livetickets", tixEventId: "77" }), "TX7"), { ok: false, kind: "not_tixstock" });
  assert.deepEqual(eventForBooking(sold({ quantity: 0 }), ""), { ok: false, kind: "no_event" });
});

it("the book button is available only where a booking can really be placed", () => {
  type Env = "sandbox" | "production";
  const asked: Env[] = [];
  const clients = (state: Partial<Record<Env, "production_closed" | "not_configured">>) => (env: Env) => {
    asked.push(env);
    const kind = state[env];
    return kind ? ({ ok: false, kind } as const) : ({ ok: true } as const);
  };
  const real = { is_test: false, tixstock_booking: null };
  const test = { is_test: true, tixstock_booking: "sandbox_office" };

  // A real event books in production: closed until the production switch is on AND its own token is set.
  assert.deepEqual(bookingAvailability(real, clients({ production: "production_closed" })), { available: false, reason: "production_closed" });
  assert.deepEqual(bookingAvailability(real, clients({ production: "not_configured" })), { available: false, reason: "not_configured" });
  assert.deepEqual(bookingAvailability(real, clients({})), { available: true, env: "production" });
  // A real event is production whatever its `tixstock_booking` says, and a sandbox that works does not open it.
  assert.deepEqual(bookingAvailability({ is_test: false, tixstock_booking: "sandbox_office" }, clients({ production: "production_closed" })), { available: false, reason: "production_closed" });

  // A test event books in the sandbox, production closed or not.
  assert.deepEqual(bookingAvailability(test, clients({ production: "production_closed" })), { available: true, env: "sandbox" });
  assert.deepEqual(bookingAvailability(test, clients({ sandbox: "not_configured" })), { available: false, reason: "not_configured" });

  // A test event with no known mode books nowhere - and no environment is even asked about.
  asked.length = 0;
  assert.deepEqual(bookingAvailability({ is_test: true, tixstock_booking: null }, clients({})), { available: false, reason: "test_without_sandbox" });
  assert.deepEqual(asked, []);
  // An event that could not be read is never "available".
  assert.deepEqual(bookingAvailability(null, clients({})), { available: false, reason: "not_configured" });
});

const main = async (): Promise<void> => {
  for (const [name, run] of cases) {
    await run();
    console.log("ok -", name);
  }
  console.log("tixstock-booking-rank-selftest: all passed");
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

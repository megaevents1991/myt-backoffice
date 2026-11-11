// Run: npx tsx scripts/tixstock-office-booking-selftest.ts
// The "Book ticket" action of a reservation (lib/tixstock-booking/office-booking.ts): hold the listing staff
// picked, place the order as Approved, keep the row honest about what happened. Every DB, TixStock and audit call
// is a stub - no network. What matters most: an order at TixStock is FINAL, so nothing is ordered twice, an
// unanswered orders/add is `uncertain` (never retried, never released), and staff's three ticks come before any call.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.1-7.4.
import assert from "node:assert/strict";
import type { TixstockCall } from "../lib/tixstock-booking/client";
import { runOfficeBooking, type OfficeBookingInput, type OfficeDeps } from "../lib/tixstock-booking/office-booking";
import type { RankedListing } from "../lib/tixstock-booking/rank";
import { ourOrderId, type BookingStatus } from "../lib/tixstock-booking/rules";

const ID = "9f3a1c2e-1111-4222-8333-444455556666";
const ok = <T>(data: T): TixstockCall<T> => ({ ok: true, data });
const refused = (status: number, message: string, code?: number): TixstockCall<never> => ({ ok: false, kind: "refused", status, message, code });
const noAnswer: TixstockCall<never> = { ok: false, kind: "no_answer", detail: "timeout" };

const ranked = (over: Partial<RankedListing> = {}): RankedListing => ({
  listingId: "L1",
  category: "Longside",
  section: "101",
  row: "5",
  ticketType: "eTicket",
  splitType: "No Preferences",
  generalAdmission: false,
  pricePerTicketUsd: 59.2,
  totalUsd: 118.4,
  gapUsd: -1.6,
  gapPct: -1.33,
  dearer: false,
  restrictions: ["Away fans"],
  deliveryDate: "2027-06-09",
  deliveryType: "EMAIL",
  instantDownload: false,
  paper: false,
  leadBooker: false,
  ...over,
});

type World = {
  /** What the SERVER read about the venue when the button was pressed. */
  venueItalian: boolean;
  listing: RankedListing | null;
  context: Awaited<ReturnType<OfficeDeps["loadContext"]>> | null;
  insert: { ok: true } | { ok: false; kind: "locked" | "db" };
  holdAnswer: TixstockCall<{ holdId: string }>;
  addAnswers: Array<TixstockCall<{ orderId: string; status: string; currency: string | null; total: number | null }>>;
};

const world = (over: Partial<World> = {}) => {
  const w: World = {
    venueItalian: false,
    listing: ranked(),
    context: null,
    insert: { ok: true },
    holdAnswer: ok({ holdId: "H1" }),
    addAnswers: [ok({ orderId: "TX-1", status: "Approved", currency: "USD", total: 118.4 })],
    ...over,
  };
  const calls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  let row: (Record<string, unknown> & { status: BookingStatus }) | null = null;
  const deps: OfficeDeps = {
    now: () => new Date("2026-11-11T10:00:00Z"),
    newId: () => ID,
    newToken: () => "t".repeat(43),
    loadContext: async (reservationId, tixEventId, listingId) => {
      calls.push(`context:${reservationId}:${tixEventId}:${listingId}`);
      return w.context ?? { ok: true, env: "sandbox", quantity: 2, listing: w.listing, costSoldTotalUsd: 120, italian: w.venueItalian };
    },
    insertBooking: async (insert) => {
      calls.push("insert");
      if (!w.insert.ok) return w.insert;
      row = { ...insert, status: "holding" };
      return { ok: true };
    },
    moveStatus: async (id, from, to, _atIso, patch) => {
      if (!row || row.id !== id || row.status !== from) return false;
      row = { ...row, ...(patch ?? {}), status: to };
      calls.push(`move:${from}>${to}`);
      return true;
    },
    hold: async (env, listingId, qty) => {
      calls.push(`hold:${env}:${listingId}:${qty}`);
      return w.holdAnswer;
    },
    release: async (env, holdId, qty) => {
      calls.push(`release:${env}:${holdId}:${qty}`);
      return ok(true as const);
    },
    addOrder: async (env, holdId, qty, body) => {
      calls.push(`addOrder:${env}:${holdId}:${qty}`);
      bodies.push(body);
      return w.addAnswers.shift() ?? noAnswer;
    },
    audit: async (action) => {
      calls.push(`audit:${action}`);
    },
  };
  return { deps, calls, bodies, row: () => row };
};

const input = (over: Partial<OfficeBookingInput> = {}): OfficeBookingInput => ({
  reservationId: 2233,
  tixstockEventId: "TX-EVENT",
  listingId: "L1",
  buyer: { first_name: "Dana", last_name: "Levi", email: "dana@example.com", phone: "0501234567" },
  attendees: [
    { first_name: "Dana", last_name: "Levi" },
    { first_name: "Omer", last_name: "Levi" },
  ],
  italian: false,
  acceptGap: false,
  acks: { flightHotelDone: true, notBoughtByHand: true, finalPurchase: true },
  ...over,
});

const ACTOR = "staff@mega-events.co.il";
const silence = <T>(run: () => Promise<T>): Promise<T> => {
  const { error, warn } = console;
  console.error = () => undefined;
  console.warn = () => undefined;
  return run().finally(() => {
    console.error = error;
    console.warn = warn;
  });
};

const cases: Array<[string, () => Promise<void>]> = [];
const it = (name: string, run: () => Promise<void>): void => {
  cases.push([name, run]);
};

it("acks required", async () => {
  for (const missing of ["flightHotelDone", "notBoughtByHand", "finalPurchase"] as const) {
    const s = world();
    const acks = { flightHotelDone: true, notBoughtByHand: true, finalPurchase: true, [missing]: false };
    assert.deepEqual(await runOfficeBooking(input({ acks }), ACTOR, s.deps), { ok: false, kind: "acks" });
    assert.deepEqual(s.calls, [], "no DB and no client call");
  }
});

it("a listing that is no longer offered is gone, with no row and no hold", async () => {
  const s = world({ listing: null });
  assert.deepEqual(await runOfficeBooking(input(), ACTOR, s.deps), { ok: false, kind: "gone" });
  assert.equal(s.calls.some((c) => c === "insert" || c.startsWith("hold")), false);
});

it("a listing that requires a lead booker is refused, whatever the dialog sent", async () => {
  // TixStock has not said what such a listing asks of the buyer (one in five production listings carries the
  // flag). Until they do it is not booked: an order at TixStock is final. The flag is read from the listing as it
  // is re-read at the click, so a browser cannot wave it through.
  const s = world({ listing: ranked({ leadBooker: true }) });
  assert.deepEqual(await runOfficeBooking(input({ acceptGap: true }), ACTOR, s.deps), { ok: false, kind: "lead_booker" });
  assert.deepEqual(s.calls, ["context:2233:TX-EVENT:L1"], "no row, no audit, no hold");
});

it("production that is not open, or not configured, books nothing", async () => {
  for (const kind of ["production_closed", "not_configured", "db"] as const) {
    const s = world({ context: { ok: false, kind } });
    assert.deepEqual(await runOfficeBooking(input(), ACTOR, s.deps), { ok: false, kind });
    assert.equal(s.calls.some((c) => c === "insert" || c.startsWith("hold")), false);
  }
});

it("attendees must fit the party and the event", async () => {
  const count = world();
  assert.equal((await runOfficeBooking(input({ attendees: [{ first_name: "Dana", last_name: "Levi" }] }), ACTOR, count.deps)).ok, false);
  assert.deepEqual(await runOfficeBooking(input({ attendees: [{ first_name: "Dana", last_name: "Levi" }] }), ACTOR, count.deps), { ok: false, kind: "attendees" });
  const italy = world();
  assert.deepEqual(await runOfficeBooking(input({ italian: true }), ACTOR, italy.deps), { ok: false, kind: "attendees" });
  assert.equal([...count.calls, ...italy.calls].some((c) => c === "insert" || c.startsWith("hold")), false);
});

it("an Italian venue asks for the identity details whatever the dialog sent", async () => {
  // The dialog's own value is a browser's claim. The venue is read again on the server at the click, and it decides.
  const s = world({ venueItalian: true });
  assert.deepEqual(await runOfficeBooking(input({ italian: false }), ACTOR, s.deps), { ok: false, kind: "attendees" });
  assert.equal(s.calls.some((c) => c === "insert" || c.startsWith("hold")), false, "nothing is held for an order that would go out without them");

  const full = { passport: "12345678", nationality: "IL", dob: "1990-04-02", gender: "F" as const, birth_place: "Haifa" };
  const withDetails = input({ italian: false, attendees: [{ first_name: "Dana", last_name: "Levi", ...full }, { first_name: "Omer", last_name: "Levi", ...full, gender: "M" }] });
  const booked = world({ venueItalian: true });
  assert.equal((await runOfficeBooking(withDetails, ACTOR, booked.deps)).ok, true);
  assert.equal((booked.bodies[0].items as Array<{ customer: { national_id?: string } }>)[0].customer.national_id, "12345678");
  assert.equal((booked.row()?.listing as { italian?: boolean }).italian, true, "the row remembers it, so a later attendee update asks for them too");
});

it("staff's tick can add the identity details to a venue that is not marked Italian, never remove them", async () => {
  const full = { passport: "12345678", nationality: "IL", dob: "1990-04-02", gender: "F" as const, birth_place: "Haifa" };
  const ticked = world({ venueItalian: false });
  assert.deepEqual(await runOfficeBooking(input({ italian: true }), ACTOR, ticked.deps), { ok: false, kind: "attendees" }, "ticked, so the details are required");
  const booked = world({ venueItalian: false });
  const result = await runOfficeBooking(input({ italian: true, attendees: [{ first_name: "Dana", last_name: "Levi", ...full }, { first_name: "Omer", last_name: "Levi", ...full, gender: "M" }] }), ACTOR, booked.deps);
  assert.equal(result.ok, true);
  assert.equal((booked.row()?.listing as { italian?: boolean }).italian, true);
});

it("dearer needs acceptGap", async () => {
  const s = world({ listing: ranked({ pricePerTicketUsd: 70, totalUsd: 140, gapUsd: 20, gapPct: 16.67, dearer: true }) });
  assert.deepEqual(await runOfficeBooking(input({ acceptGap: false }), ACTOR, s.deps), { ok: false, kind: "gap_not_accepted" });
  assert.equal(s.calls.some((c) => c === "insert" || c.startsWith("hold")), false, "no hold call");

  const accepted = world({ listing: ranked({ pricePerTicketUsd: 70, totalUsd: 140, gapUsd: 20, gapPct: 16.67, dearer: true }), addAnswers: [ok({ orderId: "TX-1", status: "Approved", currency: "USD", total: 140 })] });
  assert.equal((await runOfficeBooking(input({ acceptGap: true }), ACTOR, accepted.deps)).ok, true);
  assert.equal(accepted.row()?.gap_accepted_by, ACTOR, "who accepted the dearer price is on the row");
});

it("paper needs shipping", async () => {
  const s = world({ listing: ranked({ ticketType: "Paper", paper: true }) });
  assert.deepEqual(await runOfficeBooking(input(), ACTOR, s.deps), { ok: false, kind: "shipping" });
  assert.deepEqual(await runOfficeBooking(input({ shippingAddress: { name: " ", address: "" } }), ACTOR, s.deps), { ok: false, kind: "shipping" });
  assert.equal(s.calls.some((c) => c === "insert" || c.startsWith("hold")), false);

  const shipped = world({ listing: ranked({ ticketType: "Paper", paper: true }) });
  const address = { name: "Hotel Roma", address: "Via Roma 1, Torino" };
  assert.equal((await runOfficeBooking(input({ shippingAddress: address }), ACTOR, shipped.deps)).ok, true);
  assert.deepEqual((shipped.bodies[0].customer as { shipping_address?: unknown }).shipping_address, address);
  assert.deepEqual(shipped.row()?.shipping_address, address);
});

it("locked", async () => {
  const s = world({ insert: { ok: false, kind: "locked" } });
  assert.deepEqual(await runOfficeBooking(input(), ACTOR, s.deps), { ok: false, kind: "locked" });
  assert.equal(s.calls.some((c) => c.startsWith("hold")), false, "no hold call");
});

it("gone", async () => {
  const s = world({ holdAnswer: refused(422, "Listing not available", 108) });
  const result = await silence(() => runOfficeBooking(input(), ACTOR, s.deps));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.kind, "gone");
  assert.equal(s.row()?.status, "failed");
  assert.equal(s.calls.some((c) => c.startsWith("addOrder") || c.startsWith("release")), false);
});

it("hold with no answer", async () => {
  const s = world({ holdAnswer: noAnswer });
  const result = await silence(() => runOfficeBooking(input(), ACTOR, s.deps));
  assert.equal(result.ok, false);
  assert.equal(s.row()?.status, "failed");
  assert.equal(s.row()?.last_error, "hold: no answer");
  assert.equal(s.calls.some((c) => c.startsWith("release") || c.startsWith("addOrder")), false, "no hold id to release, no order");
});

it("approved", async () => {
  const s = world();
  assert.deepEqual(await runOfficeBooking(input(), ACTOR, s.deps), { ok: true, status: "approved", orderId: "TX-1" });
  assert.deepEqual(s.calls, [
    "context:2233:TX-EVENT:L1",
    "insert",
    "audit:tixstock_ticket_booking_started",
    "hold:sandbox:L1:2",
    "move:holding>on_hold",
    "move:on_hold>ordering",
    "addOrder:sandbox:H1:2",
    "move:ordering>approved",
    "audit:tixstock_ticket_booked",
  ]);
  assert.equal(s.bodies[0].order_status, "Approved");
  assert.equal(s.bodies[0].order_id, ourOrderId(2233, ID), "our own order id, one per booking row");
  assert.deepEqual((s.bodies[0].items as Array<{ price: number }>).map((i) => i.price), [59.2, 59.2], "the feed's amount, never rounded");
  const row = s.row();
  assert.ok(row);
  assert.deepEqual(
    [row.id, row.reservation_id, row.env, row.source, row.status, row.tixstock_event_id, row.listing_id, row.hold_id, row.quantity, row.tixstock_order_id, row.order_currency, row.order_total],
    [ID, 2233, "sandbox", "office", "approved", "TX-EVENT", "L1", "H1", 2, "TX-1", "USD", 118.4],
  );
  assert.deepEqual([row.price_per_ticket, row.total, row.cost_sold_usd, row.created_by, row.gap_accepted_by], [59.2, 118.4, 120, ACTOR, null]);
  assert.match(String(row.customer_token), /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(row.prerequisites_ack, { flightHotelDone: true, notBoughtByHand: true, finalPurchase: true, by: ACTOR, at: "2026-11-11T10:00:00.000Z" });
  assert.deepEqual(row.listing, { category: "Longside", section: "101", row: "5", generalAdmission: false, ticketType: "eTicket", splitType: "No Preferences", restrictions: ["Away fans"], deliveryDate: "2027-06-09", deliveryType: "EMAIL", instantDownload: false, italian: false });
});

it("audit before the call", async () => {
  const s = world();
  await runOfficeBooking(input(), ACTOR, s.deps);
  const started = s.calls.indexOf("audit:tixstock_ticket_booking_started");
  const hold = s.calls.findIndex((c) => c.startsWith("hold"));
  assert.ok(started >= 0 && hold > started, "the attempt is on record before TixStock is called");
});

it("refused releases once", async () => {
  for (const answer of [refused(400, "Validation failed"), refused(404, "Resource Not Found")]) {
    const s = world({ addAnswers: [answer, ok({ orderId: "TX-2", status: "Approved", currency: "USD", total: 118.4 })] });
    const result = await silence(() => runOfficeBooking(input(), ACTOR, s.deps));
    assert.equal(!result.ok && result.kind, "refused");
    assert.deepEqual(s.calls.filter((c) => c.startsWith("release")), ["release:sandbox:H1:2"]);
    assert.equal(s.calls.filter((c) => c.startsWith("addOrder")).length, 1, "no automatic re-hold and no second order: staff press the button again");
    assert.equal(s.calls.filter((c) => c.startsWith("hold")).length, 1);
    assert.equal(s.row()?.status, "failed");
    assert.notEqual(String(s.row()?.last_error ?? ""), "");
  }
});

it("no answer is uncertain", async () => {
  const s = world({ addAnswers: [noAnswer, ok({ orderId: "TX-2", status: "Approved", currency: "USD", total: 118.4 })] });
  const result = await silence(() => runOfficeBooking(input(), ACTOR, s.deps));
  assert.equal(!result.ok && result.kind, "uncertain");
  assert.equal(s.row()?.status, "uncertain");
  assert.equal(s.calls.some((c) => c.startsWith("release")), false, "TixStock may have created the order: the hold is not released");
  assert.equal(s.calls.filter((c) => c.startsWith("addOrder")).length, 1, "no second orders/add");
});

it("a booking that throws on the way answers db and never throws to the page", async () => {
  const s = world();
  const broken: OfficeDeps = { ...s.deps, moveStatus: async () => { throw new Error("connection reset"); } };
  const result = await silence(() => runOfficeBooking(input(), ACTOR, broken));
  assert.equal(!result.ok && result.kind, "db");
});

const main = async (): Promise<void> => {
  for (const [name, run] of cases) {
    await run();
    console.log("ok -", name);
  }
  console.log("tixstock-office-booking-selftest: all passed");
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

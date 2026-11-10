// Run: npx tsx scripts/tixstock-booking-rules-selftest.ts
// The pure TixStock booking rules (lib/tixstock-booking/rules.ts, byte-identical in myt-main). The same cases run
// there under vitest as lib/__tests__/tixstockBookingRules.test.ts - change one, change the other. No DB, no network.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md.
import assert from "node:assert/strict";
const describe = (_name: string, run: () => void): void => run();
const it = (name: string, run: () => void): void => {
  run();
  console.log("ok -", name);
};
import {
  ACTIVE_STATUSES,
  attendeeIssues,
  BOOKING_STATUSES,
  bookingEnvFor,
  buildOrderRequest,
  canMoveTo,
  isBookingStatus,
  isSandboxBookingEvent,
  ourOrderId,
  siteBooksAfterPayment,
  statusFromTixstock,
  ticketLinkEmail,
  ticketPageUrl,
  tixstockDatetime,
  type AttendeeInput,
  type BookingStatus,
  type Buyer,
} from "../lib/tixstock-booking/rules";

const STATUSES: BookingStatus[] = [
  "holding", "on_hold", "ordering", "sale_on_hold", "approved", "commissionable", "failed", "released", "uncertain", "cancelled",
];
// The whole transition table: a move that is not listed here is refused.
const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  holding: ["on_hold", "failed"],
  on_hold: ["ordering", "released", "failed"],
  ordering: ["sale_on_hold", "approved", "uncertain", "failed"],
  sale_on_hold: ["approved", "commissionable", "cancelled"],
  approved: ["commissionable", "cancelled"],
  commissionable: ["cancelled"],
  uncertain: ["sale_on_hold", "approved", "commissionable", "cancelled", "failed"],
  released: ["ordering"],
  failed: [],
  cancelled: [],
};
const BASE: AttendeeInput = {
  first_name: "Dana", last_name: "Levi", passport: "12345678", nationality: "IL", dob: "1990-01-31", gender: "F", birth_place: "Tel Aviv",
};
const BUYER: Buyer = { first_name: "Dana", last_name: "Levi", email: "dana@example.com", phone: "+972501234567" };
const AT = new Date("2026-05-23T20:45:00Z");
const LISTING = { generalAdmission: false, row: "V", pricePerTicket: 59.2 };
const without = (key: keyof AttendeeInput): AttendeeInput => {
  const copy: AttendeeInput = { ...BASE };
  delete copy[key];
  return copy;
};

describe("tixstock booking rules", () => {
  it("env for sandbox_site test event", () => {
    assert.deepEqual(bookingEnvFor({ is_test: true, tixstock_booking: "sandbox_site" }), { ok: true, env: "sandbox" });
    assert.deepEqual(bookingEnvFor({ is_test: true, tixstock_booking: "sandbox_office" }), { ok: true, env: "sandbox" });
  });

  it("real event is production even with a mode", () => {
    assert.deepEqual(bookingEnvFor({ is_test: false, tixstock_booking: "sandbox_site" }), { ok: true, env: "production" });
    assert.deepEqual(bookingEnvFor({}), { ok: true, env: "production" });
  });

  it("test event without mode refused", () => {
    assert.deepEqual(bookingEnvFor({ is_test: true, tixstock_booking: null }), { ok: false, kind: "test_without_sandbox" });
    assert.deepEqual(bookingEnvFor({ is_test: true, tixstock_booking: "bogus" }), { ok: false, kind: "test_without_sandbox" });
  });

  it("site books only sandbox_site", () => {
    assert.equal(siteBooksAfterPayment({ is_test: true, tixstock_booking: "sandbox_site" }), true);
    assert.equal(siteBooksAfterPayment({ is_test: true, tixstock_booking: "sandbox_office" }), false);
    assert.equal(siteBooksAfterPayment({ is_test: false, tixstock_booking: "sandbox_site" }), false);
    assert.equal(siteBooksAfterPayment(null), false);
    assert.equal(siteBooksAfterPayment(undefined), false);
  });

  it("a sandbox booking event needs is_test AND a known mode", () => {
    assert.equal(isSandboxBookingEvent({ is_test: true, tixstock_booking: "sandbox_site" }), true);
    assert.equal(isSandboxBookingEvent({ is_test: true, tixstock_booking: "sandbox_office" }), true);
    assert.equal(isSandboxBookingEvent({ is_test: false, tixstock_booking: "sandbox_site" }), false);
    assert.equal(isSandboxBookingEvent({ is_test: true, tixstock_booking: null }), false);
    assert.equal(isSandboxBookingEvent({ is_test: true, tixstock_booking: "bogus" }), false);
    assert.equal(isSandboxBookingEvent(null), false);
  });

  it("datetime format", () => {
    assert.equal(tixstockDatetime(AT), "2026-05-23T20:45:00+0000");
    assert.equal(tixstockDatetime(new Date("2026-01-02T03:04:05.678+02:00")), "2026-01-02T01:04:05+0000");
  });

  it("status mapping", () => {
    assert.equal(statusFromTixstock("Sale on Hold"), "sale_on_hold");
    assert.equal(statusFromTixstock("Approved"), "approved");
    assert.equal(statusFromTixstock("Commissionable"), "commissionable");
    assert.equal(statusFromTixstock("Cancelled"), "cancelled");
    assert.equal(statusFromTixstock("approved "), "approved");
    assert.equal(statusFromTixstock("Awaiting"), null);
    assert.equal(statusFromTixstock(42), null);
    assert.equal(statusFromTixstock(null), null);
  });

  it("transitions", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        assert.equal(canMoveTo(from, to), ALLOWED[from].includes(to), `${from} -> ${to}`);
      }
    }
    // the ones that matter most, spelled out
    assert.equal(canMoveTo("on_hold", "ordering"), true);
    assert.equal(canMoveTo("ordering", "approved"), true, "the office orders as Approved");
    assert.equal(canMoveTo("released", "ordering"), true, "paid after the hold was released");
    assert.equal(canMoveTo("on_hold", "approved"), false, "it must pass ordering");
    assert.equal(canMoveTo("commissionable", "approved"), false, "no status regression");
    assert.equal(canMoveTo("approved", "released"), false, "an Approved order is final");
    assert.equal(canMoveTo("released", "on_hold"), false);
    assert.equal(canMoveTo("ordering", "ordering"), false, "the claim is taken once");
  });

  it("the live statuses are the seven of the unique index", () => {
    assert.deepEqual([...ACTIVE_STATUSES].sort(), ["approved", "commissionable", "holding", "on_hold", "ordering", "sale_on_hold", "uncertain"]);
  });

  it("a status read from the database is narrowed, never trusted", () => {
    assert.deepEqual([...BOOKING_STATUSES].sort(), [...STATUSES].sort());
    assert.equal(isBookingStatus("ordering"), true);
    assert.equal(isBookingStatus("Approved"), false, "TixStock's spelling is not ours");
    assert.equal(isBookingStatus(null), false);
    assert.equal(isBookingStatus(7), false);
  });

  it("italian issues", () => {
    assert.deepEqual(attendeeIssues(BASE, true), []);
    assert.deepEqual(attendeeIssues(without("passport"), true), ["passport"]);
    assert.deepEqual(attendeeIssues(without("gender"), true), ["gender"]);
    assert.deepEqual(attendeeIssues(without("birth_place"), true), ["birth_place"], "an Israeli needs a place of birth too");
    assert.deepEqual(attendeeIssues({ ...BASE, dob: "31/01/1990" }, true), ["dob"]);
    assert.deepEqual(attendeeIssues({ ...BASE, dob: "1990-02-31" }, true), ["dob"], "not a real date");
    assert.deepEqual(attendeeIssues({ ...BASE, nationality: "Israel" }, true), ["nationality"]);
    assert.deepEqual(attendeeIssues({ ...BASE, passport: "   " }, true), ["passport"]);
    assert.deepEqual(attendeeIssues({ first_name: "Dana", last_name: " " }, true), ["name", "passport", "nationality", "dob", "gender", "birth_place"]);
  });

  it("a plain event asks for the name only", () => {
    assert.deepEqual(attendeeIssues({ first_name: "Dana", last_name: " " }, false), ["name"]);
    assert.deepEqual(attendeeIssues({ first_name: "Dana", last_name: "Levi" }, false), []);
  });

  it("order body, plain", () => {
    const r = buildOrderRequest({
      status: "Approved", at: AT, reservationId: 2233, buyer: BUYER, quantity: 2, italian: false, listing: LISTING,
      attendees: [BASE, { first_name: " Noa ", last_name: "Levi" }],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const body = r.body as { order_status: string; datetime: string; customer: Record<string, unknown>; items: Array<Record<string, unknown>> };
    assert.equal(body.order_status, "Approved");
    assert.deepEqual(body.customer, {
      first_name: "Dana", last_name: "Levi", email_address: "dana@example.com", contact_number: "+972501234567",
    });
    assert.equal(body.items.length, 2);
    assert.deepEqual(Object.keys(body.items[0].customer as object).sort(), ["first_name", "last_name"]);
    assert.deepEqual(body.items[1].customer, { first_name: "Noa", last_name: "Levi" }, "names are trimmed; a passport is not sent on a plain event");
    assert.equal(body.items[0].price, 59.2, "the feed's amount, untouched");
    assert.equal(body.items[0].general_admission, false);
    assert.equal(body.items[0].row, "V");
    assert.match(body.datetime, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+0000$/);
  });

  it("order body, italian", () => {
    const second: AttendeeInput = { ...BASE, first_name: "Marco", last_name: "Rossi", passport: "YA1234567", nationality: "it", gender: "M", birth_place: "Roma" };
    const r = buildOrderRequest({
      status: "Sale on Hold", at: AT, reservationId: 2233, buyer: BUYER, quantity: 2, italian: true, listing: LISTING, attendees: [BASE, second],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const body = r.body as { order_status: string; items: Array<{ customer: Record<string, unknown> }> };
    assert.equal(body.order_status, "Sale on Hold");
    assert.deepEqual(body.items[0].customer, {
      first_name: "Dana", last_name: "Levi", email_address: "dana@example.com", national_id: "12345678",
      nationality: "IL", dob: "1990-01-31", gender: "Female", birth_place: "Tel Aviv",
    });
    assert.deepEqual(body.items[1].customer, {
      first_name: "Marco", last_name: "Rossi", email_address: "dana@example.com", national_id: "YA1234567",
      nationality: "IT", dob: "1990-01-31", gender: "Male", birth_place: "Roma",
    }, "every attendee gets the buyer's e-mail; the nationality goes out upper-case; M / F go out as Male / Female");
  });

  it("our reservation id goes out as order_id", () => {
    const r = buildOrderRequest({ status: "Approved", at: AT, reservationId: 2233, buyer: BUYER, quantity: 1, italian: false, listing: LISTING, attendees: [BASE] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.body.order_id, "2233", "TixStock 10.11: our own order id, in the body, as a string");
    assert.equal(ourOrderId(2233), "2233", "the same value the webhook answers as external_id");
    assert.equal("external_id" in r.body, false);
    assert.equal("id" in (r.body.customer as object), false);
  });

  it("an order is never built without a real reservation id", () => {
    for (const reservationId of [0, -5, 1.5, Number.NaN]) {
      assert.deepEqual(
        buildOrderRequest({ status: "Approved", at: AT, reservationId, buyer: BUYER, quantity: 1, italian: false, listing: LISTING, attendees: [BASE] }),
        { ok: false, kind: "reservation_id" },
        String(reservationId),
      );
    }
  });

  it("a shipping address rides on the buyer", () => {
    const r = buildOrderRequest({
      status: "Approved", at: AT, reservationId: 2233, buyer: BUYER, quantity: 1, italian: false, listing: LISTING, attendees: [BASE],
      shippingAddress: { address_line_1: "Hotel Roma", town: "Rome" },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual((r.body.customer as { shipping_address?: unknown }).shipping_address, { address_line_1: "Hotel Roma", town: "Rome" });
  });

  it("attendee count", () => {
    assert.deepEqual(
      buildOrderRequest({ status: "Approved", at: AT, reservationId: 2233, buyer: BUYER, quantity: 2, italian: false, listing: LISTING, attendees: [BASE] }),
      { ok: false, kind: "attendee_count" },
    );
  });

  it("issues block the body", () => {
    assert.deepEqual(
      buildOrderRequest({ status: "Approved", at: AT, reservationId: 2233, buyer: BUYER, quantity: 1, italian: true, listing: LISTING, attendees: [without("passport")] }),
      { ok: false, kind: "attendee_issues" },
    );
  });

  it("link email", () => {
    assert.equal(ticketPageUrl("tok"), "https://www.mega-events.co.il/ticket/tok");
    const mail = ticketLinkEmail("Juventus - Como", ticketPageUrl("tok"));
    assert.equal(mail.subject, "הקישור לכרטיסים שלכם");
    assert.match(mail.html, /dir="rtl"/);
    assert.match(mail.html, /Juventus - Como/);
    assert.match(mail.html, /https:\/\/www\.mega-events\.co\.il\/ticket\/tok/);
    assert.match(mail.html, /הכרטיסים יופיעו בקישור ברגע שהספק ישלח אותם/);
    assert.match(mail.text, /https:\/\/www\.mega-events\.co\.il\/ticket\/tok/);
    assert.equal(/<[a-z]/i.test(mail.text), false, "the text part has no html");
    assert.match(ticketLinkEmail("<b>X</b> & Y", "https://x").html, /&lt;b&gt;X&lt;\/b&gt; &amp; Y/, "the event name is escaped");
  });
});

console.log("tixstock-booking-rules-selftest: all passed");

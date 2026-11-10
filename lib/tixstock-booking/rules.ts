// The pure rules of TixStock ticket booking: which environment an event books in, the booking's states and the
// moves between them, what an attendee must give, and the exact body of an order.
//
// BYTE-IDENTICAL in both repos - myt-main `lib/tixstock-booking/rules.ts` and backoffice
// `lib/tixstock-booking/rules.ts` (`cmp` the pair after any change). That is why this file has NO imports.
// Tests: myt-main `lib/__tests__/tixstockBookingRules.test.ts`, backoffice
// `scripts/tixstock-booking-rules-selftest.ts` (the same cases).
// Spec: backoffice docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md.

export type TixstockBookingMode = "sandbox_site" | "sandbox_office";
export type BookingEnv = "sandbox" | "production";

/**
 * A booking row's state. `ordering` = the orders/add call is in flight: the row is claimed by a one-way move from
 * `on_hold`, so two callers can never both order. `uncertain` = TixStock may hold an order we got no answer for;
 * nothing orders again until staff settle it (TixStock: a repeated orders/add can create a second order).
 */
export type BookingStatus =
  | "holding"
  | "on_hold"
  | "ordering"
  | "sale_on_hold"
  | "approved"
  | "commissionable"
  | "failed"
  | "released"
  | "uncertain"
  | "cancelled";

/** The statuses of the unique index `ticket_bookings_one_live`: one such row per reservation. */
export const ACTIVE_STATUSES: readonly BookingStatus[] = [
  "holding",
  "on_hold",
  "ordering",
  "sale_on_hold",
  "approved",
  "commissionable",
  "uncertain",
];

export type EventFlags = { is_test?: boolean | null; tixstock_booking?: string | null };

const modeOf = (e: EventFlags | null | undefined): TixstockBookingMode | null => {
  const mode = e?.tixstock_booking;
  return mode === "sandbox_site" || mode === "sandbox_office" ? mode : null;
};

/**
 * The environment is decided by the event, never by a global switch. A real event is production whatever its
 * `tixstock_booking` says; a test event books in the sandbox, and one without a known mode books nowhere - a test
 * reservation must never reach production.
 */
export function bookingEnvFor(
  e: EventFlags,
): { ok: true; env: BookingEnv } | { ok: false; kind: "test_without_sandbox" } {
  if (e.is_test !== true) return { ok: true, env: "production" };
  return modeOf(e) ? { ok: true, env: "sandbox" } : { ok: false, kind: "test_without_sandbox" };
}

/** The only events the site's new booking paths run for: `is_test` AND a known mode. */
export function isSandboxBookingEvent(e: EventFlags | null | undefined): boolean {
  return e?.is_test === true && modeOf(e) !== null;
}

/** The site orders at TixStock after payment only on a `sandbox_site` test event. */
export function siteBooksAfterPayment(e: EventFlags | null | undefined): boolean {
  return e?.is_test === true && modeOf(e) === "sandbox_site";
}

/** TixStock's `datetime`: `2026-05-23T20:45:00+0000`, in UTC. Another format is answered 200 with `[]`. */
export function tixstockDatetime(d: Date): string {
  return `${d.toISOString().slice(0, 19)}+0000`;
}

const FROM_TIXSTOCK = new Map<string, BookingStatus>([
  ["sale on hold", "sale_on_hold"],
  ["approved", "approved"],
  ["commissionable", "commissionable"],
  ["cancelled", "cancelled"],
  ["canceled", "cancelled"],
]);

/** TixStock's order status as ours; anything it does not name is `null` and changes nothing. */
export function statusFromTixstock(s: unknown): BookingStatus | null {
  if (typeof s !== "string") return null;
  return FROM_TIXSTOCK.get(s.trim().toLowerCase()) ?? null;
}

// The whole table: a move that is not listed is refused. `cancelled` is only ever reported by TixStock.
const MOVES: Record<BookingStatus, readonly BookingStatus[]> = {
  holding: ["on_hold", "failed"],
  on_hold: ["ordering", "released", "failed"],
  ordering: ["sale_on_hold", "approved", "uncertain", "failed"],
  sale_on_hold: ["approved", "commissionable", "cancelled"],
  approved: ["commissionable", "cancelled"],
  commissionable: ["cancelled"],
  uncertain: ["sale_on_hold", "approved", "commissionable", "cancelled", "failed"],
  // The site only: the customer paid after the hold was released.
  released: ["ordering"],
  failed: [],
  cancelled: [],
};

export function canMoveTo(from: BookingStatus, to: BookingStatus): boolean {
  return (MOVES[from] ?? []).includes(to);
}

export type Buyer = { first_name: string; last_name: string; email: string; phone: string };

export type AttendeeInput = {
  first_name: string;
  last_name: string;
  passport?: string;
  nationality?: string;
  dob?: string;
  gender?: "M" | "F";
  birth_place?: string;
};

export type AttendeeIssue = "name" | "passport" | "nationality" | "dob" | "gender" | "birth_place";

const blank = (v: string | null | undefined): boolean => !v || v.trim() === "";

const realDate = (v: string | undefined): boolean => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/**
 * What is missing or malformed on one attendee. Every event needs a name. An Italian event (the TixStock event's
 * venue is in Italy) needs, for EVERY attendee whatever their nationality: passport, a two-letter nationality, a
 * `YYYY-MM-DD` date of birth, gender and place of birth (TixStock's list of 10.11.2026).
 */
export function attendeeIssues(a: AttendeeInput, italian: boolean): AttendeeIssue[] {
  const issues: AttendeeIssue[] = [];
  if (blank(a.first_name) || blank(a.last_name)) issues.push("name");
  if (!italian) return issues;
  if (blank(a.passport)) issues.push("passport");
  if (!/^[A-Za-z]{2}$/.test((a.nationality ?? "").trim())) issues.push("nationality");
  if (!realDate(a.dob)) issues.push("dob");
  if (a.gender !== "M" && a.gender !== "F") issues.push("gender");
  if (blank(a.birth_place)) issues.push("birth_place");
  return issues;
}

/**
 * The body of `POST /orders/add/{hold_id}/{quantity}`: the buyer once, and one item per ticket with its attendee.
 * The ONE place that names TixStock's attendee fields.
 *
 * PROVISIONAL until TixStock answers the follow-up of 10.11.2026 (backoffice
 * docs/tixstock/2026-11-10-questions-to-tixstock.md): the field name `gender` with `M` / `F`, the ISO alpha-2 code
 * in `nationality`, and the empty `seat` (a listing names a row, not seats). No id of ours is sent: the guide's body
 * has no field for it.
 *
 * `pricePerTicket` is the feed's `proceed_price` exactly as received - never rounded, never the customer's price.
 * An Italian attendee's `email_address` is the buyer's (no per-attendee e-mail is collected).
 */
export function buildOrderRequest(input: {
  status: "Sale on Hold" | "Approved";
  at: Date;
  buyer: Buyer;
  attendees: AttendeeInput[];
  quantity: number;
  italian: boolean;
  listing: { generalAdmission: boolean; row: string; pricePerTicket: number };
  shippingAddress?: Record<string, string>;
}): { ok: true; body: Record<string, unknown> } | { ok: false; kind: "attendee_count" | "attendee_issues" } {
  if (input.quantity < 1 || input.attendees.length !== input.quantity) return { ok: false, kind: "attendee_count" };
  if (input.attendees.some((a) => attendeeIssues(a, input.italian).length > 0)) {
    return { ok: false, kind: "attendee_issues" };
  }

  const email = input.buyer.email.trim();
  const customer: Record<string, unknown> = {
    first_name: input.buyer.first_name.trim(),
    last_name: input.buyer.last_name.trim(),
    email_address: email,
    contact_number: input.buyer.phone.trim(),
  };
  if (input.shippingAddress) customer.shipping_address = input.shippingAddress;

  const items = input.attendees.map((a) => {
    const attendee: Record<string, string> = { first_name: a.first_name.trim(), last_name: a.last_name.trim() };
    if (input.italian) {
      attendee.email_address = email;
      attendee.national_id = (a.passport ?? "").trim();
      attendee.nationality = (a.nationality ?? "").trim().toUpperCase();
      attendee.dob = a.dob ?? "";
      attendee.gender = a.gender ?? "";
      attendee.birth_place = (a.birth_place ?? "").trim();
    }
    return {
      general_admission: input.listing.generalAdmission,
      row: input.listing.row,
      seat: "",
      price: input.listing.pricePerTicket,
      customer: attendee,
    };
  });

  return {
    ok: true,
    body: { order_status: input.status, datetime: tixstockDatetime(input.at), customer, items },
  };
}

export const SITE_ORIGIN = "https://www.mega-events.co.il";

/** The customer's ticket page. The token is its only key. */
export function ticketPageUrl(token: string): string {
  return `${SITE_ORIGIN}/ticket/${token}`;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The short email that carries the ticket page link, sent once the order is Approved - by the site after payment,
 * or by the backoffice sweep when it is the one that approves. One text for both.
 */
export function ticketLinkEmail(eventName: string, url: string): { subject: string; html: string; text: string } {
  const subject = "הקישור לכרטיסים שלכם";
  const note = "הכרטיסים יופיעו בקישור ברגע שהספק ישלח אותם";
  const html =
    `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#111">` +
    `<p>שלום,</p>` +
    `<p>הזמנת הכרטיסים שלכם ל-<strong>${esc(eventName)}</strong> התקבלה.</p>` +
    `<p><a href="${esc(url)}">לצפייה בכרטיסים</a></p>` +
    `<p>${note}.</p>` +
    `<p dir="ltr" style="font-size:13px;color:#555">${esc(url)}</p>` +
    `</div>`;
  const text = `שלום,\nהזמנת הכרטיסים שלכם ל-${eventName} התקבלה.\n${note}.\n${url}`;
  return { subject, html, text };
}

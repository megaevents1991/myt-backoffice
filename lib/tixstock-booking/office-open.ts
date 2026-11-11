// What the booking dialog reads out of a reservation before staff pick a listing: the buyer, the attendees, the
// ticket the order was sold with, and the hotel a paper ticket can be shipped to. A reservation's JSON columns are
// read as unknown - an old or hand-typed row never breaks the dialog. Pure.
// Selftest: scripts/tixstock-booking-rank-selftest.ts.
import type { AttendeeInput, Buyer } from "./rules";

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? { ...v } : {});

export type ReservationContact = {
  main_contact_first_name?: unknown;
  main_contact_last_name?: unknown;
  main_contact_email?: unknown;
  main_contact_phone_number?: unknown;
  more_pax_info?: unknown;
};

/** The buyer TixStock is told: the order's main contact. */
export function reservationBuyer(r: ReservationContact): Buyer {
  return {
    first_name: text(r.main_contact_first_name),
    last_name: text(r.main_contact_last_name),
    email: text(r.main_contact_email),
    phone: text(r.main_contact_phone_number),
  };
}

/**
 * One attendee per traveller: the main contact first, then `more_pax_info` in its own order. A traveller whose
 * names were never typed stays in the list with empty names - staff complete them in the dialog, and the order's
 * own rule refuses a blank name.
 */
export function reservationAttendees(r: ReservationContact): AttendeeInput[] {
  const others: unknown[] = Array.isArray(r.more_pax_info) ? r.more_pax_info : [];
  return [
    { first_name: text(r.main_contact_first_name), last_name: text(r.main_contact_last_name) },
    ...others.map((pax) => {
      const o = rec(pax);
      return { first_name: text(o.first_name), last_name: text(o.last_name) };
    }),
  ];
}

export type SoldTicket = {
  /** Who the site sold the ticket from. A ticket that names no supplier is TixStock's on a `tx_event`. */
  supplier: string;
  /** The event's id at TixStock, when the order kept it. */
  tixEventId: string | null;
  /** The category as that supplier names it (falls back to the customer-facing one). */
  category: string;
  quantity: number;
  /** The customer was promised seats together. */
  together: boolean;
};

/** The ticket of `reservations.event_order_info`. */
export function soldTicketOf(eventOrderInfo: unknown): SoldTicket {
  const info = rec(eventOrderInfo);
  const named = text(info.supplier);
  const quantity = Number(info.number_of_ticket);
  return {
    supplier: named !== "" ? named : text(info.event_type) === "tx_event" ? "tixstock" : "static",
    tixEventId: text(info.supplier_event_id) || null,
    category: text(info.supplier_category) || text(info.category),
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 0,
    together: info.seating_choice === "together",
  };
}

/**
 * Where a paper ticket can be shipped: the order's hotel - its name, address and check-in day. Null when the order
 * has no hotel (a skipped hotel is saved as an empty object) or the hotel has no address.
 */
export function hotelShippingOf(hotelOrderInfo: unknown): Record<string, string> | null {
  const hotel = rec(hotelOrderInfo);
  const name = text(hotel.name);
  const address = text(hotel.address);
  if (name === "" || address === "") return null;
  const checkIn = text(hotel.checkin);
  return { name, address, ...(checkIn ? { check_in: checkIn } : {}) };
}

/**
 * The attendees fitted to the order's tickets: blank rows for the names nobody typed (a hand-typed or phone
 * reservation often has the main contact alone - staff type the rest in the dialog), and never more rows than
 * tickets.
 */
export function fitAttendees(attendees: readonly AttendeeInput[], quantity: number): AttendeeInput[] {
  const size = Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
  return Array.from({ length: size }, (_, i) => attendees[i] ?? { first_name: "", last_name: "" });
}

/**
 * Is the TixStock event's venue in Italy (every attendee then carries the identity details)? `true` / `false` when
 * it is known, `null` when it is NOT - the venue could not be read and the sync's table has no country for it.
 * Unknown is never "not Italian": an order at TixStock is final, and one sent without the details cannot be mended.
 *
 * `country` is the live venue read (it wins when it names a country); `knownCode` is `tixstock_events.country_code`.
 */
export function venueItaly(
  country: { ok: true; data: string | null } | { ok: false },
  knownCode: string | null | undefined,
): boolean | null {
  const live = country.ok ? text(country.data).toUpperCase() : "";
  if (live !== "") return live === "IT";
  const known = text(knownCode).toUpperCase();
  if (known !== "") return known === "IT";
  // Read, and the venue names no country: not Italian (staff can still tick the details). Not read at all: unknown.
  return country.ok ? false : null;
}

/**
 * Which TixStock event a reservation may be booked on, and the category to rank first.
 *
 * - An order sold from ANOTHER supplier is refused, whatever event staff picked: its ticket is bought there, and a
 *   TixStock order on top would be a second, final purchase (spec 7.1: other suppliers get the manual mark only).
 * - A TixStock order uses its own event (or one staff picked instead).
 * - Our own stock or a hand-typed order has no event of its own: staff pick one, and then no category is "the one
 *   that was sold".
 */
export function eventForBooking(
  sold: SoldTicket,
  pickedEventId: string,
): { ok: true; eventId: string; soldCategory: string | null } | { ok: false; kind: "not_tixstock" | "no_event" } {
  if (sold.supplier !== "tixstock" && sold.supplier !== "static") return { ok: false, kind: "not_tixstock" };
  if (sold.quantity < 1) return { ok: false, kind: "no_event" };
  const picked = pickedEventId.trim();
  const eventId = picked !== "" ? picked : sold.supplier === "tixstock" ? sold.tixEventId : null;
  if (!eventId) return { ok: false, kind: "no_event" };
  return { ok: true, eventId, soldCategory: sold.supplier === "tixstock" ? sold.category : null };
}

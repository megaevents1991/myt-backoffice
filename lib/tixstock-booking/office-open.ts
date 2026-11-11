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

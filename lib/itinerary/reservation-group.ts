/**
 * Build Your Euro Trip - how the backoffice reads a multi-event trip in the reservations screens.
 * PURE (no database, no server-only import): the list table and the detail panel are client
 * components and import it; the Supabase reads live next to it in `reservation-group-db.ts`.
 *
 * A trip is one `reservations` row per event, tied by `itinerary_group` (uuid) with `itinerary_seq`
 * (1..of, date order) and `itinerary_of` (2 or 3) - written by myt-main POST /api/itinerary/confirm
 * (migration 20261021193309_itinerary_core.sql). The whole multi-city flight (an `ItineraryFlight`:
 * a regular Flight plus `legs` and `trainLegs`) sits on seq 1's `flight_order_info`, the other rows
 * hold `{}`; each stay's hotel sits on the stay's first event; `final_purchase_price_ils` is split
 * across the rows (their sum is the trip total).
 */
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import type { ItineraryFlight } from "@/types/app.types";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";

/** A trip has two or three events (itinerary_settings max_events caps it at 3). */
export const MAX_TRIP_EVENTS = 3;

/** A trimmed, non-empty string, or "". */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** An integer given as a number or a numeric string (smallint columns arrive as numbers). */
export function wholeNumber(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

// ── Chip ────────────────────────────────────────────────────────────────────────────────────────

/** "יורו טריפ 1/2" - the list chip. Null unless seq and of are whole numbers with 1 <= seq <= of. */
export function itineraryChipLabel(seq: unknown, of: unknown): string | null {
  const s = wholeNumber(seq);
  const o = wholeNumber(of);
  if (s == null || o == null || s < 1 || o < 1 || s > o) return null;
  return `יורו טריפ ${s}/${o}`;
}

// ── Dates and money ─────────────────────────────────────────────────────────────────────────────

// The times in flight_order_info are the airport's wall clock with no zone ("2027-05-13T16:00:00"),
// so they are read off the string - never through Date, which would shift them by the viewer's zone.
const ISO_PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

/** "2027-05-13T16:00:00" -> "13/05/2027"; null when it is not an ISO date. */
export function formatDmy(value: unknown): string | null {
  const m = ISO_PARTS.exec(text(value));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** "2027-05-13T16:00:00" -> "16:00"; null when the value carries no time. */
export function formatHm(value: unknown): string | null {
  const m = ISO_PARTS.exec(text(value));
  return m && m[4] != null ? `${m[4]}:${m[5]}` : null;
}

/** "₪1,234.5" - whole shekels when there are no agorot. */
export function formatIls(amount: number): string {
  return `₪${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

// ── Flight legs ─────────────────────────────────────────────────────────────────────────────────

export type ItineraryLeg = {
  from: string;
  to: string;
  /** Departure day, "13/05/2027" (null when the leg has no readable time). */
  date: string | null;
  departs: string | null;
  arrives: string | null;
  /** Landing day, only when it is not the departure day (an overnight leg). */
  arrivalDate: string | null;
  flightNumber: string | null;
  /** The airline actually flying it when it is not the one on the ticket (a codeshare). */
  operatedBy: string | null;
};

export type ItineraryTrainLeg = { from: string; to: string; date: string | null };

function legOf(raw: unknown): ItineraryLeg | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const from = text(s.departureAirport);
  const to = text(s.arrivalAirport);
  if (!from && !to) return null;
  const date = formatDmy(s.departureTime);
  const arrivalDay = formatDmy(s.arrivalTime);
  return {
    from: from || "?",
    to: to || "?",
    date,
    departs: formatHm(s.departureTime),
    arrives: formatHm(s.arrivalTime),
    arrivalDate: arrivalDay && arrivalDay !== date ? arrivalDay : null,
    flightNumber: text(s.flightNumber) || null,
    operatedBy: text(s.operatedBy) || null,
  };
}

/** Every flown leg of the trip, in order, from an ItineraryFlight. Anything unreadable is skipped. */
export function legsOf(flight: unknown): ItineraryLeg[] {
  const legs = (flight as Partial<Pick<ItineraryFlight, "legs">> | null | undefined)?.legs;
  if (!Array.isArray(legs)) return [];
  return legs.map(legOf).filter((leg): leg is ItineraryLeg => leg !== null);
}

/** The moves between stays that the customer makes by train, on their own. */
export function trainLegsOf(flight: unknown): ItineraryTrainLeg[] {
  const trains = (flight as Partial<Pick<ItineraryFlight, "trainLegs">> | null | undefined)?.trainLegs;
  if (!Array.isArray(trains)) return [];
  const out: ItineraryTrainLeg[] = [];
  for (const raw of trains) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const from = text(t.from);
    const to = text(t.to);
    if (!from && !to) continue;
    out.push({ from: from || "?", to: to || "?", date: formatDmy(t.date) ?? (text(t.date) || null) });
  }
  return out;
}

// ── The group (detail page) ─────────────────────────────────────────────────────────────────────

/** The columns one sibling row is read with (reservation-group-db.ts). */
export type ItineraryGroupDbRow = {
  id: number;
  itinerary_seq: unknown;
  itinerary_of: unknown;
  status: unknown;
  final_purchase_price_ils: unknown;
  event_id: unknown;
  event_order_info: unknown;
  flight_order_info: unknown;
  hotel_order_info: unknown;
  is_deleted: unknown;
};

export type ItineraryMember = {
  id: number;
  seq: number | null;
  status: string;
  /** This row's share of the trip price; null when the row has none recorded. */
  priceIls: number | null;
  eventId: number | null;
  eventName: string | null;
  /** "13/05/2027". */
  eventDate: string | null;
  /** The hotel kept on this row (the first event of a stay), if any. */
  hotelName: string | null;
  deleted: boolean;
};

export type ItineraryGroup = {
  group: string;
  /** How many events the trip has (itinerary_of), null when no row says. */
  of: number | null;
  members: ItineraryMember[];
  /** Sum of the rows' shares = what the customer was charged for the whole trip. */
  totalIls: number;
  /** A row has no price recorded, so `totalIls` is a lower bound. */
  totalPartial: boolean;
  /** The row that carries the flight (seq 1), or null when none does. */
  flightHolderId: number | null;
  legs: ItineraryLeg[];
  trainLegs: ItineraryTrainLeg[];
};

function priceOf(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function hasOwnKeys(value: unknown): boolean {
  return !!value && typeof value === "object" && Object.keys(value).length > 0;
}

function memberOf(row: ItineraryGroupDbRow): ItineraryMember {
  const event = normalizeReservationEventOrderInfo(row.event_order_info as ReservationEventOrderInfo)[0];
  const hotel = row.hotel_order_info as { name?: unknown } | null | undefined;
  const dateText = event?.date != null ? String(event.date) : "";
  return {
    id: row.id,
    seq: wholeNumber(row.itinerary_seq),
    status: text(row.status),
    priceIls: priceOf(row.final_purchase_price_ils),
    eventId: wholeNumber(row.event_id),
    eventName: text(event?.name) || null,
    eventDate: formatDmy(dateText) ?? (dateText.trim() || null),
    hotelName: hasOwnKeys(hotel) ? text(hotel?.name) || null : null,
    deleted: !!row.is_deleted,
  };
}

/**
 * The trip as ops read it: the sibling rows in trip order, the total, and the flight of seq 1.
 * Pure - `rows` are the reservations that share the group. Null when there are none.
 */
export function buildItineraryGroup(group: string, rows: ItineraryGroupDbRow[]): ItineraryGroup | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const sa = wholeNumber(a.itinerary_seq) ?? Number.MAX_SAFE_INTEGER;
    const sb = wholeNumber(b.itinerary_seq) ?? Number.MAX_SAFE_INTEGER;
    return sa - sb || a.id - b.id;
  });
  const members = sorted.map(memberOf);

  // Summed in agorot so three shares never add up to 1234.5600000000002.
  let agorot = 0;
  let totalPartial = false;
  for (const m of members) {
    if (m.priceIls == null) totalPartial = true;
    else agorot += Math.round(m.priceIls * 100);
  }

  // The flight is on seq 1; a row that is not seq 1 but holds one (a hand-edited trip) still shows it.
  const holder =
    sorted.find((r) => wholeNumber(r.itinerary_seq) === 1 && legsOf(r.flight_order_info).length > 0) ??
    sorted.find((r) => legsOf(r.flight_order_info).length > 0) ??
    sorted.find((r) => wholeNumber(r.itinerary_seq) === 1 && trainLegsOf(r.flight_order_info).length > 0) ??
    null;

  const declared = sorted
    .map((r) => wholeNumber(r.itinerary_of))
    .filter((n): n is number => n != null && n >= 2 && n <= MAX_TRIP_EVENTS);

  return {
    group,
    of: declared.length > 0 ? Math.max(...declared) : null,
    members,
    totalIls: agorot / 100,
    totalPartial,
    flightHolderId: holder ? holder.id : null,
    legs: holder ? legsOf(holder.flight_order_info) : [],
    trainLegs: holder ? trainLegsOf(holder.flight_order_info) : [],
  };
}

// ── The chips (list page) ───────────────────────────────────────────────────────────────────────

/** The three reservation columns of a row that belongs to a trip. */
export type ItineraryMark = {
  itinerary_group: string;
  itinerary_seq: number;
  itinerary_of: number;
};

/** One raw row of the marks read (reservation-group-db.ts). */
export type ItineraryMarkDbRow = {
  id: number;
  itinerary_group: unknown;
  itinerary_seq: unknown;
  itinerary_of: unknown;
};

/** The mark a raw row stands for; null when it is not a well-formed trip row (no chip then). */
export function markOf(row: ItineraryMarkDbRow): ItineraryMark | null {
  const group = text(row.itinerary_group);
  const seq = wholeNumber(row.itinerary_seq);
  const of = wholeNumber(row.itinerary_of);
  if (!group || seq == null || of == null || itineraryChipLabel(seq, of) == null) return null;
  return { itinerary_group: group, itinerary_seq: seq, itinerary_of: of };
}

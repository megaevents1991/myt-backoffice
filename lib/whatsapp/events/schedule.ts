/**
 * Mega Events' messages by date (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md, section 11):
 * the flight reminder at 09:00 three days before the outbound departure (C-5א), "the event is today" at 10:00 on the
 * event's day (C-7א), "how was it" at 11:00 the day after the return (C-8א). All in Israel time. Flight times are the
 * airport's wall clock with no zone - read off the string, never through Date. Pure; selftest
 * scripts/whatsapp-events-selftest.ts.
 */
import { formatHm } from "@/lib/itinerary/reservation-group";
import { israelWallToUtc } from "@/lib/whatsapp/events/working-time";

export type ScheduleKind = "flight_reminder" | "event_today" | "after_trip";
export const FLIGHT_REMINDER_DAYS_BEFORE = 3;
const SLOT_HOUR: Record<ScheduleKind, number> = { flight_reminder: 9, event_today: 10, after_trip: 11 };
const HOUR_MS = 60 * 60 * 1000;

export type FlightFacts = { departureLocal: string; number: string; airport: string; returnArrivalLocal: string | null };

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
/** "2026-11-12 09:00:00" / "2026-11-12T09:00:00" -> "2026-11-12T09:00:00"; null when it is not a local date-time. */
function localOf(value: unknown): string | null {
  const m = typeof value === "string" ? LOCAL.exec(value) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00` : null;
}

type OfflineFlight = {
  outbound_departure_time: string | null;
  outbound_flight_number: string | null;
  outbound_departure_airport: string | null;
  inbound_arrival_time: string | null;
  is_deleted: unknown;
  cancelled_at: string | null;
};

/** The outbound flight of an order: a live offline row wins; else the stored Amadeus offer. Null = no reminder. */
export function flightFacts(input: { flightOrderInfo: unknown; offline: OfflineFlight | null }): FlightFacts | null {
  const off = input.offline;
  if (off && !off.is_deleted && !off.cancelled_at) {
    const departure = localOf(off.outbound_departure_time);
    if (departure) {
      return { departureLocal: departure, number: (off.outbound_flight_number ?? "").trim(), airport: (off.outbound_departure_airport ?? "").trim(), returnArrivalLocal: localOf(off.inbound_arrival_time) };
    }
  }
  const fo = (input.flightOrderInfo ?? {}) as {
    outbound?: { departureTime?: unknown; departureAirport?: unknown; flightNumber?: unknown };
    inbound?: { arrivalTime?: unknown };
    offer?: { itineraries?: { segments?: { carrierCode?: unknown; number?: unknown }[] }[] };
  };
  const departure = localOf(fo.outbound?.departureTime);
  if (!departure) return null;
  const seg = fo.offer?.itineraries?.[0]?.segments?.[0];
  // the stored flightNumber uses the VALIDATING carrier, wrong on a codeshare; the segment's own code is the flight
  const segNumber = seg && typeof seg.carrierCode === "string" && seg.number != null ? `${seg.carrierCode}${String(seg.number)}` : "";
  return {
    departureLocal: departure,
    number: segNumber || (typeof fo.outbound?.flightNumber === "string" ? fo.outbound.flightNumber : ""),
    airport: typeof fo.outbound?.departureAirport === "string" ? fo.outbound.departureAirport : "",
    returnArrivalLocal: localOf(fo.inbound?.arrivalTime),
  };
}

/** YYYY-MM-DD plus n days (calendar arithmetic, no zone). */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const slotAt = (day: string, hour: number): string => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(israelWallToUtc(y, m, d, hour)).toISOString();
};

/** The instant (UTC ISO) a kind is due for an order, or null when the order has no such moment. */
export function slotFor(kind: ScheduleKind, f: { flight: FlightFacts | null; eventDate: string | null }): string | null {
  if (kind === "flight_reminder") {
    return f.flight ? slotAt(addDays(f.flight.departureLocal.slice(0, 10), -FLIGHT_REMINDER_DAYS_BEFORE), SLOT_HOUR.flight_reminder) : null;
  }
  if (kind === "event_today") return f.eventDate ? slotAt(f.eventDate.slice(0, 10), SLOT_HOUR.event_today) : null;
  const back = f.flight?.returnArrivalLocal?.slice(0, 10) ?? f.eventDate?.slice(0, 10) ?? null;
  return back ? slotAt(addDays(back, 1), SLOT_HOUR.after_trip) : null;
}

/** The slot falls in the hour that is now (the hourly cron enqueues it then). */
export function dueThisHour(slot: string | null, now: Date): boolean {
  if (!slot) return false;
  const at = Date.parse(slot);
  return now.getTime() >= at && now.getTime() < at + HOUR_MS;
}

/** C-5ג: an order created after its reminder's slot gets no reminder. */
export function lateBooking(createdAt: string, slot: string): boolean {
  return Date.parse(createdAt) > Date.parse(slot);
}

export function airportLabel(iata: string): string {
  return iata.trim().toUpperCase() === "TLV" ? "נתב״ג" : iata.trim().toUpperCase();
}

export function flightParams(f: FlightFacts, flightCity: string): { city: string; number: string; date: string; hour: string; airport: string } {
  const [, m, d] = f.departureLocal.slice(0, 10).split("-");
  return { city: flightCity, number: f.number, date: `${d}.${m}`, hour: formatHm(f.departureLocal) ?? "", airport: airportLabel(f.airport) };
}

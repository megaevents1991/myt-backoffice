/**
 * Route helpers for tours: where a group lands and where it flies home from.
 *
 * 42% of Mega Family departures land in one city and return from another, and
 * the direction even flips between dates of the same series. So a route is two
 * ends, never one "destination", and everything that pairs a flight block with
 * a departure checks BOTH ends by city (LTN and LHR are both London).
 *
 * Pure functions, no I/O.
 */
import { airportsMatch } from "@/lib/airport-cities";

export type RouteType = "round_trip" | "airport_change" | "open_jaw";

export const ROUTE_TYPE_LABELS: Record<RouteType, string> = {
  round_trip: "הלוך-חזור",
  airport_change: "אותה עיר, שדה אחר",
  open_jaw: "חוזרים מעיר אחרת",
};

/** True only when both codes are present and name the same city. */
export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return airportsMatch(a.toUpperCase(), b.toUpperCase());
}

export function routeType(arrival: string | null | undefined, ret: string | null | undefined): RouteType | null {
  if (!arrival || !ret) return null;
  if (arrival.toUpperCase() === ret.toUpperCase()) return "round_trip";
  return sameCity(arrival, ret) ? "airport_change" : "open_jaw";
}

/** "LHR → CDG" for a departure, or "LHR" when it is a plain round trip. */
export function departureRouteLabel(arrival: string | null | undefined, ret: string | null | undefined): string {
  if (!arrival && !ret) return "";
  if (!ret || arrival === ret) return arrival ?? "";
  if (!arrival) return `? → ${ret}`;
  return `${arrival} → ${ret}`;
}

export interface FlightEnds {
  outbound_departure_airport: string;
  outbound_arrival_airport: string;
  inbound_departure_airport: string;
  inbound_arrival_airport: string;
}

/** Both legs of a block: "TLV→LHR · CDG→TLV". Every list and label shows this, never the outbound alone. */
export function flightRouteLabel(f: FlightEnds): string {
  return `${f.outbound_departure_airport}→${f.outbound_arrival_airport} · ${f.inbound_departure_airport}→${f.inbound_arrival_airport}`;
}

export interface RouteCheck {
  ok: boolean;
  /** Hebrew reason, shown to the operator when the block does not fit the departure. */
  reason?: string;
}

/**
 * Does this block fit this departure? Both ends must be in the same city.
 * `legs` narrows the check when a departure takes only one direction from the block.
 */
export function checkBlockFitsDeparture(
  block: FlightEnds,
  departure: { arrival_airport: string | null; return_airport: string | null },
  legs: "both" | "outbound" | "inbound" = "both",
): RouteCheck {
  const arrival = departure.arrival_airport;
  const ret = departure.return_airport ?? departure.arrival_airport;
  if (legs !== "inbound" && arrival && !sameCity(block.outbound_arrival_airport, arrival)) {
    return { ok: false, reason: `הטיסה נוחתת ב-${block.outbound_arrival_airport}, היציאה נוחתת ב-${arrival}` };
  }
  if (legs !== "outbound" && ret && !sameCity(block.inbound_departure_airport, ret)) {
    return { ok: false, reason: `הטיסה חוזרת מ-${block.inbound_departure_airport}, היציאה חוזרת מ-${ret}` };
  }
  return { ok: true };
}

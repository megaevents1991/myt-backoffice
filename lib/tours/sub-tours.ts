/**
 * Sub-tours made from flights - the pure rules of the tour setup flow
 * (mega-family docs/plans/TOUR-SETUP-FLOW-PLAN.md). No I/O.
 *
 * A flight series of a tours company, ticked "Organized tour" with a tour code,
 * creates one sub-tour (tours.departures row) per flight:
 * lib/actions/tours-flight-series-actions.ts. When the airline later moves a
 * flight, the sub-tour created from it follows - unless it has sales:
 * lib/tours/flight-sync.ts. Both take their numbers from here, and
 * scripts/tour-setup-selftest.ts pins them.
 */
import { departureCode, seasonYearOf } from "@/components/tours/departures/departure-utils";
import { isDateOnly, nightsBetween } from "@/lib/tours/format";

/** The flight fields a sub-tour is made from. */
export interface FlightDates {
  id: number;
  outbound_departure_time: string | null;
  inbound_departure_time: string | null;
  outbound_arrival_airport: string | null;
  inbound_departure_airport: string | null;
  initial_quantity: number;
  season_label: string | null;
}

export interface SubTourDraft {
  code: string;
  seasonYear: number;
  /** yyyy-mm-dd: the day the outbound flight takes off. */
  start: string;
  /** yyyy-mm-dd: the day the return flight takes off. */
  end: string;
  /** Where the trip lands and where it flies home from (the departure's route). */
  arrival: string | null;
  ret: string | null;
  capacity: number;
  season: string | null;
}

/** The longest trip a flight may turn into - the limit createDeparture applies. */
export const MAX_SUB_TOUR_NIGHTS = 60;

const day = (t: string | null | undefined): string | null => {
  const d = (t ?? "").slice(0, 10);
  return isDateOnly(d) ? d : null;
};
const airport = (a: string | null | undefined): string | null => {
  const v = (a ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(v) ? v : null;
};

/** The dates a flight gives its sub-tour, or why it gives none. */
function flightSpan(f: FlightDates): { start: string; end: string } | { error: string } {
  const start = day(f.outbound_departure_time);
  const end = day(f.inbound_departure_time);
  if (!start) return { error: "The flight has no outbound date" };
  if (!end) return { error: "The flight has no return - a sub-tour needs a flight out and back" };
  if (end < start) return { error: "The return flight is before the outbound flight" };
  if ((nightsBetween(start, end) ?? 0) > MAX_SUB_TOUR_NIGHTS) {
    return { error: `More than ${MAX_SUB_TOUR_NIGHTS} nights between the outbound and the return flight` };
  }
  return { start, end };
}

/**
 * The sub-tour one flight of an organized series creates: code = tour code +
 * month + day of the outbound flight, dates from the two flights, the route the
 * flight flies, every seat of the block, the flight's season label.
 */
export function subTourFromFlight(seriesCode: string, f: FlightDates): SubTourDraft | { error: string } {
  const span = flightSpan(f);
  if ("error" in span) return span;
  return {
    code: departureCode(seriesCode, span.start),
    seasonYear: seasonYearOf(span.start),
    start: span.start,
    end: span.end,
    arrival: airport(f.outbound_arrival_airport),
    ret: airport(f.inbound_departure_airport),
    capacity: Math.max(0, Math.trunc(Number(f.initial_quantity) || 0)),
    season: f.season_label?.trim() || null,
  };
}

export type MoveDecision =
  | { kind: "none" }
  | { kind: "move"; start: string; end: string; code: string; seasonYear: number }
  | { kind: "task"; reason: "sales" | "code_taken"; start: string; end: string; code: string };

/**
 * What happens to a sub-tour when its flight changed (Dor, 03.10.2026): it moves
 * with the flight - dates, code and season year - while nobody bought it; with
 * sales or bookings, or when the new code belongs to another departure, it stays
 * and a person gets a task. A flight without a valid out-and-back span moves nothing.
 */
export function flightMoveDecision(
  dep: { start_date: string; end_date: string; code: string; season_year: number },
  seriesCode: string,
  f: FlightDates,
  opts: { hasSales: boolean; codeTaken: (code: string, seasonYear: number) => boolean },
): MoveDecision {
  const span = flightSpan(f);
  if ("error" in span) return { kind: "none" };
  if (span.start === dep.start_date && span.end === dep.end_date) return { kind: "none" };
  const code = departureCode(seriesCode, span.start);
  const seasonYear = seasonYearOf(span.start);
  if (opts.hasSales) return { kind: "task", reason: "sales", start: span.start, end: span.end, code };
  const keepsItsCode = code === dep.code && seasonYear === dep.season_year;
  if (!keepsItsCode && opts.codeTaken(code, seasonYear)) {
    return { kind: "task", reason: "code_taken", start: span.start, end: span.end, code };
  }
  return { kind: "move", start: span.start, end: span.end, code, seasonYear };
}

import { z } from "zod";

/**
 * How long one leg (outbound or inbound) may take from takeoff to landing, a
 * stopover included. Mirrored in main's `lib/getDefaultDateRange.ts`
 * (`MAX_LEG_HOURS`): the site reads the hotel's CHECK-IN from the outbound
 * landing, and no longer trusts a landing outside this window.
 *
 * Why it exists (2026-10-12): an offline flight was saved with its outbound
 * landing in the wrong month - 20/07 for 20/05 - and nothing refused it. The
 * three flight forms took the raw datetime, their only rule was "a landing
 * before the takeoff is cleared", the auto-calculated duration read PT1468H
 * and was accepted, and `assertFlightValues` checks money and quantities
 * alone. On the site the flight card prints the landing's hour alone, so the
 * customer picked a May flight and the hotel step opened on a check-in two
 * months after the check-out.
 */
export const MAX_LEG_HOURS = 48;

export const LEG_DIRECTIONS = ["outbound", "inbound"] as const;
export type LegDirection = (typeof LEG_DIRECTIONS)[number];

type LegTimeKey =
  | `${LegDirection}_departure_time`
  | `${LegDirection}_arrival_time`;
export type LegTimeValues = Partial<Record<LegTimeKey, unknown>>;

/**
 * A local "YYYY-MM-DDTHH:mm[:ss]" - what the `timestamp without time zone`
 * columns hold and what the forms' datetime-local inputs send. Anything that
 * is not a readable time is null: the schemas own the format, this rule only
 * compares two real times.
 */
const localTime = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
};

const spanText = (hours: number): string =>
  hours >= MAX_LEG_HOURS
    ? `${Math.round(hours / 24)} days`
    : `${Math.round(hours)} hours`;

/**
 * Why a leg's landing cannot follow its takeoff, or null when it can (or when
 * either side is missing or unreadable - not this rule's call).
 */
export function legTimesProblem(
  departure: unknown,
  arrival: unknown,
): string | null {
  const dep = localTime(departure);
  const arr = localTime(arrival);
  if (dep === null || arr === null) return null;
  if (arr < dep) return "Landing is before takeoff.";
  const hours = (arr - dep) / 3_600_000;
  if (hours > MAX_LEG_HOURS) {
    return `Landing is ${spanText(hours)} after takeoff - one leg takes ${MAX_LEG_HOURS} hours at most. Check the landing's date (its month).`;
  }
  return null;
}

/**
 * Pass to `.superRefine()` on each flight form schema (new, edit, the inline
 * form in the event editor). The issue lands on the leg's arrival field, so
 * the message shows under the time that is wrong.
 */
export function legTimesSuperRefine(
  values: LegTimeValues,
  ctx: z.RefinementCtx,
): void {
  for (const direction of LEG_DIRECTIONS) {
    const problem = legTimesProblem(
      values[`${direction}_departure_time`],
      values[`${direction}_arrival_time`],
    );
    if (problem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${direction}_arrival_time`],
        message: problem,
      });
    }
  }
}

/**
 * The server-side copy, for the actions - the forms are not the only writers
 * (the API routes, the series, an in-place cell edit). Throws like
 * `assertFlightValues`, naming the column.
 *
 * `touched` limits the check to the legs that patch names: an update merged
 * with the stored row must not refuse a PRICE change over a landing someone
 * typed wrong long ago - the edit form, which sends the whole row, is where
 * that gets fixed, and it refuses until it is.
 */
export function assertLegTimes(
  row: Record<string, unknown>,
  touched?: Record<string, unknown>,
): void {
  for (const direction of LEG_DIRECTIONS) {
    const depKey = `${direction}_departure_time`;
    const arrKey = `${direction}_arrival_time`;
    if (touched && !(depKey in touched) && !(arrKey in touched)) continue;
    const problem = legTimesProblem(row[depKey], row[arrKey]);
    if (problem) throw new Error(`${arrKey}: ${problem}`);
  }
}

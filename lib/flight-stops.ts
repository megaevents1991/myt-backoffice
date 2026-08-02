import { z } from "zod";

/**
 * A stopover lives per direction (`outbound_stop_airport` / `inbound_stop_airport`)
 * — the outbound leg can connect while the inbound is direct, and each may
 * connect somewhere different. `flights.stops` is the legacy round-trip count
 * the main app still reads, derived from those two so they can never disagree.
 *
 * The DB trigger `flights_derive_stops` enforces the same rule on every write;
 * this is the client-side copy, so a form saves the right value without waiting
 * to read the row back.
 */
export function deriveStops(
  outboundStopAirport?: string | null,
  inboundStopAirport?: string | null,
): number {
  const outbound = outboundStopAirport?.trim() ? 1 : 0;
  const inbound = inboundStopAirport?.trim() ? 1 : 0;
  return Math.max(outbound, inbound);
}

/** Blank inputs must reach the DB as null, not "" — `varchar(3)` would keep it. */
export function blankToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Postgres `interval` reads "2:30" as 2h30m. */
const stopDurationPattern = /^\d{1,2}:[0-5]\d$/;
const stopIataPattern = /^[A-Z]{3}$/;

/**
 * Postgres renders `interval` as "HH:MM:SS" — drop the seconds so the value it
 * hands back is one the layover input will accept again on the next save.
 */
export function intervalToHhMm(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  const [hours, minutes] = trimmed.split(":");
  if (minutes === undefined) return trimmed;
  return `${Number(hours)}:${minutes}`;
}

/**
 * The stopover half of both flight form schemas. `*_has_stop` is form-only —
 * it drives the reveal and the "airport is required" rule, and is stripped
 * before the payload reaches Supabase.
 */
export const stopoverSchemaShape = {
  outbound_has_stop: z.enum(["0", "1"]).default("0"),
  outbound_stop_airport: z.string().optional(),
  outbound_stop_duration: z.string().optional(),
  inbound_has_stop: z.enum(["0", "1"]).default("0"),
  inbound_stop_airport: z.string().optional(),
  inbound_stop_duration: z.string().optional(),
};

type StopoverValues = {
  outbound_has_stop?: "0" | "1";
  outbound_stop_airport?: string;
  outbound_stop_duration?: string;
  inbound_has_stop?: "0" | "1";
  inbound_stop_airport?: string;
  inbound_stop_duration?: string;
};

/**
 * Pass to `.superRefine()` on either flight form schema. Saving "1 stop" with
 * no airport would store a connection the customer never sees — the trigger
 * would derive 0 stops and the flight would sell as direct — so it is an error
 * rather than a silent downgrade.
 */
export function stopoverSuperRefine(
  values: StopoverValues,
  ctx: z.RefinementCtx,
): void {
  for (const direction of ["outbound", "inbound"] as const) {
    const airport = values[`${direction}_stop_airport`]?.trim() ?? "";
    const duration = values[`${direction}_stop_duration`]?.trim() ?? "";
    const hasStop = values[`${direction}_has_stop`] === "1";

    if (hasStop && !airport) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${direction}_stop_airport`],
        message: "A connecting leg needs its stopover airport.",
      });
    }
    if (airport && !stopIataPattern.test(airport)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${direction}_stop_airport`],
        message: "Invalid stopover IATA (3 uppercase letters).",
      });
    }
    if (duration && !stopDurationPattern.test(duration)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${direction}_stop_duration`],
        message: "Layover must look like 2:30 (HH:MM).",
      });
    }
  }
}

/**
 * Turns the form's stopover fields into the columns `flights` actually has:
 * blanks become null, and `stops` is derived. Drops the `*_has_stop` toggles,
 * which exist only in the form.
 */
export function toStopoverColumns(values: StopoverValues) {
  const outboundAirport = blankToNull(values.outbound_stop_airport);
  const inboundAirport = blankToNull(values.inbound_stop_airport);
  return {
    outbound_stop_airport: outboundAirport,
    outbound_stop_duration: blankToNull(values.outbound_stop_duration),
    inbound_stop_airport: inboundAirport,
    inbound_stop_duration: blankToNull(values.inbound_stop_duration),
    stops: deriveStops(outboundAirport, inboundAirport),
  };
}

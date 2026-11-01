import { z } from "zod";
import { cleanAirlineCode } from "@/lib/airline-lookup";

/**
 * A group block can fly out with one airline and back with another (Lufthansa
 * out, Swiss back - Dor, 01.11.2026). `airline_code` + `metadata_*` are the
 * OUTBOUND airline; `inbound_airline_code` + `inbound_metadata_*` are the return
 * one, set only when it differs. A tours company only - pickFlightColumns drops
 * them on a Mega Events write. Pure: no fetch, no DB.
 */
export type ReturnAirline = { code: string; name: string; logo: string };

export const NO_RETURN_AIRLINE: ReturnAirline = { code: "", name: "", logo: "" };

/** The same length rule as `airline_code` (the column is varchar(3)). */
export const AIRLINE_CODE_PATTERN = /^[A-Z0-9]{2,3}$/;

export const returnAirlineSchemaShape = {
  inbound_airline_code: z.string().nullish(),
  inbound_metadata_name: z.string().nullish(),
  inbound_metadata_logo: z.string().nullish(),
};

/** True when the code is a real second airline - the outbound one typed again is not. */
export function flownBackByAnother(code: unknown, outboundCode: unknown): boolean {
  const back = cleanAirlineCode(code);
  return back !== "" && back !== cleanAirlineCode(outboundCode);
}

/** The form's three boxes as a row holds them. */
export function returnAirlineOf(row: {
  inbound_airline_code?: string | null;
  inbound_metadata_name?: string | null;
  inbound_metadata_logo?: string | null;
}): ReturnAirline {
  return {
    code: row.inbound_airline_code ?? "",
    name: row.inbound_metadata_name ?? "",
    logo: row.inbound_metadata_logo ?? "",
  };
}

/**
 * Why a form may not save these boxes, or null. `storedCode` is what the row
 * already holds: an older row with a code and no name must not stop an unrelated
 * edit (the save looks the name up by itself - fillReturnAirlineNames).
 */
export function returnAirlineProblem(
  value: ReturnAirline,
  outboundCode: unknown,
  storedCode?: string | null,
): string | null {
  const code = cleanAirlineCode(value.code);
  if (!code || !flownBackByAnother(code, outboundCode)) return null;
  if (!AIRLINE_CODE_PATTERN.test(code)) {
    return "The return airline is one code of 2-3 letters or digits (e.g. LX).";
  }
  if (value.name.trim() || code === cleanAirlineCode(storedCode)) return null;
  return "Look up the return airline, or type its name - the site prints it on the return flight.";
}

/** What a form writes. Blank, or the outbound airline again, is no return airline. */
export function returnAirlineColumns(value: ReturnAirline, outboundCode: unknown) {
  if (!flownBackByAnother(value.code, outboundCode)) {
    return { inbound_airline_code: null, inbound_metadata_name: null, inbound_metadata_logo: null };
  }
  return {
    inbound_airline_code: cleanAirlineCode(value.code),
    inbound_metadata_name: value.name.trim() || null,
    inbound_metadata_logo: value.logo.trim() || null,
  };
}

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Every write that names the return airline's code also decides its name and
 * logo: a sheet cell or a bulk edit writes the code alone, and Swiss's name must
 * not stay on a block that now flies back with Austrian.
 */
export function withReturnAirlineNames(columns: Record<string, unknown>): Record<string, unknown> {
  if (!("inbound_airline_code" in columns)) return columns;
  const code = cleanAirlineCode(columns.inbound_airline_code);
  return {
    ...columns,
    inbound_airline_code: code || null,
    inbound_metadata_name: code ? textOrNull(columns.inbound_metadata_name) : null,
    inbound_metadata_logo: code ? textOrNull(columns.inbound_metadata_logo) : null,
  };
}

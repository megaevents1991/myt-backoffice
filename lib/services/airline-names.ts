import {
  AVCODES_SEARCH_URL,
  avcodesSearchBody,
  normalizeAirlineCode,
  parseAvcodesResult,
} from "@/lib/airline-lookup";
import { flownBackByAnother } from "@/lib/flight-return-airline";

// A plain POST of avcodes' search form - no browser (lib/airline-lookup.ts says why).
const LOOKUP_TIMEOUT_MS = 10_000;
const LOOKUP_ATTEMPTS = 2;

/** The result page's HTML; one more try on a network error or a 5xx. Throws when neither answered. */
export async function fetchAvcodes(code: string): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= LOOKUP_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(AVCODES_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: avcodesSearchBody(code),
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.ok) return await res.text();
      lastError = new Error(`avcodes answered HTTP ${res.status}`);
      if (res.status < 500) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export type AirlineNames = { name: string; logo: string | null };

/** Found airlines only, per server instance: a sheet save of 30 rows asks avcodes once. */
const found = new Map<string, AirlineNames>();

/** The airline's name and logo, or null when avcodes has none. Throws when avcodes did not answer. */
export async function lookupAirlineNames(rawCode: string): Promise<AirlineNames | null> {
  const code = normalizeAirlineCode(rawCode);
  if (!code) return null;
  const known = found.get(code);
  if (known) return known;
  const result = parseAvcodesResult(await fetchAvcodes(code));
  if (result.kind !== "found" && result.kind !== "no_icao") return null;
  const names: AirlineNames = {
    name: result.airlineName,
    logo: result.kind === "found" ? result.airlineLogo : null,
  };
  found.set(code, names);
  return names;
}

/**
 * A return airline written as a code alone (a sheet cell, a table cell, a bulk
 * edit) gets its name and logo here. A code with no name still saves - the site
 * then prints the code, and the next save looks again - so a lookup that fails
 * never fails the save.
 */
export async function fillReturnAirlineNames(
  columns: Record<string, unknown>,
  outboundCode: unknown,
  lookup: (code: string) => Promise<AirlineNames | null> = lookupAirlineNames,
): Promise<Record<string, unknown>> {
  const code = columns.inbound_airline_code;
  if (typeof code !== "string" || columns.inbound_metadata_name) return columns;
  if (!flownBackByAnother(code, outboundCode)) return columns;
  try {
    const names = await lookup(code);
    return names
      ? { ...columns, inbound_metadata_name: names.name, inbound_metadata_logo: names.logo }
      : columns;
  } catch (error) {
    console.error(`Return airline: no name for ${code}:`, error);
    return columns;
  }
}

/**
 * The airline-code check behind the offline flight forms' "Validate" button
 * (`app/api/validate-airline/route.ts`). Pure: no fetch, no DB.
 *
 * Why it is a plain request (2026-10-29): the route used to launch a headless
 * Chromium per click to fill avcodes.co.uk's search form. On 29.10 the browser
 * crashed on a reused Vercel instance and every later call there failed with
 * `net::ERR_INSUFFICIENT_RESOURCES` for half an hour - Liz could not validate
 * IZ and "Create Flight" stays disabled until the code validates. The form is
 * an ordinary POST; the same answer comes back in about a second with no
 * browser. A code typed with a space or a hidden mark (copied from a sheet)
 * also failed, and "not found" and "the site is down" read the same.
 */

export const AVCODES_SEARCH_URL = "https://www.avcodes.co.uk/airlcoderes.asp";

/** Zero-width characters, bidi marks, the BOM and no-break spaces a pasted cell may carry. */
const INVISIBLE = /[ ​-‏‪-‮⁠-⁩﻿]/g;

/** An IATA airline designator: two letters or digits ("LY", "W6", "7X"). */
const IATA_AIRLINE = /^[A-Z0-9]{2}$/;

/**
 * The code as avcodes is asked for it: hidden marks dropped, trimmed, upper
 * case. Null when what is left is not a two-character designator.
 */
export function normalizeAirlineCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(INVISIBLE, "").trim().toUpperCase();
  return IATA_AIRLINE.test(code) ? code : null;
}

/** The search form's fields, exactly as the site's own form posts them. */
export function avcodesSearchBody(code: string): string {
  return new URLSearchParams({
    iataairl: code,
    icaoairl: "",
    faacode: "",
    account: "",
    prefix: "",
    airlname: "",
    callsign: "",
    B1: "",
  }).toString();
}

/** The logo avcodes keeps per ICAO code (first three letters). */
export function avcodesLogoUrl(icaoCode: string): string {
  return `https://www.avcodes.co.uk/images/logos/${icaoCode.substring(0, 3)}.png`;
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  copy: "©",
};

/** The page as text: scripts and styles dropped, tags to spaces, entities decoded, spaces collapsed. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}

export type AvcodesResult =
  | { kind: "found"; airlineName: string; icaoCode: string; airlineLogo: string }
  /** The site answered and has no record of the code. */
  | { kind: "not_found" }
  /** Only historical records - the code is no longer an airline's. */
  | { kind: "historical_only" }
  /** A current airline with no ICAO code - there is no logo to use. */
  | { kind: "no_icao"; airlineName: string }
  /** The page is not the result page we know (the site changed or answered an error page). */
  | { kind: "unreadable"; reason: string };

const CURRENT_MARKER = "This is Current Data";
const HISTORICAL_MARKER = "Please Note this is Historical Data";
const NAME_MAX = 120;

/** Reads avcodes' result page for one IATA code. */
export function parseAvcodesResult(html: string): AvcodesResult {
  const text = htmlToPlainText(html);

  const count = text.match(/Number of Records found\s*:?\s*(\d+)/i);
  if (!count) return { kind: "unreadable", reason: 'no "Number of Records found" on the page' };
  if (Number(count[1]) === 0) return { kind: "not_found" };

  const start = text.indexOf(CURRENT_MARKER);
  if (start === -1) {
    return text.includes(HISTORICAL_MARKER)
      ? { kind: "historical_only" }
      : { kind: "unreadable", reason: `records found but no "${CURRENT_MARKER}" section` };
  }

  // The first current record only: it ends where the next record (current or historical) begins.
  const after = text.slice(start + CURRENT_MARKER.length);
  const ends = [after.indexOf(HISTORICAL_MARKER), after.indexOf(CURRENT_MARKER)].filter((i) => i >= 0);
  const record = ends.length ? after.slice(0, Math.min(...ends)) : after;

  const nameEnd = record.search(/Full Name:|IATA Code:/);
  const airlineName = (nameEnd === -1 ? "" : record.slice(0, nameEnd)).trim().slice(0, NAME_MAX).trim();
  if (!airlineName) return { kind: "unreadable", reason: "no airline name before \"Full Name:\"" };

  // The ICAO value runs up to the next label: an empty one reads "ICAO Code: FAA 3LD Code:",
  // so a bare three-letter match would take "FAA" for the code.
  const icaoValue = record.match(/ICAO Code:\s*(.*?)\s*(?=FAA 3LD Code:|IATA Accounting Code:|IATA Prefix Code:|ICAO Callsign:|$)/);
  const icao = icaoValue?.[1].match(/^([A-Z]{3})(?![A-Za-z0-9])/);
  if (!icao) return { kind: "no_icao", airlineName };

  return { kind: "found", airlineName, icaoCode: icao[1], airlineLogo: avcodesLogoUrl(icao[1]) };
}

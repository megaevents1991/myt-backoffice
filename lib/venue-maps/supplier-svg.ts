/**
 * Reading a supplier's venue drawing (an SVG on TixStock's bucket), read-only: the host allowlist, the
 * download and the "is this really an SVG, and not too big" checks. `adoptVenueMap`
 * (lib/actions/venue-map-actions.ts) takes ownership of a drawing through it, and the tour uploader's
 * classification dialog reads a drawing's categories through it without adopting anything.
 *
 * A module of its own, and `server-only`, because a `"use server"` file turns every export into an endpoint
 * the browser can call - and this one fetches whatever URL it is handed (the allowlist is what keeps it a
 * TixStock reader and not an open proxy).
 *
 * Selftest: scripts/tour-uploader-selftest.ts (section "Round אלון 1, Task 6").
 */
import "server-only";

/** Supplier hosts a drawing may be read from. */
const ADOPTABLE_HOSTS = new Set(["tixstock.s3.eu-west-2.amazonaws.com"]);
/** A drawing longer than this is not a stadium map. */
export const MAX_SVG_BYTES = 2_000_000;
/** A supplier that does not answer in this long is treated as unreachable. */
const FETCH_TIMEOUT_MS = 15_000;

/** The url parses and its host is one a drawing may be read from. Compared whole - `<host>.evil.com` is another host. */
export function isAdoptableHost(url: string): boolean {
  try {
    return ADOPTABLE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The text looks like an SVG and fits the size cap. */
export function isUsableSvg(svg: string): boolean {
  return svg.includes("<svg") && svg.length <= MAX_SVG_BYTES;
}

/**
 * Downloads a supplier drawing. Never throws: an unparseable url, a host off the allowlist, a bad status,
 * a failed download or text that is not a usable SVG comes back as `{ ok: false, error }` (the messages are
 * the ones `adoptVenueMap` has always shown).
 */
export async function fetchSupplierSvg(sourceUrl: string): Promise<{ ok: true; svg: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return { ok: false, error: "Invalid map URL" };
  }
  if (!isAdoptableHost(sourceUrl)) return { ok: false, error: "This map is not a supplier SVG we can adopt" };

  let svg: string;
  try {
    const res = await fetch(parsed.toString(), { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, error: `Supplier map returned ${res.status}` };
    svg = await res.text();
  } catch (error) {
    console.error("venue-map: source fetch failed", error);
    return { ok: false, error: "Could not download the supplier map" };
  }
  if (!isUsableSvg(svg)) return { ok: false, error: "The supplier map is not a usable SVG" };
  return { ok: true, svg };
}

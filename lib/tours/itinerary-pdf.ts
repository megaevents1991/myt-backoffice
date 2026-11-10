/**
 * The tour's itinerary as a PDF, sent with a booking-link offer (Alon 10.11, ROAD MAP MEGATR note 6: "שבונים לינק
 * לטיול ושולחים ללקוח הצעה - אם אפשר להצמיד גם את PDF המסלול"; Dor chose a real file made by itself).
 *
 * The PDF is the SITE's own print sheet of the date (mega-family components/package/PrintSheet.tsx - the A4 brochure
 * Daniel and Liz designed 08-09.11), printed by headless Chromium (lib/services/tours-itinerary-pdf.ts) and kept in
 * the public Storage bucket, one file per date and choice of rooms. A rep's own WhatsApp or mail app can only send a LINK, so the offer's
 * message carries the file's address. Pure: no DB, no browser. Selftest: scripts/tours-itinerary-pdf-selftest.ts.
 */

/**
 * A stored PDF is printed again after half an hour, whatever changed: the sheet prints the rooms' prices, and a price
 * edit does not always touch the date's updated_at. A print takes ~3 s; the builder prints while the rep still picks.
 */
export const ITINERARY_FRESH_MS = 30 * 60 * 1000;
/**
 * The site reads its content at build time: an edit in the backoffice shows there only after the site rebuilt. A PDF
 * printed within this long of the tour's or date's last edit may hold the old page - the next request prints again.
 */
export const SITE_REBUILD_MS = 15 * 60 * 1000;
/** Where the files live in the public bucket (public_resources). */
export const ITINERARY_FOLDER = "itineraries";
/** Below this a "PDF" is an error page, not an itinerary. */
export const ITINERARY_MIN_BYTES = 10_000;

const safe = (text: string): string => text.replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 40);

/** A short name for a choice of rooms, the same whatever order they were picked in (FNV-1a, base 36). */
export function roomsKey(rooms: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const ch of [...rooms].sort().join(",")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * The file of one date and one choice of rooms: `itineraries/<company>/<code>-<id8>-<rooms>.pdf`. The sheet prints the
 * rooms and their total (the site pre-fills its funnel from `rooms`), so another choice is another file; the same
 * choice again replaces it.
 */
export function itineraryPdfPath(companySlug: string, departure: { id: string; code: string }, rooms: readonly string[]): string {
  const code = safe(departure.code) || "date";
  return `${ITINERARY_FOLDER}/${safe(companySlug) || "company"}/${code}-${safe(departure.id).slice(0, 8)}-${roomsKey(rooms)}.pdf`;
}

/** The site page whose print sheet is the PDF: the tour on that date with the offer's rooms - a booking link without its token. */
export function itineraryPageUrl(siteUrl: string, packagePath: string, productId: number, rooms: readonly string[]): string {
  const base = siteUrl.replace(/\/+$/, "");
  const [path] = packagePath.split("?");
  const params = new URLSearchParams({ product_id: String(productId) });
  if (rooms.length) params.set("rooms", rooms.join(","));
  return `${base}${path}?${params.toString()}`;
}

/**
 * A stored PDF is good when it is under half an hour old and was printed long enough after the tour's / date's last edit for
 * the site to show that edit. Unknown times = print again.
 */
export function isItineraryFresh(storedAt: string | null, contentChangedAt: string | null, now: number): boolean {
  const stored = storedAt ? Date.parse(storedAt) : NaN;
  if (Number.isNaN(stored)) return false;
  if (now - stored >= ITINERARY_FRESH_MS || stored > now + 60_000) return false;
  const changed = contentChangedAt ? Date.parse(contentChangedAt) : NaN;
  return Number.isNaN(changed) || stored - changed >= SITE_REBUILD_MS;
}

/** The public address with the print's time on it, so a phone or a CDN never shows an older print of the same file. */
export function versionedUrl(publicUrl: string, storedAt: string): string {
  const v = Date.parse(storedAt);
  return Number.isNaN(v) ? publicUrl : `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}v=${Math.floor(v / 1000)}`;
}

/** The line the offer's message ends with. */
export function itineraryLine(url: string): string {
  return `המסלול המלא להורדה (PDF): ${url}`;
}

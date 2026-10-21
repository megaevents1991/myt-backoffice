// Tells the customer site that the "Build Your Euro Trip" settings changed: POST /api/itinerary/revalidate
// (myt-main) drops the `itinerary-settings` tag and the /euro-trip pages, so a switch or a rule takes effect on
// the next request instead of at the end of the site's hour of cache.
//
// Same envs as lib/revalidate-main.ts - the site's address (NEXT_SECRET_HOTEL_SERVICE_URL) and the shared
// secret (NEXT_SECRET_REVALIDATION_SECRET), sent in `x-hotel-secret` like /api/homepage-pools. Only the primary
// site is called: the parallel mondial deployment that revalidateMain also pings is an old branch that does not
// carry this endpoint. NEVER throws - the caller reports a failure next to a successful save.

/** The ping is awaited at most this long - a site that hangs must not hold a save. */
const REVALIDATE_TIMEOUT_MS = 5_000;

export type ItineraryRevalidateResult = { ok: true } | { ok: false; reason: string };

export async function revalidateItinerary(): Promise<ItineraryRevalidateResult> {
  const base = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
  const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!base || !secret) {
    return { ok: false, reason: "כתובת האתר או הסוד המשותף לא מוגדרים בשרת" };
  }
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/itinerary/revalidate`, {
      method: "POST",
      headers: { "x-hotel-secret": secret },
      cache: "no-store",
      signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    if (res.status === 404) return { ok: false, reason: "האתר עדיין לא כולל את נקודת הרענון של Euro Trip (גרסת האתר ישנה)" };
    if (res.status === 401) return { ok: false, reason: "האתר דחה את הסוד המשותף (401)" };
    return { ok: false, reason: `האתר ענה ${res.status}` };
  } catch (error) {
    console.error("itinerary revalidate failed (non-fatal):", error);
    return { ok: false, reason: "לא ניתן להגיע לאתר" };
  }
}

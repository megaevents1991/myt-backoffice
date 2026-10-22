// Best-effort ISR refresh of the customer site(s) after backoffice data
// changes. Same dual-target fan-out as app/api/revalidate/route.ts - never
// throws; a failed ping just means the site refreshes on its 1h ISR window.

/** Each ping is awaited at most this long - a site that hangs must not hold an approve (the abort is caught below). */
const REVALIDATE_TIMEOUT_MS = 5_000;

export async function revalidateMain(): Promise<void> {
  const primary = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
  // A second site is pinged only when the env names one (the mondial2026 branch site, the old
  // default here, was taken off its domain on 22.10.2026).
  const parallel = process.env.NEXT_SECRET_PARALLEL_HOTEL_SERVICE_URL;
  const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!primary || !secret) return;
  const targets = [...new Set([primary, parallel].filter((u): u is string => Boolean(u)))];
  await Promise.allSettled(
    targets.map(async (baseUrl) => {
      try {
        await fetch(
          `${baseUrl.replace(/\/$/, "")}/api/revalidate?secret=${encodeURIComponent(secret)}`,
          { signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS) },
        );
      } catch (error) {
        console.error("revalidate failed (non-fatal):", baseUrl, error);
      }
    }),
  );
}

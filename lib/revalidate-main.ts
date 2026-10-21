// Best-effort ISR refresh of the customer site(s) after backoffice data
// changes. Same dual-target fan-out as app/api/revalidate/route.ts - never
// throws; a failed ping just means the site refreshes on its 1h ISR window.

/** Each ping is awaited at most this long - a site that hangs must not hold an approve (the abort is caught below). */
const REVALIDATE_TIMEOUT_MS = 5_000;

export async function revalidateMain(): Promise<void> {
  const primary = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
  const parallel =
    process.env.NEXT_SECRET_PARALLEL_HOTEL_SERVICE_URL ||
    "https://mondial2026.mega-events.co.il";
  const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!primary || !secret) return;
  const targets = [...new Set([primary, parallel])];
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

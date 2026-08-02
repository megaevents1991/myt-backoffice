/**
 * The customer-facing site partners send people to.
 *
 * Overridable so a preview deployment can point links somewhere else, but it
 * defaults to production: a partner copying a link out of the portal must never
 * get one that quietly points at staging.
 */
export const PUBLIC_SITE_URL = (
  process.env.NEXT_PUBLIC_MAIN_SITE_URL || "https://www.mega-events.co.il"
).replace(/\/$/, "")

/**
 * A tracking link for a partner.
 *
 * `utm_source` is what the main app reads (`app/hooks/Affiliate.tsx`), with
 * `aff` as a legacy fallback. The code is stored in localStorage on arrival, so
 * it keeps counting after the visitor navigates away from this URL.
 */
export function partnerLink(
  trackingCode: string,
  eventId?: number | null,
  shareToken?: string | null,
): string {
  const path = eventId == null ? "/" : `/order/${eventId}`
  const base = `${PUBLIC_SITE_URL}${path}?utm_source=${encodeURIComponent(trackingCode)}`
  // `pkg` is read by myt-main's useHandlePreparedPackage → GET /api/package/[token],
  // which re-validates the saved combination against live data before applying it.
  return shareToken ? `${base}&pkg=${encodeURIComponent(shareToken)}` : base
}

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
 * it keeps counting after the visitor navigates away from this URL. Since 2026-08,
 * arrival is also captured server-side into the `myt_utm` cookie (see myt-main
 * `lib/utm.ts`).
 */
export function partnerLink(
  trackingCode: string,
  eventId?: number | null,
  shareToken?: string | null,
  /** Full utm_content value (`ag-<slug>` via agentUtmContent) - credits the sale to that agent. */
  agentUtm?: string | null,
): string {
  const path = eventId == null ? "/" : `/order/${eventId}`
  // utm_medium=influencer is the classifier fast path in myt-main's middleware
  // (myt_utm cookie): it marks the visit as influencer-attributed without a
  // partners-table lookup. Old links without it still classify via the lookup.
  let base = `${PUBLIC_SITE_URL}${path}?utm_source=${encodeURIComponent(trackingCode)}&utm_medium=influencer`
  // Per-agent attribution: myt-main captures utm_content into utm_touches
  // (position 0 = credited touch); the backoffice joins it back per agent.
  if (agentUtm) base += `&utm_content=${encodeURIComponent(agentUtm)}`
  // `pkg` is read by myt-main's useHandlePreparedPackage → GET /api/package/[token],
  // which re-validates the saved combination against live data before applying it.
  return shareToken ? `${base}&pkg=${encodeURIComponent(shareToken)}` : base
}

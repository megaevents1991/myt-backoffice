/**
 * Last paid touch (spec section 5). Touches are the reservation's `utm_touches` rows -
 * position 0 is the credited / newest one, 1..n older. The first PAID touch scanning
 * upward wins; an influencer at position 0 stays a partner (the cookie's protection).
 * Pure - the lookups (ad id -> campaign, gclid -> campaign) are handed in.
 */
export interface UtmTouchLike {
  position: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  is_influencer: boolean;
}

export interface PaidTouch {
  platform: "meta" | "google";
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  resolved: boolean;
}

export interface AttributionLookups {
  metaAdCampaign: (adId: string) => { campaignId: string; adsetId: string | null } | null;
  gclidCampaign: (gclid: string) => { campaignId: string; adGroupId: string | null } | null;
}

const META_SOURCES = new Set(["facebook", "fb", "ig", "instagram", "meta"]);
/** A Meta object id (campaign / adset / ad) - 15 to 20 digits. */
export const META_ID = /^\d{15,20}$/;

export const isMetaSource = (s: string | null): boolean => META_SOURCES.has((s ?? "").trim().toLowerCase());

function metaTouch(t: UtmTouchLike, lookups: AttributionLookups): PaidTouch | null {
  if (!isMetaSource(t.utm_source) && !t.fbclid) return null;
  const adId = t.utm_content && META_ID.test(t.utm_content) ? t.utm_content : null;
  if (t.utm_campaign && META_ID.test(t.utm_campaign)) {
    return { platform: "meta", campaignId: t.utm_campaign, adsetId: t.utm_term && META_ID.test(t.utm_term) ? t.utm_term : null, adId, resolved: true };
  }
  const hit = adId ? lookups.metaAdCampaign(adId) : null;
  return hit ? { platform: "meta", campaignId: hit.campaignId, adsetId: hit.adsetId, adId, resolved: true } : { platform: "meta", campaignId: null, adsetId: null, adId, resolved: false };
}

function googleTouch(t: UtmTouchLike, lookups: AttributionLookups): PaidTouch | null {
  const src = (t.utm_source ?? "").trim().toLowerCase();
  const paid = Boolean(t.gclid) || (src === "google" && (t.utm_medium ?? "").toLowerCase() === "cpc");
  if (!paid) return null;
  const hit = t.gclid ? lookups.gclidCampaign(t.gclid) : null;
  return hit ? { platform: "google", campaignId: hit.campaignId, adsetId: hit.adGroupId, adId: null, resolved: true } : { platform: "google", campaignId: null, adsetId: null, adId: null, resolved: false };
}

export function paidTouchOf(touches: UtmTouchLike[], lookups: AttributionLookups): PaidTouch | null {
  const ordered = [...touches].sort((a, b) => a.position - b.position);
  for (const t of ordered) {
    if (t.position === 0 && t.is_influencer) continue;
    // Meta takes precedence: one touch with both fbclid and gclid reads as Meta (fbclid added at click time, gclid often copied into shared links).
    const hit = metaTouch(t, lookups) ?? googleTouch(t, lookups);
    if (hit) return hit;
  }
  return null;
}

/**
 * The live ad preview's guards (spec 2026-10-14 section 6). Pure; scripts/marketing-google-selftest.ts.
 *
 * Meta's `/{ad_id}/previews` answers with a ready `<iframe>` body. Only its `src` is kept, and only when it is https on
 * Facebook's own hosts - the page renders that URL in an iframe, so anything else is refused, never shown.
 */

const PREVIEW_HOSTS = new Set(["business.facebook.com", "www.facebook.com"]);

export function previewSrcFrom(body: string): string | null {
  const m = /<iframe[^>]*\ssrc="([^"]+)"/i.exec(body ?? "");
  if (!m) return null;
  const raw = m[1].replace(/&amp;/g, "&");
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && PREVIEW_HOSTS.has(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A Meta / Google object id: digits only - the only thing allowed into a Graph path or a GAQL string. */
export const isAdId = (s: unknown): s is string => typeof s === "string" && /^\d{1,25}$/.test(s);

/** What an ad-set / ad-group row of the Media tab opens under "Ads"; null = a campaign-level row (P.Max), no button. */
export type AdsTarget =
  | { platform: "meta"; adsetId: string; title: string }
  | { platform: "google"; adGroupId: string; title: string }
  | { platform: "google"; campaignId: string; title: string };

export function adsTargetFor(platform: "meta" | "google", key: string, title: string): AdsTarget | null {
  if (!isAdId(key)) return null;
  return platform === "meta" ? { platform, adsetId: key, title } : { platform, adGroupId: key, title };
}

/**
 * A catalog (Advantage+ / dynamic) ad's product set, from the ad's creative or its ad set's promoted object; null = a
 * regular ad. Meta previews such an ad only with `product_item_ids` from that set (14.10, "Preview Not Available").
 */
export function productSetOf(ad: { creative?: { product_set_id?: string | null } | null; adset?: { promoted_object?: { product_set_id?: string | null; [key: string]: unknown } | null } | null } | null): string | null {
  return ad?.creative?.product_set_id || ad?.adset?.promoted_object?.product_set_id || null;
}

/** Words in a Meta ad name that say nothing about WHICH event it sells. */
const AD_NAME_NOISE = new Set(["feed", "v2", "broad", "copy", "ad", "ads", "general", "video", "image", "carousel", "dpa", "catalog", "retargeting", "rt", "lal", "lookalike", "advantage", "כללי", "וידאו", "תמונה", "קרוסלה"]);

export interface CatalogExampleEvent { id: number; name: string; date: string | null; campaign_image_url: string | null }

/**
 * The events a catalog ad most likely shows, for our own stand-in preview: those whose name holds a word of the ad's
 * name ("Feed_v2 Broad - אואזיס" -> the Oasis events) first, then the rest - each group soonest first. Pure.
 */
export function pickCatalogExamples<T extends CatalogExampleEvent>(adName: string, events: T[], max: number): T[] {
  const tokens = (adName ?? "")
    .replace(/[‎‏‪-‮]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !AD_NAME_NOISE.has(w) && !/^\d+$/.test(w));
  const byDate = (a: T, b: T) => (a.date ?? "9999").localeCompare(b.date ?? "9999");
  const hits = (e: T) => tokens.some((t) => e.name.toLowerCase().includes(t));
  const matched = events.filter(hits).sort(byDate);
  const rest = events.filter((e) => !hits(e)).sort(byDate);
  return [...matched, ...rest].slice(0, max);
}

export const META_PREVIEW_FORMATS = ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_STORY"] as const;
export type MetaPreviewFormat = (typeof META_PREVIEW_FORMATS)[number];
export const META_PREVIEW_LABEL: Record<MetaPreviewFormat, string> = {
  MOBILE_FEED_STANDARD: "Facebook feed",
  INSTAGRAM_STANDARD: "Instagram feed",
  INSTAGRAM_STORY: "Instagram story",
};

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

export const META_PREVIEW_FORMATS = ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_STORY"] as const;
export type MetaPreviewFormat = (typeof META_PREVIEW_FORMATS)[number];
export const META_PREVIEW_LABEL: Record<MetaPreviewFormat, string> = {
  MOBILE_FEED_STANDARD: "Facebook feed",
  INSTAGRAM_STANDARD: "Instagram feed",
  INSTAGRAM_STORY: "Instagram story",
};

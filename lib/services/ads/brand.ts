/**
 * Which brand an ad campaign belongs to. One Meta ad account and one Google Ads customer
 * serve MYT / Mega Events, Mega Family and Mega TR together, so every campaign row is
 * tagged: `mega_events` when its name says so or its landing page is our site, else
 * `other`. The sync re-applies this to `brand_source = 'rule'` rows only - a brand set by
 * hand on the Settings tab (`manual`) is never touched. Pure; scripts/ad-brand-selftest.ts.
 */
import type { AdBrand } from "@/types/marketing.types";

export const MEGA_EVENTS_DOMAIN = "mega-events.co.il";

const NAME_HINTS = /myt|מייטי|mega ?events|מגה ?אירועים|megaevents/i;

export function landingDomainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function brandOf(input: { name: string | null | undefined; landingDomain: string | null | undefined }): AdBrand {
  const domain = (input.landingDomain ?? "").replace(/^www\./, "").toLowerCase();
  if (domain === MEGA_EVENTS_DOMAIN) return "mega_events";
  if (NAME_HINTS.test(input.name ?? "")) return "mega_events";
  return "other";
}

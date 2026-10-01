/**
 * A person's two picture pools (2026-10-01). Pure - selftest: scripts/meta-feed-selftest.ts.
 *
 *   page   = `gallery`        - the mood gallery on the artist / team page
 *   events = `event_gallery`  - event variety: site event cards + Meta feed creatives
 *
 * One column did both jobs until mood photos uploaded for the Oasis page went
 * onto its event cards and ads. A picture lives in exactly one pool.
 */
export const GALLERY_USES = ["page", "events"] as const;
export type GalleryUse = (typeof GALLERY_USES)[number];
export type GalleryPools = Record<GalleryUse, string[]>;

const other = (use: GalleryUse): GalleryUse => (use === "page" ? "events" : "page");

/** Add pictures to one pool; blanks and a URL already in EITHER pool are skipped. */
export function addToPool(pools: GalleryPools, use: GalleryUse, urls: string[]): GalleryPools {
  const added = [...pools[use]];
  for (const raw of urls) {
    const url = raw.trim();
    if (url && !added.includes(url) && !pools[other(use)].includes(url)) added.push(url);
  }
  return { ...pools, [use]: added };
}

/** Move a picture to the other pool (at its end). An unknown URL changes nothing. */
export function moveToPool(pools: GalleryPools, url: string, to: GalleryUse): GalleryPools {
  const from = other(to);
  if (!pools[from].includes(url)) return pools;
  return {
    ...pools,
    [from]: pools[from].filter((u) => u !== url),
    [to]: pools[to].includes(url) ? pools[to] : [...pools[to], url],
  };
}

export function removeFromPools(pools: GalleryPools, url: string): GalleryPools {
  return {
    page: pools.page.filter((u) => u !== url),
    events: pools.events.filter((u) => u !== url),
  };
}

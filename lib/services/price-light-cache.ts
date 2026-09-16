/**
 * The /price-light screen's cache tags (2026-09-16).
 *
 * The screen's three loads (`listPriceLight`, `listCrawlRuns`, `aiCostThisMonth` in
 * lib/actions/price-light-actions.ts) are wrapped in `unstable_cache` under these tags, so a
 * second open costs a cache read instead of ~1.5 MB of event columns. The lights only change
 * when something WRITES them - the nightly pass, a decision on the screen, a recheck, an event
 * edit, a task closing - and every such write path calls `invalidatePriceLight(...)`, which
 * marks the tag stale so the very next open re-reads. The TTLs are the safety net for a write
 * path nobody wired (e.g. the 2-hourly ticket price sync moving `our_usd_now`): at worst the
 * screen is that many seconds behind.
 *
 * Rule for callers: invalidate ONCE per unit of work, after the write - a cron that touches
 * 400 events calls it at the end of the run, not per event.
 */
import { revalidateTag } from "next/cache";

export const PRICE_LIGHT_TAG = {
  /** The event rows (lights, prices, open-task flags, listing links). */
  rows: "price-light-rows",
  /** The competitors panel (last run, counts, circuit). */
  runs: "price-light-runs",
  /** This month's AI spend. */
  cost: "price-light-cost",
} as const;

export type PriceLightCacheKind = keyof typeof PRICE_LIGHT_TAG;

/** Seconds a cached answer may live without any invalidation. */
export const PRICE_LIGHT_TTL_S: Record<PriceLightCacheKind, number> = {
  rows: 300,
  runs: 120,
  cost: 120,
};

/**
 * Mark the given caches stale. Safe to call from anywhere: outside a request scope (a `tsx`
 * script such as scripts/crawl-local.ts driving runCrawl) `revalidateTag` throws its
 * "static generation store missing" invariant - there is no cache to invalidate there, so the
 * call is simply a no-op instead of failing the write that preceded it.
 */
export function invalidatePriceLight(...kinds: PriceLightCacheKind[]): void {
  for (const kind of kinds) {
    try {
      revalidateTag(PRICE_LIGHT_TAG[kind]);
    } catch {
      // No Next request context (script / test) - nothing is cached here to begin with.
    }
  }
}

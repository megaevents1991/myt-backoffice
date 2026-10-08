/** /marketing's cache tags - the sync invalidates ONCE at the end of a run (same rule as price-light-cache.ts). */
import { revalidateTag } from "next/cache";

export const MARKETING_TAG = { pnl: "marketing-pnl", instagram: "marketing-instagram", alerts: "marketing-alerts" } as const;
export const MARKETING_TTL_S = { pnl: 300, instagram: 300, alerts: 120 } as const;

export function invalidateMarketing(...kinds: (keyof typeof MARKETING_TAG)[]): void {
  const all = Object.keys(MARKETING_TAG) as (keyof typeof MARKETING_TAG)[];
  for (const kind of kinds.length ? kinds : all) {
    try { revalidateTag(MARKETING_TAG[kind]); } catch { /* no request context (script) */ }
  }
}

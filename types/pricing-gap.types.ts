/**
 * Row shape for the /tasks "Pricing" tab (Task 15, 2026-09-16). Lives here rather
 * than in lib/actions/pricing-gap-actions.ts because a "use server" file may only
 * export async functions (same reason PriceLightRow lives in price-light.types.ts,
 * not price-light-actions.ts).
 */

/** The two rule generators this tab reuses (lib/services/task-rules) - the SAME ones
 *  the weekly digest runs, so "what counts as an open pricing gap" is defined once. */
export type PricingGapSource = "price_light" | "price_changes";

export interface PricingGapRow {
  /** "{kind}:{table}:{row_id}" - identical to RuleCandidate.key and to the keys
   *  openTaskGapKeys() returns, so it round-trips through gap-resolution's
   *  parseGapKey() to route "משימה"/"טופל" without re-deriving its parts. */
  key: string;
  source: PricingGapSource;
  /** price_light: "package" | "ticket". price_changes: always "price_review". */
  scope: string;
  eventId: number;
  eventName: string;
  /** Parsed out of the generator's own description text - null when it could not
   *  be parsed (never blocks the row from showing). */
  gapUsd: number | null;
  /** price_light only - the date the light went red ("אדום מאז"), YYYY-MM-DD. Null
   *  for price_changes rows and for a price_light row with an unknown start. */
  since: string | null;
  /** "/events/{id}#fix-price" - same deep link every gap screen in this repo uses. */
  fixUrl: string;
  /** The id of an already-open task for this gap, or null. A row with one shows a
   *  link to it instead of a "משימה" button. */
  openTaskId: string | null;
}

/**
 * Controller ruling #2 (fix round 1): the two generators are loaded independently
 * (`Promise.allSettled` in `listPricingGaps`), so one throwing (today: `price_light`, until
 * `events.light_red_since` is migrated) no longer hides rows the other one loaded fine.
 * `ok: false` is reserved for auth/unexpected failures (e.g. `requireStaff()` itself throwing) -
 * a single generator failing is reported per-source in `errors` alongside the rows that DID load.
 */
export type PricingGapListResult =
  | { ok: true; rows: PricingGapRow[]; errors: { source: PricingGapSource; error: string }[] }
  | { ok: false; error: string };

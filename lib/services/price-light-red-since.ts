/**
 * When did this event turn red? PURE - no DB, no env - so
 * scripts/light-red-since-selftest.ts runs under plain `npx tsx`. Used by
 * recomputeEventLights (price-light-store.ts, which re-exports it) and read back by
 * the price_light rule's `min_weeks_red`. The stamp is per EVENT (either scope red),
 * not per scope, and is cleared the moment the event leaves red - `unchecked`
 * included.
 */
import type { Light } from "@/types/price-light.types";

export type Lights = { package: Light | null; ticket: Light | null };

/** When did this event become red? Written by recomputeEventLights, read by the
 *  price_light rule's `min_weeks_red`. Null return = write nothing. */
export function redSinceUpdate(
  before: Lights,
  after: Lights,
  current: string | null,
  now: string,
): { light_red_since: string | null } | null {
  const wasRed = before.package === "red" || before.ticket === "red";
  const isRed = after.package === "red" || after.ticket === "red";
  if (isRed) {
    // A red with no stamp gets one now - including rows that were red before
    // the column existed. "Red since we started counting" beats "unknown".
    return current ? null : { light_red_since: now };
  }
  if (wasRed || current) return { light_red_since: null };
  return null;
}

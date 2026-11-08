/**
 * "הפוך לריצה אמיתית" (08.11.2026, Dor). A test run ("ריצת בדיקה" on the plan card) marks every event it builds as a test
 * event, and approve only un-hides - so an approved show of a test run never reached the site. Alon's U2 run was a test
 * run, he approved 20 shows, and none of them was listed. The board now says so on a test run, and one button turns the
 * run into a real one: the run first (a show the build finishes from then on is born real), then the events already
 * built. Pure - the action reads the items and writes what this says.
 *
 * Selftest: scripts/tour-uploader-selftest.ts (section "Test run made real").
 */
import type { ItemStatus, UploaderItem } from "@/types/uploader.types";

/** Statuses whose event is gone or never existed: a rejected show's event was soft-deleted, a skipped show has none. */
const OUT_OF_PLAY: readonly ItemStatus[] = ["rejected", "skipped"];

export type MakeRealPlan = {
  /** Every built event of the run that is still in play - switched to real. */
  eventIds: number[];
  /** Of them, the approved shows' events: these reach the site at once. */
  liveIds: number[];
  /** Built and waiting for approve (`ready`): they reach the site when approved. */
  waiting: number;
};

/** What "make this run real" switches, from the run's items. One event per id, in item order. */
export function makeRealPlan(items: readonly Pick<UploaderItem, "status" | "event_id">[]): MakeRealPlan {
  const eventIds: number[] = [];
  const liveIds: number[] = [];
  let waiting = 0;
  for (const item of items) {
    const id = item.event_id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || OUT_OF_PLAY.includes(item.status)) continue;
    if (eventIds.includes(id)) continue;
    eventIds.push(id);
    if (item.status === "approved") liveIds.push(id);
    else if (item.status === "ready") waiting += 1;
  }
  return { eventIds, liveIds, waiting };
}

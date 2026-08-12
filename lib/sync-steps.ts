/**
 * The manual "sync everything" pipeline behind the button on /meta-feed.
 *
 * Same work the Vercel crons do nightly, in the same order (providers →
 * prices → creatives → publish), but triggered by a human. Pure data - shared
 * by the client button and the `/api/admin-sync/[step]` route so the two can
 * never drift.
 *
 * Each step is its own request: a single call running all of them would blow
 * past any function-duration limit (TixStock alone is an 800s job).
 */
export const SYNC_STEPS = [
  {
    id: "sports-events",
    label: "אירועי ספורט (XS2Event)",
    note: "מושך אירועים מהספק ומעדכן את הטבלה",
  },
  {
    id: "live-events",
    label: "אירועי LIVE",
    note: "מושך אירועים, מופיעים, אולמות וערים",
  },
  {
    id: "tixstock-events",
    label: "אירועי TixStock",
    note: "סנכרון הפיד המלא - הצעד הארוך ביותר",
  },
  {
    id: "tixstock-prices",
    label: "מחירי TixStock",
    note: "מחירי כרטיסים לכל אירועי tx_event",
  },
  {
    id: "ticket-prices",
    label: "מחירי כרטיסים",
    note: "המרות מטבע + מרקאפים על כל האירועים",
  },
  {
    id: "campaign-creatives",
    label: "קריאטיבים לפיד",
    note: "מייצר תמונות קמפיין לכל אירוע שהשתנה",
  },
  {
    id: "publish-feed",
    label: "פרסום הפיד למטא",
    note: "מעתיק את הפיד החי לקובץ הסטטי שמטא קוראת",
  },
] as const;

export type SyncStepId = (typeof SYNC_STEPS)[number]["id"];

export const SYNC_STEP_IDS = SYNC_STEPS.map(
  (s) => s.id,
) as readonly SyncStepId[];

export function isSyncStepId(value: string): value is SyncStepId {
  return (SYNC_STEP_IDS as readonly string[]).includes(value);
}

export type SyncStepResult = {
  step: SyncStepId;
  /** One-line Hebrew summary for the UI. */
  summary: string;
  /**
   * Stale items the step didn't get to (creatives only) - the client re-runs
   * the step until this hits 0, so a backlog of any size drains.
   */
  remaining?: number;
};

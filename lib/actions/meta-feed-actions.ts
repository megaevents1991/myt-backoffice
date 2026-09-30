"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import {
  CAMPAIGN_EVENT_COLUMNS,
  generateCampaignForEvent,
  type CampaignEventRow,
  type CampaignResult,
} from "@/lib/creative/auto";
import type { Event } from "@/types/app.types";
import {
  publishMetaFeeds,
  STORAGE_BUCKET,
  STORAGE_PATH_ACTIVITIES,
  STORAGE_PATH_CSV,
  STORAGE_PATH_XML,
  type PublishResult,
} from "@/lib/feed/publish-meta-feed";

export type MetaFeedSnapshot = {
  path: string;
  publicUrl: string;
  /** null when the snapshot has never been published. */
  updatedAt: string | null;
  sizeBytes: number | null;
};

export type SyncMetaFeedResult =
  | { ok: true; result: PublishResult }
  | { ok: false; error: string };

/**
 * Republishes all three feed snapshots right now - same code path as the
 * twice-daily cron. Use after editing events when the CMO needs Meta to see
 * the change before the next scheduled run.
 */
export async function syncMetaFeedAction(): Promise<SyncMetaFeedResult> {
  await requireStaff();
  try {
    const result = await publishMetaFeeds();
    await logAudit({
      action: "publish",
      entityType: "meta_feed",
      metadata: {
        activityRows: result.activityRows,
        activitiesBytes: result.activitiesBytes,
        trigger: "manual",
      },
    });
    revalidatePath("/meta-feed");
    return { ok: true, result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[meta-feed] manual sync failed:", error);
    return { ok: false, error };
  }
}

export type PushEventToFeedResult =
  | {
      ok: true;
      /** What happened to this event's creative. */
      creative: "generated" | "current" | "skipped";
      /** Why the creative was skipped (only when `creative` is "skipped"). */
      creativeNote?: string;
      /** The event is a row of the file Meta reads. */
      inFeed: boolean;
      /** When it is not: the likely reasons, read off the event (Hebrew). */
      whyNot: string[];
      activityRows: number;
    }
  | { ok: false; error: string };

/** Days before an event the site stops selling it - main's AVAILABILITY_WINDOW_DAYS. */
const FEED_BOOKING_WINDOW_DAYS = 3;

/**
 * One event into the Meta feed now, without waiting for the crons or running
 * "sync everything": make its creative (the feed skips an event with none),
 * then republish the feed files. The files are always built whole from the
 * database, so this republishes every event - it just skips the providers,
 * the price syncs and every other event's creative. Meta still reads the file
 * on its own schedule (hourly).
 */
export async function pushEventToFeedAction(
  eventId: number,
): Promise<PushEventToFeedResult> {
  await requireStaff();
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return { ok: false, error: "Invalid event id" };
  }
  try {
    const event = await loadFeedEvent(eventId);
    if (!event) return { ok: false, error: "Event not found" };

    const creative = await generateCampaignForEvent(event);
    const result = await publishMetaFeeds();
    const inFeed = result.activityIds.includes(eventId);
    const blockers = feedBlockers(event, creative);

    await logAudit({
      action: "publish",
      entityType: "meta_feed",
      entityId: eventId,
      metadata: {
        trigger: "event",
        creative: creative.status,
        inFeed,
        activityRows: result.activityRows,
      },
    });
    revalidatePath("/meta-feed");

    return {
      ok: true,
      creative: creative.status,
      creativeNote: creative.status === "skipped" ? creative.reason : undefined,
      inFeed,
      whyNot: inFeed ? [] : blockers.length ? blockers : [NO_BLOCKER_FOUND],
      activityRows: result.activityRows,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[meta-feed] push event failed:", error);
    return { ok: false, error };
  }
}

export type RenderEventCreativeResult =
  | {
      ok: true;
      id: number;
      name: string;
      creative: "generated" | "current" | "skipped";
      creativeNote?: string;
      /** What keeps this event out of the feed file, read off the row (empty = nothing). */
      blockers: string[];
    }
  | { ok: false; error: string };

/**
 * One event's creative on demand, WITHOUT publishing. The /meta-feed picker
 * calls this once per ticked event and publishes once at the end
 * (syncMetaFeedAction) - a request per event, the way "סנכרן הכל" runs a step
 * per request, so a multi-select never meets a function duration limit.
 * `force` redraws an unchanged event under a new image URL: the case the
 * picker exists for - staff fixed a picture or a render that came out wrong,
 * which the hash cannot see, and want Meta to refetch now.
 */
export async function renderEventCreativeAction(
  eventId: number,
  options: { force?: boolean } = {},
): Promise<RenderEventCreativeResult> {
  await requireStaff();
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return { ok: false, error: "Invalid event id" };
  }
  const force = options.force === true;
  try {
    const event = await loadFeedEvent(eventId);
    if (!event) return { ok: false, error: "Event not found" };

    const creative = await generateCampaignForEvent(event, undefined, { force });
    await logAudit({
      action: "update",
      entityType: "meta_feed_creative",
      entityId: eventId,
      metadata: { trigger: "picker", force, creative: creative.status },
    });
    return {
      ok: true,
      id: eventId,
      name: event.name || event.name_english || `#${eventId}`,
      creative: creative.status,
      creativeNote: creative.status === "skipped" ? creative.reason : undefined,
      blockers: feedBlockers(event, creative),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[meta-feed] render creative failed:", error);
    return { ok: false, error };
  }
}

export type FeedPickerEvent = {
  id: number;
  name: string;
  name_english: string | null;
  /** The event's date-time, ISO. */
  date: string;
  hasCreative: boolean;
  /** Why the last creative run skipped it, when it did. */
  skipReason: string | null;
  isTest: boolean;
};

type FeedPickerRow = {
  id: number;
  name: string | null;
  name_english: string | null;
  date: string;
  campaign_image_url: string | null;
  campaign_skip_reason: string | null;
  is_test: boolean | null;
};

/** Live future events for the /meta-feed picker - every event a push could concern. */
export async function listFeedPickerEvents(): Promise<FeedPickerEvent[]> {
  await requireStaff();
  const todayISO = new Date().toISOString().slice(0, 10);
  // events' generated types lag the campaign columns - cast once, like auto.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { rows, error } = await fetchPaged<FeedPickerRow>(
    () =>
      db
        .from("events")
        .select("id,name,name_english,date,campaign_image_url,campaign_skip_reason,is_test")
        .is("is_deleted", null)
        .gte("date", todayISO)
        .order("date", { ascending: true })
        .order("id", { ascending: true }),
    5000,
  );
  if (error) {
    console.error("[meta-feed] picker events read failed:", JSON.stringify(error));
    return [];
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? "",
    name_english: row.name_english,
    date: row.date,
    hasCreative: !!row.campaign_image_url,
    skipReason: row.campaign_skip_reason,
    isTest: row.is_test === true,
  }));
}

type FeedEventRow = CampaignEventRow &
  Pick<Event, "tickets_and_rates" | "tags" | "is_deleted" | "is_test">;

/** The event as the creative pipeline and the feed blockers read it. */
async function loadFeedEvent(eventId: number): Promise<FeedEventRow | null> {
  // events' generated types lag the campaign columns - cast once, like auto.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("events")
    .select(`${CAMPAIGN_EVENT_COLUMNS},is_deleted,is_test,tags`)
    .eq("id", eventId)
    .maybeSingle();
  if (error) console.error("[meta-feed] event read failed", JSON.stringify(error));
  return (data as FeedEventRow | null) ?? null;
}

type FeedBlockerRow = Pick<
  Event,
  "date" | "tickets_and_rates" | "tags" | "is_deleted" | "is_test"
>;

const NO_BLOCKER_FOUND = "לא נמצאה סיבה בנתוני האירוע - בדקו ב-/product-feed באתר";

/**
 * Why main's activities feed leaves an event out - its own rules, read off the
 * row. Empty when nothing on the row blocks it.
 */
function feedBlockers(event: FeedBlockerRow, creative: CampaignResult): string[] {
  const reasons: string[] = [];
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() + FEED_BOOKING_WINDOW_DAYS);
  if (event.is_deleted) reasons.push("האירוע מחוק");
  if (event.is_test) reasons.push("אירוע בדיקה - לא נכנס לפיד");
  if (event.date.slice(0, 10) < cutoff.toISOString().slice(0, 10)) {
    reasons.push(`פחות מ-${FEED_BOOKING_WINDOW_DAYS} ימים לאירוע - האתר כבר לא מוכר אותו`);
  }
  const available = (event.tickets_and_rates ?? []).some((t) => t.available !== false);
  if (!available || event.tags === "Sold") reasons.push("אזל - אין כרטיס זמין");
  if (creative.status === "skipped") reasons.push(`אין קריאייטיב: ${creative.reason}`);
  return reasons;
}

export type SyncHealthRow = {
  key: string;
  label: string;
  /** Newest row this sync wrote, or null when it has never written. */
  lastRun: string | null;
  /** Older than this = the sync stopped working. */
  staleAfterHours: number;
};

export type SyncHealth = {
  rows: SyncHealthRow[];
  /** Feed-eligible events, and how many already carry a campaign creative. */
  eventsInFeedWindow: number;
  eventsWithCreative: number;
};

/**
 * Freshness of every scheduled sync, read straight off the data each one
 * writes. This is the check that was missing when all the Vercel crons
 * silently started 401'ing on 2026-07-15 (the cron auth guard shipped without
 * CRON_SECRET being set) and nothing synced for two weeks - the dashboard
 * looked fine because nothing surfaces "last run".
 */
export async function getSyncHealth(): Promise<SyncHealth> {
  await requireStaff();

  // Provider tables aren't in the generated DB types - cast like template-crud.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const newest = async (
    table: string,
    column: string,
  ): Promise<string | null> => {
    const { data, error } = await db
      .from(table)
      .select(column)
      // DESC puts NULLs FIRST in Postgres - events.campaign_generated_at is
      // null on rows without a creative, so without nullsFirst:false the
      // newest "stamp" is a null and the sync reads "never ran".
      .order(column, { ascending: false, nullsFirst: false })
      .limit(1);
    if (error) {
      console.error(`[sync-health] ${table} failed:`, JSON.stringify(error));
      return null;
    }
    return (data?.[0]?.[column] as string | undefined) ?? null;
  };

  const todayISO = new Date().toISOString().split("T")[0];
  const [
    sportsEvents,
    liveEvents,
    tixstockEvents,
    creatives,
    inWindow,
    withCreative,
  ] = await Promise.all([
    newest("xs2e_events", "updated_at"),
    newest("live_events", "updated_at"),
    newest("tixstock_events", "updated_at"),
    newest("events", "campaign_generated_at"),
    db
      .from("events")
      .select("id", { count: "exact", head: true })
      .is("is_deleted", null)
      .gte("date", todayISO),
    db
      .from("events")
      .select("id", { count: "exact", head: true })
      .is("is_deleted", null)
      .gte("date", todayISO)
      .not("campaign_image_url", "is", null),
  ]);

  return {
    rows: [
      {
        key: "sports-events",
        label: "אירועי ספורט (XS2Event)",
        lastRun: sportsEvents,
        staleAfterHours: 26,
      },
      {
        key: "live-events",
        label: "אירועי LIVE",
        lastRun: liveEvents,
        staleAfterHours: 26,
      },
      {
        key: "tixstock-events",
        label: "אירועי TixStock",
        lastRun: tixstockEvents,
        staleAfterHours: 26,
      },
      {
        key: "campaign-creatives",
        label: "קריאטיבים לפיד",
        lastRun: creatives,
        staleAfterHours: 26,
      },
    ],
    eventsInFeedWindow: inWindow.count ?? 0,
    eventsWithCreative: withCreative.count ?? 0,
  };
}

/** Last-published time + size of each snapshot, for the status table. */
export async function getMetaFeedSnapshots(): Promise<MetaFeedSnapshot[]> {
  await requireStaff();
  const paths = [STORAGE_PATH_ACTIVITIES, STORAGE_PATH_CSV, STORAGE_PATH_XML];

  // Storage has no "stat one object" call - list the folder once and match.
  const folder = paths[0].split("/")[0];
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(folder, {
      limit: 100,
    });
  if (error) {
    console.error("[meta-feed] snapshot list failed:", JSON.stringify(error));
  }

  return paths.map((path) => {
    const name = path.split("/").pop();
    const file = (data ?? []).find((f) => f.name === name);
    const size = (file?.metadata as { size?: number } | undefined)?.size;
    return {
      path,
      publicUrl: supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data
        .publicUrl,
      updatedAt: file?.updated_at ?? null,
      sizeBytes: typeof size === "number" ? size : null,
    };
  });
}

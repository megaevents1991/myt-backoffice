"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
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

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
 * Republishes all three feed snapshots right now — same code path as the
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

/** Last-published time + size of each snapshot, for the status table. */
export async function getMetaFeedSnapshots(): Promise<MetaFeedSnapshot[]> {
  await requireStaff();
  const paths = [STORAGE_PATH_ACTIVITIES, STORAGE_PATH_CSV, STORAGE_PATH_XML];

  // Storage has no "stat one object" call — list the folder once and match.
  const folder = paths[0].split("/")[0];
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(folder, {
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
      publicUrl: supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl,
      updatedAt: file?.updated_at ?? null,
      sizeBytes: typeof size === "number" ? size : null,
    };
  });
}

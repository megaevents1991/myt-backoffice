"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase-server";

// base_price_sync_log predates the generated database types - cast once at
// the boundary, same pattern as the tasks/creative-gaps actions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface SyncLogRow {
  id: number;
  event_id: number;
  event_name: string | null;
  component: string;
  old_price: number | null;
  new_price: number | null;
  live_price: number | null;
  status: string;
  note: string | null;
  created_at: string;
}

export async function listSyncLog(
  filter: "all" | "needs_review",
  limit = 300,
): Promise<SyncLogRow[]> {
  await requireAdmin();

  let query = db
    .from("base_price_sync_log")
    .select("id,event_id,component,old_price,new_price,live_price,status,note,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (filter === "needs_review") query = query.eq("status", "needs_review");
  const { data, error } = await query;
  if (error) {
    console.error("price-changes: log list failed", JSON.stringify(error));
    return [];
  }
  const rows = (data ?? []) as Omit<SyncLogRow, "event_name">[];

  // No FK on the log - resolve event names in one extra query.
  const eventIds = [...new Set(rows.map((row) => row.event_id))];
  const nameOf = new Map<number, string | null>();
  if (eventIds.length > 0) {
    const { data: events, error: eventsError } = await db
      .from("events")
      .select("id,name")
      .in("id", eventIds);
    if (eventsError) {
      console.error("price-changes: event names failed", JSON.stringify(eventsError));
    }
    for (const event of (events ?? []) as { id: number; name: string | null }[]) {
      nameOf.set(event.id, event.name);
    }
  }

  return rows.map((row) => ({ ...row, event_name: nameOf.get(row.event_id) ?? null }));
}

/**
 * Applies a frozen ">$400" change after a human looked at it: writes the live
 * price onto the event's component and flips the log row to applied.
 */
export async function approveReviewRow(
  logId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();

  const { data: row, error } = await db
    .from("base_price_sync_log")
    .select("id,event_id,component,old_price,live_price,status")
    .eq("id", logId)
    .single();
  if (error || !row) {
    console.error("price-changes: approve load failed", JSON.stringify(error));
    return { ok: false, error: "Log row not found" };
  }
  if (row.status !== "needs_review") {
    return { ok: false, error: "Only needs-review rows can be approved" };
  }
  if (typeof row.live_price !== "number") {
    return { ok: false, error: "Row has no live price to apply" };
  }

  const column =
    row.component === "flight" ? "base_flight_price" : "base_hotel_price";
  const { error: updateError } = await db
    .from("events")
    .update({ [column]: row.live_price })
    .eq("id", row.event_id);
  if (updateError) {
    console.error("price-changes: approve apply failed", JSON.stringify(updateError));
    return { ok: false, error: "Could not update the event" };
  }

  const { error: flipError } = await db
    .from("base_price_sync_log")
    .update({ new_price: row.live_price, status: "applied", note: "approved manually" })
    .eq("id", logId);
  if (flipError) {
    console.error("price-changes: approve flip failed", JSON.stringify(flipError));
  }

  await logAudit({
    action: "base_price.approve_review",
    entityType: "event",
    entityId: row.event_id,
    changes: { component: row.component, from: row.old_price, to: row.live_price },
  });
  return { ok: true };
}

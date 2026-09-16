import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { OPEN_TASK_STATUSES } from "@/types/task.types";
import type { RuleGenerator } from "./types";

// base_price_sync_log predates the generated database types - one boundary
// cast, same pattern as base-price-log-actions.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface SyncLogRow {
  id: number;
  event_id: number;
  component: string;
  old_price: number | null;
  new_price: number | null;
  live_price: number | null;
  created_at: string;
}

interface OpenTaskRow {
  id: string;
  source_ref: { row_id: string | number; kind: string } | null;
}

const LOG_MAX = 3_000;
const TASKS_MAX = 5_000;
// PostgREST silently truncates a single `.in()` call past its row cap (~1000) rather than
// erroring, so a needs_review backlog spanning more than one chunk would quietly drop names
// to "#id" past the cut - chunk instead of trusting one request to carry every id.
const NAME_LOOKUP_CHUNK = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every frozen (`needs_review`) sync-log row - one query, not one per event. */
async function loadNeedsReviewRows(): Promise<SyncLogRow[]> {
  const { rows, error, truncated } = await fetchPaged<SyncLogRow>(
    () =>
      db
        .from("base_price_sync_log")
        .select("id,event_id,component,old_price,new_price,live_price,created_at")
        .eq("status", "needs_review")
        .order("id", { ascending: true }),
    LOG_MAX,
  );
  if (error) {
    console.error("task-rules/price-changes: log failed", JSON.stringify(error));
    throw new Error("price-changes: log load failed");
  }
  if (truncated) console.error(`task-rules/price-changes: log truncated at ${LOG_MAX}`);
  return rows;
}

/** Event ids with an already-open `price_review` task - one query, no N+1 per row (same shape
 *  as price-light's loadOpenTaskKeys / price-light-actions.ts loadOpenPriceLightTaskKeys). */
async function loadOpenReviewEventIds(): Promise<Set<number>> {
  const { rows, error, truncated } = await fetchPaged<OpenTaskRow>(
    () =>
      db
        .from("tasks")
        .select("id,source_ref")
        .eq("source", "price_review")
        .is("deleted_at", null)
        .in("status", OPEN_TASK_STATUSES)
        .order("id", { ascending: true }),
    TASKS_MAX,
  );
  if (error) {
    console.error("task-rules/price-changes: open tasks failed", JSON.stringify(error));
    throw new Error("price-changes: open tasks load failed");
  }
  if (truncated) console.error(`task-rules/price-changes: open tasks truncated at ${TASKS_MAX}`);
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.source_ref?.kind === "price_review" && row.source_ref.row_id != null) {
      ids.add(Number(row.source_ref.row_id));
    }
  }
  return ids;
}

export const priceChangesGenerator: RuleGenerator = {
  domain: "price_changes",
  label: "שינויי מחיר",
  screenUrl: "/price-changes",
  digestTitle: (count) => `שינויי מחיר להחלטה — ${count} רשומות קפואות`,
  async candidates(match) {
    const [rows, openEventIds] = await Promise.all([loadNeedsReviewRows(), loadOpenReviewEventIds()]);
    const maxAgeMs = match.max_age_days != null ? match.max_age_days * 86_400_000 : null;
    const now = Date.now();

    const withDeviation = rows
      .filter((row) => {
        if (openEventIds.has(row.event_id)) return false;
        if (maxAgeMs != null && now - Date.parse(row.created_at) > maxAgeMs) return false;
        return true;
      })
      .map((row) => ({
        row,
        // A frozen row's candidate price lives in `live_price` (`new_price` is only
        // set once a row is approved - see approveReviewRow in base-price-log-actions.ts -
        // and an approved row is never status "needs_review" any more). Read both so a
        // deviation is never computed against a price that was never written.
        deviation: Math.abs((row.live_price ?? row.new_price ?? 0) - (row.old_price ?? 0)),
      }))
      .filter(({ deviation }) => match.min_deviation_usd == null || deviation >= match.min_deviation_usd);

    // One candidate per event - the largest deviation, since an existing
    // price-review task is one per event (see createTaskFor in price-changes-client.tsx).
    const byEvent = new Map<number, { row: SyncLogRow; deviation: number }>();
    for (const entry of withDeviation) {
      const existing = byEvent.get(entry.row.event_id);
      if (!existing || entry.deviation > existing.deviation) byEvent.set(entry.row.event_id, entry);
    }

    const eventIds = [...byEvent.keys()];
    const nameOf = new Map<number, string>();
    for (const idsChunk of chunk(eventIds, NAME_LOOKUP_CHUNK)) {
      const { data, error } = await db.from("events").select("id,name").in("id", idsChunk);
      if (error) {
        console.error("task-rules/price-changes: event names failed", JSON.stringify(error));
        throw new Error("price-changes: event names load failed");
      }
      for (const e of (data ?? []) as { id: number; name: string }[]) nameOf.set(e.id, e.name);
    }

    return [...byEvent.values()].map(({ row, deviation }) => {
      const label = nameOf.get(row.event_id) ?? `#${row.event_id}`;
      return {
        key: `price_review:events:${row.event_id}`,
        title: `שינוי מחיר קפוא: ${label}`,
        description: `${row.component} · $${row.old_price ?? "?"} → $${row.live_price ?? row.new_price ?? "?"} (הפרש $${deviation})`,
        sourceRef: {
          kind: "price_review",
          table: "events",
          row_id: row.event_id,
          label,
          url: `/events/${row.event_id}#fix-price`,
        },
      };
    });
  },
};

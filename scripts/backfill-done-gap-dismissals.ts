/**
 * One-time backfill (Task 16, tasks hub, 2026-09-16): a creative-gap task
 * marked `done` BEFORE `resolveGapForTask` (lib/services/gap-resolution.ts)
 * existed never wrote a `creative_gap_dismissals` row, so its gap never left
 * the radar - "אם סימנתי בטסק DONE שינקה את זה גם מהקריאטיב גאפ" (team doc,
 * 16.09). This finds every `done` `creative_gap` task whose gap isn't already
 * dismissed and inserts the dismissal, in the exact shape
 * `dismissCreativeGap` (lib/actions/creative-gap-actions.ts) writes.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-done-gap-dismissals.ts [--apply]
 *
 * Dry-run (no flag) is the default and writes nothing - it only prints what
 * would be inserted, plus counts. `--apply` performs the inserts. Read-only
 * on `tasks` - this never touches a task row, only the separate dismissals
 * table. Idempotent: a second run (dry or real) reports "would dismiss: 0"
 * once every backlog task has its dismissal.
 */
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { gapKey } from "@/types/creative-gap.types";
import type { TaskSourceRef } from "@/types/task.types";

// tasks / creative_gap_dismissals predate the generated database types on
// some call sites - same boundary-cast pattern as creative-gaps.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const PAGE_SIZE = 500;
const APPLY = process.argv.includes("--apply");

interface DoneGapTask {
  id: string;
  source_ref: TaskSourceRef | null;
}

/** All rows of a table's column set, paginated - `.limit()` alone caps at
 *  Supabase's default page size, which would silently under-count a backlog
 *  this size. */
async function fetchAllPages<T>(
  label: string,
  page: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label} failed: ${JSON.stringify(error)}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function main() {
  const doneTasks = await fetchAllPages<DoneGapTask>("done creative_gap tasks", (from, to) =>
    db
      .from("tasks")
      .select("id,source_ref")
      .eq("source", "creative_gap")
      .eq("status", "done")
      .is("deleted_at", null)
      .order("id")
      .range(from, to),
  );

  const existingDismissals = await fetchAllPages<{ gap_key: string }>(
    "existing dismissals",
    (from, to) => db.from("creative_gap_dismissals").select("gap_key").range(from, to),
  );
  const dismissed = new Set(existingDismissals.map((row) => row.gap_key));

  const withRef = doneTasks.filter((t): t is DoneGapTask & { source_ref: TaskSourceRef } => !!t.source_ref);
  const noRef = doneTasks.length - withRef.length;

  // A gap can only have one open task at a time (dedupe-on-open-task), but be
  // defensive against two done tasks pointing at the same gap anyway - only
  // one dismissal row per gap_key either way (upsert-safe, and idempotent
  // with itself inside one run).
  const toDismiss = new Map<string, TaskSourceRef>();
  for (const task of withRef) {
    const key = gapKey(task.source_ref.kind, task.source_ref.table, task.source_ref.row_id);
    if (dismissed.has(key) || toDismiss.has(key)) continue;
    toDismiss.set(key, task.source_ref);
  }

  console.log(`done creative_gap tasks: ${doneTasks.length}${noRef ? ` (${noRef} with no source_ref, skipped)` : ""}`);
  console.log(`already dismissed: ${withRef.length - toDismiss.size}`);
  console.log(`would dismiss: ${toDismiss.size}`);

  if (toDismiss.size === 0) {
    console.log(APPLY ? "\nNothing to apply." : "\nDry run: nothing to do.");
    return;
  }

  for (const [key, ref] of toDismiss) {
    console.log(`  ${APPLY ? "dismissing" : "would dismiss"}: ${key} (${ref.label})`);
  }

  if (!APPLY) {
    console.log("\nDry run - pass --apply to write these dismissals.");
    return;
  }

  const rows = [...toDismiss.values()].map((ref) => ({
    gap_key: gapKey(ref.kind, ref.table, ref.row_id),
    kind: ref.kind,
    source_table: ref.table,
    row_id: String(ref.row_id),
    label: ref.label,
    note: "נסגר במשימה (השלמה)",
    dismissed_by: null,
  }));
  const { error } = await db.from("creative_gap_dismissals").upsert(rows, { onConflict: "gap_key" });
  if (error) throw new Error(`insert failed: ${JSON.stringify(error)}`);

  // One audit row per applied dismissal, same shape dismissCreativeGap()
  // writes for a manual one - logAudit never throws, so a failure here can't
  // abort the backfill after the writes already landed.
  for (const row of rows) {
    await logAudit({
      action: "creative_gap.dismiss",
      entityType: "creative_gap",
      entityId: row.gap_key,
      changes: { label: row.label },
    });
  }
  console.log(`\nInserted ${rows.length} dismissal(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

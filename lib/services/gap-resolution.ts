/**
 * A task born from a gap closes that gap when it is done, and reopens it when it
 * comes back to life. One rule for every gap family (Dor, 16.09: "אחרי שמשימה
 * נעשתה - צריך להוריד אותה מה-gaps של כל אחד באשר הוא"). This replaces the
 * `if (row.source === "creative_gap")` branch that used to live inline in
 * setTaskStatus (lib/actions/task-actions.ts) - creative behaviour is unchanged,
 * byte-for-byte; every other gap family now gets the same treatment.
 *
 * Pure routing (gapSourceOf / gapAction) is exported for the self-test
 * (scripts/gap-resolution-selftest.ts); each family's actual write lives in its own
 * action/service and resolveGapForTask never lets one fail the task's own status
 * change - it only logs.
 */
import { supabase } from "@/lib/supabase-server";
import { dismissCreativeGap, restoreCreativeGap } from "@/lib/actions/creative-gap-actions";
import { gapKey } from "@/types/creative-gap.types";
import type { Scope } from "@/types/price-light.types";
import type { TaskSource, TaskSourceRef, TaskStatus } from "@/types/task.types";

// base_price_sync_log predates the generated database types - same boundary-cast
// pattern as base-price-log-actions.ts / lib/services/task-rules/price-changes.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type GapFamily = "creative" | "pricing";

/** Which gap list this task belongs to, by its source alone. `recurring` returns
 *  null on purpose - a recurring task is always a weekly digest here (per-item
 *  recurring rules already write the domain's own native source, never
 *  "recurring" - see planRule's NATIVE_SOURCE in weekly-task-plan.ts), and a
 *  digest is not itself a gap. */
export function gapSourceOf(source: TaskSource): GapFamily | null {
  if (source === "creative_gap") return "creative";
  if (source === "price_light" || source === "price_review") return "pricing";
  return null;
}

/** A finished task closes its gap; anything still open puts it back. */
export function gapAction(status: TaskStatus): "close" | "reopen" {
  return status === "done" || status === "cancelled" ? "close" : "reopen";
}

// ---- pure helpers shared with the Pricing tab (lib/actions/pricing-gap-actions.ts) -------------

/** A gap-list key of the form "{kind}:{table}:{row_id}" - the exact shape both
 *  RuleCandidate.key (lib/services/task-rules) and openTaskGapKeys() produce, so a
 *  `PricingGapRow.key` round-trips through here instead of re-deriving its parts. */
export interface ParsedGapKey {
  kind: string;
  table: string;
  rowId: number;
}

export function parseGapKey(key: string): ParsedGapKey | null {
  const parts = key.split(":");
  if (parts.length !== 3) return null;
  const [kind, table, rowIdRaw] = parts;
  if (!kind || !table || !rowIdRaw) return null;
  const rowId = Number(rowIdRaw);
  if (!Number.isFinite(rowId)) return null;
  return { kind, table, rowId };
}

/** The nightly price-light pass runs at 00:30 UTC - the next occurrence strictly
 *  AFTER `now`. Used to mute a "handled" red light until that visit (Dor, 16.09:
 *  "'טופל' = רושם 'הוזל' ומסתיר עד החישוב הבא" - not a fixed number of days, not a
 *  final dismissal: if the gap is still there at the next nightly check, the row
 *  comes back, because the price genuinely has not changed). */
const NIGHTLY_HOUR_UTC = 0;
const NIGHTLY_MINUTE_UTC = 30;

export function nextNightlyRun(now: Date): Date {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), NIGHTLY_HOUR_UTC, NIGHTLY_MINUTE_UTC, 0, 0),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// ---- price_review writes (shared by the task rule below and the Pricing tab's own button) ------

/**
 * The exact note a `price_review` task's close stamps onto the rows it closes - and the ONLY
 * thing a reopen is allowed to match on. Pulled out as a pure helper (controller ruling #1) so
 * the self-test can assert the format without a DB, and so `setSyncLogReviewed` (write) and
 * `reopenSyncLogReview` (match) can never drift apart.
 *
 * Scoping the reopen to this exact note - not just "reviewed rows of this event" - matters
 * because the event is the unit the tab and its price_review tasks share, but a row can turn
 * `reviewed` for THREE different reasons: this task closing it, a DIFFERENT price_review task
 * closing it, or the "טופל" button (no task at all, note "סומן כטופל"). Only the first may be
 * undone by reopening this task.
 */
export function closedByTaskNote(taskId: string): string {
  return `נסגר במשימה ${taskId}`;
}

/** Flips this event's frozen (`needs_review`) base_price_sync_log rows to `reviewed`, with a note
 *  saying why. Scoped to `needs_review` only, so it never touches a row the cron already applied
 *  or skipped. Reused by markPricingGapHandled (lib/actions/pricing-gap-actions.ts) with its own
 *  note ("סומן כטופל") - the task-closing path below passes closedByTaskNote(taskId). Logs the
 *  affected row ids (controller ruling #1). */
export async function setSyncLogReviewed(eventId: number, note: string): Promise<void> {
  const { data, error } = await db
    .from("base_price_sync_log")
    .update({ status: "reviewed", note })
    .eq("event_id", eventId)
    .eq("status", "needs_review")
    .select("id");
  if (error) {
    console.error("gap-resolution: set reviewed failed", JSON.stringify(error));
    return;
  }
  const ids = (data ?? []).map((row: { id: number }) => row.id);
  console.log(`gap-resolution: set reviewed event=${eventId} note=${JSON.stringify(note)} rows=${JSON.stringify(ids)}`);
}

/**
 * Puts back to `needs_review` ONLY the rows THIS task closed - `status = 'reviewed'` AND
 * `note` equal exactly `closedByTaskNote(taskId)` (controller ruling #1). A row someone marked
 * with the "טופל" button, or that a different price_review task closed, is never touched: the
 * event is the shared unit, but only the task that closed a row may reopen it.
 */
async function reopenSyncLogReview(eventId: number, taskId: string): Promise<void> {
  const note = closedByTaskNote(taskId);
  const { data, error } = await db
    .from("base_price_sync_log")
    .update({ status: "needs_review", note: "נפתח מחדש מהמשימה" })
    .eq("event_id", eventId)
    .eq("status", "reviewed")
    .eq("note", note)
    .select("id");
  if (error) {
    console.error("gap-resolution: reopen review failed", JSON.stringify(error));
    return;
  }
  const ids = (data ?? []).map((row: { id: number }) => row.id);
  console.log(`gap-resolution: reopened review event=${eventId} task=${taskId} rows=${JSON.stringify(ids)}`);
}

// ---- per-family writes ---------------------------------------------------------------------

/** Byte-for-byte the old inline branch in setTaskStatus. */
async function resolveCreative(ref: TaskSourceRef, action: "close" | "reopen"): Promise<void> {
  if (action === "close") {
    await dismissCreativeGap({
      kind: ref.kind,
      table: ref.table,
      row_id: ref.row_id,
      label: ref.label,
      note: "נסגר במשימה",
    });
  } else {
    await restoreCreativeGap(gapKey(ref.kind, ref.table, ref.row_id));
  }
}

async function resolvePricing(
  source: TaskSource,
  ref: TaskSourceRef,
  action: "close" | "reopen",
  taskId: string,
): Promise<void> {
  if (source === "price_light") {
    // "בפתיחה מחדש אין מה לבטל" (brief) - the light recomputes nightly regardless of
    // this task, and a "repriced" decision is a record of a human's judgment, not a
    // state to roll back.
    if (action !== "close") return;
    const scope: Scope = ref.kind === "ticket" ? "ticket" : "package";
    // Dynamic import: price-light-decisions.ts pulls in the competitor-scraper
    // registry (via price-light-store.ts), which reads provider env vars at
    // module load - fine inside Next.js, but it would make importing this file
    // alone (e.g. the self-test, which never takes this branch) blow up under
    // plain `npx tsx` with no .env loaded.
    const { recordRepriced } = await import("@/lib/services/price-light-decisions");
    const result = await recordRepriced(Number(ref.row_id), scope, null);
    if (!result.ok) console.error("gap-resolution: recordRepriced failed on task close", taskId, result.error);
    return;
  }
  if (source === "price_review") {
    const eventId = Number(ref.row_id);
    if (action === "close") await setSyncLogReviewed(eventId, closedByTaskNote(taskId));
    else await reopenSyncLogReview(eventId, taskId);
  }
}

/**
 * A task born from a gap closes that gap when it reaches done/cancelled, and
 * reopens it when it comes back to life (todo/in_progress/paused). One rule for
 * every gap family:
 * - creative_gap -> dismiss/restore the creative gap (unchanged from the branch
 *   this replaces).
 * - price_light -> record a "repriced" decision on close only.
 * - price_review -> flip the event's frozen base_price_sync_log row(s) between
 *   needs_review and reviewed.
 * - recurring -> always a weekly digest here (source_ref.kind === "rule"); a
 *   digest is not itself a gap, so this is a no-op.
 * - manual / roadmap / unrecognized source -> no-op.
 *
 * Never throws - a failed gap write must never block the task's own status change.
 */
export async function resolveGapForTask(
  task: { id: string; source: TaskSource; source_ref: TaskSourceRef | null },
  status: TaskStatus,
): Promise<void> {
  try {
    if (!task.source_ref) return;
    const family = gapSourceOf(task.source);
    const action = gapAction(status);
    if (family === "creative") {
      await resolveCreative(task.source_ref, action);
    } else if (family === "pricing") {
      await resolvePricing(task.source, task.source_ref, action, task.id);
    }
    // "recurring" (always a digest) and everything else: no-op by design.
  } catch (e) {
    console.error("gap-resolution: resolveGapForTask failed", task.id, e);
  }
}

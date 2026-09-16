/**
 * The weekly recurring-task run (Task 9, spec §2.1). One cron for every active
 * `task_rules` row: the rule is data, the generator (lib/services/task-rules/)
 * is code. Reads only against the domains it scans - it never writes a price
 * or removes an event. The insert is direct (not createTask): this runs with
 * no session, so `created_by` is always null ("המערכת").
 *
 * Controller ruling (2026-09-16): a generator's `candidates()` THROWS when its
 * data cannot be loaded - a throw must never read as "no gaps". Below, the
 * throw happens as the very first thing in runOneRule(), before any dedupe
 * query, insert, close or `last_run_at` write, so a caught throw here means
 * "touch nothing for this rule and move on" automatically - there is nothing
 * to roll back.
 */
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { logAudit } from "@/lib/audit";
import { generatorFor } from "@/lib/services/task-rules";
import { isoWeek } from "@/lib/services/task-rules/week";
import { notifyTaskAssigned } from "@/lib/services/task-notify";
import { isRuleDueToday, planRule, type TaskInsert } from "@/lib/services/weekly-task-plan";
import { OPEN_TASK_STATUSES, type TaskSourceRef } from "@/types/task.types";
import type { TaskRule } from "@/types/task-rule.types";

// task_rules predates the generated database types - one boundary cast, same
// pattern as the task-rules generators.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface TaskGenSummary {
  ran: number;
  created: number;
  existed: number;
  closed: number;
  skipped: { rule: string; why: string }[];
  errors: string[];
  dryRun: boolean;
  wouldCreate: { rule: string; title: string }[];
}

interface OpenTaskKeyRow {
  id: string;
  source_ref: TaskSourceRef | null;
}

const TASKS_MAX = 10_000;

/** Every open (not deleted, not done/cancelled), any-source task's `{kind}:{table}:{row_id}`
 *  key - one query per rule (ruling #3), never one per candidate. Matches the `key` shape
 *  every RuleCandidate already carries, so a direct Set.has() is the whole dedupe. */
async function loadOpenItemKeys(): Promise<Set<string>> {
  const { rows, error, truncated } = await fetchPaged<OpenTaskKeyRow>(
    () =>
      db
        .from("tasks")
        .select("id,source_ref")
        .is("deleted_at", null)
        .in("status", OPEN_TASK_STATUSES)
        .order("id", { ascending: true }),
    TASKS_MAX,
  );
  if (error) throw new Error(`open task keys load failed: ${error.message}`);
  // A truncated read is not "fewer open tasks than there really are" - it is an INCOMPLETE
  // dedupe set. Creating per-item tasks against it would silently duplicate every task whose
  // key fell past the cap, which is worse than skipping this rule's run entirely: throw, same
  // as a real query error, so the rule is retried whole next time instead of half-applied now.
  if (truncated) throw new Error(`open task keys truncated at ${TASKS_MAX} - refusing to dedupe against a partial set`);
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.source_ref) keys.add(`${row.source_ref.kind}:${row.source_ref.table}:${row.source_ref.row_id}`);
  }
  return keys;
}

/** Whether a "recurring" digest for this rule already exists THIS week - open or done
 *  (ruling #4): a digest closed on Monday must not be recreated by the same week's re-run. */
async function hasDigestThisWeek(ruleId: string, week: string): Promise<boolean> {
  const { data, error } = await db
    .from("tasks")
    .select("id")
    .eq("source", "recurring")
    .is("deleted_at", null)
    .contains("source_ref", { row_id: ruleId, week })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`digest lookup failed: ${error.message}`);
  return !!data;
}

/** Every still-OPEN "recurring" digest of this rule from a week other than `week`
 *  (ruling #5) - closing on an empty-candidates run never touches this week's own digest
 *  (there isn't one, or planRule would have hit the dedupe branch instead). */
async function loadEarlierOpenDigests(
  ruleId: string,
  week: string,
): Promise<{ id: string; description: string | null }[]> {
  const { data, error } = await db
    .from("tasks")
    .select("id,description,source_ref")
    .eq("source", "recurring")
    .is("deleted_at", null)
    .in("status", OPEN_TASK_STATUSES)
    .contains("source_ref", { row_id: ruleId, kind: "rule" })
    .order("id", { ascending: true });
  if (error) throw new Error(`earlier digests load failed: ${error.message}`);
  return ((data ?? []) as { id: string; description: string | null; source_ref: TaskSourceRef | null }[])
    .filter((row) => row.source_ref?.week !== week)
    .map((row) => ({ id: row.id, description: row.description }));
}

/** Appends the close note rather than overwriting the description, same pattern as
 *  closePriceLightTasksIfNotRed in price-light-tasks.ts. An update failure is pushed
 *  into `summary.errors` (same as an insert failure below) rather than only logged -
 *  otherwise a close that silently didn't happen would never show up in the summary. */
async function closeEarlierDigests(
  ruleId: string,
  week: string,
  ruleName: string,
  summary: TaskGenSummary,
): Promise<number> {
  const rows = await loadEarlierOpenDigests(ruleId, week);
  let closed = 0;
  const note = "נסגר אוטומטית — אין יותר פריטים פתוחים";
  for (const row of rows) {
    const { error } = await db
      .from("tasks")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        description: `${row.description ?? ""}\n${note}`.trim(),
      })
      .eq("id", row.id);
    if (error) {
      console.error("weekly-task-gen: close earlier digest failed", JSON.stringify(error));
      summary.errors.push(`${ruleName}: close earlier digest failed - ${error.message}`);
      continue;
    }
    closed++;
  }
  return closed;
}

/** A digest insert can lose a race to another concurrent run (the Sunday cron and a
 *  manual "run now" overlapping) - `tasks_recurring_digest_week_uniq` (migration
 *  20260916210000) turns that into a Postgres 23505 instead of a duplicate row. That is
 *  "already exists", not a failure: the caller counts it in `existed`, never `errors`.
 *  The index only covers `source = 'recurring'` rows, so a 23505 elsewhere would be a
 *  real, unexpected conflict and falls through to the normal error path. */
async function insertTask(task: TaskInsert): Promise<{ id: string } | { conflict: true } | null> {
  const { data, error } = await db
    .from("tasks")
    .insert({
      title: task.title,
      description: task.description,
      priority: task.priority,
      assignee_id: task.assignee_id,
      created_by: task.created_by,
      due_date: task.due_date,
      source: task.source,
      source_ref: task.source_ref,
      board: task.board,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505" && task.source === "recurring") return { conflict: true };
    console.error("weekly-task-gen: task insert failed", JSON.stringify(error));
    return null;
  }
  if (!data) return null;
  return data as { id: string };
}

async function runOneRule(
  rule: TaskRule,
  week: string,
  now: Date,
  summary: TaskGenSummary,
  dryRun: boolean,
): Promise<void> {
  const generator = generatorFor(rule.domain);
  // Throws on failure (controller ruling) - propagates straight out of this function,
  // before any dedupe query, insert, close, or last_run_at write happens below.
  const candidates = rule.domain === "custom" ? [] : await generator.candidates(rule.match);

  const openItemKeys = rule.mode === "per_item" ? await loadOpenItemKeys() : new Set<string>();
  const existingDigest = rule.mode === "weekly_digest" ? await hasDigestThisWeek(rule.id, week) : false;

  const plan = planRule(rule, candidates, openItemKeys, existingDigest, now, {
    week,
    digestTitle: generator.digestTitle,
    screenUrl: generator.screenUrl,
  });

  if (plan.skippedWhy) summary.skipped.push({ rule: rule.name, why: plan.skippedWhy });

  if (dryRun) {
    for (const task of plan.create) summary.wouldCreate.push({ rule: rule.name, title: task.title });
    // last_run_at is intentionally NOT updated on a dry run (spec §rulings #8).
    return;
  }

  let created = 0;
  for (const task of plan.create) {
    const inserted = await insertTask(task);
    if (!inserted) {
      summary.errors.push(`${rule.name}: task insert failed`);
      continue;
    }
    if ("conflict" in inserted) {
      summary.existed++;
      continue;
    }
    created++;
    summary.created++;
    if (task.assignee_id) {
      await notifyTaskAssigned({
        taskId: inserted.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: task.due_date,
        sourceRef: task.source_ref,
        assigneeId: task.assignee_id,
        assignerId: null,
      });
    }
  }
  summary.existed += plan.existed;

  let closed = 0;
  if (plan.closeEarlierDigests) {
    closed = await closeEarlierDigests(rule.id, week, rule.name, summary);
    summary.closed += closed;
  }

  const { error: touchError } = await db
    .from("task_rules")
    .update({ last_run_at: now.toISOString() })
    .eq("id", rule.id);
  if (touchError) {
    summary.errors.push(`${rule.name}: last_run_at update failed - ${touchError.message}`);
  }

  await logAudit({
    action: "tasks.generated",
    entityType: "task_rule",
    entityId: rule.id,
    metadata: { created, existed: plan.existed, closed, candidates: candidates.length },
  });
}

/**
 * Concurrency note: `tasks_recurring_digest_week_uniq` (migration 20260916210000) makes a
 * double-created weekly digest impossible even if the Sunday cron and a manual "run now"
 * overlap - the loser's insert hits Postgres 23505 and is counted in `existed` (see
 * insertTask above). Per-item tasks have NO such DB-level guard: two overlapping runs can
 * still insert the same candidate twice, because `loadOpenItemKeys()` is read once up
 * front and the two runs race each other's writes. This is accepted rather than fixed
 * here - per-item rows already rely on app-level dedupe only (same as the existing
 * price_light/creative_gap rows this reads against, which can themselves repeat), a
 * unique index over an arbitrary jsonb `source_ref` shape could fail to build against
 * that existing data, and in practice a manual run-now and the Sunday cron essentially
 * never overlap.
 */
export async function runWeeklyTaskGen(
  opts: { dryRun?: boolean; budgetMs?: number; ruleId?: string; now?: Date } = {},
): Promise<TaskGenSummary> {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.budgetMs ?? 270_000);
  const week = isoWeek(now);
  const summary: TaskGenSummary = {
    ran: 0,
    created: 0,
    existed: 0,
    closed: 0,
    skipped: [],
    errors: [],
    dryRun: !!opts.dryRun,
    wouldCreate: [],
  };

  // Oldest visit first, so a budget cutoff never starves the same rule week after week
  // (same rotation idea as base-price-sync).
  let query = db
    .from("task_rules")
    .select("*")
    .eq("active", true)
    .order("last_run_at", { ascending: true, nullsFirst: true });
  if (opts.ruleId) query = query.eq("id", opts.ruleId);
  const { data, error } = await query;
  if (error) {
    // task_rules doesn't exist yet in production (migration unapplied) - this is exactly
    // the shape that must land in summary.errors, never throw out of this function.
    summary.errors.push(`load rules: ${error.message}`);
    return summary;
  }

  for (const rule of (data ?? []) as TaskRule[]) {
    if (Date.now() > deadline) {
      summary.skipped.push({ rule: rule.name, why: "budget" });
      continue;
    }
    // A manual "run now" (single ruleId) ignores the day; the cron respects it.
    if (!opts.ruleId && !isRuleDueToday(rule, now)) {
      summary.skipped.push({ rule: rule.name, why: "not its day" });
      continue;
    }
    try {
      await runOneRule(rule, week, now, summary, !!opts.dryRun);
      summary.ran++;
    } catch (e) {
      summary.errors.push(`${rule.name}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return summary;
}

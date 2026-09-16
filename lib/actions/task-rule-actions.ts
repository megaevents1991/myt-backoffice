"use server";

/**
 * `/tasks/rules` (Task 10, spec docs/superpowers/sdd/2026-09-16-tasks-hub). Every
 * export starts with `requireAdmin()` - a recurring rule reaches into price-light,
 * price-changes and creative-gaps and can spam the whole team, so only an admin
 * creates or runs one. `runRuleNow`/`previewRule` delegate to `runWeeklyTaskGen`
 * (Task 9) - that is the one place a rule is actually executed, cron or manual.
 */
import { requireAdmin } from "@/lib/auth/guards";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { runWeeklyTaskGen, type TaskGenSummary } from "@/lib/services/weekly-task-gen";
import { validateRuleInput } from "@/lib/tasks/rule-validation";
import type { TaskRule, TaskRuleWithNames } from "@/types/task-rule.types";

// Typed against types/database.types.ts (npm run db:types).
const db = supabaseTyped;

export type Ok = { ok: true } | { ok: false; error: string };

interface StaffNameRow {
  id: string;
  display_name: string | null;
  email: string;
}

/** One extra query for the handful of distinct assignees on this screen - never
 *  N+1, and cheap enough that a screen with zero rules skips it entirely. */
async function attachAssigneeNames(rules: TaskRule[]): Promise<TaskRuleWithNames[]> {
  const ids = Array.from(
    new Set(rules.map((rule) => rule.assignee_id).filter((id): id is string => !!id)),
  );
  if (!ids.length) return rules.map((rule) => ({ ...rule, assignee_name: null }));

  const { data, error } = await db.from("user_profiles").select("id,display_name,email").in("id", ids);
  if (error) {
    console.error("task-rule-actions: load assignee names failed", JSON.stringify(error));
    return rules.map((rule) => ({ ...rule, assignee_name: null }));
  }
  // Same fallback as the tasks board: a profile with no display name shows its email,
  // never "unassigned".
  const names = new Map<string, string | null>(
    (data as StaffNameRow[]).map((row) => [row.id, row.display_name || row.email]),
  );
  return rules.map((rule) => ({
    ...rule,
    assignee_name: rule.assignee_id ? (names.get(rule.assignee_id) ?? null) : null,
  }));
}

/** Every rule, newest first - this is a short admin list, not a paged table.
 *  Returns `{ ok: false, error }` on a load failure (missing table, RLS,
 *  connection) rather than silently returning an empty list - an empty list
 *  and a broken table must never look the same to the person looking at the
 *  screen (fix round 1, code review). */
export async function listTaskRules(): Promise<
  { ok: true; rules: TaskRuleWithNames[] } | { ok: false; error: string }
> {
  await requireAdmin();
  const { data, error } = await db.from("task_rules").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error("listTaskRules failed", JSON.stringify(error));
    return { ok: false, error: error.message };
  }
  const rules = await attachAssigneeNames((data ?? []) as TaskRule[]);
  return { ok: true, rules };
}

/** Confirms the rule still exists before running/previewing it - a rule
 *  deleted in another tab must fail with a clear message, not silently
 *  return an all-zero summary through `runWeeklyTaskGen`'s empty-result
 *  path (fix round 1, code review). */
async function requireRuleExists(
  id: string,
  opts: { mustBeActive?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await db.from("task_rules").select("id,active").eq("id", id).maybeSingle();
  if (error) {
    console.error("task-rule-actions: existence check failed", JSON.stringify(error));
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "הכלל לא נמצא" };
  // runWeeklyTaskGen only loads active rules, so running/previewing an inactive one
  // would quietly report "nothing happened" - say why instead.
  if (opts.mustBeActive && !(data as { active: boolean }).active) {
    return { ok: false, error: "הכלל כבוי — הפעל אותו כדי להריץ" };
  }
  return { ok: true };
}

export async function createTaskRule(
  input: unknown,
): Promise<{ ok: true; rule: TaskRuleWithNames } | { ok: false; error: string }> {
  const session = await requireAdmin();
  const validated = validateRuleInput(input);
  if (!validated.ok) return { ok: false, error: validated.error };
  const v = validated.value;

  const { data, error } = await db
    .from("task_rules")
    .insert({
      name: v.name,
      domain: v.domain,
      mode: v.mode,
      match: v.match,
      assignee_id: v.assignee_id,
      priority: v.priority,
      due_days: v.due_days,
      dow: v.dow,
      board: v.board,
      title: v.title,
      description: v.description,
      active: v.active,
      created_by: session.sub,
    })
    .select("*")
    .single();
  if (error) {
    console.error("createTaskRule failed", JSON.stringify(error));
    return { ok: false, error: error.message };
  }

  await logAudit({
    action: "tasks.rule_create",
    entityType: "task_rule",
    entityId: data.id,
    metadata: { name: v.name, domain: v.domain },
  });
  const [withName] = await attachAssigneeNames([data as TaskRule]);
  return { ok: true, rule: withName };
}

export async function updateTaskRule(
  id: string,
  input: unknown,
): Promise<{ ok: true; rule: TaskRuleWithNames } | { ok: false; error: string }> {
  await requireAdmin();
  const validated = validateRuleInput(input);
  if (!validated.ok) return { ok: false, error: validated.error };
  const v = validated.value;

  const { data, error } = await db
    .from("task_rules")
    .update({
      name: v.name,
      domain: v.domain,
      mode: v.mode,
      match: v.match,
      assignee_id: v.assignee_id,
      priority: v.priority,
      due_days: v.due_days,
      dow: v.dow,
      board: v.board,
      title: v.title,
      description: v.description,
      active: v.active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    console.error("updateTaskRule failed", JSON.stringify(error));
    return { ok: false, error: error.message };
  }

  await logAudit({
    action: "tasks.rule_update",
    entityType: "task_rule",
    entityId: id,
    metadata: { name: v.name, domain: v.domain, active: v.active },
  });
  const [withName] = await attachAssigneeNames([data as TaskRule]);
  return { ok: true, rule: withName };
}

/** Reads the full row first so the audit metadata carries what was actually
 *  deleted - the UI confirms with the user before ever calling this. */
export async function deleteTaskRule(id: string): Promise<Ok> {
  await requireAdmin();
  const { data: row, error: readError } = await db.from("task_rules").select("*").eq("id", id).maybeSingle();
  if (readError) {
    console.error("deleteTaskRule read failed", JSON.stringify(readError));
    return { ok: false, error: readError.message };
  }
  if (!row) return { ok: false, error: "rule not found" };

  await logAudit({ action: "tasks.rule_delete", entityType: "task_rule", entityId: id, metadata: { row } });

  const { error } = await db.from("task_rules").delete().eq("id", id);
  if (error) {
    console.error("deleteTaskRule failed", JSON.stringify(error));
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** "הרץ עכשיו" - runs this one rule for real, ignoring its day-of-week gate
 *  (a manual run is not the cron). */
export async function runRuleNow(
  id: string,
): Promise<{ ok: true; summary: TaskGenSummary } | { ok: false; error: string }> {
  await requireAdmin();
  const exists = await requireRuleExists(id, { mustBeActive: true });
  if (!exists.ok) return exists;

  const summary = await runWeeklyTaskGen({ ruleId: id });
  await logAudit({
    action: "tasks.rule_run",
    entityType: "task_rule",
    entityId: id,
    metadata: { created: summary.created, existed: summary.existed, closed: summary.closed, errors: summary.errors },
  });
  return { ok: true, summary };
}

/** "תצוגה מקדימה" - the exact same generator, zero writes. */
export async function previewRule(
  id: string,
): Promise<{ ok: true; summary: TaskGenSummary } | { ok: false; error: string }> {
  await requireAdmin();
  const exists = await requireRuleExists(id, { mustBeActive: true });
  if (!exists.ok) return exists;

  const summary = await runWeeklyTaskGen({ ruleId: id, dryRun: true });
  return { ok: true, summary };
}

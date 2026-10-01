/**
 * The daily late check (Dor, 01.10: "if the deadline passed, these tasks pop up to whoever
 * opened them, by mail and in the tasks area - the ones nobody has answered yet").
 *
 * Every open task past its due date whose assignee has said nothing since (lib/tasks/reminders.ts
 * `lateWithoutAnswer`) is raised to the person who opened it - ONE mail per opener listing all of
 * theirs. A task is raised again only after OVERDUE_REALERT_DAYS, and each raise leaves an
 * `overdue_alert` row in the task's thread (author null = the system), which is both the record
 * and the dedupe. The board shows the same tasks without this job (TaskWithNames.late) - the job
 * only adds the mail. `dryRun` = everything computed, nothing mailed or written.
 */
import { supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { assignedByMap, type AssigneeChangeRow } from "@/lib/tasks/owner-filter";
import {
  assignedAtMap,
  daysLate,
  israelDate,
  lateWithoutAnswer,
  openerOf,
  overdueAlertDue,
  type ThreadEvent,
} from "@/lib/tasks/reminders";
import { notifyOverdueDigest, type LateTaskLine } from "@/lib/services/task-reminder-notify";
import { recordActivity } from "@/lib/services/task-activity";
import type { TaskStatus } from "@/types/task.types";

const db = supabaseTyped;

const CHUNK = 200;
const ROWS_MAX = 50_000;

interface LateTask {
  id: string;
  /** The task's own company: this run reads every company, and each mailed link names its task's board. */
  company_id: string;
  title: string;
  status: TaskStatus;
  due_date: string;
  assignee_id: string;
  created_by: string | null;
  created_at: string;
  reviewer_ids: string[] | null;
}

export interface OverdueAlertSummary {
  dryRun: boolean;
  today: string;
  /** Open, assigned tasks past their due date. */
  overdue: number;
  /** Of those, the ones with no answer from the assignee since. */
  late: number;
  /** Of those, raised in this run (the rest were raised less than OVERDUE_REALERT_DAYS ago). */
  raised: number;
  mails: { opener: string; tasks: number; outcome: string }[];
  errors: string[];
}

type ThreadRow = ThreadEvent & {
  id: string;
  task_id: string;
  kind: string;
  activity: { field?: string; from?: string | null; to?: string | null } | null;
};

async function threadRows(taskIds: string[]): Promise<ThreadRow[]> {
  const out: ThreadRow[] = [];
  for (let i = 0; i < taskIds.length; i += CHUNK) {
    const chunk = taskIds.slice(i, i + CHUNK);
    const { rows, error } = await fetchPaged<ThreadRow>(
      () =>
        db
          .from("task_comments")
          .select("id,task_id,author_id,created_at,kind,activity")
          .in("task_id", chunk)
          .order("id", { ascending: true }),
      ROWS_MAX,
    );
    // A missing thread would make every task in it look ignored - fail the run instead.
    if (error) throw new Error(`thread read failed: ${JSON.stringify(error)}`);
    out.push(...(rows as ThreadRow[]));
  }
  return out;
}

export async function runOverdueAlerts(options: { dryRun: boolean; now?: Date }): Promise<OverdueAlertSummary> {
  const now = options.now ?? new Date();
  const today = israelDate(now);
  const summary: OverdueAlertSummary = {
    dryRun: options.dryRun,
    today,
    overdue: 0,
    late: 0,
    raised: 0,
    mails: [],
    errors: [],
  };

  // Every company on purpose: the run mails each task's opener, whatever board the task is on,
  // and each mailed link carries its task's own company. This is the one read of `tasks` outside
  // lib/tasks-scope.ts - allow-listed by name in scripts/tasks-company-scope-selftest.ts.
  const { rows: tasks, error } = await fetchPaged<LateTask>(
    () =>
      db
        .from("tasks")
        .select("id,company_id,title,status,due_date,assignee_id,created_by,created_at,reviewer_ids")
        .is("deleted_at", null)
        .in("status", ["todo", "in_progress", "paused"])
        .not("assignee_id", "is", null)
        .lt("due_date", today)
        .order("id", { ascending: true }),
    5000,
  );
  if (error) throw new Error(`task read failed: ${JSON.stringify(error)}`);
  summary.overdue = tasks.length;
  if (tasks.length === 0) return summary;

  const thread = await threadRows(tasks.map((task) => task.id));
  const changes = thread.filter(
    (row) => row.kind === "activity" && row.activity?.field === "assignee",
  ) as unknown as AssigneeChangeRow[];
  const assignedBy = assignedByMap(tasks, changes);
  const assignedAt = assignedAtMap(tasks, changes);

  const byTask = new Map<string, ThreadRow[]>();
  for (const row of thread) {
    const list = byTask.get(row.task_id) ?? [];
    list.push(row);
    byTask.set(row.task_id, list);
  }

  // opener id -> the late tasks to raise to them now
  const toRaise = new Map<string, LateTask[]>();
  for (const task of tasks) {
    const rows = byTask.get(task.id) ?? [];
    const withAssigner = { ...task, assigned_by: assignedBy.get(task.id) ?? null };
    if (!lateWithoutAnswer({ task: withAssigner, assignedAt: assignedAt.get(task.id) ?? task.created_at, events: rows, today })) {
      continue;
    }
    summary.late += 1;
    const opener = openerOf(withAssigner);
    if (!opener) continue;
    const lastAlert = rows
      .filter((row) => row.kind === "activity" && row.activity?.field === "overdue_alert" && row.activity.to === opener)
      .map((row) => row.created_at)
      .sort()
      .at(-1);
    if (!overdueAlertDue(lastAlert ?? null, now)) continue;
    const list = toRaise.get(opener) ?? [];
    list.push(task);
    toRaise.set(opener, list);
  }

  const assigneeIds = [...new Set([...toRaise.values()].flat().map((task) => task.assignee_id))];
  const { data: people, error: peopleError } = assigneeIds.length
    ? await db.from("user_profiles").select("id,display_name,email").in("id", assigneeIds)
    : { data: [], error: null };
  if (peopleError) summary.errors.push(`names: ${JSON.stringify(peopleError)}`);
  const nameOf = new Map(
    (people ?? []).map((p: { id: string; display_name: string | null; email: string }) => [p.id, p.display_name || p.email] as const),
  );

  for (const [opener, list] of toRaise) {
    // Longest overdue first.
    list.sort((a, b) => a.due_date.localeCompare(b.due_date));
    const lines: LateTaskLine[] = list.map((task) => ({
      id: task.id,
      company_id: task.company_id,
      title: task.title,
      status: task.status,
      due_date: task.due_date,
      days_late: daysLate(task.due_date, today),
      assignee_name: nameOf.get(task.assignee_id) ?? "?",
    }));
    summary.raised += list.length;
    if (options.dryRun) {
      summary.mails.push({ opener, tasks: list.length, outcome: "dry-run" });
      continue;
    }
    const outcome = await notifyOverdueDigest({ openerId: opener, tasks: lines });
    summary.mails.push({ opener, tasks: list.length, outcome });
    // Only a mail that went out counts as "raised" - a skipped or failed one is tried again tomorrow.
    if (outcome !== "sent") continue;
    for (const task of list) {
      await recordActivity(task.id, null, { field: "overdue_alert", from: task.due_date, to: opener });
    }
  }
  return summary;
}

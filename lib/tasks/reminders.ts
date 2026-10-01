// lib/tasks/reminders.ts
// Reminders (Dor, 01.10): "a button that pops the task again by mail - it was not done, or I
// got no answer on it", and "when the deadline passed, the tasks pop up to whoever opened them,
// by mail and in the tasks area - the ones nobody has answered yet".
// Pure - no DB, no session (scripts/task-thread-selftest.ts).
import { ADMIN_ROLES } from "@/types/auth.types";
import type { TaskStatus } from "@/types/task.types";
import { reviewersOf } from "@/lib/tasks/review";
import type { AssigneeChangeRow } from "@/lib/tasks/owner-filter";

/** One manual reminder per task per this long - a double click, or an impatient second press,
 *  must not become a second mail. */
export const REMINDER_COOLDOWN_MS = 60 * 60 * 1000;

/** A task that stays late without an answer is raised to its opener again after this many days
 *  (the first time it goes late it is raised at once). */
export const OVERDUE_REALERT_DAYS = 3;

/** Statuses where the deadline is the ASSIGNEE's to meet. "review" is not one: the assignee
 *  answered by handing it over, and the move is the reviewer's (the reminder button covers it). */
const WORKING_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "paused"];

const OPEN_STATUSES: readonly TaskStatus[] = [...WORKING_STATUSES, "review"];

interface ReminderTask {
  status: TaskStatus;
  assignee_id: string | null;
  created_by: string | null;
  /** Who handed the task to its current owner (lib/tasks/owner-filter.ts). */
  assigned_by: string | null;
  reviewer_ids: string[] | null;
}

/** The date in Israel, YYYY-MM-DD - a deadline is a day on the office's calendar, and at
 *  01:00 Israel time UTC still says yesterday. */
export function israelDate(at: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof at === "string" ? new Date(at) : at);
}

/** Whole days from `due` to `today` (both YYYY-MM-DD); 0 or less = not late. */
export function daysLate(due: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

/** The person a late task is raised to: whoever opened it, else (a rule-made task nobody human
 *  opened) whoever assigned it. */
export function openerOf(task: Pick<ReminderTask, "created_by" | "assigned_by">): string | null {
  return task.created_by ?? task.assigned_by ?? null;
}

/** Who a reminder mails: the assignee while the work is theirs, the reviewers while it waits
 *  for review. Nobody on a closed or unassigned task. */
export function reminderTargets(task: ReminderTask): string[] {
  if (task.status === "review") return reviewersOf(task);
  if (WORKING_STATUSES.includes(task.status) && task.assignee_id) return [task.assignee_id];
  return [];
}

/** Who may press "remind": an admin, or anyone the task belongs to (opened it, assigned it, owns
 *  it, reviews it) - and only when there is someone OTHER than them to remind. */
export function canRemind(role: string, task: ReminderTask, userId: string | null): boolean {
  if (!userId || !OPEN_STATUSES.includes(task.status)) return false;
  if (reminderTargets(task).filter((id) => id !== userId).length === 0) return false;
  if ((ADMIN_ROLES as readonly string[]).includes(role)) return true;
  return (
    task.created_by === userId ||
    task.assigned_by === userId ||
    task.assignee_id === userId ||
    reviewersOf(task).includes(userId)
  );
}

/** A reminder sent at `lastAt` still blocks a new one at `now`. */
export function reminderCoolingDown(lastAt: string | null, now: Date): boolean {
  if (!lastAt) return false;
  const at = Date.parse(lastAt);
  return Number.isFinite(at) && now.getTime() - at < REMINDER_COOLDOWN_MS;
}

/** One row of the task's thread (comment or activity) - who did something, and when. */
export interface ThreadEvent {
  author_id: string | null;
  created_at: string;
}

/**
 * Past its deadline with no word from the person who owes one. "A word" = anything the assignee
 * did on the task (a comment, a status or progress change, handing it on) on or after the due
 * day, and after it reached them - a task handed over yesterday is not "ignored since last week".
 * They get until the end of the day it reached them. A task someone opened for themself has
 * nobody else to raise it to, so it is never "late without an answer".
 */
export function lateWithoutAnswer(input: {
  task: ReminderTask & { due_date: string | null };
  /** When the current assignee got it: the newest assignee change to them, else task creation. */
  assignedAt: string;
  /** Every row of this task's thread. */
  events: ThreadEvent[];
  /** Israel date (israelDate). */
  today: string;
}): boolean {
  const { task, assignedAt, events, today } = input;
  const due = task.due_date;
  if (!due || !task.assignee_id || !WORKING_STATUSES.includes(task.status)) return false;
  if (due >= today) return false;
  const opener = openerOf(task);
  if (!opener || opener === task.assignee_id) return false;
  if (israelDate(assignedAt) >= today) return false;

  const reachedAt = Date.parse(assignedAt);
  const answered = events.some(
    (event) =>
      event.author_id === task.assignee_id &&
      israelDate(event.created_at) >= due &&
      !(Date.parse(event.created_at) < reachedAt),
  );
  return !answered;
}

/** When each task's CURRENT assignee got it: the newest assignee change that landed on them,
 *  else the task's creation (assigned in the New-task form, which writes no activity row). */
export function assignedAtMap(
  tasks: Array<{ id: string; assignee_id: string | null; created_at: string }>,
  changes: AssigneeChangeRow[],
): Map<string, string> {
  const assigneeOf = new Map(tasks.map((task) => [task.id, task.assignee_id] as const));
  const out = new Map(tasks.map((task) => [task.id, task.created_at] as const));
  const fromChange = new Set<string>();
  for (const change of changes) {
    const assignee = assigneeOf.get(change.task_id);
    if (!assignee || change.activity?.field !== "assignee" || change.activity.to !== assignee) continue;
    const current = out.get(change.task_id);
    if (!fromChange.has(change.task_id) || !current || Date.parse(change.created_at) > Date.parse(current)) {
      out.set(change.task_id, change.created_at);
      fromChange.add(change.task_id);
    }
  }
  return out;
}

/** The opener was told about this late task at `lastAlertAt`; is it time to tell them again? */
export function overdueAlertDue(lastAlertAt: string | null, now: Date): boolean {
  if (!lastAlertAt) return true;
  const at = Date.parse(lastAlertAt);
  return !Number.isFinite(at) || now.getTime() - at >= OVERDUE_REALERT_DAYS * 86_400_000;
}

// lib/tasks/owner-filter.ts
// Whose tasks the board shows (Dor, 30.09): mine, the ones I handed to someone else, one
// person's (admins), nobody's. Pure - no DB, no session (scripts/task-thread-selftest.ts).
import { awaitsReviewBy } from "@/lib/tasks/review";
import type { TaskStatus } from "@/types/task.types";

/** "all" | "mine" | "delegated" (I assigned it, someone else owns it) | "unassigned" |
 *  "user:<id>" (that person's tasks - the admin's per-person view). */
export type OwnerFilter = "all" | "mine" | "delegated" | "unassigned" | `user:${string}`;

/** An `assignee` activity row of the task thread - who changed the owner, and to whom. */
export interface AssigneeChangeRow {
  task_id: string;
  author_id: string | null;
  created_at: string;
  activity: { field?: string; to?: string | null } | null;
}

/**
 * Who put the CURRENT assignee on each task: the author of the newest assignee change that
 * landed on that person, else whoever created the task (assigned in the New-task form, which
 * writes no activity row). Not `created_by` alone - an admin who bulk-assigns rule-made tasks
 * created none of them, and those are exactly the tasks they want to follow up on.
 * Unassigned tasks, and ones nobody human assigned (a rule's own assignee), are left out.
 */
export function assignedByMap(
  tasks: Array<{ id: string; assignee_id: string | null; created_by: string | null }>,
  changes: AssigneeChangeRow[],
): Map<string, string> {
  const newest = new Map<string, AssigneeChangeRow>();
  const assigneeOf = new Map(tasks.map((task) => [task.id, task.assignee_id] as const));
  for (const change of changes) {
    const assignee = assigneeOf.get(change.task_id);
    if (!assignee || change.activity?.field !== "assignee" || change.activity.to !== assignee) continue;
    const current = newest.get(change.task_id);
    if (!current || Date.parse(change.created_at) > Date.parse(current.created_at)) {
      newest.set(change.task_id, change);
    }
  }

  const out = new Map<string, string>();
  for (const task of tasks) {
    if (!task.assignee_id) continue;
    const change = newest.get(task.id);
    const by = change ? change.author_id : task.created_by;
    if (by) out.set(task.id, by);
  }
  return out;
}

export function matchesOwner(
  task: {
    assignee_id: string | null;
    assigned_by: string | null;
    status: TaskStatus;
    created_by: string | null;
  },
  filter: OwnerFilter,
  userId: string | null,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "mine":
      // Mine = assigned to me, plus what came BACK to me: a task in review that I opened
      // is my move now, whoever its assignee is (lib/tasks/review.ts).
      return !!userId && (task.assignee_id === userId || awaitsReviewBy(task, userId));
    case "delegated":
      return !!userId && !!task.assignee_id && task.assignee_id !== userId && task.assigned_by === userId;
    case "unassigned":
      return !task.assignee_id;
    default:
      return task.assignee_id === filter.slice("user:".length);
  }
}

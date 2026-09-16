/**
 * Pure kanban logic for the /tasks Kanban tab (Task 12): swimlane grouping,
 * the board-lens filter/parse, per-card drag permission, and the status/
 * priority label maps the table and the board both draw from - one source,
 * not two copies. No DOM, no React, no Supabase - covered end to end by
 * scripts/kanban-selftest.ts under plain `npx tsx` (same pattern as
 * scripts/task-boards-selftest.ts).
 */
import { editableFields } from "@/lib/tasks/permissions";
import { PHASES } from "@/lib/task-boards";
import {
  TASK_BOARDS,
  type TaskBoard,
  type TaskPriority,
  type TaskStatus,
  type TaskWithNames,
} from "@/types/task.types";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  paused: "Paused",
  done: "Done",
  cancelled: "Cancelled",
};

export const PRIORITY_STYLE: Record<TaskPriority, string> = {
  urgent: "bg-destructive/15 text-destructive",
  high: "bg-warning-muted text-warning",
  medium: "bg-info-muted text-info",
  low: "bg-muted text-muted-foreground",
};

/** "all" is the default lens - every real board plus "all" for the button group. */
export type BoardLens = TaskBoard | "all";
export type GroupBy = "none" | "phase" | "assignee";

const NO_PHASE_LABEL = "ללא פאזה";
const UNASSIGNED_LABEL = "לא משויך";

/** `?board=` -> a real board, or "all" for anything missing/unrecognized -
 *  a stale or hand-typed value never breaks the lens, it just resets it. */
export function parseBoardParam(value: string | null | undefined): BoardLens {
  if (value && (TASK_BOARDS as readonly string[]).includes(value)) return value as TaskBoard;
  return "all";
}

export function filterByBoard(tasks: TaskWithNames[], board: BoardLens): TaskWithNames[] {
  if (board === "all") return tasks;
  return tasks.filter((task) => task.board === board);
}

export interface TaskGroup {
  key: string;
  /** Empty for "none" - the caller skips the swimlane header in that case. */
  label: string;
  tasks: TaskWithNames[];
}

/**
 * Splits one status column's tasks into swimlanes. "none" is a single
 * unlabeled lane (the column, unchanged) so callers can always map over the
 * result instead of branching on groupBy themselves.
 */
export function groupTasks(tasks: TaskWithNames[], groupBy: GroupBy): TaskGroup[] {
  if (groupBy === "none") {
    return tasks.length ? [{ key: "all", label: "", tasks }] : [];
  }

  const groups = new Map<string, TaskGroup>();
  const push = (key: string, label: string, task: TaskWithNames) => {
    const existing = groups.get(key);
    if (existing) existing.tasks.push(task);
    else groups.set(key, { key, label, tasks: [task] });
  };

  if (groupBy === "phase") {
    for (const task of tasks) {
      if (task.phase != null) {
        push(String(task.phase), PHASES[task.phase]?.name ?? `פאזה ${task.phase}`, task);
      } else {
        push("none", NO_PHASE_LABEL, task);
      }
    }
    return [...groups.values()].sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return Number(a.key) - Number(b.key);
    });
  }

  // assignee
  for (const task of tasks) {
    if (task.assignee_id) {
      push(task.assignee_id, task.assignee_name ?? "—", task);
    } else {
      push("none", UNASSIGNED_LABEL, task);
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === "none") return 1;
    if (b.key === "none") return -1;
    return a.label.localeCompare(b.label, "he");
  });
}

/**
 * Same rule the table's status <Select> already enforces
 * (lib/tasks/permissions editableFields) - a card is draggable, or shows the
 * mobile status picker, only when this is true. One rule, read from one place.
 */
export function canDragCard(role: string, isOwnTask: boolean): boolean {
  return editableFields(role, isOwnTask).has("status");
}

/** Up to two letters for a card's assignee initials chip. */
export function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

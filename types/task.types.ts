/**
 * Staff task board. Hand-typed until the tasks migration lands on master and
 * `npm run db:types` can regenerate (same bootstrap as user_profiles had).
 */

export const TASK_STATUSES = ["todo", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Sort weight - lower is more urgent. */
export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const TASK_SOURCES = ["manual", "creative_gap"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/**
 * Where a creative_gap task came from - enough to link back to the screen
 * that fixes it and to spot "this gap already has an open task".
 */
export interface TaskSourceRef {
  /** Gap kind, e.g. "team_logo" | "hero_image" | "gallery" | "event_creative". */
  kind: string;
  table: string;
  row_id: string | number;
  /** Human name of the entity ("Liverpool", "Coldplay"). */
  label: string;
  /** Backoffice path that fixes the gap. */
  url: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  created_by: string | null;
  due_date: string | null; // ISO date (YYYY-MM-DD)
  source: TaskSource;
  source_ref: TaskSourceRef | null;
  deleted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Task row joined with the names the list screen shows. */
export interface TaskWithNames extends Task {
  assignee_name: string | null;
  created_by_name: string | null;
}

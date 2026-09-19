/**
 * Staff task board. Hand-typed until the tasks migration lands on master and
 * `npm run db:types` can regenerate (same bootstrap as user_profiles had).
 */

export const TASK_STATUSES = ["todo", "in_progress", "paused", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** "paused" counts as OPEN - the DB's partial "open tasks" index includes it,
 *  so every "still open" filter (dashboards, dedupe-on-open-task checks) reads
 *  from here rather than hand-listing statuses. */
export const OPEN_TASK_STATUSES = ["todo", "in_progress", "paused"] as const;

export const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Sort weight - lower is more urgent. */
export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * manual - typed in by a person.
 * creative_gap - born from the gaps radar (source_ref = the gap).
 * price_review - born from a frozen row on /price-changes (source_ref =
 *   the event: kind "price_review", table "events", row_id = event id).
 * price_light - born from a red light on /price-light (source_ref = the event, kind = the scope).
 * recurring - born from a task_rules row (source_ref = the rule + matched item).
 * roadmap - dev-board product work, tracked by phase (no external source_ref).
 */
export const TASK_SOURCES = [
  "manual",
  "creative_gap",
  "price_review",
  "price_light",
  "recurring",
  "roadmap",
] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/** dev = roadmap product work · marketing = campaigns · ops = what the system generates. */
export const TASK_BOARDS = ["dev", "marketing", "ops"] as const;
export type TaskBoard = (typeof TASK_BOARDS)[number];

export const MKT_CHANNELS = [
  "social",
  "email",
  "seo",
  "ads",
  "content",
  "partnerships",
  "pr",
] as const;
export type MktChannel = (typeof MKT_CHANNELS)[number];

/**
 * Where a sourced task came from - enough to link back to the screen that
 * fixes it and to spot "this gap / event already has an open task".
 */
export type TaskSourceRef = {
  /** Gap kind ("team_logo", "artist_hero", …) or "price_review". */
  kind: string;
  table: string;
  row_id: string | number;
  /** Human name of the entity ("Liverpool", "Coldplay"). */
  label: string;
  /** Backoffice path that fixes the gap. */
  url: string;
  /** recurring weekly_digest only - the ISO week ("2026-W38") this digest covers, the
   *  dedupe key alongside row_id (see isoWeek in lib/services/task-rules/week.ts). */
  week?: string;
};

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
  board: TaskBoard;
  /** 1..7, dev board only. Labels live in lib/task-boards.ts. */
  phase: number | null;
  /** marketing board only. */
  channel: MktChannel | null;
  /** 0..100, marketing board only. */
  progress: number | null;
}

/** Task row joined with the names the list screen shows. */
export interface TaskWithNames extends Task {
  assignee_name: string | null;
  created_by_name: string | null;
  /** The subject's page on the customer site (event / team / artist / category), when it has one. */
  site_url: string | null;
  /** Comments on this task (activity rows excluded). Filled by listTasks. */
  comment_count: number;
  /** Of those, the ones the VIEWER has not read - written by someone else since they last
   *  opened the thread, on a task whose conversation they are part of (lib/tasks/thread-watch.ts). */
  unread_count: number;
}

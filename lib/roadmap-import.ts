/** Pure mapping from the old roadmap app's shapes to task rows (spec §4.2).
 *  Kept out of the script so it can be self-tested without a DB. */
import type { MktChannel, TaskBoard, TaskPriority, TaskSourceRef, TaskStatus } from "@/types/task.types";

export interface RoadmapDevRow { id: number; title: string; ph: number; pri: string; st: string; as: string | null; desc: string }
export interface RoadmapMktRow { id: string; title: string; ch: string; pri: string; st: string; as: string | null; prog: number; desc: string }

export interface RoadmapInsert {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  board: TaskBoard;
  phase: number | null;
  channel: MktChannel | null;
  progress: number | null;
  source: "roadmap";
  source_ref: TaskSourceRef;
}

const PRIORITY: Record<string, TaskPriority> = {
  critical: "urgent", high: "high", medium: "medium", low: "low",
};

const STATUS: Record<string, TaskStatus> = {
  todo: "todo", inprogress: "in_progress", done: "done",
  planning: "todo", active: "in_progress", paused: "paused",
};

export function mapDevTask(row: RoadmapDevRow, userIdByKey: Map<string, string>): RoadmapInsert {
  return {
    title: row.title,
    description: row.desc?.trim() || null,
    status: STATUS[row.st] ?? "todo",
    priority: PRIORITY[row.pri] ?? "medium",
    assignee_id: row.as ? (userIdByKey.get(row.as) ?? null) : null,
    board: "dev",
    phase: row.ph >= 1 && row.ph <= 7 ? row.ph : null,
    channel: null,
    progress: null,
    source: "roadmap",
    source_ref: { kind: "roadmap_dev", table: "roadmap", row_id: row.id, label: row.title, url: "/tasks" },
  };
}

export function mapMktTask(row: RoadmapMktRow, userIdByKey: Map<string, string>): RoadmapInsert {
  return {
    title: row.title,
    description: row.desc?.trim() || null,
    status: STATUS[row.st] ?? "todo",
    priority: PRIORITY[row.pri] ?? "medium",
    assignee_id: row.as ? (userIdByKey.get(row.as) ?? null) : null,
    board: "marketing",
    phase: null,
    channel: (row.ch as MktChannel) ?? null,
    progress: Number.isFinite(row.prog) ? Math.max(0, Math.min(100, Math.round(row.prog))) : null,
    source: "roadmap",
    source_ref: { kind: "roadmap_mkt", table: "roadmap", row_id: row.id, label: row.title, url: "/tasks" },
  };
}

// ---- planning (pure - the script does all the I/O, this decides what to do with it) --------

/** The columns of an existing `tasks` row this diff cares about. `board`/`phase`/`channel`/
 *  `progress` are null when the tasks_hub migration hasn't landed yet (see `hasNewColumns`
 *  on `planRow`/`rowDiffers` below) - not merely absent on this particular row. */
export interface ExistingTaskForPlan {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  board: TaskBoard | null;
  phase: number | null;
  channel: MktChannel | null;
  progress: number | null;
  /** Soft-delete marker (a human removed it in /tasks) - non-null means never touch it. */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PlanKind = "create" | "skipped_deleted" | "existing" | "update" | "unchanged";

export interface PlannedRow {
  kind: PlanKind;
  insert: RoadmapInsert;
  existingId?: string;
  /** Only meaningful on `update` rows: the DB copy's `updated_at` is later than its
   *  `created_at`, i.e. a human touched it in /tasks after it was created - `--update-existing`
   *  would overwrite that edit, so the dry-run surfaces it as a warning before anyone commits to it. */
  editedSinceImport?: boolean;
}

/** `source_ref.kind` + `source_ref.row_id` is the identity of an imported row - stable across
 *  re-runs of the same export even if the title changes. */
export function sourceRefKey(ref: { kind: string; row_id: string | number } | null | undefined): string | null {
  if (!ref) return null;
  return `${ref.kind}:${ref.row_id}`;
}

/** hasNewColumns false (tasks_hub migration not applied yet) means board/phase/channel/progress
 *  can't be compared - only possible in --dry-run, since a real run refuses before this point. */
export function rowDiffers(insert: RoadmapInsert, existing: ExistingTaskForPlan, hasNewColumns: boolean): boolean {
  if (insert.title !== existing.title) return true;
  if (insert.description !== existing.description) return true;
  if (insert.status !== existing.status) return true;
  if (insert.priority !== existing.priority) return true;
  if (insert.assignee_id !== existing.assignee_id) return true;
  if (!hasNewColumns) return false;
  if (insert.board !== existing.board) return true;
  if (insert.phase !== existing.phase) return true;
  if (insert.channel !== existing.channel) return true;
  if (insert.progress !== existing.progress) return true;
  return false;
}

/**
 * Classifies one mapped row against its (possibly absent) existing DB match. Order matters:
 * - no match at all                                -> create.
 * - match is soft-deleted (a human removed it)      -> skipped_deleted, NEVER written - a
 *   re-run must not resurrect it as a duplicate, but it still occupies its source_ref key so
 *   the next run doesn't try to create it again either.
 * - match is live, `updateExisting` is off (default) -> existing, left as is - a re-run of the
 *   old export must never silently revert what a person changed in /tasks.
 * - match is live, `updateExisting` is on            -> update (a mapped field actually
 *   differs) or unchanged.
 */
export function planRow(
  insert: RoadmapInsert,
  existing: ExistingTaskForPlan | undefined,
  updateExisting: boolean,
  hasNewColumns: boolean,
): PlannedRow {
  if (!existing) return { kind: "create", insert };
  if (existing.deleted_at) return { kind: "skipped_deleted", insert, existingId: existing.id };
  if (!updateExisting) return { kind: "existing", insert, existingId: existing.id };
  if (!rowDiffers(insert, existing, hasNewColumns)) return { kind: "unchanged", insert, existingId: existing.id };
  return {
    kind: "update",
    insert,
    existingId: existing.id,
    editedSinceImport: existing.updated_at > existing.created_at,
  };
}

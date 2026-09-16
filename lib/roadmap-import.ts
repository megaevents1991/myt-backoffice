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

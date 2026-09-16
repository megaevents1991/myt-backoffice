/**
 * Pure grouping + counts for the /tasks Roadmap and Marketing tabs - the in-backoffice
 * replacement for the old standalone RoadMap app (Dor, 16.09: "צריך לייצר לנו כזה בתוך
 * הבקאופיס"). Roadmap = dev-board tasks by phase (1-7); Marketing = marketing-board tasks by
 * channel. No DOM, no Supabase - covered by scripts/roadmap-selftest.ts.
 */
import { CHANNEL_META, PHASES } from "@/lib/task-boards";
import {
  MKT_CHANNELS,
  PRIORITY_ORDER,
  type MktChannel,
  type TaskStatus,
  type TaskWithNames,
} from "@/types/task.types";

type RoadmapTask = Pick<TaskWithNames, "board" | "phase" | "channel" | "status" | "priority" | "progress" | "created_at">;

/** Cancelled work is off the map - it is neither done nor remaining. */
function onMap<T extends RoadmapTask>(tasks: T[], board: "dev" | "marketing"): T[] {
  return tasks.filter((task) => task.board === board && task.status !== "cancelled");
}

const STATUS_RANK: Record<TaskStatus, number> = {
  in_progress: 0,
  todo: 1,
  paused: 2,
  done: 3,
  cancelled: 4,
};

/** Inside a section: in progress first, done last; then priority; then oldest first. */
export function sortForMap<T extends RoadmapTask>(tasks: T[]): T[] {
  return [...tasks].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      a.created_at.localeCompare(b.created_at),
  );
}

export interface MapSection<T> {
  key: string;
  title: string;
  sub: string;
  tasks: T[];
  done: number;
  total: number;
  /** 0-100. Roadmap: share done. Marketing: mean task progress (done counts as 100). */
  percent: number;
}

export interface MapStats {
  total: number;
  inProgress: number;
  done: number;
  remaining: number;
}

export function mapStats(tasks: RoadmapTask[]): MapStats {
  const done = tasks.filter((task) => task.status === "done").length;
  return {
    total: tasks.length,
    inProgress: tasks.filter((task) => task.status === "in_progress").length,
    done,
    remaining: tasks.length - done,
  };
}

function donePercent(tasks: RoadmapTask[]): number {
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((task) => task.status === "done").length / tasks.length) * 100);
}

/** Mean progress, with a done task read as 100 whatever its slider says. */
export function meanProgress(tasks: RoadmapTask[]): number {
  if (!tasks.length) return 0;
  const sum = tasks.reduce((acc, task) => acc + (task.status === "done" ? 100 : (task.progress ?? 0)), 0);
  return Math.round(sum / tasks.length);
}

function section<T extends RoadmapTask>(
  key: string,
  title: string,
  sub: string,
  tasks: T[],
  percent: (tasks: T[]) => number,
): MapSection<T> {
  return {
    key,
    title,
    sub,
    tasks: sortForMap(tasks),
    done: tasks.filter((task) => task.status === "done").length,
    total: tasks.length,
    percent: percent(tasks),
  };
}

export const NO_GROUP_KEY = "none";

/** Every phase 1-7 always (an empty phase is still a place to add work), then
 *  "ללא פאזה" only when some dev task has no phase. */
export function roadmapSections<T extends RoadmapTask>(tasks: T[]): {
  stats: MapStats;
  sections: MapSection<T>[];
} {
  const dev = onMap(tasks, "dev");
  const sections = Object.entries(PHASES).map(([phase, meta]) =>
    section(phase, meta.name, meta.sub, dev.filter((task) => task.phase === Number(phase)), donePercent),
  );
  const loose = dev.filter((task) => task.phase == null || !PHASES[task.phase]);
  if (loose.length) sections.push(section(NO_GROUP_KEY, "ללא פאזה", "משימות פיתוח שלא שובצו לשלב", loose, donePercent));
  return { stats: mapStats(dev), sections };
}

export interface MarketingStats extends MapStats {
  avgProgress: number;
}

/** Every channel always, then "ללא ערוץ" only when needed. */
export function marketingSections<T extends RoadmapTask>(tasks: T[]): {
  stats: MarketingStats;
  sections: MapSection<T>[];
} {
  const mkt = onMap(tasks, "marketing");
  const sections = MKT_CHANNELS.map((channel: MktChannel) =>
    section(channel, CHANNEL_META[channel].label, "", mkt.filter((task) => task.channel === channel), meanProgress),
  );
  const loose = mkt.filter((task) => !task.channel);
  if (loose.length) sections.push(section(NO_GROUP_KEY, "ללא ערוץ", "משימות שיווק שלא שובצו לערוץ", loose, meanProgress));
  return { stats: { ...mapStats(mkt), avgProgress: meanProgress(mkt) }, sections };
}

/** System rows in the task thread. Written from the same server action that
 *  performs the change - a DB trigger would not know who the actor was. */
import { supabaseTyped } from "@/lib/supabase-server";
import type { ActivityField, TaskActivity } from "@/types/task-comment.types";

const db = supabaseTyped;

/** Column name in `tasks` → the field name shown in the thread. */
const TRACKED: Record<string, ActivityField> = {
  status: "status",
  assignee_id: "assignee",
  priority: "priority",
  due_date: "due_date",
  progress: "progress",
  board: "board",
};

function asText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

/** Pure: which tracked fields actually changed. Untracked keys are ignored. */
export function diffActivities(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): TaskActivity[] {
  const out: TaskActivity[] = [];
  for (const [column, field] of Object.entries(TRACKED)) {
    if (!(column in after)) continue;
    const from = asText(before[column]);
    const to = asText(after[column]);
    if (from === to) continue;
    out.push({ field, from, to });
  }
  return out;
}

/** Best-effort: a failed activity row never fails the change it describes. */
export async function recordActivity(
  taskId: string,
  actorId: string | null,
  activity: TaskActivity,
): Promise<void> {
  const { error } = await db.from("task_comments").insert({
    task_id: taskId,
    author_id: actorId,
    kind: "activity",
    activity,
  });
  if (error) console.error("task-activity: insert failed", JSON.stringify(error));
}

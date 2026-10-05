// lib/tasks/subtasks.ts
// One general task split into parts (createTask `parent_id` - one level, never deeper).
// Pure - no DB, no session, no React (scripts/kanban-selftest.ts).
import type { TaskStatus } from "@/types/task.types";

type Part = { status: TaskStatus };
type Node = { id: string; parent_id: string | null };

/** Sub-tasks that count toward "x of y done" - a cancelled part is no longer part of the job. */
export function subtaskProgress(parts: Part[]): { done: number; total: number } {
  const live = parts.filter((part) => part.status !== "cancelled");
  return { done: live.filter((part) => part.status === "done").length, total: live.length };
}

/** The parts of every general task, oldest first. Feed it the WHOLE board: a part assigned to
 *  someone else still counts toward its task's "x/y" when a filter hides it. */
export function partsByTask<T extends Node & { created_at: string }>(tasks: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const task of [...tasks].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!task.parent_id) continue;
    const list = map.get(task.parent_id) ?? [];
    list.push(task);
    map.set(task.parent_id, list);
  }
  return map;
}

/**
 * The cards of a screen that draws ONE card per general task - the Kanban and the Roadmap /
 * Marketing maps (Dor, 05.10: "תת משימה לא צריכה להופיע כמשימה לבדה"). A part is never a card
 * of its own: it stands in for the general task it belongs to. So a filter that matches only a
 * part - my part of someone else's task, under "המשימות שלי" - still shows that task (with its
 * x/y), and nothing of mine drops off the board. A part whose general task is not on the board
 * at all (deleted) stays a card: hiding it would lose the work.
 *
 * `visible` = what the screen's filters left, `all` = the whole board. Order follows `visible`.
 */
export function generalTasks<T extends Node>(visible: T[], all: T[]): T[] {
  const byId = new Map(all.map((task) => [task.id, task] as const));
  const seen = new Set<string>();
  const cards: T[] = [];
  for (const task of visible) {
    const card = (task.parent_id ? byId.get(task.parent_id) : undefined) ?? task;
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
  }
  return cards;
}

// scripts/kanban-selftest.ts - `npx tsx scripts/kanban-selftest.ts`
// Pure helper only - no DB, no session, no DOM. Same pattern as
// scripts/task-boards-selftest.ts / scripts/task-permissions-selftest.ts.
import {
  canDragCard,
  filterByBoard,
  groupTasks,
  parseBoardParam,
} from "../lib/tasks/kanban";
import { generalTasks, partsByTask, subtaskProgress } from "../lib/tasks/subtasks";
import type { TaskWithNames } from "../types/task.types";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function task(overrides: Partial<TaskWithNames>): TaskWithNames {
  return {
    id: "t1",
    title: "Task",
    description: null,
    status: "todo",
    priority: "medium",
    assignee_id: null,
    created_by: null,
    due_date: null,
    source: "manual",
    source_ref: null,
    deleted_at: null,
    completed_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    board: "ops",
    phase: null,
    channel: null,
    progress: null,
    parent_id: null,
    reviewer_ids: null,
    assignee_name: null,
    created_by_name: null,
    assigned_by: null,
    reviewer_names: [],
    site_url: null,
    comment_count: 0,
    unread_count: 0,
    late: false,
    last_reminded_at: null,
    ...overrides,
  };
}

// --- board param parsing --------------------------------------------------
check("board param: dev", parseBoardParam("dev"), "dev");
check("board param: marketing", parseBoardParam("marketing"), "marketing");
check("board param: ops", parseBoardParam("ops"), "ops");
check("board param: missing -> all", parseBoardParam(null), "all");
check("board param: empty -> all", parseBoardParam(""), "all");
check("board param: garbage -> all", parseBoardParam("engineering"), "all");

// --- board filter, one case per value -------------------------------------
const boardTasks = [
  task({ id: "d1", board: "dev" }),
  task({ id: "m1", board: "marketing" }),
  task({ id: "o1", board: "ops" }),
];
check("filter all keeps every board", filterByBoard(boardTasks, "all").map((t) => t.id), [
  "d1",
  "m1",
  "o1",
]);
check("filter dev", filterByBoard(boardTasks, "dev").map((t) => t.id), ["d1"]);
check("filter marketing", filterByBoard(boardTasks, "marketing").map((t) => t.id), ["m1"]);
check("filter ops", filterByBoard(boardTasks, "ops").map((t) => t.id), ["o1"]);

// --- grouping: none --------------------------------------------------------
check(
  "group none: single unlabeled lane",
  groupTasks(boardTasks, "none").map((g) => ({ key: g.key, label: g.label, ids: g.tasks.map((t) => t.id) })),
  [{ key: "all", label: "", ids: ["d1", "m1", "o1"] }],
);
check("group none: empty column -> no lanes", groupTasks([], "none"), []);

// --- grouping: phase, including the "none" bucket -------------------------
const phaseTasks = [
  task({ id: "p3a", phase: 3 }),
  task({ id: "p1a", phase: 1 }),
  task({ id: "p1b", phase: 1 }),
  task({ id: "pNone", phase: null }),
];
const byPhase = groupTasks(phaseTasks, "phase");
check(
  "group phase: order 1, 3, then none last",
  byPhase.map((g) => g.key),
  ["1", "3", "none"],
);
check(
  "group phase: labels come from PHASES / ללא פאזה",
  byPhase.map((g) => g.label),
  ["ליבה ותפעול", "עיצוב ו-UX", "ללא פאזה"],
);
check(
  "group phase: tasks land in the right lane",
  byPhase.map((g) => g.tasks.map((t) => t.id)),
  [["p1a", "p1b"], ["p3a"], ["pNone"]],
);

// --- grouping: assignee, including the "none" (unassigned) bucket ---------
const assigneeTasks = [
  task({ id: "aZoe", assignee_id: "u-zoe", assignee_name: "Zoe" }),
  task({ id: "aAmi1", assignee_id: "u-ami", assignee_name: "Ami" }),
  task({ id: "aAmi2", assignee_id: "u-ami", assignee_name: "Ami" }),
  task({ id: "aUnassigned", assignee_id: null }),
];
const byAssignee = groupTasks(assigneeTasks, "assignee");
check(
  "group assignee: alphabetical, unassigned last",
  byAssignee.map((g) => g.label),
  ["Ami", "Zoe", "לא משויך"],
);
check(
  "group assignee: tasks land in the right lane",
  byAssignee.map((g) => g.tasks.map((t) => t.id)),
  [["aAmi1", "aAmi2"], ["aZoe"], ["aUnassigned"]],
);

// --- card draggability: admin / editor-own / editor-other -----------------
check("drag: admin, any task", canDragCard("admin", false), true);
check("drag: superadmin, own task", canDragCard("superadmin", true), true);
check("drag: editor, own task", canDragCard("editor", true), true);
check("drag: editor, someone else's task", canDragCard("editor", false), false);

// --- one card per general task (lib/tasks/subtasks.ts) ---------------------
// Board: G1 with parts a (mine) and b; G2 with part c (mine); L = a plain task; orphan = a part
// whose general task is gone from the board.
const board = [
  task({ id: "G1", assignee_id: "alon", created_at: "2026-09-01T00:00:00Z" }),
  task({ id: "a", parent_id: "G1", assignee_id: "me", status: "done", created_at: "2026-09-03T00:00:00Z" }),
  task({ id: "b", parent_id: "G1", assignee_id: "tom", created_at: "2026-09-02T00:00:00Z" }),
  task({ id: "G2", assignee_id: "tom", created_at: "2026-09-04T00:00:00Z" }),
  task({ id: "c", parent_id: "G2", assignee_id: "me", status: "cancelled", created_at: "2026-09-05T00:00:00Z" }),
  task({ id: "L", assignee_id: "me", created_at: "2026-09-06T00:00:00Z" }),
  task({ id: "orphan", parent_id: "deleted-task", assignee_id: "me", created_at: "2026-09-07T00:00:00Z" }),
];
const ids = (list: { id: string }[]) => list.map((t) => t.id);

check("cards: the whole board -> general tasks only, no part is a card", ids(generalTasks(board, board)), [
  "G1",
  "G2",
  "L",
  "orphan",
]);
const mine = board.filter((t) => t.assignee_id === "me");
check(
  "cards: only my parts match -> their general tasks show, each once, in the filter's order",
  ids(generalTasks(mine, board)),
  ["G1", "G2", "L", "orphan"],
);
check(
  "cards: a general task and its own part both match -> one card",
  ids(generalTasks([board[0], board[1], board[2]], board)),
  ["G1"],
);
check("cards: a part whose general task is gone stays a card", ids(generalTasks([board[6]], board)), ["orphan"]);
check("cards: nothing visible -> nothing", generalTasks([], board), []);

const parts = partsByTask(board);
check("parts: grouped by general task, oldest first", ids(parts.get("G1") ?? []), ["b", "a"]);
check("parts: a plain task has none", parts.has("L"), false);
check("parts: an orphan is filed under its missing task, never under a real one", [...parts.keys()].sort(), [
  "G1",
  "G2",
  "deleted-task",
]);
check("progress: done of live parts", subtaskProgress(parts.get("G1") ?? []), { done: 1, total: 2 });
check("progress: a cancelled part is not part of the job", subtaskProgress(parts.get("G2") ?? []), {
  done: 0,
  total: 0,
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

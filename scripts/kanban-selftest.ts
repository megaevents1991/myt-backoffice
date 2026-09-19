// scripts/kanban-selftest.ts - `npx tsx scripts/kanban-selftest.ts`
// Pure helper only - no DB, no session, no DOM. Same pattern as
// scripts/task-boards-selftest.ts / scripts/task-permissions-selftest.ts.
import {
  canDragCard,
  filterByBoard,
  groupTasks,
  parseBoardParam,
} from "../lib/tasks/kanban";
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
    assignee_name: null,
    created_by_name: null,
    comment_count: 0,
    unread_count: 0,
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

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

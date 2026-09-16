// scripts/roadmap-selftest.ts - `npx tsx scripts/roadmap-selftest.ts`
// Pure helper only - no DB, no session, no DOM. Same pattern as scripts/kanban-selftest.ts.
import { marketingSections, meanProgress, roadmapSections, sortForMap } from "../lib/tasks/roadmap";
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

type T = Pick<TaskWithNames, "board" | "phase" | "channel" | "status" | "priority" | "progress" | "created_at"> & {
  id: string;
};
let seq = 0;
function task(overrides: Partial<T>): T {
  seq++;
  return {
    id: `t${seq}`,
    board: "dev",
    phase: null,
    channel: null,
    status: "todo",
    priority: "medium",
    progress: 0,
    created_at: `2026-09-${String(seq).padStart(2, "0")}T00:00:00Z`,
    ...overrides,
  };
}

// --- roadmap ----------------------------------------------------------------
const dev = [
  task({ id: "a", phase: 1, status: "done" }),
  task({ id: "b", phase: 1, status: "todo", priority: "urgent" }),
  task({ id: "c", phase: 1, status: "in_progress", priority: "low" }),
  task({ id: "d", phase: 1, status: "cancelled" }),
  task({ id: "e", phase: 3 }),
  task({ id: "f", phase: null }),
  task({ id: "g", board: "ops", phase: 1 }),
  task({ id: "h", board: "marketing", channel: "seo" }),
];
const rm = roadmapSections(dev);
check("roadmap: 7 phases + no-phase section", rm.sections.map((s) => s.key), ["1", "2", "3", "4", "5", "6", "7", "none"]);
check("roadmap: phase 1 skips cancelled and other boards", rm.sections[0].tasks.map((t) => t.id), ["c", "b", "a"]);
check("roadmap: phase 1 done/total/percent", [rm.sections[0].done, rm.sections[0].total, rm.sections[0].percent], [1, 3, 33]);
check("roadmap: empty phase is 0%", [rm.sections[1].total, rm.sections[1].percent], [0, 0]);
check("roadmap: stats over dev only", rm.stats, { total: 5, inProgress: 1, done: 1, remaining: 4 });
check(
  "roadmap: no no-phase section when every task has one",
  roadmapSections([task({ phase: 2 })]).sections.map((s) => s.key).includes("none"),
  false,
);

// --- marketing --------------------------------------------------------------
const mkt = [
  task({ board: "marketing", channel: "seo", progress: 40 }),
  task({ board: "marketing", channel: "seo", status: "done", progress: 10 }),
  task({ board: "marketing", channel: null, progress: 20 }),
  task({ board: "dev", phase: 1 }),
];
const mk = marketingSections(mkt);
check("marketing: 7 channels + no-channel section", mk.sections.length, 8);
const seo = mk.sections.find((s) => s.key === "seo");
check("marketing: seo percent reads done as 100", seo?.percent, 70);
check("marketing: stats", mk.stats, { total: 3, inProgress: 0, done: 1, remaining: 2, avgProgress: 53 });
check("meanProgress: empty is 0", meanProgress([]), 0);

// --- ordering ---------------------------------------------------------------
const order = sortForMap([
  task({ id: "x", status: "done", priority: "urgent" }),
  task({ id: "y", status: "todo", priority: "low" }),
  task({ id: "z", status: "todo", priority: "high" }),
  task({ id: "w", status: "in_progress", priority: "low" }),
]);
check("sort: in progress, then todo by priority, done last", order.map((t) => t.id), ["w", "z", "y", "x"]);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

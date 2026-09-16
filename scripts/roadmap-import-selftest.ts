// scripts/roadmap-import-selftest.ts - `npx tsx scripts/roadmap-import-selftest.ts`
import { mapDevTask, mapMktTask } from "../lib/roadmap-import";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const users = new Map([["dor", "u-dor"], ["tom", "u-tom"]]);

check("dev task", mapDevTask({ id: 7, title: "Flights", ph: 1, pri: "critical", st: "inprogress", as: "dor", desc: "d" }, users), {
  title: "Flights", description: "d", status: "in_progress", priority: "urgent",
  assignee_id: "u-dor", board: "dev", phase: 1, channel: null, progress: null,
  source: "roadmap",
  source_ref: { kind: "roadmap_dev", table: "roadmap", row_id: 7, label: "Flights", url: "/tasks" },
});

check("mkt task", mapMktTask({ id: "m3", title: "Newsletter", ch: "email", pri: "medium", st: "paused", as: "tom", prog: 40, desc: "" }, users), {
  title: "Newsletter", description: null, status: "paused", priority: "medium",
  assignee_id: "u-tom", board: "marketing", phase: null, channel: "email", progress: 40,
  source: "roadmap",
  source_ref: { kind: "roadmap_mkt", table: "roadmap", row_id: "m3", label: "Newsletter", url: "/tasks" },
});

check("planning maps to todo", mapMktTask({ id: "m4", title: "X", ch: "seo", pri: "low", st: "planning", as: null, prog: 0, desc: "" }, users).status, "todo");
check("active maps to in_progress", mapMktTask({ id: "m5", title: "Y", ch: "ads", pri: "low", st: "active", as: null, prog: 0, desc: "" }, users).status, "in_progress");
check("unassigned stays null", mapDevTask({ id: 8, title: "Z", ph: 3, pri: "low", st: "todo", as: null, desc: "" }, users).assignee_id, null);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

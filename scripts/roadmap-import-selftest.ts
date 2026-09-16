// scripts/roadmap-import-selftest.ts - `npx tsx scripts/roadmap-import-selftest.ts`
import { mapDevTask, mapMktTask, planRow, type ExistingTaskForPlan } from "../lib/roadmap-import";

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

// ---- planRow: create-only default, deleted rows never touched, edited-since-import warning ----

const plannedInsert = mapDevTask({ id: 10, title: "T", ph: 1, pri: "high", st: "todo", as: null, desc: "" }, users);

const deletedExisting: ExistingTaskForPlan = {
  id: "e1", title: "T", description: null, status: "todo", priority: "high", assignee_id: null,
  board: null, phase: null, channel: null, progress: null,
  deleted_at: "2026-09-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
check("deleted row is skipped, never recreated or written", planRow(plannedInsert, deletedExisting, true, false).kind, "skipped_deleted");

const liveExisting: ExistingTaskForPlan = {
  id: "e2", title: "OLD TITLE", description: null, status: "todo", priority: "high", assignee_id: null,
  board: null, phase: null, channel: null, progress: null,
  deleted_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
check("live row without --update-existing is left as is (create-only default)", planRow(plannedInsert, liveExisting, false, false).kind, "existing");
check("live row with --update-existing and a difference becomes an update", planRow(plannedInsert, liveExisting, true, false).kind, "update");

const unchangedExisting: ExistingTaskForPlan = {
  id: "e3",
  title: plannedInsert.title, description: plannedInsert.description, status: plannedInsert.status,
  priority: plannedInsert.priority, assignee_id: plannedInsert.assignee_id,
  board: null, phase: null, channel: null, progress: null,
  deleted_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
check("live row with --update-existing and no difference is unchanged", planRow(plannedInsert, unchangedExisting, true, false).kind, "unchanged");

const editedExisting: ExistingTaskForPlan = { ...liveExisting, updated_at: "2026-02-01T00:00:00.000Z" };
check("an update whose updated_at is later than created_at is flagged edited-since-import", planRow(plannedInsert, editedExisting, true, false).editedSinceImport, true);
check("an update whose updated_at equals created_at is NOT flagged edited-since-import", planRow(plannedInsert, liveExisting, true, false).editedSinceImport, false);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

// scripts/task-thread-selftest.ts - `npx tsx scripts/task-thread-selftest.ts`
// Pure helpers only: the DB paths are verified in the browser.
import { diffActivities } from "../lib/services/task-activity";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

check("status change", diffActivities({ status: "todo" }, { status: "in_progress" }),
  [{ field: "status", from: "todo", to: "in_progress" }]);
check("no change", diffActivities({ status: "todo" }, { status: "todo" }), []);
check("assignee cleared", diffActivities({ assignee_id: "u1" }, { assignee_id: null }),
  [{ field: "assignee", from: "u1", to: null }]);
check("two fields", diffActivities({ priority: "low", due_date: null }, { priority: "urgent", due_date: "2026-09-20" }),
  [{ field: "priority", from: "low", to: "urgent" }, { field: "due_date", from: null, to: "2026-09-20" }]);
check("untracked field ignored", diffActivities({ title: "a" }, { title: "b" }), []);
check("number to string", diffActivities({ progress: 10 }, { progress: 60 }),
  [{ field: "progress", from: "10", to: "60" }]);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

// scripts/task-permissions-selftest.ts - `npx tsx scripts/task-permissions-selftest.ts`
// Pure helper only - no DB, no session. Covers the three cases the whole
// feature rests on, for every field: admin (any task), editor (own task),
// editor (someone else's task).
import { canEditTaskField, TASK_FIELDS, type EditableTaskField } from "../lib/tasks/permissions";

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

const EDITOR_OWN: EditableTaskField[] = ["status", "progress"];

for (const field of TASK_FIELDS) {
  // Admins edit everything, on any task, whichever admin role.
  check(`admin / any task / ${field}`, canEditTaskField("admin", false, field), true);
  check(`superadmin / own task / ${field}`, canEditTaskField("superadmin", true, field), true);

  // Editor on their OWN task: only status + progress.
  const shouldOwn = EDITOR_OWN.includes(field);
  check(`editor / own task / ${field}`, canEditTaskField("editor", true, field), shouldOwn);

  // Editor on someone ELSE's task: nothing at all.
  check(`editor / other's task / ${field}`, canEditTaskField("editor", false, field), false);
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

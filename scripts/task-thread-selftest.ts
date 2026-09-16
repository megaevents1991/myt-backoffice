// scripts/task-thread-selftest.ts - `npx tsx scripts/task-thread-selftest.ts`
// Pure helpers only: the DB paths are verified in the browser.
import { randomUUID } from "crypto";
import { diffActivities } from "../lib/services/task-activity";
import { isValidTaskAttachmentPath } from "../lib/tasks/attachment-path";
import { mentionsStillInBody } from "../lib/tasks/mentions";

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

// Attachment path validation: reject traversals, nested dirs, non-strings; accept valid paths
const taskId = "task-123";
check("path rejects traversal", isValidTaskAttachmentPath(taskId, `${taskId}/../other/x.png`), false);
check("path rejects absolute", isValidTaskAttachmentPath(taskId, "/etc/passwd"), false);
check("path rejects nested dirs", isValidTaskAttachmentPath(taskId, `${taskId}/sub/dir/x.png`), false);
check("path rejects non-string", isValidTaskAttachmentPath(taskId, 123), false);
check("path accepts valid uuid", isValidTaskAttachmentPath(taskId, `${taskId}/3f9a-uuid.png`), true);
check("path accepts uuid-like name", isValidTaskAttachmentPath(taskId, `${taskId}/a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6.png`), true);
// The real upload path: taskId/{randomUUID()}.{ext} - confirms a genuine
// crypto.randomUUID() (hyphens + lowercase hex) fits the accepted shape.
check("path accepts real randomUUID", isValidTaskAttachmentPath(taskId, `${taskId}/${randomUUID()}.png`), true);

// Mention pruning: keep only IDs whose @<label> still appears in the body
check("mention kept when label present", mentionsStillInBody("@Tom said hi", [{ id: "id1", label: "Tom" }]), ["id1"]);
check("mention dropped when label removed", mentionsStillInBody("said hi", [{ id: "id1", label: "Tom" }]), []);
check("two people, one removed",
  mentionsStillInBody("@Alice said @Bob replied", [{ id: "id1", label: "Alice" }, { id: "id2", label: "Bob" }]),
  ["id1", "id2"]);
check("two people, one removed v2",
  mentionsStillInBody("@Alice said", [{ id: "id1", label: "Alice" }, { id: "id2", label: "Bob" }]),
  ["id1"]);
// Edge case: @Dor vs @Doron - word boundary prevents matching "@Dor" inside "@Doron"
check("prefix label does not match longer name",
  mentionsStillInBody("@Doron replied", [{ id: "id1", label: "Dor" }, { id: "id2", label: "Doron" }]),
  ["id2"]);
check("both Dor and Doron present",
  mentionsStillInBody("@Dor and @Doron replied", [{ id: "id1", label: "Dor" }, { id: "id2", label: "Doron" }]),
  ["id1", "id2"]);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

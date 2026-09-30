// scripts/task-thread-selftest.ts - `npx tsx scripts/task-thread-selftest.ts`
// Pure helpers only: the DB paths are verified in the browser.
import { randomUUID } from "crypto";
import { diffActivities } from "../lib/services/task-activity";
import { isValidTaskAttachmentPath } from "../lib/tasks/attachment-path";
import { mentionsStillInBody } from "../lib/tasks/mentions";
import { assignedByMap, matchesOwner, type AssigneeChangeRow } from "../lib/tasks/owner-filter";
import { awaitsReviewBy, canChangeStatus, reviewMove, reviewersOf } from "../lib/tasks/review";
import type { TaskStatus } from "../types/task.types";
import {
  commentMailTargets,
  threadParticipants,
  unreadCounts,
  type ThreadCommentRow,
  type ThreadTask,
} from "../lib/tasks/thread-watch";

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

// Hebrew names: Unicode lookarounds handle Hebrew letters correctly
check("Hebrew label kept",
  mentionsStillInBody("שלום @תומס מה נשמע", [{ id: "id1", label: "תומס" }]),
  ["id1"]);
check("Hebrew label at end of body",
  mentionsStillInBody("תודה @תומס", [{ id: "id1", label: "תומס" }]),
  ["id1"]);
check("Hebrew label followed by punctuation",
  mentionsStillInBody("@תומס, תבדוק", [{ id: "id1", label: "תומס" }]),
  ["id1"]);
check("Hebrew prefix collision",
  mentionsStillInBody("@דורון תבדוק", [{ id: "id1", label: "דור" }, { id: "id2", label: "דורון" }]),
  ["id2"]);
check("mixed English and Hebrew",
  mentionsStillInBody("@Tom (Ops) ו-@תומס", [{ id: "id1", label: "Tom (Ops)" }, { id: "id2", label: "תומס" }]),
  ["id1", "id2"]);

// --- thread-watch: who a conversation belongs to, and what one person has not read ---
const watched: ThreadTask = { id: "t1", created_by: "dor", assignee_id: "alon" };
const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`;
function comment(author: string | null, day: number, mentions: string[] = [], taskId = "t1"): ThreadCommentRow {
  return { task_id: taskId, author_id: author, created_at: at(day), mentions };
}

check("participants: creator + assignee with no comments", [...threadParticipants(watched, [])].sort(), ["alon", "dor"]);
check("participants: writers and the mentioned join",
  [...threadParticipants(watched, [comment("tom", 1, ["rina"]), comment(null, 2)])].sort(),
  ["alon", "dor", "rina", "tom"]);

check("mail: first comment by the creator reaches the assignee only",
  commentMailTargets({ task: watched, earlier: [], authorId: "dor", mentionedIds: [] }), ["alon"]);
check("mail: a reply reaches an earlier writer who is neither creator nor assignee",
  commentMailTargets({ task: watched, earlier: [comment("tom", 1)], authorId: "alon", mentionedIds: [] }).sort(),
  ["dor", "tom"]);
check("mail: someone this comment mentions is left to the mention mail",
  commentMailTargets({ task: watched, earlier: [comment("tom", 1)], authorId: "alon", mentionedIds: ["tom"] }),
  ["dor"]);
check("mail: someone mentioned earlier is part of the thread",
  commentMailTargets({ task: watched, earlier: [comment("dor", 1, ["rina"])], authorId: "dor", mentionedIds: [] }).sort(),
  ["alon", "rina"]);
check("mail: a rule-made task with no people reaches nobody on its first comment",
  commentMailTargets({ task: { id: "t9", created_by: null, assignee_id: null }, earlier: [], authorId: "dor", mentionedIds: [] }),
  []);

const talk = [comment("alon", 1), comment("dor", 2), comment("alon", 3)];
check("unread: never opened = every comment by someone else",
  [...unreadCounts({ userId: "dor", tasks: [watched], comments: talk, lastReadAt: new Map() })], [["t1", 2]]);
check("unread: only what came after the last read",
  [...unreadCounts({ userId: "dor", tasks: [watched], comments: talk, lastReadAt: new Map([["t1", at(2)]]) })],
  [["t1", 1]]);
check("unread: all read = the task is left out",
  [...unreadCounts({ userId: "dor", tasks: [watched], comments: talk, lastReadAt: new Map([["t1", at(4)]]) })], []);
check("unread: my own comments never count",
  [...unreadCounts({ userId: "alon", tasks: [watched], comments: [comment("alon", 1)], lastReadAt: new Map() })], []);
check("unread: a task I am not part of stays quiet",
  [...unreadCounts({ userId: "tom", tasks: [watched], comments: talk, lastReadAt: new Map() })], []);
check("unread: a mention makes me part of it",
  [...unreadCounts({ userId: "tom", tasks: [watched], comments: [comment("dor", 1, ["tom"])], lastReadAt: new Map() })],
  [["t1", 1]]);
check("unread: comments stay with their own task",
  [...unreadCounts({
    userId: "dor",
    tasks: [watched, { id: "t2", created_by: "dor", assignee_id: null }],
    comments: [comment("alon", 1), comment("alon", 1, [], "t2"), comment("alon", 2, [], "t2")],
    lastReadAt: new Map([["t1", at(5)]]),
  })],
  [["t2", 2]]);

// --- owner-filter: who handed a task to its current owner, and whose tasks a filter shows ---
const change = (task: string, author: string | null, to: string | null, day: number): AssigneeChangeRow => ({
  task_id: task,
  author_id: author,
  created_at: at(day),
  activity: { field: "assignee", to },
});
check("assigned by: the creator, when the form assigned it (no activity row)",
  [...assignedByMap([{ id: "t1", assignee_id: "alon", created_by: "dor" }], [])], [["t1", "dor"]]);
check("assigned by: whoever re-assigned it last, not the creator",
  [...assignedByMap([{ id: "t1", assignee_id: "tom", created_by: "dor" }],
    [change("t1", "rina", "alon", 1), change("t1", "liz", "tom", 2)])],
  [["t1", "liz"]]);
check("assigned by: a bulk-assigned rule task has no creator, the admin still owns the hand-off",
  [...assignedByMap([{ id: "t1", assignee_id: "tom", created_by: null }], [change("t1", "alon", "tom", 1)])],
  [["t1", "alon"]]);
check("assigned by: a change to someone who no longer owns it does not count",
  [...assignedByMap([{ id: "t1", assignee_id: "alon", created_by: "dor" }], [change("t1", "liz", "tom", 3)])],
  [["t1", "dor"]]);
check("assigned by: unassigned, and a rule's own assignee, are nobody's hand-off",
  [...assignedByMap([
    { id: "t1", assignee_id: null, created_by: "dor" },
    { id: "t2", assignee_id: "tom", created_by: null },
  ], [change("t1", "dor", null, 1)])],
  []);

const owned = (
  assignee: string | null,
  by: string | null,
  status: TaskStatus = "todo",
  creator: string | null = null,
  reviewers: string[] | null = null,
) => ({ assignee_id: assignee, assigned_by: by, status, created_by: creator, reviewer_ids: reviewers });
check("owner: all shows everything", matchesOwner(owned(null, null), "all", "dor"), true);
check("owner: mine = assigned to me", [matchesOwner(owned("dor", "alon"), "mine", "dor"), matchesOwner(owned("alon", "dor"), "mine", "dor")], [true, false]);
check("owner: delegated = I assigned it to someone else",
  [
    matchesOwner(owned("alon", "dor"), "delegated", "dor"),
    matchesOwner(owned("dor", "dor"), "delegated", "dor"), // my own task is not "handed to others"
    matchesOwner(owned("alon", "tom"), "delegated", "dor"), // someone else's hand-off
    matchesOwner(owned(null, null), "delegated", "dor"),
  ],
  [true, false, false, false]);
check("owner: one person's tasks", [matchesOwner(owned("alon", null), "user:alon", "dor"), matchesOwner(owned("tom", null), "user:alon", "dor")], [true, false]);
check("owner: unassigned", [matchesOwner(owned(null, null), "unassigned", "dor"), matchesOwner(owned("alon", null), "unassigned", "dor")], [true, false]);
check("owner: no session shows nothing of 'mine'", matchesOwner(owned(null, null), "mine", null), false);

// --- review: the owner hands the task back to whoever opened it ---
check("reviewers: the creator", reviewersOf({ created_by: "dor", assigned_by: "alon", reviewer_ids: null }), ["dor"]);
check("reviewers: a rule-made task goes to whoever assigned it", reviewersOf({ created_by: null, assigned_by: "alon", reviewer_ids: [] }), ["alon"]);
check("reviewers: nobody opened it, nobody assigned it", reviewersOf({ created_by: null, assigned_by: null, reviewer_ids: null }), []);
check("reviewers: picked ones replace the creator (Alon opened it, Tom looks at it)",
  reviewersOf({ created_by: "alon", assigned_by: null, reviewer_ids: ["tom"] }), ["tom"]);
check("reviewers: or both, once each",
  reviewersOf({ created_by: "alon", assigned_by: null, reviewer_ids: ["alon", "tom", "tom"] }), ["alon", "tom"]);
check("awaits review: a picked reviewer, not the creator who was replaced",
  [
    awaitsReviewBy(owned("liz", "alon", "review", "alon", ["tom"]), "tom"),
    awaitsReviewBy(owned("liz", "alon", "review", "alon", ["tom"]), "alon"),
  ],
  [true, false]);
check("status: a picked reviewer may move it while it waits",
  canChangeStatus("editor", owned("liz", null, "review", "alon", ["tom"]), "tom"), true);
check("awaits review: only in review, only for the reviewer",
  [
    awaitsReviewBy(owned("tom", "dor", "review", "dor"), "dor"),
    awaitsReviewBy(owned("tom", "dor", "in_progress", "dor"), "dor"),
    awaitsReviewBy(owned("tom", "dor", "review", "dor"), "tom"),
    awaitsReviewBy(owned("tom", "dor", "review", "dor"), null),
  ],
  [true, false, false, false]);
check("owner: a task in review comes back into its creator's 'mine'",
  [
    matchesOwner(owned("tom", "dor", "review", "dor"), "mine", "dor"),
    matchesOwner(owned("tom", "dor", "in_progress", "dor"), "mine", "dor"),
    matchesOwner(owned("tom", "dor", "review", "dor"), "mine", "tom"), // still the owner's too
  ],
  [true, false, true]);
check("status: admin anywhere, editor on own task, reviewer only while it waits for them",
  [
    canChangeStatus("admin", owned("tom", null), "alon"),
    canChangeStatus("editor", owned("tom", null), "tom"),
    canChangeStatus("editor", owned("tom", null, "review", "liz"), "liz"),
    canChangeStatus("editor", owned("tom", null, "in_progress", "liz"), "liz"),
    canChangeStatus("editor", owned("tom", null, "review", "liz"), "rina"),
    canChangeStatus("editor", owned("tom", null, "review", "liz"), null),
  ],
  [true, true, true, false, false, false]);
check("review move: into review, approved, returned, and everything else",
  [
    reviewMove("in_progress", "review"),
    reviewMove(null, "review"),
    reviewMove("review", "review"),
    reviewMove("review", "done"),
    reviewMove("review", "in_progress"),
    reviewMove("review", "todo"),
    reviewMove("review", "cancelled"),
    reviewMove("in_progress", "done"),
  ],
  ["sent", "sent", null, "approved", "returned", "returned", null, null]);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

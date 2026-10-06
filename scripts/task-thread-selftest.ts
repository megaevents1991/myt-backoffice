// scripts/task-thread-selftest.ts - `npx tsx scripts/task-thread-selftest.ts`
// Pure helpers only: the DB paths are verified in the browser.
import { randomUUID } from "crypto";
import { diffActivities } from "../lib/services/task-activity";
import { isValidTaskAttachmentPath } from "../lib/tasks/attachment-path";
import {
  insertImageToken,
  removeImageToken,
  renumberImageTokens,
  splitInlineImages,
} from "../lib/tasks/inline-images";
import { mentionsStillInBody } from "../lib/tasks/mentions";
import { assignedByMap, matchesOwner, type AssigneeChangeRow } from "../lib/tasks/owner-filter";
import {
  TASK_VIEWS,
  awaitsReviewBy,
  canChangeStatus,
  inTaskView,
  isTaskView,
  reviewMove,
  reviewRank,
  reviewersOf,
  taskViewOf,
} from "../lib/tasks/review";
import {
  assignedAtMap,
  canRemind,
  daysLate,
  israelDate,
  lateWithoutAnswer,
  overdueAlertDue,
  reminderCoolingDown,
  reminderTargets,
} from "../lib/tasks/reminders";
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

// --- the table's piles (05.10): a task in review leaves "Open" and waits under "In review" ---
const ALL_STATUSES: TaskStatus[] = ["todo", "in_progress", "paused", "review", "done", "cancelled"];
check("views: the pile of every status",
  ALL_STATUSES.map((status) => taskViewOf(status)),
  ["open", "open", "open", "review", "done", "done"]);
check("views: a task in review is not in Open any more",
  [inTaskView("review", "open"), inTaskView("review", "review"), inTaskView("review", "done"), inTaskView("review", "all")],
  [false, true, false, true]);
check("views: Open is the work still to do",
  ALL_STATUSES.filter((status) => inTaskView(status, "open")), ["todo", "in_progress", "paused"]);
check("views: every status sits in exactly one pile, and All shows everything",
  ALL_STATUSES.map((status) => [
    TASK_VIEWS.filter((view) => view !== "all" && inTaskView(status, view)).length,
    inTaskView(status, "all"),
  ]),
  ALL_STATUSES.map(() => [1, true]));
check("views: only a known view comes off the URL",
  [isTaskView("review"), isTaskView("open"), isTaskView("hacked"), isTaskView(null)], [true, true, false, false]);
check("review pile: what waits for MY check comes first",
  [
    { id: "theirs", ...owned("tom", null, "review", "alon") },
    { id: "mine", ...owned("tom", null, "review", "dor") },
    { id: "picked", ...owned("liz", null, "review", "alon", ["dor"]) },
    { id: "sent-by-me", ...owned("dor", null, "review", "alon") },
  ]
    .sort((a, b) => reviewRank(a, "dor") - reviewRank(b, "dor"))
    .map((task) => task.id),
  ["mine", "picked", "theirs", "sent-by-me"]);
check("review pile: nobody signed in = no one's check comes first",
  reviewRank(owned("tom", null, "review", "dor"), null), 1);

// --- reminders (01.10): the button, and "late with no answer" raised to whoever opened it ---
check("israel date: 23:30 UTC is already tomorrow in Israel", israelDate("2026-09-30T23:30:00Z"), "2026-10-01");
check("israel date: 20:00 UTC is still today", israelDate("2026-09-30T20:00:00Z"), "2026-09-30");
check("days late", [daysLate("2026-09-26", "2026-10-01"), daysLate("2026-10-01", "2026-10-01"), daysLate("2026-10-03", "2026-10-01")], [5, 0, -2]);
check("remind targets: the assignee while it is theirs, the reviewers while it waits, nobody when closed",
  [
    reminderTargets(owned("tom", "dor", "in_progress", "dor")),
    reminderTargets(owned("tom", "dor", "review", "dor", ["alon"])),
    reminderTargets(owned("tom", "dor", "review", "dor")),
    reminderTargets(owned("tom", "dor", "done", "dor")),
    reminderTargets(owned(null, null, "todo", "dor")),
  ],
  [["tom"], ["alon"], ["dor"], [], []]);
check("can remind: the opener, the assigner, an admin; not a bystander; not yourself",
  [
    canRemind("editor", owned("tom", null, "todo", "liz"), "liz"), // opened it
    canRemind("editor", owned("tom", "rina", "todo", null), "rina"), // assigned it
    canRemind("admin", owned("tom", null, "todo", "liz"), "dor"), // admin
    canRemind("editor", owned("tom", null, "todo", "liz"), "rina"), // nothing to do with it
    canRemind("editor", owned("tom", null, "todo", "liz"), "tom"), // the only target is me
    canRemind("editor", owned("tom", null, "done", "liz"), "liz"), // closed
  ],
  [true, true, true, false, false, false]);
check("can remind: in review the owner reminds the reviewer (\"I got no answer\")",
  canRemind("editor", owned("tom", null, "review", "liz"), "tom"), true);
check("cooldown: an hour", [
  reminderCoolingDown("2026-10-01T10:00:00Z", new Date("2026-10-01T10:30:00Z")),
  reminderCoolingDown("2026-10-01T10:00:00Z", new Date("2026-10-01T11:01:00Z")),
  reminderCoolingDown(null, new Date("2026-10-01T10:30:00Z")),
], [true, false, false]);

const lateTask = (over: Partial<ReturnType<typeof owned> & { due_date: string | null }> = {}) => ({
  ...owned("tom", null, "in_progress", "liz"),
  due_date: "2026-09-26" as string | null,
  ...over,
});
const TODAY = "2026-10-01";
check("late: past the deadline, the assignee silent since -> late", lateWithoutAnswer({
  task: lateTask(), assignedAt: "2026-09-20T08:00:00Z", events: [{ author_id: "tom", created_at: "2026-09-21T08:00:00Z" }], today: TODAY,
}), true);
check("late: the assignee wrote on the due day -> answered", lateWithoutAnswer({
  task: lateTask(), assignedAt: "2026-09-20T08:00:00Z", events: [{ author_id: "tom", created_at: "2026-09-26T09:00:00Z" }], today: TODAY,
}), false);
check("late: someone ELSE writing is not the assignee's answer", lateWithoutAnswer({
  task: lateTask(), assignedAt: "2026-09-20T08:00:00Z", events: [{ author_id: "liz", created_at: "2026-09-29T09:00:00Z" }], today: TODAY,
}), true);
check("late: due today, or no due date -> not late", [
  lateWithoutAnswer({ task: lateTask({ due_date: TODAY }), assignedAt: "2026-09-20T08:00:00Z", events: [], today: TODAY }),
  lateWithoutAnswer({ task: lateTask({ due_date: null }), assignedAt: "2026-09-20T08:00:00Z", events: [], today: TODAY }),
], [false, false]);
check("late: in review / done -> the assignee already answered", [
  lateWithoutAnswer({ task: lateTask({ status: "review" }), assignedAt: "2026-09-20T08:00:00Z", events: [], today: TODAY }),
  lateWithoutAnswer({ task: lateTask({ status: "done" }), assignedAt: "2026-09-20T08:00:00Z", events: [], today: TODAY }),
], [false, false]);
check("late: a task I opened for myself is never raised to me", lateWithoutAnswer({
  task: lateTask({ assignee_id: "liz" }), assignedAt: "2026-09-20T08:00:00Z", events: [], today: TODAY,
}), false);
check("late: handed over today -> they get until tonight; handed over yesterday and silent -> late", [
  lateWithoutAnswer({ task: lateTask(), assignedAt: "2026-10-01T07:00:00Z", events: [], today: TODAY }),
  lateWithoutAnswer({ task: lateTask(), assignedAt: "2026-09-30T07:00:00Z", events: [], today: TODAY }),
], [false, true]);
check("late: an answer from before it reached the current owner does not count", lateWithoutAnswer({
  task: lateTask(), assignedAt: "2026-09-28T08:00:00Z", events: [{ author_id: "tom", created_at: "2026-09-27T08:00:00Z" }], today: TODAY,
}), true);
check("late: a rule task nobody opened goes to whoever assigned it, else nobody", [
  lateWithoutAnswer({ task: lateTask({ created_by: null, assigned_by: "alon" }), assignedAt: "2026-09-20T08:00:00Z", events: [], today: TODAY }),
  lateWithoutAnswer({ task: lateTask({ created_by: null, assigned_by: null }), assignedAt: "2026-09-20T08:00:00Z", events: [], today: TODAY }),
], [true, false]);
check("assigned at: the newest change to the current owner, else creation",
  [...assignedAtMap(
    [
      { id: "t1", assignee_id: "tom", created_at: "2026-09-01T00:00:00Z" },
      { id: "t2", assignee_id: "tom", created_at: "2026-09-02T00:00:00Z" },
    ],
    [change("t1", "dor", "alon", 3), change("t1", "dor", "tom", 4), change("t1", "dor", "tom", 5)],
  )],
  [["t1", at(5)], ["t2", "2026-09-02T00:00:00Z"]]);
check("overdue alert: first time at once, again only after three days", [
  overdueAlertDue(null, new Date("2026-10-01T06:30:00Z")),
  overdueAlertDue("2026-09-30T06:30:00Z", new Date("2026-10-01T06:30:00Z")),
  overdueAlertDue("2026-09-28T06:30:00Z", new Date("2026-10-01T06:30:00Z")),
], [true, false, true]);
check("owner: late = tasks I opened that are late", [
  matchesOwner({ ...owned("tom", null, "todo", "liz"), late: true }, "late", "liz"),
  matchesOwner({ ...owned("tom", null, "todo", "liz"), late: true }, "late", "tom"),
  matchesOwner({ ...owned("tom", null, "todo", "liz"), late: false }, "late", "liz"),
  matchesOwner({ ...owned("tom", "alon", "todo", null), late: true }, "late", "alon"),
], [true, false, false, true]);

// ── pictures inside a comment (lib/tasks/inline-images.ts) ──────────────────
check("picture: marker goes in under the line being written",
  insertImageToken("שורה ראשונה\nשורה שנייה", 11, 1),
  { body: "שורה ראשונה\n[תמונה 1]\nשורה שנייה", cursor: 22 });
check("picture: marker in an empty box", insertImageToken("", 0, 1), { body: "[תמונה 1]\n", cursor: 10 });
check("picture: marker at the end of the text", insertImageToken("ראה כאן", 99, 2).body, "ראה כאן\n[תמונה 2]\n");
check("picture: removed picture takes its line with it",
  removeImageToken("לפני\n[תמונה 1]\nאחרי\n[תמונה 2]\n", 1), "לפני\nאחרי\n[תמונה 2]\n");
check("picture: a marker typed inside a sentence is removed too",
  removeImageToken("ראה [תמונה 3] כאן", 3), "ראה  כאן");
check("picture: composer numbers become positions, in one pass",
  renumberImageTokens("[תמונה 2]\nטקסט\n[תמונה 3]\n[תמונה 9]", new Map([[2, 1], [3, 2]])),
  "[תמונה 1]\nטקסט\n[תמונה 2]\n[תמונה 9]");
check("picture: a comment is cut at its markers",
  splitInlineImages("כך זה נראה:\n[תמונה 1]\nוכך צריך:\n[תמונה 2]\nתודה", [true, true]).parts,
  [
    { kind: "text", text: "כך זה נראה:" },
    { kind: "image", index: 0 },
    { kind: "text", text: "וכך צריך:" },
    { kind: "image", index: 1 },
    { kind: "text", text: "תודה" },
  ]);
const mixed = splitInlineImages("[תמונה 2]\n[תמונה 1]\n[תמונה 1]\n[תמונה 7]", [false, true]);
check("picture: only a marker of one of the comment's own pictures is drawn, once",
  [mixed.parts, [...mixed.inlined]],
  [[{ kind: "image", index: 1 }, { kind: "text", text: "[תמונה 1]\n[תמונה 1]\n[תמונה 7]" }], [1]]);
check("picture: a comment with no marker is one block of text, nothing inlined",
  [splitInlineImages("סתם תגובה\nבשתי שורות", [true]).parts, splitInlineImages("סתם", [true]).inlined.size],
  [[{ kind: "text", text: "סתם תגובה\nבשתי שורות" }], 0]);
check("picture: an empty comment has no parts", splitInlineImages("", [true]).parts, []);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

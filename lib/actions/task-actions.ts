"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { logAudit } from "@/lib/audit";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";
import { notifyTaskAssigned, notifyTasksAssigned, type TaskMailOutcome } from "@/lib/services/task-notify";
import { notifyReviewOutcome, notifyTaskDone, notifyTaskReview } from "@/lib/services/task-watch-notify";
import { reviewMove, reviewersOf } from "@/lib/tasks/review";
import { siteUrlOf, siteUrlsForRefs } from "@/lib/services/task-site-url";
import { resolveGapForTask } from "@/lib/services/gap-resolution";
import { ADMIN_ROLES, STAFF_ROLES } from "@/types/auth.types";
import {
  OPEN_TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_SOURCES,
  TASK_STATUSES,
  type MktChannel,
  type Task,
  type TaskBoard,
  type TaskPriority,
  type TaskSource,
  type TaskSourceRef,
  type TaskStatus,
  type TaskWithNames,
} from "@/types/task.types";
import { defaultBoardFor, validBoard, validChannel, validPhase, validProgress } from "@/lib/task-boards";
import { diffActivities, recordActivity } from "@/lib/services/task-activity";
import { editableFields, type EditableTaskField } from "@/lib/tasks/permissions";
import { unreadCounts, type ThreadCommentRow } from "@/lib/tasks/thread-watch";
import { assignedByMap, type AssigneeChangeRow } from "@/lib/tasks/owner-filter";

// Typed against types/database.types.ts (npm run db:types).
const db = supabaseTyped;

/** `mail` is set only when an assignment mail was attempted - see TaskMailOutcome. */
type Result = { ok: true; mail?: TaskMailOutcome } | { ok: false; error: string };
type CreateResult =
  | { ok: true; id: string; mail?: TaskMailOutcome }
  | { ok: false; error: string };

/**
 * Permissions (decided 01.09):
 * - superadmin/admin: create for anyone, edit/delete everything.
 * - editor: sees own tasks, updates their status, may create FOR HIMSELF only.
 * - Partner roles never reach these actions - requireStaff() rejects them,
 *   and middleware confines them to /portal anyway.
 */
function isManager(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

// One literal (not concatenated) so the typed client can parse the column list.
const TASK_COLUMNS =
  "id,title,description,status,priority,assignee_id,created_by,due_date,source,source_ref,board,phase,channel,progress,parent_id,reviewer_ids,deleted_at,completed_at,created_at,updated_at";

/** The same list without `reviewer_ids` - the board's fallback while its migration lands. */
const TASK_COLUMNS_BEFORE_REVIEWERS = TASK_COLUMNS.replace(",reviewer_ids", "");

/** Postgres 42703 = undefined column; PostgREST answers it with that code. */
function missingColumn(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42703" || /reviewer_ids/.test(error?.message ?? "");
}

/** Most reviewers one task may carry - "Alon, Tom or both", not the whole company. */
const REVIEWERS_MAX = 5;

/** The reviewer ids a form sent, kept only where they are real, active staff profiles -
 *  the client is never trusted with a user id. `null` = back to the default reviewer. */
async function cleanReviewerIds(value: unknown): Promise<string[] | null | { error: string }> {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) return { error: "Bad reviewers" };
  const unique = [...new Set(value as string[])].filter((id) => id.length > 0);
  if (unique.length === 0) return null;
  if (unique.length > REVIEWERS_MAX) return { error: `עד ${REVIEWERS_MAX} בודקים למשימה` };
  const { data, error } = await db
    .from("user_profiles")
    .select("id,role")
    .in("id", unique)
    .eq("is_active", true);
  if (error) {
    console.error("tasks: reviewer check failed", JSON.stringify(error));
    return { error: "Save failed - check the log" };
  }
  const staff = new Set(
    (data ?? [])
      .filter((user: { role: string }) => (STAFF_ROLES as readonly string[]).includes(user.role))
      .map((user: { id: string }) => user.id),
  );
  if (unique.some((id) => !staff.has(id))) return { error: "בודק חייב להיות איש צוות פעיל" };
  return unique;
}

function validStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function validPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

function validSource(value: string | undefined): value is TaskSource {
  return !!value && (TASK_SOURCES as readonly string[]).includes(value);
}

/** Sources only the server itself may stamp (the rules cron, the roadmap import). */
const SERVER_ONLY_SOURCES: readonly TaskSource[] = ["recurring", "roadmap"];

/** A client-supplied source_ref must have the shape every reader assumes - and its
 *  url must be a same-site path, because it becomes a link in mails and the UI. */
function validSourceRef(value: unknown): value is TaskSourceRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.kind === "string" &&
    typeof ref.table === "string" &&
    typeof ref.label === "string" &&
    (typeof ref.row_id === "string" || typeof ref.row_id === "number") &&
    typeof ref.url === "string" &&
    ref.url.startsWith("/") &&
    !ref.url.startsWith("//")
  );
}

/** Board read cap - far above today's size; a truncated read is logged, never hidden. */
const TASKS_LIST_MAX = 5000;
/** Task ids per comment-count query - keeps the `in (...)` filter well inside URL limits. */
const COMMENT_COUNT_CHUNK = 200;
const COMMENT_ROWS_MAX = 50_000;

/** Every live comment of these tasks, in chunks of task ids (never one query per task) -
 *  the rows behind both the comment count and the unread marker. Each chunk pages its
 *  rows; a failed chunk is logged and leaves only ITS tasks without comments. */
async function commentRows(taskIds: string[]): Promise<ThreadCommentRow[]> {
  const out: ThreadCommentRow[] = [];
  for (let i = 0; i < taskIds.length; i += COMMENT_COUNT_CHUNK) {
    const chunk = taskIds.slice(i, i + COMMENT_COUNT_CHUNK);
    const { rows, error, truncated } = await fetchPaged<ThreadCommentRow & { id: string }>(
      () =>
        db
          .from("task_comments")
          .select("id,task_id,author_id,created_at,mentions")
          .eq("kind", "comment")
          .is("deleted_at", null)
          .in("task_id", chunk)
          .order("id", { ascending: true }),
      COMMENT_ROWS_MAX,
    );
    if (error) {
      console.error("tasks: comment rows failed for a chunk", JSON.stringify(error));
      continue;
    }
    if (truncated) console.error(`tasks: comment rows truncated at ${COMMENT_ROWS_MAX} rows for a chunk`);
    out.push(...rows);
  }
  return out;
}

/** Every "assignee changed" activity row of these tasks - who handed each task to whom.
 *  Same chunking as commentRows; a failed chunk is logged and its tasks fall back to
 *  "assigned by whoever created it". */
async function assigneeChangeRows(taskIds: string[]): Promise<AssigneeChangeRow[]> {
  const out: AssigneeChangeRow[] = [];
  for (let i = 0; i < taskIds.length; i += COMMENT_COUNT_CHUNK) {
    const chunk = taskIds.slice(i, i + COMMENT_COUNT_CHUNK);
    const { rows, error, truncated } = await fetchPaged<AssigneeChangeRow & { id: string }>(
      () =>
        db
          .from("task_comments")
          .select("id,task_id,author_id,created_at,activity")
          .eq("kind", "activity")
          .eq("activity->>field", "assignee")
          .in("task_id", chunk)
          .order("id", { ascending: true }),
      COMMENT_ROWS_MAX,
    );
    if (error) {
      console.error("tasks: assignee-change rows failed for a chunk", JSON.stringify(error));
      continue;
    }
    if (truncated) console.error(`tasks: assignee-change rows truncated at ${COMMENT_ROWS_MAX} rows for a chunk`);
    out.push(...rows);
  }
  return out;
}

/** When this person last opened each thread. A failed read (the table not migrated yet
 *  included) returns null = "unknown", which the caller shows as nothing unread - an empty
 *  map would read as "never opened anything" and light the whole board up. */
async function lastReadByTask(userId: string): Promise<Map<string, string> | null> {
  // `id` is the task id: fetchPaged dedupes pages by `id`, and one person has one row per task.
  const { rows, error, truncated } = await fetchPaged<{ id: string; last_read_at: string }>(
    () =>
      db
        .from("task_reads")
        .select("id:task_id,last_read_at")
        .eq("user_id", userId)
        .order("task_id", { ascending: true }),
    TASKS_LIST_MAX,
  );
  if (error) {
    console.error("tasks: last-read load failed", JSON.stringify(error));
    return null;
  }
  if (truncated) console.error(`tasks: last-read rows truncated at ${TASKS_LIST_MAX}`);
  return new Map(rows.map((row) => [row.id, row.last_read_at] as const));
}

/** Attach display names without a DB relation (no FK join over PostgREST needed). */
async function withNames(rows: Task[], userId: string): Promise<TaskWithNames[]> {
  const ids = [
    ...new Set(
      rows
        .flatMap((row) => [row.assignee_id, row.created_by, ...(row.reviewer_ids ?? [])])
        .filter((value): value is string => !!value),
    ),
  ];
  const [comments, lastReadAt, siteUrls, assigneeChanges] = await Promise.all([
    commentRows(rows.map((row) => row.id)),
    lastReadByTask(userId),
    siteUrlsForRefs(rows.map((row) => row.source_ref)),
    // Only a task that HAS an owner can have been handed to someone.
    assigneeChangeRows(rows.filter((row) => row.assignee_id).map((row) => row.id)),
  ]);
  const assignedBy = assignedByMap(rows, assigneeChanges);
  const countOf = new Map<string, number>();
  for (const comment of comments) countOf.set(comment.task_id, (countOf.get(comment.task_id) ?? 0) + 1);
  const unreadOf = lastReadAt
    ? unreadCounts({ userId, tasks: rows, comments, lastReadAt })
    : new Map<string, number>();

  if (ids.length === 0) {
    return rows.map((row) => ({
      ...row,
      assignee_name: null,
      created_by_name: null,
      assigned_by: null,
      reviewer_names: [],
      site_url: siteUrlOf(row.source_ref, siteUrls),
      comment_count: countOf.get(row.id) ?? 0,
      unread_count: unreadOf.get(row.id) ?? 0,
    }));
  }

  const { data: users, error } = await db
    .from("user_profiles")
    .select("id,display_name,email")
    .in("id", ids);
  if (error) {
    console.error("tasks: load user names failed", JSON.stringify(error));
  }
  const nameOf = new Map<string, string | null>(
    (users ?? []).map((user: { id: string; display_name: string | null; email: string }) => [user.id, user.display_name || user.email] as const),
  );
  return rows.map((row) => ({
    ...row,
    assignee_name: row.assignee_id ? (nameOf.get(row.assignee_id) ?? null) : null,
    created_by_name: row.created_by ? (nameOf.get(row.created_by) ?? null) : null,
    assigned_by: assignedBy.get(row.id) ?? null,
    reviewer_names: (row.reviewer_ids ?? []).map((id) => nameOf.get(id) ?? "?"),
    site_url: siteUrlOf(row.source_ref, siteUrls),
    comment_count: countOf.get(row.id) ?? 0,
    unread_count: unreadOf.get(row.id) ?? 0,
  }));
}

/** Every staff member sees the whole board; editing stays scoped (see updateTask/setTaskStatus). */
export async function listTasks(): Promise<TaskWithNames[]> {
  const session = await requireStaff();

  // Everyone on staff sees the whole board (Dor, 16.09): the roadmap lives here
  // now, and a board people cannot see is not a board. Editing stays narrow -
  // an editor only changes the status/progress of tasks assigned to them.
  const read = (columns: string) =>
    fetchPaged<Task>(
      () =>
        db
          .from("tasks")
          .select(columns)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true }),
      TASKS_LIST_MAX,
    );
  let { rows, error, truncated } = await read(TASK_COLUMNS);
  if (error && missingColumn(error)) {
    // The deploy beat the reviewer_ids migration by a few minutes - read without it rather
    // than show an empty board.
    console.error("tasks: reviewer_ids column missing, reading without it", JSON.stringify(error));
    ({ rows, error, truncated } = await read(TASK_COLUMNS_BEFORE_REVIEWERS));
    rows = rows.map((row) => ({ ...row, reviewer_ids: null }));
  }
  if (error) {
    console.error("tasks: list failed", JSON.stringify(error));
    return [];
  }
  if (truncated) console.error(`tasks: list truncated at ${TASKS_LIST_MAX} rows`);
  return withNames(rows, session.sub);
}

/**
 * The dashboard widget: what is MY move, most urgent first. My open tasks - minus the ones I
 * already handed over for review (they wait on someone else) - plus the tasks that came BACK
 * to me: in review, and I am its reviewer (picked, or opened it with nobody picked). (A
 * rule-made task's fallback reviewer is not looked up here; it still shows under "המשימות
 * שלי" on the board.)
 */
export async function listMyOpenTasks(limit = 6): Promise<Task[]> {
  const session = await requireStaff();

  const [mine, back] = await Promise.all([
    db
      .from("tasks")
      .select(TASK_COLUMNS)
      .is("deleted_at", null)
      .eq("assignee_id", session.sub)
      .in("status", OPEN_TASK_STATUSES.filter((status) => status !== "review"))
      .order("created_at", { ascending: false })
      .limit(200),
    // Waiting for MY review: I am a picked reviewer, or nobody was picked and I opened it.
    db
      .from("tasks")
      .select(TASK_COLUMNS)
      .is("deleted_at", null)
      .eq("status", "review")
      .or(`reviewer_ids.cs.{${session.sub}},and(reviewer_ids.is.null,created_by.eq.${session.sub})`)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (mine.error) {
    console.error("tasks: my-open failed", JSON.stringify(mine.error));
    return [];
  }
  // The review half is an extra - without it the widget still shows my own work.
  if (back.error) console.error("tasks: my-review failed", JSON.stringify(back.error));

  // Priority is a text column; the meaningful order lives in code.
  const weight: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return ([...(mine.data ?? []), ...(back.data ?? [])] as Task[])
    .sort(
      (a, b) =>
        (weight[a.priority] ?? 9) - (weight[b.priority] ?? 9) ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
    )
    .slice(0, limit);
}

export async function createTask(input: {
  title: string;
  description?: string | null;
  priority: TaskPriority;
  assignee_id?: string | null;
  due_date?: string | null;
  source?: TaskSource;
  source_ref?: TaskSourceRef | null;
  board?: TaskBoard;
  phase?: number | null;
  channel?: MktChannel | null;
  progress?: number | null;
  /** Makes this a sub-task of that task (one level - a sub-task has no sub-tasks). */
  parent_id?: string | null;
  /** Who it goes back to in review; empty = the default (whoever opened it). Anyone may
   *  pick reviewers for a task they create - an editor's own task included. */
  reviewer_ids?: string[] | null;
}): Promise<CreateResult> {
  const session = await requireStaff();

  const title = input.title?.trim();
  if (!title) return { ok: false, error: "Title is required" };
  const reviewerIds = await cleanReviewerIds(input.reviewer_ids);
  if (reviewerIds && !Array.isArray(reviewerIds)) return { ok: false, error: reviewerIds.error };
  if (!validPriority(input.priority)) return { ok: false, error: "Bad priority" };
  if (input.board !== undefined && !validBoard(input.board)) return { ok: false, error: "Bad board" };
  if (!validPhase(input.phase)) return { ok: false, error: "Bad phase" };
  if (!validChannel(input.channel)) return { ok: false, error: "Bad channel" };
  if (!validProgress(input.progress)) return { ok: false, error: "Bad progress" };
  if (input.source !== undefined && !validSource(input.source)) return { ok: false, error: "Bad source" };
  if (input.source && SERVER_ONLY_SOURCES.includes(input.source)) {
    return { ok: false, error: "Bad source" };
  }
  const source: TaskSource = input.source ?? "manual";
  const sourceRef: TaskSourceRef | null = input.source_ref ?? null;
  if (sourceRef !== null) {
    if (!validSourceRef(sourceRef)) return { ok: false, error: "Bad source_ref" };
  } else if (source !== "manual") {
    return { ok: false, error: "Bad source_ref" };
  }
  // Only the shape fields travel - never whatever else the client put on the object.
  const cleanRef: TaskSourceRef | null = sourceRef
    ? {
        kind: sourceRef.kind,
        table: sourceRef.table,
        row_id: sourceRef.row_id,
        label: sourceRef.label,
        url: sourceRef.url,
      }
    : null;

  // Editors may only create tasks for themselves.
  const assigneeId = isManager(session.role)
    ? (input.assignee_id ?? null)
    : session.sub;

  // A sub-task lives where its parent lives (board, phase, channel) unless told otherwise,
  // and only its parent's owners - an admin, or whoever the general task is assigned to or
  // was opened by - may split it.
  let parent: { id: string; board: string; phase: number | null; channel: string | null } | null = null;
  if (input.parent_id) {
    const { data: row, error: parentError } = await db
      .from("tasks")
      .select("id,board,phase,channel,parent_id,assignee_id,created_by")
      .eq("id", input.parent_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (parentError) {
      console.error("tasks: parent read failed", JSON.stringify(parentError));
      return { ok: false, error: "Create failed - check the log" };
    }
    if (!row) return { ok: false, error: "משימת האב לא נמצאה" };
    if (row.parent_id) return { ok: false, error: "תת-משימה לא מתחלקת שוב - רמה אחת בלבד" };
    if (!isManager(session.role) && row.assignee_id !== session.sub && row.created_by !== session.sub) {
      return { ok: false, error: "רק מנהל או האחראי על המשימה מחלקים אותה" };
    }
    parent = { id: row.id, board: row.board, phase: row.phase, channel: row.channel };
  }
  const board: TaskBoard =
    input.board ?? (parent && validBoard(parent.board) ? parent.board : defaultBoardFor(source));

  const { data, error } = await db
    .from("tasks")
    .insert({
      title,
      description: input.description?.trim() || null,
      priority: input.priority,
      assignee_id: assigneeId,
      created_by: session.sub,
      due_date: input.due_date || null,
      source,
      source_ref: cleanRef,
      board,
      phase: input.phase ?? (parent && board === parent.board ? parent.phase : null),
      channel: input.channel ?? (parent && board === parent.board ? (parent.channel as MktChannel | null) : null),
      progress: input.progress ?? null,
      parent_id: parent?.id ?? null,
      // Sent only when someone was picked - so a create still works in the minutes between
      // the code deploy and the reviewer_ids migration landing.
      ...(reviewerIds ? { reviewer_ids: reviewerIds } : {}),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("tasks: create failed", JSON.stringify(error));
    return { ok: false, error: "Create failed - check the log" };
  }

  await logAudit({
    action: "task.create",
    entityType: "task",
    entityId: data.id,
    changes: { title, assignee_id: assigneeId, priority: input.priority, board, parent_id: parent?.id ?? null, reviewer_ids: reviewerIds },
  });
  if (input.source === "price_light") invalidatePriceLight("rows");

  // Assigning someone else = they get a mail. Self-assignment stays quiet.
  let mail: TaskMailOutcome | undefined;
  if (assigneeId && assigneeId !== session.sub) {
    mail = await notifyTaskAssigned({
      taskId: data.id,
      title,
      description: input.description?.trim() || null,
      priority: input.priority,
      dueDate: input.due_date || null,
      sourceRef: cleanRef,
      assigneeId,
      assignerId: session.sub,
    });
  }
  return { ok: true, id: data.id, mail };
}

export async function updateTask(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    assignee_id?: string | null;
    due_date?: string | null;
    board?: TaskBoard;
    phase?: number | null;
    channel?: MktChannel | null;
    progress?: number | null;
    /** null / [] = back to the default reviewer. Admin-only (lib/tasks/permissions.ts). */
    reviewer_ids?: string[] | null;
  },
): Promise<Result> {
  const session = await requireStaff();
  const manager = isManager(session.role);

  if (!manager) {
    // The most permissive a non-admin can ever be (editing their OWN task) -
    // any patch key outside that set is refused before we even know whose
    // task this is. Real ownership is enforced below via the scoped queries.
    const allowed = editableFields(session.role, true);
    const disallowed = (Object.keys(patch) as EditableTaskField[]).filter(
      (key) => !allowed.has(key),
    );
    if (disallowed.length > 0) {
      return { ok: false, error: "רק מנהל עורך פרטי משימה" };
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return { ok: false, error: "Title is required" };
    update.title = title;
  }
  if (patch.description !== undefined) {
    update.description = patch.description?.trim() || null;
  }
  if (patch.priority !== undefined) {
    if (!validPriority(patch.priority)) return { ok: false, error: "Bad priority" };
    update.priority = patch.priority;
  }
  if (patch.assignee_id !== undefined) update.assignee_id = patch.assignee_id;
  if (patch.due_date !== undefined) update.due_date = patch.due_date || null;
  if (patch.board !== undefined) {
    if (!validBoard(patch.board)) return { ok: false, error: "Bad board" };
    update.board = patch.board;
  }
  if (patch.phase !== undefined) {
    if (!validPhase(patch.phase)) return { ok: false, error: "Bad phase" };
    update.phase = patch.phase;
  }
  if (patch.channel !== undefined) {
    if (!validChannel(patch.channel)) return { ok: false, error: "Bad channel" };
    update.channel = patch.channel;
  }
  if (patch.progress !== undefined) {
    if (!validProgress(patch.progress)) return { ok: false, error: "Bad progress" };
    update.progress = patch.progress;
  }
  if (patch.reviewer_ids !== undefined) {
    const reviewerIds = await cleanReviewerIds(patch.reviewer_ids);
    if (reviewerIds && !Array.isArray(reviewerIds)) return { ok: false, error: reviewerIds.error };
    update.reviewer_ids = reviewerIds;
  }

  // The row as it was - needed to tell a re-assignment from a plain edit,
  // and to diff every tracked field into the thread's activity rows below.
  // Scoped the same way as the update itself for a non-admin, so a non-owner
  // can never learn another task's fields through the activity diff.
  let beforeQuery = db
    .from("tasks")
    .select("status,assignee_id,priority,due_date,progress,board")
    .eq("id", id);
  if (!manager) beforeQuery = beforeQuery.eq("assignee_id", session.sub);
  const { data: before, error: beforeError } = await beforeQuery.maybeSingle();
  if (beforeError) console.error("tasks: before-read failed", JSON.stringify(beforeError));
  // Tradeoff: if before-read fails, diffActivities records every patched field as changing from
  // null (not true, but safe: the actual edit succeeded so audit has the final state).

  let updateQuery = db.from("tasks").update(update).eq("id", id);
  if (!manager) updateQuery = updateQuery.eq("assignee_id", session.sub);
  const { data: after, error } = await updateQuery
    .select("id,title,description,priority,assignee_id,due_date,source_ref")
    .maybeSingle();
  if (error) {
    console.error("tasks: update failed", JSON.stringify(error));
    return { ok: false, error: "Update failed" };
  }
  if (!after) {
    // Nothing matched: for an editor it is not their task, for an admin the id is
    // gone. Either way no activity row and no audit for a write that never happened.
    return { ok: false, error: manager ? "המשימה לא נמצאה" : "לא המשימה שלך" };
  }

  await logAudit({
    action: "task.update",
    entityType: "task",
    entityId: id,
    changes: update,
  });

  for (const activity of diffActivities(before ?? {}, update)) {
    await recordActivity(id, session.sub, activity);
  }

  // Handed to a new person (not the editor themself) → mail them.
  const newAssignee = (after?.assignee_id as string | null) ?? null;
  let mail: TaskMailOutcome | undefined;
  if (
    after &&
    newAssignee &&
    newAssignee !== (before?.assignee_id ?? null) &&
    newAssignee !== session.sub
  ) {
    mail = await notifyTaskAssigned({
      taskId: id,
      title: after.title,
      description: after.description ?? null,
      priority: validPriority(after.priority) ? after.priority : "medium",
      dueDate: after.due_date ?? null,
      sourceRef: (after.source_ref as TaskSourceRef | null) ?? null,
      assigneeId: newAssignee,
      assignerId: session.sub,
    });
  }
  return { ok: true, mail };
}

/** Who handed this task to its current owner - the fallback reviewer of a task nobody
 *  human created (lib/tasks/review.ts). One task, so one small read. */
async function assignerOf(taskId: string, assigneeId: string | null): Promise<string | null> {
  if (!assigneeId) return null;
  const changes = await assigneeChangeRows([taskId]);
  return assignedByMap([{ id: taskId, assignee_id: assigneeId, created_by: null }], changes).get(taskId) ?? null;
}

/** The task's reviewers by the one rule (`reviewersOf`); the assigner is looked up only
 *  when the rule would need it (nobody picked, nobody created). */
async function reviewerIdsOf(
  taskId: string,
  row: { created_by: string | null; assignee_id: string | null; reviewer_ids: string[] | null },
): Promise<string[]> {
  const needsAssigner = !(row.reviewer_ids?.length) && !row.created_by;
  return reviewersOf({
    created_by: row.created_by,
    reviewer_ids: row.reviewer_ids,
    assigned_by: needsAssigner ? await assignerOf(taskId, row.assignee_id) : null,
  });
}

/**
 * Status is the one field an editor may change - on his own tasks, and on a task that sits
 * in REVIEW waiting for him (he opened it; its owner handed it back): the reviewer has to be
 * able to approve it or send it back to work. Moving a task INTO review mails the reviewer
 * (`mail` says what became of it); the reviewer's answer mails the assignee.
 */
export async function setTaskStatus(id: string, status: TaskStatus): Promise<Result> {
  const session = await requireStaff();
  if (!validStatus(status)) return { ok: false, error: "Bad status" };
  const manager = isManager(session.role);

  // The status as it was - read BEFORE the update, or an activity row would
  // record "from" equal to "to".
  const { data: beforeRow, error: beforeError } = await db
    .from("tasks")
    .select("status,assignee_id,created_by,reviewer_ids")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) console.error("tasks: before-read failed", JSON.stringify(beforeError));
  // Tradeoff: if before-read fails, activity records status as changing from null (not true,
  // but safe: the actual update succeeded so audit has the final state).
  const previousStatus = (beforeRow?.status as TaskStatus | undefined) ?? null;

  // A non-admin who is not the owner gets in only as the REVIEWER of a task in review.
  let asReviewer = false;
  if (!manager && beforeRow && beforeRow.assignee_id !== session.sub && previousStatus === "review") {
    asReviewer = (await reviewerIdsOf(id, beforeRow)).includes(session.sub);
  }

  let query = db
    .from("tasks")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (!manager) {
    // The reviewer's door closes the moment the task leaves review (a concurrent change).
    query = asReviewer ? query.eq("status", "review") : query.eq("assignee_id", session.sub);
  }

  const { data, error } = await query.select("id,title,created_by,assignee_id,reviewer_ids,source,source_ref");
  if (error) {
    console.error("tasks: status failed", JSON.stringify(error));
    return { ok: false, error: "Update failed" };
  }
  if (!data?.length) return { ok: false, error: "Not your task" };

  await logAudit({
    action: "task.status",
    entityType: "task",
    entityId: id,
    changes: { status },
  });
  // /price-light's "ממתינים להחלטה" excludes events with an open price-light task - closing or
  // reopening one changes that screen, which caches its rows (lib/services/price-light-cache).
  invalidatePriceLight("rows");

  // Reuses diffActivities' from===to skip: a no-op setTaskStatus call (same
  // status re-applied) writes no activity row.
  for (const activity of diffActivities({ status: previousStatus }, { status })) {
    await recordActivity(id, session.sub, activity);
  }

  // A gap task marked done takes its gap off every list that shows it, and
  // reopening the task puts it back - one rule for every gap family, not just
  // creative (Dor, 16.09: "אחרי שמשימה נעשתה - צריך להוריד אותה מה-gaps של כל
  // אחד באשר הוא"). resolveGapForTask swallows its own errors, so a failed gap
  // write never blocks this status change.
  const row = data[0] as {
    title: string;
    created_by: string | null;
    assignee_id: string | null;
    reviewer_ids: string[] | null;
    source: TaskSource;
    source_ref: TaskSourceRef | null;
  };
  await resolveGapForTask({ id, source: row.source, source_ref: row.source_ref }, status);

  // Done (and it was not already) → the person who opened the task hears about it.
  const watched = { id, title: row.title, created_by: row.created_by, assignee_id: row.assignee_id };
  if (status === "done" && previousStatus !== "done") {
    await notifyTaskDone({ task: watched, actorId: session.sub });
  }

  // The review hand-off: into review → the reviewer is told; out of it → the assignee is.
  let mail: TaskMailOutcome | undefined;
  const move = reviewMove(previousStatus, status);
  if (move === "sent") {
    mail = await notifyTaskReview({
      task: watched,
      actorId: session.sub,
      reviewerIds: await reviewerIdsOf(id, row),
    });
  } else if (move) {
    await notifyReviewOutcome({ task: watched, actorId: session.sub, outcome: move });
  }
  return { ok: true, mail };
}

export async function deleteTask(id: string): Promise<Result> {
  const session = await requireStaff();
  if (!isManager(session.role)) {
    return { ok: false, error: "Only admins delete tasks" };
  }

  const { error } = await db
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("tasks: delete failed", JSON.stringify(error));
    return { ok: false, error: "Delete failed" };
  }

  // The thread rows survive the soft delete; the images do not need to.
  // Best-effort: list() defaults to 100 entries, so pass an explicit limit
  // large enough to cover a task with many screenshots; a cleanup failure is
  // logged and never fails the delete itself.
  try {
    const { data: files, error: listError } = await supabase.storage
      .from("task-attachments")
      .list(id, { limit: 1000 });
    if (listError) {
      console.error("tasks: attachment list failed", JSON.stringify(listError));
    } else if (files?.length) {
      const { error: removeError } = await supabase.storage
        .from("task-attachments")
        .remove(files.map((file) => `${id}/${file.name}`));
      if (removeError) console.error("tasks: attachment cleanup failed", JSON.stringify(removeError));
    }
  } catch (cleanupError) {
    console.error("tasks: attachment cleanup threw", JSON.stringify(cleanupError));
  }

  await logAudit({ action: "task.delete", entityType: "task", entityId: id });
  invalidatePriceLight("rows");
  return { ok: true };
}

/**
 * Source keys ({kind}:{table}:{row_id}) that already carry an OPEN task - the
 * gaps tab and the price-changes screen use this to disable duplicate
 * "create task" buttons. One source per call (creative_gap | price_review).
 */
export async function openTaskGapKeys(
  source: Exclude<TaskSource, "manual"> = "creative_gap",
): Promise<string[]> {
  await requireStaff();

  const { data, error } = await db
    .from("tasks")
    .select("source_ref")
    .is("deleted_at", null)
    .in("status", OPEN_TASK_STATUSES)
    .eq("source", source);
  if (error) {
    console.error("tasks: gap-keys failed", JSON.stringify(error));
    return [];
  }
  return (data ?? [])
    .map((row: { source_ref: unknown }) => row.source_ref as TaskSourceRef | null)
    .filter((ref: TaskSourceRef | null): ref is TaskSourceRef => !!ref)
    // Keyed by kind too: a team can need both a crest and a gallery, and one
    // task about the crest must not silently claim the gallery as handled.
    .map((ref: TaskSourceRef) => `${ref.kind}:${ref.table}:${ref.row_id}`);
}

/** Most tasks one bulk action may touch - the bar works on what a person ticked, not the board. */
const BULK_MAX = 200;

/**
 * The bulk bar on /tasks (Alon, 28.09: "לשייך מספר משימות במכה אחת"). Admins only.
 * Assignee and board are ONE update over the ticked ids, with an activity row per task that
 * really changed; a status goes through setTaskStatus task by task, so gap closing and the
 * done-mail behave exactly as for one task. Whoever receives tasks gets ONE mail listing them
 * (notifyTasksAssigned) - never one per task, and never the admin who assigned to themself.
 */
export async function bulkUpdateTasks(
  ids: string[],
  patch: { assignee_id?: string | null; board?: TaskBoard; status?: TaskStatus },
): Promise<{ ok: true; updated: number; mail?: TaskMailOutcome } | { ok: false; error: string }> {
  const session = await requireStaff();
  if (!isManager(session.role)) return { ok: false, error: "רק מנהל מעדכן כמה משימות יחד" };
  const unique = [...new Set((ids ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return { ok: false, error: "לא נבחרו משימות" };
  if (unique.length > BULK_MAX) return { ok: false, error: `עד ${BULK_MAX} משימות בפעולה אחת` };
  if (patch.board !== undefined && !validBoard(patch.board)) return { ok: false, error: "Bad board" };
  if (patch.status !== undefined && !validStatus(patch.status)) return { ok: false, error: "Bad status" };
  const fieldPatch = patch.assignee_id !== undefined || patch.board !== undefined;
  if (!fieldPatch && patch.status === undefined) return { ok: false, error: "אין מה לעדכן" };

  let updated = 0;
  let mail: TaskMailOutcome | undefined;

  if (fieldPatch) {
    const { data: before, error: beforeError } = await db
      .from("tasks")
      .select("id,title,assignee_id,board")
      .in("id", unique)
      .is("deleted_at", null);
    if (beforeError) {
      console.error("tasks: bulk before-read failed", JSON.stringify(beforeError));
      return { ok: false, error: "Update failed" };
    }
    const rows = before ?? [];
    if (rows.length === 0) return { ok: false, error: "המשימות לא נמצאו" };

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.assignee_id !== undefined) update.assignee_id = patch.assignee_id;
    if (patch.board !== undefined) update.board = patch.board;
    const { error } = await db.from("tasks").update(update).in("id", rows.map((row) => row.id));
    if (error) {
      console.error("tasks: bulk update failed", JSON.stringify(error));
      return { ok: false, error: "Update failed" };
    }
    updated = rows.length;

    for (const row of rows) {
      for (const activity of diffActivities(row, update)) {
        await recordActivity(row.id, session.sub, activity);
      }
    }
    await logAudit({
      action: "task.bulk_update",
      entityType: "task",
      changes: { ids: rows.map((row) => row.id), ...update },
    });

    // Only the tasks this person did not already have - re-assigning a task to its own
    // assignee is no news.
    const newAssignee = patch.assignee_id ?? null;
    if (newAssignee && newAssignee !== session.sub) {
      const handed = rows.filter((row) => row.assignee_id !== newAssignee).map((row) => row.title);
      if (handed.length > 0) mail = await notifyTasksAssigned({ assigneeId: newAssignee, titles: handed });
    }
  }

  if (patch.status !== undefined) {
    let statusOk = 0;
    for (const id of unique) {
      const result = await setTaskStatus(id, patch.status);
      if (result.ok) statusOk += 1;
    }
    if (statusOk === 0) return { ok: false, error: "עדכון הסטטוס נכשל" };
    updated = Math.max(updated, statusOk);
  }

  invalidatePriceLight("rows");
  return { ok: true, updated, mail };
}

"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

// The generated database types predate the tasks table (regenerate with
// `npm run db:types` once the migration lands on master) - cast once at the
// boundary, same pattern as listUsers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
import { logAudit } from "@/lib/audit";
import { notifyTaskAssigned } from "@/lib/services/task-notify";
import {
  dismissCreativeGap,
  restoreCreativeGap,
} from "@/lib/actions/creative-gap-actions";
import { gapKey } from "@/types/creative-gap.types";
import { ADMIN_ROLES } from "@/types/auth.types";
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
import { validBoard, validChannel, validPhase, validProgress } from "@/lib/task-boards";
import { diffActivities, recordActivity } from "@/lib/services/task-activity";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

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

const TASK_COLUMNS =
  "id,title,description,status,priority,assignee_id,created_by,due_date,source,source_ref," +
  "board,phase,channel,progress,deleted_at,completed_at,created_at,updated_at";

function validStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function validPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

function validSource(value: string | undefined): value is TaskSource {
  return !!value && (TASK_SOURCES as readonly string[]).includes(value);
}

/** Attach display names without a DB relation (no FK join over PostgREST needed). */
async function withNames(rows: Task[]): Promise<TaskWithNames[]> {
  const ids = [
    ...new Set(
      rows
        .flatMap((row) => [row.assignee_id, row.created_by])
        .filter((value): value is string => !!value),
    ),
  ];
  if (ids.length === 0) {
    return rows.map((row) => ({
      ...row,
      assignee_name: null,
      created_by_name: null,
      // Populated by a later task (comment count query); honest zero until then.
      comment_count: 0,
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
    // Populated by a later task (comment count query); honest zero until then.
    comment_count: 0,
  }));
}

/** Managers see everything; editors only their own tasks. */
export async function listTasks(): Promise<TaskWithNames[]> {
  const session = await requireStaff();

  let query = db
    .from("tasks")
    .select(TASK_COLUMNS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (!isManager(session.role)) {
    query = query.eq("assignee_id", session.sub);
  }

  const { data, error } = await query;
  if (error) {
    console.error("tasks: list failed", JSON.stringify(error));
    return [];
  }
  return withNames((data ?? []) as Task[]);
}

/** The dashboard widget: my open tasks, most urgent first. */
export async function listMyOpenTasks(limit = 6): Promise<Task[]> {
  const session = await requireStaff();

  const { data, error } = await db
    .from("tasks")
    .select(TASK_COLUMNS)
    .is("deleted_at", null)
    .eq("assignee_id", session.sub)
    .in("status", OPEN_TASK_STATUSES)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("tasks: my-open failed", JSON.stringify(error));
    return [];
  }

  // Priority is a text column; the meaningful order lives in code.
  const weight: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return ((data ?? []) as Task[])
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
}): Promise<CreateResult> {
  const session = await requireStaff();

  const title = input.title?.trim();
  if (!title) return { ok: false, error: "Title is required" };
  if (!validPriority(input.priority)) return { ok: false, error: "Bad priority" };
  if (input.board !== undefined && !validBoard(input.board)) return { ok: false, error: "Bad board" };
  if (!validPhase(input.phase)) return { ok: false, error: "Bad phase" };
  if (!validChannel(input.channel)) return { ok: false, error: "Bad channel" };
  if (!validProgress(input.progress)) return { ok: false, error: "Bad progress" };

  // Editors may only create tasks for themselves.
  const assigneeId = isManager(session.role)
    ? (input.assignee_id ?? null)
    : session.sub;

  const { data, error } = await db
    .from("tasks")
    .insert({
      title,
      description: input.description?.trim() || null,
      priority: input.priority,
      assignee_id: assigneeId,
      created_by: session.sub,
      due_date: input.due_date || null,
      source: validSource(input.source) ? input.source : "manual",
      source_ref: input.source_ref ?? null,
      board: input.board ?? "ops",
      phase: input.phase ?? null,
      channel: input.channel ?? null,
      progress: input.progress ?? null,
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
    changes: { title, assignee_id: assigneeId, priority: input.priority },
  });

  // Assigning someone else = they get a mail. Self-assignment stays quiet.
  if (assigneeId && assigneeId !== session.sub) {
    await notifyTaskAssigned({
      taskId: data.id,
      title,
      description: input.description?.trim() || null,
      priority: input.priority,
      dueDate: input.due_date || null,
      sourceRef: input.source_ref ?? null,
      assigneeId,
      assignerId: session.sub,
    });
  }
  return { ok: true, id: data.id };
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
  },
): Promise<Result> {
  const session = await requireStaff();
  if (!isManager(session.role)) {
    return { ok: false, error: "Only admins edit task details" };
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

  // The row as it was - needed to tell a re-assignment from a plain edit,
  // and to diff every tracked field into the thread's activity rows below.
  const { data: before, error: beforeError } = await db
    .from("tasks")
    .select("status,assignee_id,priority,due_date,progress,board")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) console.error("tasks: before-read failed", JSON.stringify(beforeError));
  // Tradeoff: if before-read fails, diffActivities records every patched field as changing from
  // null (not true, but safe: the actual edit succeeded so audit has the final state).

  const { data: after, error } = await db
    .from("tasks")
    .update(update)
    .eq("id", id)
    .select("id,title,description,priority,assignee_id,due_date,source_ref")
    .maybeSingle();
  if (error) {
    console.error("tasks: update failed", JSON.stringify(error));
    return { ok: false, error: "Update failed" };
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
  if (
    after &&
    newAssignee &&
    newAssignee !== (before?.assignee_id ?? null) &&
    newAssignee !== session.sub
  ) {
    await notifyTaskAssigned({
      taskId: id,
      title: after.title,
      description: after.description ?? null,
      priority: after.priority,
      dueDate: after.due_date ?? null,
      sourceRef: (after.source_ref as TaskSourceRef | null) ?? null,
      assigneeId: newAssignee,
      assignerId: session.sub,
    });
  }
  return { ok: true };
}

/** Status is the one field an editor may change - on his own tasks only. */
export async function setTaskStatus(id: string, status: TaskStatus): Promise<Result> {
  const session = await requireStaff();
  if (!validStatus(status)) return { ok: false, error: "Bad status" };

  // The status as it was - read BEFORE the update, or an activity row would
  // record "from" equal to "to".
  const { data: beforeRow, error: beforeError } = await db
    .from("tasks")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) console.error("tasks: before-read failed", JSON.stringify(beforeError));
  // Tradeoff: if before-read fails, activity records status as changing from null (not true,
  // but safe: the actual update succeeded so audit has the final state).
  const previousStatus = (beforeRow?.status as TaskStatus | undefined) ?? null;

  let query = db
    .from("tasks")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (!isManager(session.role)) {
    query = query.eq("assignee_id", session.sub);
  }

  const { data, error } = await query.select("id,source,source_ref");
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

  // Reuses diffActivities' from===to skip: a no-op setTaskStatus call (same
  // status re-applied) writes no activity row.
  for (const activity of diffActivities({ status: previousStatus }, { status })) {
    await recordActivity(id, session.sub, activity);
  }

  // A gap task marked done files the gap away with it (Tom, 2026-09-10: the
  // radar kept listing it as "assigned to task" after the work was done).
  // Reopening the task puts the gap back on the list.
  const row = data[0] as { source: string; source_ref: TaskSourceRef | null };
  if (row.source === "creative_gap" && row.source_ref) {
    const ref = row.source_ref;
    if (status === "done") {
      await dismissCreativeGap({
        kind: ref.kind,
        table: ref.table,
        row_id: ref.row_id,
        label: ref.label,
        note: "נסגר במשימה",
      });
    } else if ((OPEN_TASK_STATUSES as readonly string[]).includes(status)) {
      await restoreCreativeGap(gapKey(ref.kind, ref.table, ref.row_id));
    }
  }
  return { ok: true };
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

  await logAudit({ action: "task.delete", entityType: "task", entityId: id });
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

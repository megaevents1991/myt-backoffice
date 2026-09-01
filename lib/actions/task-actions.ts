"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

// The generated database types predate the tasks table (regenerate with
// `npm run db:types` once the migration lands on master) - cast once at the
// boundary, same pattern as listUsers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
import { logAudit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/types/auth.types";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskPriority,
  type TaskSourceRef,
  type TaskStatus,
  type TaskWithNames,
} from "@/types/task.types";

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
  "id,title,description,status,priority,assignee_id,created_by,due_date,source,source_ref,deleted_at,completed_at,created_at,updated_at";

function validStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function validPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
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
    return rows.map((row) => ({ ...row, assignee_name: null, created_by_name: null }));
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
    .in("status", ["todo", "in_progress"])
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
  source?: "manual" | "creative_gap";
  source_ref?: TaskSourceRef | null;
}): Promise<CreateResult> {
  const session = await requireStaff();

  const title = input.title?.trim();
  if (!title) return { ok: false, error: "Title is required" };
  if (!validPriority(input.priority)) return { ok: false, error: "Bad priority" };

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
      source: input.source === "creative_gap" ? "creative_gap" : "manual",
      source_ref: input.source_ref ?? null,
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

  const { error } = await db.from("tasks").update(update).eq("id", id);
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
  return { ok: true };
}

/** Status is the one field an editor may change - on his own tasks only. */
export async function setTaskStatus(id: string, status: TaskStatus): Promise<Result> {
  const session = await requireStaff();
  if (!validStatus(status)) return { ok: false, error: "Bad status" };

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

  const { data, error } = await query.select("id");
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
 * Gap-ids ({table}:{row_id}) that already carry an OPEN task - the gaps tab
 * uses this to disable duplicate "create task" buttons.
 */
export async function openTaskGapKeys(): Promise<string[]> {
  await requireStaff();

  const { data, error } = await db
    .from("tasks")
    .select("source_ref")
    .is("deleted_at", null)
    .in("status", ["todo", "in_progress"])
    .eq("source", "creative_gap");
  if (error) {
    console.error("tasks: gap-keys failed", JSON.stringify(error));
    return [];
  }
  return (data ?? [])
    .map((row: { source_ref: unknown }) => row.source_ref as TaskSourceRef | null)
    .filter((ref: TaskSourceRef | null): ref is TaskSourceRef => !!ref)
    .map((ref: TaskSourceRef) => `${ref.table}:${ref.row_id}`);
}

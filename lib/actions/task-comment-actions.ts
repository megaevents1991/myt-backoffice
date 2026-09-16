"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { ADMIN_ROLES, STAFF_ROLES } from "@/types/auth.types";
import type {
  Ok,
  TaskAttachment,
  TaskComment,
  TaskCommentWithAuthor,
} from "@/types/task-comment.types";
import { isValidTaskAttachmentPath } from "@/lib/tasks/attachment-path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const COMMENT_COLUMNS =
  "id,task_id,author_id,kind,body,activity,attachments,mentions,edited_at,deleted_at,created_at";

const BODY_MAX = 5000;

function isManager(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

/** Every staff member reads every thread (spec §3.4). */
export async function listTaskComments(taskId: string): Promise<TaskCommentWithAuthor[]> {
  await requireStaff();

  const { data, error } = await db
    .from("task_comments")
    .select(COMMENT_COLUMNS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("task-comments: list failed", JSON.stringify(error));
    return [];
  }
  const rows = (data ?? []) as TaskComment[];

  const ids = [...new Set(rows.flatMap((r) => [r.author_id, ...r.mentions]).filter((v): v is string => !!v))];
  const nameOf = new Map<string, string>();
  if (ids.length) {
    const { data: users, error: userError } = await db
      .from("user_profiles").select("id,display_name,email").in("id", ids);
    if (userError) console.error("task-comments: names failed", JSON.stringify(userError));
    for (const user of (users ?? []) as { id: string; display_name: string | null; email: string }[]) {
      nameOf.set(user.id, user.display_name || user.email);
    }
  }

  const urlOf = await signedUrlMap(rows.flatMap((r) => (r.deleted_at ? [] : r.attachments.map((a) => a.path))));

  return rows.map((row) => ({
    ...row,
    // A deleted comment keeps its place in the thread but gives up its content.
    body: row.deleted_at ? null : row.body,
    attachments: row.deleted_at ? [] : row.attachments,
    author_name: row.author_id ? (nameOf.get(row.author_id) ?? null) : null,
    mention_names: row.mentions.map((id) => nameOf.get(id) ?? "משתמש"),
    attachment_urls: row.deleted_at ? [] : row.attachments.map((a) => urlOf.get(a.path) ?? ""),
  }));
}

/** One signed URL per path, valid an hour. Private bucket - never a public URL. */
async function signedUrlMap(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { data, error } = await supabase.storage.from("task-attachments").createSignedUrls(paths, 3600);
  if (error) {
    console.error("task-comments: sign failed", JSON.stringify(error));
    return out;
  }
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
  }
  return out;
}

/** Attachments arrive from the client and are not trusted with a path: an
 *  entry must be a well-shaped TaskAttachment whose storage path lives under
 *  THIS task's folder - otherwise a forged path could attach (and later sign
 *  a URL for) another task's file. Paths are validated against traversal
 *  segments (.. / //) and checked to the exact storage shape. */
function isOwnAttachment(taskId: string, value: unknown): value is TaskAttachment {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    isValidTaskAttachmentPath(taskId, a.path) &&
    typeof a.name === "string" &&
    typeof a.mime === "string" &&
    typeof a.size === "number"
  );
}

function sanitizeAttachments(taskId: string, attachments: unknown[]): TaskAttachment[] {
  return attachments.filter((a): a is TaskAttachment => isOwnAttachment(taskId, a));
}

export async function addTaskComment(input: {
  taskId: string;
  body: string;
  attachments?: TaskAttachment[];
  mentions?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await requireStaff();

  const body = input.body?.trim() ?? "";
  const attachments = sanitizeAttachments(input.taskId, input.attachments ?? []);
  if (!body && attachments.length === 0) return { ok: false, error: "אין מה לשלוח" };
  if (body.length > BODY_MAX) return { ok: false, error: "התגובה ארוכה מדי" };

  // Mentions come from the picker, but the client is not trusted with them:
  // keep only ids that are real staff profiles.
  const mentions = await staffIdsOnly(input.mentions ?? []);

  const { data, error } = await db
    .from("task_comments")
    .insert({
      task_id: input.taskId,
      author_id: session.sub,
      kind: "comment",
      body: body || null,
      attachments,
      mentions,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("task-comments: add failed", JSON.stringify(error));
    return { ok: false, error: "השליחה נכשלה" };
  }

  await logAudit({ action: "task.comment", entityType: "task", entityId: input.taskId, changes: { comment_id: data.id, mentions } });
  return { ok: true, id: data.id };
}

async function staffIdsOnly(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const { data, error } = await db.from("user_profiles").select("id,role").in("id", unique);
  if (error) {
    console.error("task-comments: mention check failed", JSON.stringify(error));
    return [];
  }
  return (data ?? [])
    .filter((user: { role: string }) => (STAFF_ROLES as readonly string[]).includes(user.role))
    .map((user: { id: string }) => user.id);
}

/** Author edits their own. An admin does NOT edit someone else's words - a
 *  comment edited by another hand is a forged quote. Admin power is deletion. */
export async function editTaskComment(id: string, body: string): Promise<Ok> {
  const session = await requireStaff();
  const text = body?.trim();
  if (!text) return { ok: false, error: "תגובה ריקה" };
  if (text.length > BODY_MAX) return { ok: false, error: "התגובה ארוכה מדי" };

  const { data, error } = await db
    .from("task_comments")
    .update({ body: text, edited_at: new Date().toISOString() })
    .eq("id", id)
    .eq("author_id", session.sub)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    console.error("task-comments: edit failed", JSON.stringify(error));
    return { ok: false, error: "העריכה נכשלה" };
  }
  if (!data?.length) return { ok: false, error: "אפשר לערוך רק תגובה שלך" };
  return { ok: true };
}

/** Soft delete: the row keeps its place, the content goes. */
export async function deleteTaskComment(id: string): Promise<Ok> {
  const session = await requireStaff();

  let query = db
    .from("task_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("kind", "comment");
  if (!isManager(session.role)) query = query.eq("author_id", session.sub);

  const { data, error } = await query.select("id,task_id");
  if (error) {
    console.error("task-comments: delete failed", JSON.stringify(error));
    return { ok: false, error: "המחיקה נכשלה" };
  }
  if (!data?.length) return { ok: false, error: "אין הרשאה למחוק את התגובה" };

  await logAudit({ action: "task.comment_delete", entityType: "task", entityId: data[0].task_id, changes: { comment_id: id } });
  return { ok: true };
}

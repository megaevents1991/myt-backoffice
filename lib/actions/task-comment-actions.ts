"use server";

import { randomUUID } from "crypto";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { requireTaskBoard, type TaskResult, type TaskScope, type TasksScope } from "@/lib/tasks-scope";
import { logAudit } from "@/lib/audit";
import { sniffAttachmentMime } from "@/lib/images/sniff";
import { notifyTaskMention } from "@/lib/services/task-mention-notify";
import { taskPeopleIds, taskPeopleOf } from "@/lib/services/task-people";
import { notifyTaskComment } from "@/lib/services/task-watch-notify";
import { ADMIN_ROLES } from "@/types/auth.types";
import type {
  Ok,
  StaffMentionOption,
  TaskAttachment,
  TaskComment,
  TaskThreadLoad,
} from "@/types/task-comment.types";
import { isValidTaskAttachmentPath } from "@/lib/tasks/attachment-path";
import type { ThreadCommentRow } from "@/lib/tasks/thread-watch";

/**
 * The thread of a task: comments, read marks and attachments.
 *
 * `task_comments`, `task_reads` and the `task-attachments` bucket carry no company column -
 * they hang off a task id. Every action here starts with `requireTaskBoard()` (the active
 * company and its scope, lib/tasks-scope.ts) and resolves the parent task inside that scope
 * BEFORE it touches a child row. A task of another company is then exactly a task that does
 * not exist: an empty thread, nothing stamped, "not found".
 */
const db = supabaseTyped;

const COMMENT_COLUMNS =
  "id,task_id,author_id,kind,body,activity,attachments,mentions,edited_at,deleted_at,created_at";

const BODY_MAX = 5000;
// Must stay under experimental.serverActions.bodySizeLimit ("3mb") in next.config.mjs -
// Next rejects the whole request before this action ever runs, so this ceiling only
// matters (and its Hebrew message only shows) while it sits below that framework limit.
const ATTACHMENT_MAX_BYTES = 2.5 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "application/pdf": "pdf",
};

function isManager(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

/** The comment's task belongs to the caller's company. A comment of another company's task -
 *  or no comment at all - is the same "not there". */
async function commentInScope(tasks: TasksScope, commentId: string): Promise<boolean> {
  const { data, error } = await db.from("task_comments").select("task_id").eq("id", commentId).maybeSingle();
  if (error) {
    console.error("task-comments: comment lookup failed", JSON.stringify(error));
    return false;
  }
  return !!data && (await tasks.owns(data.task_id));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Everything one opened thread needs, in ONE action: its comments, the read stamp and - when
 * the screen does not already hold them - the people for the @mention picker.
 *
 * It used to be three actions (comments, read stamp, people), and Next sends a tab's server
 * actions one at a time: each queued behind the other and paid the guard again - 23 database
 * round trips to open one task (measured 05.10). Here the guard runs once and whatever does
 * not wait for anything else is read side by side.
 *
 * Every staff member of the company reads every thread of its board (spec §3.4). The rows are
 * handed out only once the task is confirmed to be this company's - a task of another company
 * still reads as an empty thread, and nothing is stamped for it.
 */
export async function loadTaskThread(
  taskId: string,
  options: { withPeople?: boolean } = {},
): Promise<TaskThreadLoad> {
  const { session, company, tasks } = await requireTaskBoard();
  const nothing = { comments: [], read: { ok: false, previous: null } };
  // A malformed id can only be "not found" - and must not reach the child tables as a bad uuid.
  if (typeof taskId !== "string" || !UUID.test(taskId)) return { ...nothing, people: null };

  const [owned, thread, lastRead, people] = await Promise.all([
    tasks.owns(taskId),
    db.from("task_comments").select(COMMENT_COLUMNS).eq("task_id", taskId).order("created_at", { ascending: true }),
    db.from("task_reads").select("last_read_at").eq("task_id", taskId).eq("user_id", session.sub).maybeSingle(),
    options.withPeople ? taskPeopleOf(company) : null,
  ]);
  if (!owned) return { ...nothing, people };
  if (thread.error) {
    // Nothing was shown, so nothing is stamped read.
    console.error("task-comments: list failed", JSON.stringify(thread.error));
    return { ...nothing, people };
  }
  const rows = (thread.data ?? []) as TaskComment[];

  const [nameOf, urlOf, read] = await Promise.all([
    namesOf(rows),
    signedUrlMap(rows.flatMap((r) => (r.deleted_at ? [] : r.attachments.map((a) => a.path)))),
    stampRead(taskId, session, lastRead),
  ]);

  return {
    comments: rows.map((row) => ({
      ...row,
      // A deleted comment keeps its place in the thread but gives up its content.
      body: row.deleted_at ? null : row.body,
      attachments: row.deleted_at ? [] : row.attachments,
      author_name: row.author_id ? (nameOf.get(row.author_id) ?? null) : null,
      mention_names: row.mentions.map((id) => nameOf.get(id) ?? "משתמש"),
      attachment_urls: row.deleted_at ? [] : row.attachments.map((a) => urlOf.get(a.path) ?? ""),
    })),
    read,
    people,
  };
}

/** Display names of everyone who wrote or was mentioned in these rows. */
async function namesOf(rows: TaskComment[]): Promise<Map<string, string>> {
  const nameOf = new Map<string, string>();
  const ids = [...new Set(rows.flatMap((r) => [r.author_id, ...r.mentions]).filter((v): v is string => !!v))];
  if (!ids.length) return nameOf;
  const { data: users, error } = await db.from("user_profiles").select("id,display_name,email").in("id", ids);
  if (error) console.error("task-comments: names failed", JSON.stringify(error));
  for (const user of (users ?? []) as { id: string; display_name: string | null; email: string }[]) {
    nameOf.set(user.id, user.display_name || user.email);
  }
  return nameOf;
}

/** The thread was just shown to this person: stamp it read, and hand back the PREVIOUS
 *  stamp so the thread can point at what is new since then (null = first time here).
 *  `ok: false` = nothing was stamped (a failed read or write, the table not migrated yet),
 *  so the caller keeps its marker and shows no "new" badges. Best-effort - a failure only
 *  costs the marker, never the thread. An impersonating admin reads without stamping: the
 *  unread state is the real person's, not the visitor's. The caller has already confirmed
 *  the task belongs to the session's company. */
async function stampRead(
  taskId: string,
  session: { sub: string; impersonator?: unknown },
  lastRead: { data: { last_read_at: string } | null; error: unknown },
): Promise<{ ok: boolean; previous: string | null }> {
  if (lastRead.error) {
    console.error("task-comments: last-read lookup failed", JSON.stringify(lastRead.error));
    return { ok: false, previous: null };
  }
  const previous = lastRead.data?.last_read_at ?? null;
  if (session.impersonator) return { ok: false, previous };

  const { error } = await db
    .from("task_reads")
    .upsert(
      { task_id: taskId, user_id: session.sub, last_read_at: new Date().toISOString() },
      { onConflict: "task_id,user_id" },
    );
  if (error) {
    console.error("task-comments: mark read failed", JSON.stringify(error));
    return { ok: false, previous };
  }
  return { ok: true, previous };
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

/** The people of the active company, for the @mention and reviewer pickers. `listUsers`
 *  (user-actions.ts) is admin-only, so an editor writing a comment would be refused - this
 *  is open to every staff member of the company and shaped down to just what a picker
 *  needs. Who counts as the company's people: lib/services/task-people.ts (Mega Events =
 *  the active staff list it always was). */
export async function listStaffForMentions(): Promise<StaffMentionOption[]> {
  const { company } = await requireTaskBoard();
  return (await taskPeopleOf(company)) ?? [];
}

/** Upload one pasted/dropped/picked file - a screenshot or a PDF. The path is derived
 *  server-side from the task id and a uuid - a client-supplied name never reaches the storage path. */
export async function uploadTaskAttachment(
  taskId: string,
  form: FormData,
): Promise<{ ok: true; attachment: TaskAttachment } | { ok: false; error: string }> {
  const { tasks } = await requireTaskBoard();

  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "לא התקבל קובץ" };
  if (file.size === 0) return { ok: false, error: "הקובץ ריק" };
  if (file.size > ATTACHMENT_MAX_BYTES) return { ok: false, error: "הקובץ גדול מ-2.5MB" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = sniffAttachmentMime(new Uint8Array(buffer.subarray(0, 12)));
  if (!mime) return { ok: false, error: "אפשר להעלות תמונה (PNG/JPG/WebP/GIF) או PDF" };

  // The task must exist IN THIS COMPANY and not be deleted - otherwise the bucket
  // collects orphan folders no screen will ever show (or a file under another
  // company's task).
  const { data: task, error: taskError } = (await tasks
    .select("id").eq("id", taskId).is("deleted_at", null).maybeSingle()) as TaskResult<{ id: string }>;
  if (taskError) console.error("task-comments: task lookup failed", JSON.stringify(taskError));
  if (taskError || !task) return { ok: false, error: "המשימה לא נמצאה" };

  const path = `${taskId}/${randomUUID()}.${EXT[mime]}`;
  const { error } = await supabase.storage
    .from("task-attachments")
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (error) {
    console.error("task-comments: upload failed", JSON.stringify(error));
    return { ok: false, error: "ההעלאה נכשלה" };
  }

  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  return {
    ok: true,
    attachment: {
      path,
      // Display name only - never used to build a path.
      name: (file.name || "screenshot").slice(0, 120),
      mime,
      size: file.size,
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
    },
  };
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
  const { session, company, tasks } = await requireTaskBoard();

  const body = input.body?.trim() ?? "";
  const attachments = sanitizeAttachments(input.taskId, input.attachments ?? []);
  if (!body && attachments.length === 0) return { ok: false, error: "אין מה לשלוח" };
  if (body.length > BODY_MAX) return { ok: false, error: "התגובה ארוכה מדי" };
  // A task of another company fails exactly like a task id that does not exist
  // (the insert below would hit the foreign key).
  if (!(await tasks.owns(input.taskId))) return { ok: false, error: "השליחה נכשלה" };

  // Mentions come from the picker, but the client is not trusted with them:
  // keep only ids that are people of this company.
  const mentions = await staffIdsOnly(input.mentions ?? [], company);

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

  // Mentioned people get the mention mail; everyone else the conversation belongs to
  // (creator, assignee, whoever wrote or was mentioned in it before - so a reply reaches
  // the person it answers) gets the "new comment" mail - never both for one comment,
  // never the author.
  const { data: task, error: taskError } = (await tasks
    .select("id,title,created_by,assignee_id")
    .eq("id", input.taskId)
    .maybeSingle()) as TaskResult<{ id: string; title: string; created_by: string | null; assignee_id: string | null }>;
  if (taskError) console.error("task-comments: task lookup failed", JSON.stringify(taskError));
  if (mentions.length) {
    await notifyTaskMention({
      taskId: input.taskId,
      companyId: company.id,
      taskTitle: task?.title ?? "משימה",
      body,
      authorId: session.sub,
      mentionIds: mentions,
    });
  }
  if (task) {
    const { data: earlier, error: earlierError } = await db
      .from("task_comments")
      .select("task_id,author_id,created_at,mentions")
      .eq("task_id", input.taskId)
      .eq("kind", "comment")
      .is("deleted_at", null)
      .neq("id", data.id);
    // Without the earlier comments the mail still reaches the creator and the assignee.
    if (earlierError) console.error("task-comments: thread lookup failed", JSON.stringify(earlierError));
    await notifyTaskComment({
      task: {
        id: task.id,
        company_id: company.id,
        title: task.title,
        created_by: task.created_by,
        assignee_id: task.assignee_id,
      },
      authorId: session.sub,
      body,
      attachmentCount: attachments.length,
      mentionedIds: mentions,
      earlier: (earlier ?? []) as ThreadCommentRow[],
    });
  }

  return { ok: true, id: data.id };
}

/**
 * Files picked in the New-task dialog (Dor, 30.09). They can only be uploaded once the task
 * has an id, so they land as the task's FIRST comment - the thread is where every attachment
 * lives and is shown. No mail: the assignment mail for this same task went out a second ago,
 * and the assignee still sees the comment as unread on the board. Only the person who just
 * created the task may call this, and only while its thread is still empty.
 */
export async function attachFilesToNewTask(taskId: string, files: TaskAttachment[]): Promise<Ok> {
  const { session, tasks } = await requireTaskBoard();

  const attachments = sanitizeAttachments(taskId, files ?? []);
  if (attachments.length === 0) return { ok: false, error: "אין קבצים לצרף" };

  const { data: task, error: taskError } = (await tasks
    .select("id,created_by").eq("id", taskId).is("deleted_at", null).maybeSingle()) as TaskResult<{ id: string; created_by: string | null }>;
  if (taskError) console.error("task-comments: task lookup failed", JSON.stringify(taskError));
  if (taskError || !task) return { ok: false, error: "המשימה לא נמצאה" };
  if (task.created_by !== session.sub) return { ok: false, error: "רק מי שפתח את המשימה מצרף לה קבצים כאן" };

  const { count, error: countError } = await db
    .from("task_comments")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId)
    .eq("kind", "comment");
  if (countError) console.error("task-comments: thread count failed", JSON.stringify(countError));
  if (countError || (count ?? 0) > 0) return { ok: false, error: "השיחה כבר התחילה - מצרפים בתגובה" };

  const { data, error } = await db
    .from("task_comments")
    .insert({ task_id: taskId, author_id: session.sub, kind: "comment", body: null, attachments, mentions: [] })
    .select("id")
    .single();
  if (error || !data) {
    console.error("task-comments: attach to new task failed", JSON.stringify(error));
    return { ok: false, error: "צירוף הקבצים נכשל" };
  }

  await logAudit({
    action: "task.comment",
    entityType: "task",
    entityId: taskId,
    changes: { comment_id: data.id, attachments: attachments.length, on_create: true },
  });
  return { ok: true };
}

async function staffIdsOnly(ids: string[], company: TaskScope): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  // Same gate as listStaffForMentions: an inactive profile, or someone who does not
  // work in this company, is never mentionable/mailed. A failed read mentions nobody.
  const people = await taskPeopleIds(company);
  if (!people) return [];
  return unique.filter((id) => people.has(id));
}

/** Author edits their own. An admin does NOT edit someone else's words - a
 *  comment edited by another hand is a forged quote. Admin power is deletion. */
export async function editTaskComment(id: string, body: string): Promise<Ok> {
  const { session, tasks } = await requireTaskBoard();
  const text = body?.trim();
  if (!text) return { ok: false, error: "תגובה ריקה" };
  if (text.length > BODY_MAX) return { ok: false, error: "התגובה ארוכה מדי" };
  // Not this company's thread = not a comment of yours (the answer for a missing id).
  if (!(await commentInScope(tasks, id))) return { ok: false, error: "אפשר לערוך רק תגובה שלך" };

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
  const { session, tasks } = await requireTaskBoard();
  // Not this company's thread = nothing to delete (the answer for a missing id).
  if (!(await commentInScope(tasks, id))) return { ok: false, error: "אין הרשאה למחוק את התגובה" };

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

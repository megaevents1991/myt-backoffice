/** One thread per task: human comments and system activity rows share a table
 *  so the story reads in one chronological list. Spec §3. */

/** Shared server-action result shape for the comment/attachment actions - a
 *  "use server" file may only export async functions (Next 15), so this
 *  lives here for lib/actions/task-comment-actions.ts (a later task) to
 *  import rather than declare locally. */
export type Ok = { ok: true } | { ok: false; error: string };

export interface TaskAttachment {
  /** Storage path inside the private task-attachments bucket: {task_id}/{uuid}.{ext} */
  path: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

export const ACTIVITY_FIELDS = [
  "status",
  "assignee",
  "priority",
  "due_date",
  "progress",
  "board",
] as const;
export type ActivityField = (typeof ACTIVITY_FIELDS)[number];

export interface TaskActivity {
  field: ActivityField;
  from: string | null;
  to: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string | null;
  kind: "comment" | "activity";
  body: string | null;
  activity: TaskActivity | null;
  attachments: TaskAttachment[];
  mentions: string[];
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface TaskCommentWithAuthor extends TaskComment {
  author_name: string | null;
  /** Display names of `mentions`, same order. */
  mention_names: string[];
  /** Signed URLs for `attachments`, same order, valid one hour. */
  attachment_urls: string[];
}

/** One staff member, for the @mention picker only - never a full UserProfile. */
export interface StaffMentionOption {
  id: string;
  display_name: string | null;
  email: string;
}

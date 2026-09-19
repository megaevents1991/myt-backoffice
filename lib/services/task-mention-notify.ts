/** "You were mentioned in a task" mail. Sister of task-notify.ts: same
 *  transport, same best-effort contract - a mail failure is logged and never
 *  fails the comment write (spec §3.3). */
import { appOrigin, sendMail } from "@/lib/email";
import { supabaseTyped } from "@/lib/supabase-server";

const db = supabaseTyped;

/** The mail carries the comment itself, not a teaser (Dor, 19.09) - long enough for any
 *  real comment, short enough that a pasted log does not become the mail. */
const COMMENT_MAIL_MAX = 2000;

/** The comment as the mails quote it. A comment with no words is a screenshot. */
export function commentForMail(body: string): string {
  const text = body.trim() || "(צילום מסך)";
  return text.length > COMMENT_MAIL_MAX ? `${text.slice(0, COMMENT_MAIL_MAX)}…` : text;
}

export interface TaskMentionInput {
  taskId: string;
  taskTitle: string;
  body: string;
  authorId: string | null;
  mentionIds: string[];
}

export async function notifyTaskMention(input: TaskMentionInput): Promise<void> {
  try {
    const targets = input.mentionIds.filter((id) => id !== input.authorId);
    if (!targets.length) return;

    const ids = [...targets, ...(input.authorId ? [input.authorId] : [])];
    const { data, error } = await db.from("user_profiles").select("id,email,display_name").in("id", ids);
    if (error) throw error;
    const profiles = (data ?? []) as { id: string; email: string; display_name: string | null }[];
    const author = profiles.find((p) => p.id === input.authorId);
    const authorName = author?.display_name || author?.email || "מישהו";

    const url = `${appOrigin()}/tasks?task=${input.taskId}`;
    const excerpt = commentForMail(input.body);

    const mailPromises = profiles
      .filter((p) => targets.includes(p.id))
      .map((target) => {
        if (!target.email) return Promise.resolve();
        return sendMail({
          to: target.email,
          subject: `אוזכרת במשימה: ${input.taskTitle}`,
          html: `<div dir="rtl" style="font-family:Arial,sans-serif">
  <p>${escapeHtml(authorName)} אזכר/ה אותך במשימה <strong>${escapeHtml(input.taskTitle)}</strong>:</p>
  <blockquote style="border-right:3px solid #5BFF95;margin:0;padding:0 12px;color:#333;white-space:pre-line">${escapeHtml(excerpt)}</blockquote>
  <p><a href="${url}">למשימה</a></p>
</div>`,
          text: [`${authorName} אזכר/ה אותך במשימה: ${input.taskTitle}`, excerpt, url].join("\n"),
        });
      });

    const results = await Promise.allSettled(mailPromises);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("task-mention-notify failed", result.reason instanceof Error ? result.reason.message : JSON.stringify(result.reason));
      }
    }
  } catch (error) {
    console.error("task-mention-notify failed", error instanceof Error ? error.message : JSON.stringify(error));
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "Your task moved" mails (Alon, 2026-09-18: "לא קיבלתי מייל שהיא סיימה את המשימה
 *  או הגיבה עליה"). Sisters of task-notify.ts / task-mention-notify.ts: same
 *  transport, same best-effort contract - a mail failure is logged and never
 *  fails the status change or the comment write.
 *
 *  Who hears what: a task marked DONE mails the person who created it; a new
 *  COMMENT mails the creator and the assignee. The person acting is never mailed
 *  about their own action, and someone the comment @mentions already gets the
 *  mention mail, so they are left out here. A rule-made task has no human creator -
 *  only its assignee can be reached. */
import { appOrigin, sendMail } from "@/lib/email";
import { supabaseTyped } from "@/lib/supabase-server";
import { escapeHtml } from "@/lib/services/task-mention-notify";

const db = supabaseTyped;

const EXCERPT_MAX = 300;

interface WatchedTask {
  id: string;
  title: string;
  created_by: string | null;
  assignee_id: string | null;
}

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean | null;
}

async function loadProfiles(ids: string[]): Promise<Profile[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const { data, error } = await db
    .from("user_profiles")
    .select("id,email,display_name,is_active")
    .in("id", unique);
  if (error) throw error;
  return (data ?? []) as Profile[];
}

const nameOf = (profile: Profile | undefined, fallback: string) =>
  profile?.display_name || profile?.email || fallback;

async function mailEach(
  what: string,
  taskId: string,
  targets: Profile[],
  build: (target: Profile) => { subject: string; html: string; text: string },
): Promise<void> {
  const results = await Promise.allSettled(
    targets.map((target) => sendMail({ to: target.email, ...build(target) })),
  );
  results.forEach((result, index) => {
    const to = targets[index]?.email;
    if (result.status === "rejected") {
      console.error(
        `tasks: ${what} mail failed for task ${taskId} -> ${to}`,
        result.reason instanceof Error ? result.reason.message : JSON.stringify(result.reason),
      );
    } else {
      console.log(`tasks: ${what} mail sent for task ${taskId} -> ${to}`);
    }
  });
}

/** A task was marked done - tell the person who opened it. */
export async function notifyTaskDone(input: {
  task: WatchedTask;
  actorId: string | null;
}): Promise<void> {
  try {
    const { task, actorId } = input;
    if (!task.created_by || task.created_by === actorId) return;

    const profiles = await loadProfiles([task.created_by, ...(actorId ? [actorId] : [])]);
    const creator = profiles.find((p) => p.id === task.created_by);
    if (!creator?.email || creator.is_active === false) {
      console.log(`tasks: done mail skipped for task ${task.id} - creator has no active mailbox`);
      return;
    }
    const actorName = nameOf(profiles.find((p) => p.id === actorId), "מישהו");
    const url = `${appOrigin()}/tasks?task=${task.id}`;

    await mailEach("done", task.id, [creator], () => ({
      subject: `בוצע: ${task.title}`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif">
  <p>${escapeHtml(actorName)} סימן/ה את המשימה <strong>${escapeHtml(task.title)}</strong> כבוצעה.</p>
  <p><a href="${url}">למשימה</a></p>
</div>`,
      text: [`${actorName} סימן/ה את המשימה כבוצעה: ${task.title}`, url].join("\n"),
    }));
  } catch (error) {
    console.error(
      `tasks: done mail failed for task ${input.task.id}`,
      error instanceof Error ? error.message : JSON.stringify(error),
    );
  }
}

/** A new comment - tell the creator and the assignee (not the author, not the mentioned). */
export async function notifyTaskComment(input: {
  task: WatchedTask;
  authorId: string | null;
  body: string;
  /** Already mailed by notifyTaskMention - one mail per comment per person. */
  mentionedIds: string[];
}): Promise<void> {
  try {
    const { task, authorId, mentionedIds } = input;
    const targetIds = [task.created_by, task.assignee_id].filter(
      (id): id is string => !!id && id !== authorId && !mentionedIds.includes(id),
    );
    if (!targetIds.length) return;

    const profiles = await loadProfiles([...targetIds, ...(authorId ? [authorId] : [])]);
    const targets = profiles.filter(
      (p) => targetIds.includes(p.id) && !!p.email && p.is_active !== false,
    );
    if (!targets.length) {
      console.log(`tasks: comment mail skipped for task ${task.id} - nobody with an active mailbox`);
      return;
    }
    const authorName = nameOf(profiles.find((p) => p.id === authorId), "מישהו");
    const url = `${appOrigin()}/tasks?task=${task.id}`;
    const text = input.body || "(צילום מסך)";
    const excerpt = text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text;

    await mailEach("comment", task.id, targets, () => ({
      subject: `תגובה חדשה במשימה: ${task.title}`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif">
  <p>${escapeHtml(authorName)} הגיב/ה במשימה <strong>${escapeHtml(task.title)}</strong>:</p>
  <blockquote style="border-right:3px solid #5BFF95;margin:0;padding:0 12px;color:#333;white-space:pre-line">${escapeHtml(excerpt)}</blockquote>
  <p><a href="${url}">למשימה</a></p>
</div>`,
      text: [`${authorName} הגיב/ה במשימה: ${task.title}`, excerpt, url].join("\n"),
    }));
  } catch (error) {
    console.error(
      `tasks: comment mail failed for task ${input.task.id}`,
      error instanceof Error ? error.message : JSON.stringify(error),
    );
  }
}

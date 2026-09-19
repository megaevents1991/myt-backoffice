/** "Your task moved" mails (Alon, 2026-09-18: "לא קיבלתי מייל שהיא סיימה את המשימה
 *  או הגיבה עליה"). Sisters of task-notify.ts / task-mention-notify.ts: same
 *  transport, same best-effort contract - a mail failure is logged and never
 *  fails the status change or the comment write.
 *
 *  Who hears what: a task marked DONE mails the person who created it; a new
 *  COMMENT mails everyone the conversation belongs to - creator, assignee, and whoever
 *  wrote or was @mentioned in it before, so a REPLY reaches the person it answers
 *  (Dor, 19.09; the rule is `commentMailTargets`, lib/tasks/thread-watch.ts). The mail
 *  carries the comment itself. The person acting is never mailed about their own
 *  action, and someone the comment @mentions already gets the mention mail, so they
 *  are left out here. A rule-made task has no human creator - until someone writes on
 *  it only its assignee can be reached. */
import { appOrigin, sendMail } from "@/lib/email";
import { supabaseTyped } from "@/lib/supabase-server";
import { commentForMail, escapeHtml } from "@/lib/services/task-mention-notify";
import { commentMailTargets, type ThreadCommentRow } from "@/lib/tasks/thread-watch";

const db = supabaseTyped;

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

/** A new comment - tell everyone in the conversation (not the author, not the mentioned). */
export async function notifyTaskComment(input: {
  task: WatchedTask;
  authorId: string | null;
  body: string;
  /** How many screenshots ride on the comment - the mail cannot show them, so it says so. */
  attachmentCount: number;
  /** Already mailed by notifyTaskMention - one mail per comment per person. */
  mentionedIds: string[];
  /** The task's comments BEFORE this one: whoever wrote or was mentioned there hears the reply. */
  earlier: ThreadCommentRow[];
}): Promise<void> {
  try {
    const { task, authorId, mentionedIds } = input;
    const targetIds = commentMailTargets({ task, earlier: input.earlier, authorId, mentionedIds });
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
    const excerpt = commentForMail(input.body);
    const shots =
      input.attachmentCount > 0 && input.body.trim()
        ? input.attachmentCount === 1
          ? "צורף צילום מסך אחד - הוא מחכה במשימה."
          : `צורפו ${input.attachmentCount} צילומי מסך - הם מחכים במשימה.`
        : "";

    await mailEach("comment", task.id, targets, () => ({
      subject: `תגובה חדשה במשימה: ${task.title}`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif">
  <p>${escapeHtml(authorName)} הגיב/ה במשימה <strong>${escapeHtml(task.title)}</strong>:</p>
  <blockquote style="border-right:3px solid #5BFF95;margin:0;padding:0 12px;color:#333;white-space:pre-line">${escapeHtml(excerpt)}</blockquote>${shots ? `\n  <p style="color:#666;font-size:13px">${shots}</p>` : ""}
  <p><a href="${url}">למשימה ולתשובה</a></p>
</div>`,
      text: [`${authorName} הגיב/ה במשימה: ${task.title}`, excerpt, shots, url].filter(Boolean).join("\n"),
    }));
  } catch (error) {
    console.error(
      `tasks: comment mail failed for task ${input.task.id}`,
      error instanceof Error ? error.message : JSON.stringify(error),
    );
  }
}

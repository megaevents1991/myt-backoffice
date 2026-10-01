/** Reminder mails (Dor, 01.10 - lib/tasks/reminders.ts). Sisters of task-watch-notify.ts: same
 *  transport, same contract - every send/skip is logged, a failure never throws past here.
 *
 *  Two of them:
 *  - the REMINDER button: "<who> reminds you of <task>" to whoever owns the next move (the
 *    assignee, or the reviewers of a task in review);
 *  - the daily LATE digest: one mail per opener listing the tasks they opened whose deadline
 *    passed with no answer from the assignee. */
import { appOrigin, sendMail } from "@/lib/email";
import { supabaseTyped } from "@/lib/supabase-server";
import { taskUrl } from "@/lib/services/task-site-url";
import { escapeHtml } from "@/lib/services/task-mention-notify";
import type { TaskMailOutcome } from "@/lib/services/task-notify";
import type { TaskStatus } from "@/types/task.types";

const db = supabaseTyped;

const STATUS_HE: Record<TaskStatus, string> = {
  todo: "לביצוע",
  in_progress: "בעבודה",
  paused: "מושהית",
  review: "בבדיקה",
  done: "בוצעה",
  cancelled: "בוטלה",
};

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean | null;
}

async function loadProfiles(ids: string[]): Promise<Profile[]> {
  const unique = [...new Set(ids.filter(Boolean))];
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

const lateLine = (due: string | null, late: number) =>
  !due ? "" : late > 0 ? `תאריך היעד ${due} - עבר לפני ${late === 1 ? "יום" : `${late} ימים`}` : `תאריך יעד: ${due}`;

/** The reminder button. Returns "sent" when at least one target was handed to the mail server. */
export async function notifyTaskReminder(input: {
  /** `company_id` = the company of THIS task - its link opens that company's board (taskUrl). */
  task: { id: string; company_id: string; title: string; status: TaskStatus; due_date: string | null };
  /** Days past the deadline (lib/tasks/reminders.ts daysLate); 0 or less = not late. */
  daysLate: number;
  targetIds: string[];
  actorId: string;
}): Promise<{ mail: TaskMailOutcome; reached: string[] }> {
  const { task, actorId } = input;
  try {
    const profiles = await loadProfiles([...input.targetIds, actorId]);
    const targets = profiles.filter(
      (p) => input.targetIds.includes(p.id) && p.id !== actorId && !!p.email && p.is_active !== false,
    );
    if (!targets.length) {
      console.log(`tasks: reminder mail skipped for task ${task.id} - nobody with an active mailbox`);
      return { mail: "skipped", reached: [] };
    }
    const actorName = nameOf(profiles.find((p) => p.id === actorId), "מישהו");
    const url = await taskUrl(task.id, task.company_id);
    const ask =
      task.status === "review"
        ? "המשימה מחכה לבדיקה שלך: הכול בסדר - מסמנים Done; צריך עוד עבודה - מחזירים ל-In progress וכותבים בשיחה מה חסר."
        : "המשימה עדיין פתוחה אצלך. אם היא בוצעה - סמן/י אותה, ואם משהו תקוע - כתוב/כתבי בשיחה על המשימה.";
    const when = lateLine(task.due_date, input.daysLate);

    const results = await Promise.allSettled(
      targets.map((target) =>
        sendMail({
          to: target.email,
          subject: `תזכורת: ${task.title}`,
          html: `<div dir="rtl" style="font-family:Arial,sans-serif">
  <p>${escapeHtml(actorName)} מזכיר/ה לך את המשימה <strong>${escapeHtml(task.title)}</strong>.</p>
  <p style="color:#666;font-size:13px">סטטוס: ${STATUS_HE[task.status]}${when ? ` · ${escapeHtml(when)}` : ""}</p>
  <p>${escapeHtml(ask)}</p>
  <p><a href="${escapeHtml(url)}">למשימה ולשיחה עליה</a></p>
</div>`,
          text: [`${actorName} מזכיר/ה לך את המשימה: ${task.title}`, `סטטוס: ${STATUS_HE[task.status]}`, when, ask, url]
            .filter(Boolean)
            .join("\n"),
        }),
      ),
    );
    const reached: string[] = [];
    results.forEach((result, index) => {
      const target = targets[index];
      if (result.status === "rejected") {
        console.error(
          `tasks: reminder mail failed for task ${task.id} -> ${target?.email}`,
          result.reason instanceof Error ? result.reason.message : JSON.stringify(result.reason),
        );
      } else if (target) {
        reached.push(target.id);
        console.log(`tasks: reminder mail sent for task ${task.id} -> ${target.email}`);
      }
    });
    return { mail: reached.length > 0 ? "sent" : "failed", reached };
  } catch (error) {
    console.error(
      `tasks: reminder mail failed for task ${task.id}`,
      error instanceof Error ? error.message : JSON.stringify(error),
    );
    return { mail: "failed", reached: [] };
  }
}

export interface LateTaskLine {
  id: string;
  /** The company of THIS task (one digest may list tasks of several companies). */
  company_id: string;
  title: string;
  status: TaskStatus;
  due_date: string;
  days_late: number;
  assignee_name: string;
}

/** How many tasks one late digest lists before "ועוד N". */
const DIGEST_MAX = 25;

/** The daily check: ONE mail to an opener listing every task of theirs that is late with no answer. */
export async function notifyOverdueDigest(input: {
  openerId: string;
  tasks: LateTaskLine[];
}): Promise<TaskMailOutcome> {
  if (input.tasks.length === 0) return "skipped";
  try {
    const [opener] = await loadProfiles([input.openerId]);
    if (!opener?.email || opener.is_active === false) {
      console.log(`tasks: overdue digest skipped for ${input.openerId} - no active mailbox`);
      return "skipped";
    }
    const origin = appOrigin();
    const count = input.tasks.length;
    const shown = input.tasks.slice(0, DIGEST_MAX);
    const more = count - shown.length;
    // Each task links to the board of its own company; the board button names a company only
    // when every task in the mail is of the same one.
    const urlOf = new Map(
      await Promise.all(shown.map(async (task) => [task.id, await taskUrl(task.id, task.company_id)] as const)),
    );
    const companies = new Set(input.tasks.map((task) => task.company_id));
    const boardUrl = companies.size === 1 ? await taskUrl(null, input.tasks[0]?.company_id) : `${origin}/tasks`;
    const subject =
      count === 1 ? `עבר תאריך היעד ואין מענה: ${shown[0]?.title}` : `${count} משימות שפתחת עברו את תאריך היעד ואין מענה`;

    const rows = shown
      .map((task) => {
        const url = urlOf.get(task.id) ?? boardUrl;
        return `<tr>
  <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;"><a href="${escapeHtml(url)}" style="color:#111827;font-weight:bold;text-decoration:none;">${escapeHtml(task.title)}</a>
    <div style="color:#6b7280;font-size:12px;padding-top:2px;">${escapeHtml(task.assignee_name)} · ${STATUS_HE[task.status]} · ${escapeHtml(lateLine(task.due_date, task.days_late))}</div></td>
</tr>`;
      })
      .join("");
    const html = `<!doctype html>
<html dir="rtl" lang="he">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;padding:32px;" cellpadding="0" cellspacing="0" dir="rtl">
          <tr><td style="text-align:right;font-size:13px;color:#6b7280;padding-bottom:4px;">MYT Admin · משימות באיחור</td></tr>
          <tr><td style="text-align:right;font-size:20px;font-weight:bold;color:#111827;padding-bottom:8px;">${escapeHtml(subject)}</td></tr>
          <tr><td style="text-align:right;font-size:14px;color:#374151;line-height:1.6;padding-bottom:12px;">משימות שפתחת: תאריך היעד עבר, והאחראי עוד לא הגיב, לא עדכן סטטוס ולא כתב כלום מאז.</td></tr>
          <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl">${rows}</table>
            ${more > 0 ? `<div style="padding-top:6px;color:#6b7280;font-size:13px;">ועוד ${more}</div>` : ""}</td></tr>
          <tr><td style="text-align:right;font-size:13px;color:#6b7280;line-height:1.6;padding:16px 0 12px;">בכל משימה יש כפתור "תזכורת" ששולח לאחראי מייל, ובלוח המשימות הן מחכות לך תחת "באיחור, בלי מענה".</td></tr>
          <tr><td style="text-align:right;">
            <a href="${escapeHtml(boardUrl)}" style="display:inline-block;background:#0A1A14;color:#5BFF95;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;">ללוח המשימות</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

    await sendMail({
      to: opener.email,
      subject,
      html,
      text: [
        subject,
        ...shown.map(
          (task) =>
            `• ${task.title} - ${task.assignee_name} · ${STATUS_HE[task.status]} · ${lateLine(task.due_date, task.days_late)}\n  ${urlOf.get(task.id) ?? boardUrl}`,
        ),
        more > 0 ? `ועוד ${more}` : "",
        `לוח המשימות: ${boardUrl}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    console.log(`tasks: overdue digest sent -> ${opener.email} (${count} tasks)`);
    return "sent";
  } catch (error) {
    console.error(
      `tasks: overdue digest failed for ${input.openerId}`,
      error instanceof Error ? error.message : JSON.stringify(error),
    );
    return "failed";
  }
}

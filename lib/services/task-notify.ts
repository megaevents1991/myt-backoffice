/**
 * "You were assigned a task" email (Tom, 2026-09-10: "כשעשינו למישהו טאסק -
 * שיקבל הודעה במייל ששובץ לו משימה").
 *
 * Fired by createTask / updateTask when the assignee changes to someone other
 * than the person doing the assigning. Best-effort: a mail failure is logged
 * and never fails the task write.
 */

import { appOrigin, sendMail } from "@/lib/email";
import { supabase } from "@/lib/supabase-server";
import type { TaskPriority, TaskSourceRef } from "@/types/task.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const PRIORITY_HE: Record<TaskPriority, string> = {
  urgent: "דחוף",
  high: "גבוהה",
  medium: "בינונית",
  low: "נמוכה",
};

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
}

export interface TaskAssignedInput {
  taskId: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  sourceRef: TaskSourceRef | null;
  assigneeId: string;
  assignerId: string | null;
}

/** What became of the mail - the dialog's toast says so instead of promising one
 *  ("sent" = handed to the mail server, not proof it reached the inbox). */
export type TaskMailOutcome = "sent" | "skipped" | "failed";

export async function notifyTaskAssigned(input: TaskAssignedInput): Promise<TaskMailOutcome> {
  try {
    const ids = [input.assigneeId, input.assignerId].filter(
      (value): value is string => !!value,
    );
    const { data, error } = await db
      .from("user_profiles")
      .select("id,email,display_name")
      .in("id", ids);
    if (error) throw error;
    const profiles = (data ?? []) as Profile[];
    const assignee = profiles.find((p) => p.id === input.assigneeId);
    if (!assignee?.email) {
      console.error(`tasks: assignment mail skipped for task ${input.taskId} - assignee has no email`);
      return "skipped";
    }
    const assigner = profiles.find((p) => p.id === input.assignerId);
    const assignerName = assigner?.display_name || assigner?.email || "המערכת";

    const origin = appOrigin();
    const boardUrl = `${origin}/tasks?task=${input.taskId}`;
    // source_ref comes from the client side of a server action - only a
    // same-site relative path may become a link in the mail.
    const path = safeRelativePath(input.sourceRef?.url);
    const fixUrl = path ? `${origin}${path}` : null;

    await sendMail({
      to: assignee.email,
      subject: `משימה חדשה: ${input.title}`,
      html: taskAssignedHtml({ ...input, assignerName, boardUrl, fixUrl }),
      text: [
        `${assignerName} שיבץ/ה לך משימה: ${input.title}`,
        input.description ?? "",
        `עדיפות: ${PRIORITY_HE[input.priority]}`,
        input.dueDate ? `יעד: ${input.dueDate}` : "",
        fixUrl ? `לתיקון: ${fixUrl}` : "",
        `למשימה: ${boardUrl}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    console.log(`tasks: assignment mail sent for task ${input.taskId} -> ${assignee.email}`);
    return "sent";
  } catch (error) {
    console.error(
      `tasks: assignment mail failed for task ${input.taskId}`,
      error instanceof Error ? error.message : JSON.stringify(error),
    );
    return "failed";
  }
}

/** How many titles the per-item summary mail lists before "ועוד N". */
const SUMMARY_TITLES_MAX = 10;

export interface RuleTasksCreatedInput {
  ruleId: string;
  ruleName: string;
  assigneeId: string;
  titles: string[];
}

/**
 * ONE mail per assignee for a per-item rule's run (final review, I4) - a rule that
 * opens 25 tasks must not send 25 mails. Best-effort like notifyTaskAssigned: a
 * failure is logged and never fails the run. The caller never calls this on a dry run.
 */
export async function notifyRuleTasksCreated(input: RuleTasksCreatedInput): Promise<void> {
  if (input.titles.length === 0) return;
  try {
    const { data, error } = await db
      .from("user_profiles")
      .select("id,email,display_name")
      .eq("id", input.assigneeId)
      .maybeSingle();
    if (error) throw error;
    const assignee = data as Profile | null;
    if (!assignee?.email) return;

    const boardUrl = `${appOrigin()}/tasks`;
    const count = input.titles.length;
    const shown = input.titles.slice(0, SUMMARY_TITLES_MAX);
    const more = count - shown.length;
    const subject = `${count} משימות חדשות מהכלל ${input.ruleName}`;

    const items = shown
      .map((title) => `<li style="padding:2px 0;">${escapeHtml(title)}</li>`)
      .join("");
    const html = `<!doctype html>
<html dir="rtl" lang="he">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;" cellpadding="0" cellspacing="0" dir="rtl">
          <tr><td style="text-align:right;font-size:13px;color:#6b7280;padding-bottom:4px;">MYT Admin · משימות חוזרות</td></tr>
          <tr><td style="text-align:right;font-size:20px;font-weight:bold;color:#111827;padding-bottom:12px;">${escapeHtml(subject)}</td></tr>
          <tr><td style="text-align:right;font-size:14px;color:#374151;line-height:1.6;padding-bottom:16px;">
            <ul style="margin:0;padding-right:18px;">${items}</ul>
            ${more > 0 ? `<div style="padding-top:6px;color:#6b7280;">ועוד ${more}</div>` : ""}
          </td></tr>
          <tr><td style="text-align:right;padding-bottom:12px;">
            <a href="${escapeHtml(boardUrl)}" style="display:inline-block;background:#0A1A14;color:#5BFF95;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;">ללוח המשימות</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

    await sendMail({
      to: assignee.email,
      subject,
      html,
      text: [
        subject,
        ...shown.map((title) => `• ${title}`),
        more > 0 ? `ועוד ${more}` : "",
        `לוח המשימות: ${boardUrl}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch (error) {
    console.error(
      `tasks: rule summary mail failed for rule ${input.ruleId}`,
      error instanceof Error ? error.message : JSON.stringify(error),
    );
  }
}

function taskAssignedHtml(params: {
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  sourceRef: TaskSourceRef | null;
  assignerName: string;
  boardUrl: string;
  fixUrl: string | null;
}): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;white-space:nowrap;">${label}</td><td style="padding:4px 12px;color:#111827;font-size:14px;">${value}</td></tr>`;

  return `<!doctype html>
<html dir="rtl" lang="he">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;" cellpadding="0" cellspacing="0" dir="rtl">
          <tr><td style="text-align:right;font-size:13px;color:#6b7280;padding-bottom:4px;">MYT Admin · משימה חדשה</td></tr>
          <tr><td style="text-align:right;font-size:20px;font-weight:bold;color:#111827;padding-bottom:12px;">${escapeHtml(params.title)}</td></tr>
          <tr><td style="text-align:right;font-size:15px;color:#374151;line-height:1.6;padding-bottom:16px;">${escapeHtml(params.assignerName)} שיבץ/ה לך את המשימה הזו.</td></tr>
          ${
            params.description
              ? `<tr><td style="text-align:right;font-size:14px;color:#374151;line-height:1.6;padding-bottom:16px;white-space:pre-line;">${escapeHtml(params.description)}</td></tr>`
              : ""
          }
          <tr><td style="padding-bottom:20px;"><table role="presentation" cellpadding="0" cellspacing="0" dir="rtl">
            ${row("עדיפות", escapeHtml(PRIORITY_HE[params.priority]))}
            ${params.dueDate ? row("תאריך יעד", escapeHtml(params.dueDate)) : ""}
            ${params.sourceRef?.label ? row("נושא", escapeHtml(params.sourceRef.label)) : ""}
          </table></td></tr>
          <tr><td style="text-align:right;padding-bottom:12px;">
            <a href="${escapeHtml(params.fixUrl ?? params.boardUrl)}" style="display:inline-block;background:#0A1A14;color:#5BFF95;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;">${params.fixUrl ? "לתיקון" : "למשימה"}</a>
          </td></tr>
          <tr><td style="text-align:right;font-size:13px;color:#6b7280;line-height:1.6;"><a href="${escapeHtml(params.boardUrl)}" style="color:#6b7280;">למשימה ולשיחה עליה</a></td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** "/tasks", "/events/12#fix-price" - not "//evil", not "javascript:", no control chars. */
function safeRelativePath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s<>"'`]/.test(value)) return null;
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

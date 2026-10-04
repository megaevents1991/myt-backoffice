/**
 * The morning Follow-up reminder (Dor, 04.10: the dashboard shows the pile, and a mail makes
 * sure it is seen). Sunday-Thursday, ONE mail to the reminder list with every reservation in
 * Follow-up whose customer is waiting NOW - the call-back day is today, has passed, or was
 * never set (lib/reservations/follow-up.ts `needsCallNow`). A reservation with a later day is
 * left out until that day comes. Nobody waiting = no mail.
 *
 * It is a daily digest on purpose: a customer stays in it every morning until someone moves
 * the day or the status, which is the only way off the list. `dryRun` = the full report,
 * nothing mailed.
 */
import { DEFAULT_FROM, appOrigin, sendMail } from "@/lib/email";
import { escapeHtml } from "@/lib/services/task-mention-notify";
import { israelDate } from "@/lib/tasks/reminders";
import {
  FOLLOW_UP_STATUS,
  followUpCounts,
  followUpLabel,
  needsCallNow,
  type FollowUpCounts,
  type FollowUpState,
} from "@/lib/reservations/follow-up";
import { loadFollowUps, type FollowUpRow } from "@/lib/services/reservation-follow-ups";

/** How many reservations one mail lists before "ועוד N". */
const DIGEST_MAX = 30;

const LABEL_COLOR: Record<FollowUpState, string> = {
  overdue: "#b91c1c",
  today: "#b45309",
  undated: "#6b7280",
  upcoming: "#6b7280",
};

export interface FollowUpReminderSummary {
  dryRun: boolean;
  today: string;
  counts: FollowUpCounts;
  /** The reservations the mail lists (ids only - no customer details in logs). */
  waiting: { id: number; label: string }[];
  mails: { to: string; outcome: "sent" | "failed" | "dry-run" }[];
  errors: string[];
}

/** Alon's Mega mailbox (Dor, 04.10: "send it to Alon's Mega mail") - the same address every
 *  system mail is sent from. */
const DEFAULT_TO = DEFAULT_FROM;

/** Who gets the reminder: Alon's Mega mailbox, unless NEXT_SECRET_FOLLOW_UP_REMINDER_TO
 *  (comma-separated) names other addresses. An override with no usable address in it falls
 *  back to the default - a typo in an env var must not silence the reminder. */
export function followUpReminderRecipients(): string[] {
  const addresses = (process.env.NEXT_SECRET_FOLLOW_UP_REMINDER_TO ?? "")
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(part));
  return addresses.length > 0 ? [...new Set(addresses)] : [DEFAULT_TO];
}

function buildMail(rows: FollowUpRow[], today: string) {
  const origin = appOrigin();
  const listUrl = `${origin}/reservations?status=${encodeURIComponent(FOLLOW_UP_STATUS)}`;
  const count = rows.length;
  const shown = rows.slice(0, DIGEST_MAX);
  const more = count - shown.length;
  const subject =
    count === 1 ? `לחזור ללקוח: ${shown[0]?.name ?? ""}` : `${count} לקוחות מחכים שנחזור אליהם`;

  const htmlRows = shown
    .map((row) => {
      const url = `${origin}/reservations/${row.id}`;
      const label = followUpLabel(row.follow_up_date, today, "he");
      const phone = row.phone
        ? ` · <a href="tel:${escapeHtml(row.phone.replace(/[^\d+]/g, ""))}" style="color:#374151;text-decoration:none;" dir="ltr">${escapeHtml(row.phone)}</a>`
        : "";
      const comment = row.comments?.trim()
        ? `<div style="color:#374151;font-size:13px;padding-top:2px;">${escapeHtml(row.comments.trim())}</div>`
        : "";
      return `<tr>
  <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;"><a href="${escapeHtml(url)}" style="color:#111827;font-weight:bold;text-decoration:none;">${escapeHtml(row.name)}</a>${phone}
    <div style="color:#6b7280;font-size:12px;padding-top:2px;">${escapeHtml(row.event_name)} · הזמנה ${row.id} · <span style="color:${LABEL_COLOR[row.state]};font-weight:bold;">${escapeHtml(label)}</span></div>${comment}</td>
</tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html dir="rtl" lang="he">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;padding:32px;" cellpadding="0" cellspacing="0" dir="rtl">
          <tr><td style="text-align:right;font-size:13px;color:#6b7280;padding-bottom:4px;">MYT Admin · Follow-up</td></tr>
          <tr><td style="text-align:right;font-size:20px;font-weight:bold;color:#111827;padding-bottom:8px;">${escapeHtml(subject)}</td></tr>
          <tr><td style="text-align:right;font-size:14px;color:#374151;line-height:1.6;padding-bottom:12px;">הזמנות בסטטוס Follow-up שהיום שקבענו לחזור אל הלקוח הגיע, עבר, או שלא נקבע להן יום.</td></tr>
          <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl">${htmlRows}</table>
            ${more > 0 ? `<div style="padding-top:6px;color:#6b7280;font-size:13px;">ועוד ${more}</div>` : ""}</td></tr>
          <tr><td style="text-align:right;font-size:13px;color:#6b7280;line-height:1.6;padding:16px 0 12px;">הזמנה יורדת מהרשימה כשקובעים לה יום חזרה חדש או מעבירים אותה לסטטוס אחר (Paid / Lost).</td></tr>
          <tr><td style="text-align:right;">
            <a href="${escapeHtml(listUrl)}" style="display:inline-block;background:#0A1A14;color:#5BFF95;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;">לכל ההזמנות ב-Follow-up</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    subject,
    ...shown.map((row) => {
      const label = followUpLabel(row.follow_up_date, today, "he");
      const comment = row.comments?.trim() ? `\n  ${row.comments.trim()}` : "";
      return `• ${row.name}${row.phone ? ` · ${row.phone}` : ""} - ${row.event_name} · ${label}${comment}\n  ${origin}/reservations/${row.id}`;
    }),
    more > 0 ? `ועוד ${more}` : "",
    `כל ההזמנות ב-Follow-up: ${listUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export async function runFollowUpReminder(options: {
  dryRun: boolean;
  now?: Date;
}): Promise<FollowUpReminderSummary> {
  const today = israelDate(options.now ?? new Date());
  // Throws on a failed read - the route answers 500 instead of a quiet "nobody is waiting".
  const pile = await loadFollowUps(today);
  const waiting = pile.filter((row) => needsCallNow(row.state));
  const summary: FollowUpReminderSummary = {
    dryRun: options.dryRun,
    today,
    counts: followUpCounts(pile, today),
    waiting: waiting.map((row) => ({
      id: row.id,
      label: followUpLabel(row.follow_up_date, today, "en"),
    })),
    mails: [],
    errors: [],
  };
  if (waiting.length === 0) return summary;

  const recipients = followUpReminderRecipients();
  if (options.dryRun) {
    summary.mails = recipients.map((to) => ({ to, outcome: "dry-run" }));
    return summary;
  }

  const mail = buildMail(waiting, today);
  const results = await Promise.allSettled(recipients.map((to) => sendMail({ to, ...mail })));
  results.forEach((result, index) => {
    const to = recipients[index] ?? "?";
    if (result.status === "fulfilled") {
      summary.mails.push({ to, outcome: "sent" });
      console.log(`follow-up: reminder mail sent -> ${to} (${waiting.length} reservations)`);
      return;
    }
    const reason = result.reason instanceof Error ? result.reason.message : JSON.stringify(result.reason);
    summary.mails.push({ to, outcome: "failed" });
    summary.errors.push(`mail to ${to}: ${reason}`);
    console.error(`follow-up: reminder mail failed -> ${to}`, reason);
  });
  return summary;
}

/**
 * Mega Events' unanswered-chat alert (spec 2026-11-08 section 8, B-6): a chat waiting 60 working minutes for an answer
 * shows red on the WhatsApp screen and counts on the dashboard banner; the cron waEventsAlerts mails ONE digest of the
 * chats that BECAME unanswered since its last run (wa_chats.alerted_at is the dedupe - stamped only after the mail
 * went out, so a failed mail is retried next run). Session-free; the cron and the banner's action call it.
 */
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { appOrigin, DEFAULT_FROM, sendMail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import { isAlertTime, unansweredFor } from "@/lib/whatsapp/events/working-time";
import { sameNumber } from "@/lib/whatsapp/events/chat-rules";
import { markChat, reservationsByPhoneKeys } from "@/lib/services/whatsapp-events-db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Row = { id: string; phone: string; phone_key: string; profile_name: string | null; last_in_at: string | null; answered_at: string | null; alerted_at: string | null };
export type UnansweredChat = { id: string; phone: string; phoneKey: string; profileName: string | null; lastInAt: string; minutes: number; alertedAt: string | null };

/** The chats waiting 60+ working minutes for an answer, longest wait first. Throws on a failed read. */
export async function unansweredChats(companyId: string, now: Date): Promise<UnansweredChat[]> {
  const { rows, error } = await fetchPaged<Row>(
    () => db.from("wa_chats").select("id, phone, phone_key, profile_name, last_in_at, answered_at, alerted_at").eq("company_id", companyId).eq("is_unanswered", true).order("id"),
    20_000,
  );
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205" || code === "42703") return [];
    throw new Error(`wa_chats: ${error.message}`);
  }
  const out: UnansweredChat[] = [];
  for (const r of rows) {
    const minutes = unansweredFor(r.last_in_at, r.answered_at, now);
    if (minutes !== null && r.last_in_at) out.push({ id: r.id, phone: r.phone, phoneKey: r.phone_key, profileName: r.profile_name, lastInAt: r.last_in_at, minutes, alertedAt: r.alerted_at });
  }
  return out.sort((a, b) => b.minutes - a.minutes);
}

export async function countUnanswered(companyId: string, now: Date = new Date()): Promise<number> {
  return (await unansweredChats(companyId, now)).length;
}

const recipients = (): string[] => {
  const list = (process.env.NEXT_SECRET_WA_EVENTS_ALERT_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [DEFAULT_FROM];
};

const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export async function runEventsAlerts(opts: { dryRun: boolean; now?: Date; companyId?: string }): Promise<{ unanswered: number; mailed: number; chatIds: string[]; skipped?: string }> {
  const now = opts.now ?? new Date();
  const companyId = opts.companyId ?? MEGA_EVENTS_COMPANY_ID;
  if (!isAlertTime(now)) return { unanswered: 0, mailed: 0, chatIds: [], skipped: "outside working hours" };
  const all = await unansweredChats(companyId, now);
  // only chats that became unanswered since the last digest: never alerted, or alerted for an older message
  const fresh = all.filter((c) => !c.alertedAt || Date.parse(c.alertedAt) < Date.parse(c.lastInAt));
  if (fresh.length === 0 || opts.dryRun) return { unanswered: all.length, mailed: 0, chatIds: fresh.map((c) => c.id) };

  const orders = await reservationsByPhoneKeys(fresh.map((c) => c.phoneKey));
  const lines = fresh.map((c) => {
    const own = orders.filter((o) => o.phoneKey === c.phoneKey && !o.isDeleted && sameNumber(o.phone, c.phone));
    const name = own.find((o) => o.contactName)?.contactName || c.profileName || "ללא שם";
    const chips = own.slice(0, 3).map((o) => `#${o.id} ${o.status}`).join(", ");
    const url = `${appOrigin()}/whatsapp?chat=${encodeURIComponent(c.id)}`;
    return `<li>${escapeHtml(name)} · ****${escapeHtml(c.phone.slice(-4))} · ממתין ${hm(c.minutes)}${chips ? ` · ${escapeHtml(chips)}` : ""} · <a href="${escapeHtml(url)}">פתח</a></li>`;
  });
  await sendMail({
    to: recipients().join(", "),
    subject: `וואטסאפ מגה איבנטס: ${fresh.length} שיחות מחכות לתשובה`,
    html: `<div dir="rtl"><p>שיחות שמחכות יותר משעת עבודה לתשובה:</p><ul>${lines.join("")}</ul></div>`,
  });
  const at = now.toISOString();
  for (const c of fresh) await markChat(c.id, { alertedAt: at });
  return { unanswered: all.length, mailed: fresh.length, chatIds: fresh.map((c) => c.id) };
}

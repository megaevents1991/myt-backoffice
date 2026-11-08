/**
 * The boundary on Mega Events' WhatsApp tables - wa_chats and wa_app_auto_texts (migration 20261108190000) - and on
 * the reservation columns the conversation rules read (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md).
 * The new tables are not in types/database.types.ts yet, so they go through one `as any` cast HERE. A table that is not
 * there yet (42P01 / PGRST205) reads as empty with one warning per process; any other error throws. Server only.
 */
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { fetchPaged } from "@/lib/supabase-paged";
import { marksFor, normAutoText, type EventsResLite } from "@/lib/whatsapp/events/chat-rules";
import { israelToday } from "@/lib/marketing/range";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Keys / ids per .in() request - the list travels in the URL. */
const IN_CHUNK = 200;
const AUTO_TEXT_TTL_MS = 60_000;

type DbError = { code?: string; message?: string } | null | undefined;
const missingTable = (error: DbError): boolean => error?.code === "42P01" || error?.code === "PGRST205";
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`whatsapp-events-db: ${message}`);
}
const chunks = <T>(xs: T[], n = IN_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

// ---------------------------------------------------------------- chats

export type WaChat = {
  id: string;
  companyId: string;
  phone: string;
  phoneKey: string;
  profileName: string | null;
  lastInAt: string | null;
  lastOutAt: string | null;
  answeredAt: string | null;
  seenAt: string | null;
  linkedReservationId: number | null;
  optedOutAt: string | null;
  alertedAt: string | null;
};

export type ChatPatch = Partial<Pick<WaChat, "profileName" | "lastInAt" | "lastOutAt" | "answeredAt" | "seenAt">>;

const CHAT_COLUMNS =
  "id, company_id, phone, phone_key, profile_name, last_in_at, last_out_at, answered_at, seen_at, linked_reservation_id, opted_out_at, alerted_at";

type ChatRow = {
  id: string;
  company_id: string;
  phone: string;
  phone_key: string;
  profile_name: string | null;
  last_in_at: string | null;
  last_out_at: string | null;
  answered_at: string | null;
  seen_at: string | null;
  linked_reservation_id: number | null;
  opted_out_at: string | null;
  alerted_at: string | null;
};

const toChat = (r: ChatRow): WaChat => ({
  id: r.id,
  companyId: r.company_id,
  phone: r.phone,
  phoneKey: r.phone_key,
  profileName: r.profile_name,
  lastInAt: r.last_in_at,
  lastOutAt: r.last_out_at,
  answeredAt: r.answered_at,
  seenAt: r.seen_at,
  linkedReservationId: r.linked_reservation_id,
  optedOutAt: r.opted_out_at,
  alertedAt: r.alerted_at,
});

/** The later of two instants (null-safe): a webhook delivered out of order never moves a timestamp back. */
function later(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

export async function chatByKey(companyId: string, phoneKey: string): Promise<WaChat | null> {
  const { data, error } = await db.from("wa_chats").select(CHAT_COLUMNS).eq("company_id", companyId).eq("phone_key", phoneKey).maybeSingle();
  if (error) {
    if (missingTable(error)) {
      warnOnce("wa_chats", "wa_chats is missing (migration not applied)");
      return null;
    }
    throw new Error(`wa_chats: ${error.message}`);
  }
  return data ? toChat(data as ChatRow) : null;
}

export async function chatById(chatId: string): Promise<WaChat | null> {
  const { data, error } = await db.from("wa_chats").select(CHAT_COLUMNS).eq("id", chatId).maybeSingle();
  if (error) throw new Error(`wa_chats: ${error.message}`);
  return data ? toChat(data as ChatRow) : null;
}

/** Creates the chat or moves its timestamps FORWARD only; the profile name is filled only when empty. */
export async function upsertChat(companyId: string, phone: string, phoneKey: string, patch: ChatPatch): Promise<WaChat> {
  const current = await chatByKey(companyId, phoneKey);
  const row = {
    company_id: companyId,
    phone_key: phoneKey,
    phone: current?.phone ?? phone,
    profile_name: current?.profileName || patch.profileName || null,
    last_in_at: later(current?.lastInAt, patch.lastInAt),
    last_out_at: later(current?.lastOutAt, patch.lastOutAt),
    answered_at: later(current?.answeredAt, patch.answeredAt),
    seen_at: later(current?.seenAt, patch.seenAt),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db.from("wa_chats").upsert(row, { onConflict: "company_id,phone_key" }).select(CHAT_COLUMNS).single();
  if (error) throw new Error(`wa_chats: ${error.message}`);
  return toChat(data as ChatRow);
}

export type ChatMark = {
  seenAt?: string;
  seenBy?: string | null;
  answeredAt?: string;
  linkedReservationId?: number | null;
  linkedBy?: string | null;
  optedOutAt?: string | null;
  optedOutSource?: string | null;
  alertedAt?: string;
};

export async function markChat(chatId: string, patch: ChatMark): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.seenAt !== undefined) row.seen_at = patch.seenAt;
  if (patch.seenBy !== undefined) row.seen_by = patch.seenBy;
  if (patch.answeredAt !== undefined) row.answered_at = patch.answeredAt;
  if (patch.linkedReservationId !== undefined) {
    row.linked_reservation_id = patch.linkedReservationId;
    row.linked_by = patch.linkedBy ?? null;
    row.linked_at = patch.linkedReservationId === null ? null : new Date().toISOString();
  }
  if (patch.optedOutAt !== undefined) {
    row.opted_out_at = patch.optedOutAt;
    row.opted_out_source = patch.optedOutSource ?? null;
  }
  if (patch.alertedAt !== undefined) row.alerted_at = patch.alertedAt;
  const { error } = await db.from("wa_chats").update(row).eq("id", chatId);
  if (error) throw new Error(`wa_chats: ${error.message}`);
}

export type ChatFilter = "all" | "new" | "unanswered" | "no_order";
/** The newest chats the "no order" filter looks through (it is resolved against reservations in code). */
const NO_ORDER_SCAN = 500;

export async function listChats(companyId: string, filter: ChatFilter, page: number, pageSize: number): Promise<{ rows: WaChat[]; total: number }> {
  const from = Math.max(0, page) * pageSize;
  if (filter === "no_order") {
    const { data, error } = await db
      .from("wa_chats")
      .select(CHAT_COLUMNS)
      .eq("company_id", companyId)
      .is("linked_reservation_id", null)
      .order("last_in_at", { ascending: false, nullsFirst: false })
      .limit(NO_ORDER_SCAN);
    if (error) {
      if (missingTable(error)) return { rows: [], total: 0 };
      throw new Error(`wa_chats: ${error.message}`);
    }
    const chats = ((data ?? []) as ChatRow[]).map(toChat);
    const withOrders = new Set((await reservationsByPhoneKeys(chats.map((c) => c.phoneKey))).map((r) => r.phoneKey));
    const lonely = chats.filter((c) => !withOrders.has(c.phoneKey));
    return { rows: lonely.slice(from, from + pageSize), total: lonely.length };
  }
  let query = db.from("wa_chats").select(CHAT_COLUMNS, { count: "exact" }).eq("company_id", companyId);
  if (filter === "new") query = query.eq("is_unseen", true);
  if (filter === "unanswered") query = query.eq("is_unanswered", true);
  const { data, error, count } = await query.order("last_in_at", { ascending: false, nullsFirst: false }).range(from, from + pageSize - 1);
  if (error) {
    if (missingTable(error)) return { rows: [], total: 0 };
    throw new Error(`wa_chats: ${error.message}`);
  }
  return { rows: ((data ?? []) as ChatRow[]).map(toChat), total: count ?? 0 };
}

/** Every chat with an unseen live inbound message (few: the "new" mark of the reservations list). */
export async function unseenChats(companyId: string): Promise<WaChat[]> {
  const { rows, error } = await fetchPaged<ChatRow>(
    () => db.from("wa_chats").select(CHAT_COLUMNS).eq("company_id", companyId).eq("is_unseen", true).order("id"),
    20_000,
  );
  if (error) {
    if (missingTable(error as DbError)) return [];
    throw new Error(`wa_chats: ${error.message}`);
  }
  return rows.map(toChat);
}

/** The chats a reservation's thread is made of: its phone's chat and any chat a rep attached to it (R-1, R-3). */
export async function chatsOfReservation(companyId: string, reservationId: number, phoneKey: string): Promise<WaChat[]> {
  const parts: WaChat[] = [];
  if (phoneKey) {
    const own = await chatByKey(companyId, phoneKey);
    if (own) parts.push(own);
  }
  const { data, error } = await db.from("wa_chats").select(CHAT_COLUMNS).eq("company_id", companyId).eq("linked_reservation_id", reservationId);
  if (error) {
    if (missingTable(error)) return parts;
    throw new Error(`wa_chats: ${error.message}`);
  }
  for (const r of (data ?? []) as ChatRow[]) if (!parts.some((c) => c.id === r.id)) parts.push(toChat(r));
  return parts;
}

// ---------------------------------------------------------------- reservations

export type EventsOrderLite = EventsResLite & { phoneKey: string; eventId: number | null; contactName: string };

type ResRow = {
  id: number;
  status: string | null;
  created_at: string;
  is_deleted: string | null;
  main_contact_phone_key: string | null;
  event_id: number | null;
  main_contact_first_name: string | null;
  main_contact_last_name: string | null;
};

/** The orders of these phone keys with their event's date (two reads; keys and event ids chunked by 200). */
export async function reservationsByPhoneKeys(keys: string[]): Promise<EventsOrderLite[]> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows: ResRow[] = [];
  for (const part of chunks(unique)) {
    const { data, error } = await db
      .from("reservations")
      .select("id, status, created_at, is_deleted, main_contact_phone_key, event_id, main_contact_first_name, main_contact_last_name")
      .in("main_contact_phone_key", part);
    if (error) throw new Error(`reservations: ${error.message}`);
    rows.push(...((data ?? []) as ResRow[]));
  }
  return toOrders(rows);
}

/** The orders a rep attached chats to (R-3), in the same shape. */
export async function reservationsByIds(ids: number[]): Promise<EventsOrderLite[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows: ResRow[] = [];
  for (const part of chunks(unique)) {
    const { data, error } = await db
      .from("reservations")
      .select("id, status, created_at, is_deleted, main_contact_phone_key, event_id, main_contact_first_name, main_contact_last_name")
      .in("id", part);
    if (error) throw new Error(`reservations: ${error.message}`);
    rows.push(...((data ?? []) as ResRow[]));
  }
  return toOrders(rows);
}

async function toOrders(rows: ResRow[]): Promise<EventsOrderLite[]> {
  const eventDates = await eventDatesOf(rows.map((r) => r.event_id).filter((x): x is number => typeof x === "number"));
  return rows.map((r) => ({
    id: r.id,
    status: r.status ?? "",
    createdAt: r.created_at,
    isDeleted: !!r.is_deleted,
    eventDate: r.event_id ? eventDates.get(r.event_id) ?? null : null,
    phoneKey: r.main_contact_phone_key ?? "",
    eventId: r.event_id,
    contactName: [r.main_contact_first_name, r.main_contact_last_name].filter(Boolean).join(" ").trim(),
  }));
}

async function eventDatesOf(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await db.from("events").select("id, date").in("id", part);
    if (error) throw new Error(`events: ${error.message}`);
    for (const e of (data ?? []) as { id: number; date: string | null }[]) if (e.date) out.set(e.id, String(e.date).slice(0, 10));
  }
  return out;
}

/** R-2: Lost -> Follow-up with today's call-back day, only while it is still Lost (a rep who got there first wins). */
export async function moveToFollowUp(reservationId: number, today: string, chatId: string): Promise<boolean> {
  const { data, error } = await db
    .from("reservations")
    .update({ status: "Follow-up", follow_up_date: today })
    .eq("id", reservationId)
    .eq("status", "Lost")
    .select("id");
  if (error) throw new Error(`reservations: ${error.message}`);
  const moved = ((data ?? []) as unknown[]).length > 0;
  if (moved) {
    await logAudit({
      action: "reservation.status",
      entityType: "reservation",
      entityId: reservationId,
      changes: { status: { from: "Lost", to: "Follow-up" }, follow_up_date: { from: null, to: today } },
      metadata: { via: "whatsapp", chat_id: chatId },
      actor: { id: null, email: null, role: null },
    });
  }
  return moved;
}

// ---------------------------------------------------------------- the app's own automatic texts

const autoTextCache = new Map<string, { at: number; texts: Set<string> }>();

export async function autoTexts(companyId: string): Promise<Set<string>> {
  const hit = autoTextCache.get(companyId);
  if (hit && Date.now() - hit.at < AUTO_TEXT_TTL_MS) return hit.texts;
  const { data, error } = await db.from("wa_app_auto_texts").select("text_norm").eq("company_id", companyId);
  if (error) {
    if (missingTable(error)) return new Set();
    throw new Error(`wa_app_auto_texts: ${error.message}`);
  }
  const texts = new Set(((data ?? []) as { text_norm: string }[]).map((r) => r.text_norm));
  autoTextCache.set(companyId, { at: Date.now(), texts });
  return texts;
}

export async function listAutoTextRows(companyId: string): Promise<{ text: string; textNorm: string; source: string }[]> {
  const { data, error } = await db.from("wa_app_auto_texts").select("text, text_norm, source").eq("company_id", companyId).order("created_at");
  if (error) {
    if (missingTable(error)) return [];
    throw new Error(`wa_app_auto_texts: ${error.message}`);
  }
  return ((data ?? []) as { text: string; text_norm: string; source: string }[]).map((r) => ({ text: r.text, textNorm: r.text_norm, source: r.source }));
}

export async function addAutoTexts(companyId: string, texts: string[], source: "history" | "staff"): Promise<void> {
  const rows = [...new Set(texts.map(normAutoText).filter(Boolean))].map((t) => ({ company_id: companyId, text_norm: t, text: t, source }));
  if (rows.length === 0) return;
  const { error } = await db.from("wa_app_auto_texts").upsert(rows, { onConflict: "company_id,text_norm", ignoreDuplicates: true });
  if (error) throw new Error(`wa_app_auto_texts: ${error.message}`);
  autoTextCache.delete(companyId);
}

export async function removeAutoText(companyId: string, textNorm: string): Promise<void> {
  const { error } = await db.from("wa_app_auto_texts").delete().eq("company_id", companyId).eq("text_norm", textNorm);
  if (error) throw new Error(`wa_app_auto_texts: ${error.message}`);
  autoTextCache.delete(companyId);
}

/** What the number sent from the app (live echoes and history) in the last `days` - the source of the auto-text guess. */
export async function recentEchoes(companyId: string, days: number): Promise<{ phoneKey: string; text: string | null }[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { rows, error } = await fetchPaged<{ id: string; phone_key: string; text: string | null }>(
    () =>
      db
        .from("wa_messages")
        .select("id, phone_key, text")
        .eq("company_id", companyId)
        .eq("direction", "out")
        .in("origin", ["app", "history"])
        .eq("type", "text")
        .gte("sent_at", since)
        .order("id"),
    50_000,
  );
  if (error) {
    if (missingTable(error as DbError)) return [];
    throw new Error(`wa_messages: ${error.message}`);
  }
  return rows.map((r) => ({ phoneKey: r.phone_key, text: r.text }));
}

// ---------------------------------------------------------------- the list's last line per chat

export type LastMessage = { text: string | null; type: string; sentAt: string; direction: "in" | "out" };

/** The newest message of each phone key (one read: the newest rows of these keys, first per key). */
export async function lastMessages(companyId: string, keys: string[]): Promise<Map<string, LastMessage>> {
  const out = new Map<string, LastMessage>();
  const unique = [...new Set(keys.filter(Boolean))];
  for (const part of chunks(unique, 50)) {
    const { data, error } = await db
      .from("wa_messages")
      .select("phone_key, text, type, sent_at, direction")
      .eq("company_id", companyId)
      .in("phone_key", part)
      .order("sent_at", { ascending: false })
      .limit(Math.min(1000, part.length * 20));
    if (error) {
      if (missingTable(error)) return out;
      throw new Error(`wa_messages: ${error.message}`);
    }
    for (const r of (data ?? []) as { phone_key: string; text: string | null; type: string; sent_at: string; direction: "in" | "out" }[]) {
      if (!out.has(r.phone_key)) out.set(r.phone_key, { text: r.text, type: r.type, sentAt: r.sent_at, direction: r.direction });
    }
  }
  return out;
}

/** The reservations list's "new message" marks: the one order each unseen chat points at (spec R-1). */
export async function whatsappMarks(companyId: string): Promise<Set<number>> {
  const unseen = await unseenChats(companyId);
  if (unseen.length === 0) return new Set();
  const orders = await reservationsByPhoneKeys(unseen.map((c) => c.phoneKey));
  return marksFor(unseen, orders, israelToday());
}

/** Reads the per-order "no WhatsApp" switch (D-6). A deploy that beat its migration reads as "on". */
export async function reservationWhatsappOff(reservationId: number): Promise<{ at: string; by: string | null } | null> {
  const { data, error } = await db.from("reservations").select("whatsapp_off_at, whatsapp_off_by, main_contact_phone_key").eq("id", reservationId).maybeSingle();
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") return null;
    throw new Error(`reservations: ${error.message}`);
  }
  const row = data as { whatsapp_off_at: string | null; whatsapp_off_by: string | null } | null;
  return row?.whatsapp_off_at ? { at: row.whatsapp_off_at, by: row.whatsapp_off_by } : null;
}

export async function setReservationWhatsappOffAt(reservationId: number, off: boolean, by: string | null): Promise<void> {
  const { error } = await db
    .from("reservations")
    .update(off ? { whatsapp_off_at: new Date().toISOString(), whatsapp_off_by: by } : { whatsapp_off_at: null, whatsapp_off_by: null })
    .eq("id", reservationId);
  if (error) throw new Error(`reservations: ${error.message}`);
}

/** The phone key of one order (kept by the trigger), "" when it has none or the column is not migrated yet. */
export async function reservationPhoneKey(reservationId: number): Promise<string> {
  const { data, error } = await db.from("reservations").select("main_contact_phone_key").eq("id", reservationId).maybeSingle();
  if (error) return "";
  return ((data as { main_contact_phone_key: string | null } | null)?.main_contact_phone_key ?? "") || "";
}

export type OutboxLine = { kind: string; at: string; status: string; reason: string | null; sentTo: string | null };

/** The order's automatic messages (wa_outbox, phase E2) - [] before that table exists. */
export async function outboxOfReservation(reservationId: number): Promise<OutboxLine[]> {
  const { data, error } = await db
    .from("wa_outbox")
    .select("kind, created_at, finished_at, status, reason, sent_to")
    .eq("reservation_id", reservationId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (missingTable(error)) return [];
    throw new Error(`wa_outbox: ${error.message}`);
  }
  return ((data ?? []) as { kind: string; created_at: string; finished_at: string | null; status: string; reason: string | null; sent_to: string | null }[]).map((r) => ({
    kind: r.kind,
    at: r.finished_at ?? r.created_at,
    status: r.status,
    reason: r.reason,
    sentTo: r.sent_to,
  }));
}

/**
 * Mega Events WhatsApp - the pure rules of a conversation (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md,
 * sections 5 and 7). Mega Events has no tours `customers` / `leads`: a conversation is one `wa_chats` row per phone, and it
 * shows on every order of that phone. Selftest: scripts/whatsapp-events-selftest.ts.
 */
import { OPT_OUT_WORDS, canSendText, type WaMessageType } from "@/lib/whatsapp/rules";
import { whatsappPhone } from "@/lib/tours/cases";

/** The order as the conversation rules need it. `eventDate` = the event's day, YYYY-MM-DD. */
export type EventsResLite = { id: number; status: string; createdAt: string; eventDate: string | null; isDeleted: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;
/** A Pending / 24Save order older than this no longer blocks the Lost -> Follow-up move: paying always inserts a NEW row. */
export const STALE_OPEN_ORDER_DAYS = 7;

/** A company selling events and not tours - the Mega Events branch of the inbound flow. */
export function isEventsCompany(productTypes: readonly string[]): boolean {
  return productTypes.includes("events") && !productTypes.includes("tours");
}

/** A reaction or a sticker is stored and shown, but asks nothing: no "new" mark, no unanswered timer, no order move. */
export function countsAsInbound(type: WaMessageType): boolean {
  return type !== "reaction" && type !== "sticker";
}

/** Mega Events: an opt-out only when the WHOLE message is the word - "הסר את המלון מההזמנה" is a request about an order. */
export function isOptOutWhole(text: string | null | undefined): boolean {
  if (!text) return false;
  const clean = text
    .toLowerCase()
    .replace(/[.,!?;:'"״׳()[\]\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (OPT_OUT_WORDS as readonly string[]).includes(clean);
}

/** The key an automatic text of the app is matched by: trimmed, whitespace collapsed. */
export function normAutoText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Texts the app sent word for word to at least `minChats` different chats - its greeting / away message, not a rep. */
export function suggestAutoTexts(echoes: { phoneKey: string; text: string | null }[], minChats = 5): string[] {
  const chats = new Map<string, Set<string>>();
  for (const e of echoes) {
    const t = normAutoText(e.text);
    if (!t || !e.phoneKey) continue;
    const seen = chats.get(t) ?? new Set<string>();
    seen.add(e.phoneKey);
    chats.set(t, seen);
  }
  return [...chats.entries()].filter(([, keys]) => keys.size >= minChats).map(([t]) => t);
}

const ahead = (r: EventsResLite, today: string): boolean => !r.isDeleted && !!r.eventDate && r.eventDate >= today;

/** An order (event ahead) that means the customer is not "only Lost": Paid / Follow-up, or a fresh Pending / 24Save. */
export function isLiveForFollowUp(r: EventsResLite, today: string, now: Date): boolean {
  if (!ahead(r, today)) return false;
  if (r.status === "Paid" || r.status === "Follow-up") return true;
  if (r.status === "Pending" || r.status === "24Save") {
    const created = Date.parse(r.createdAt);
    return Number.isFinite(created) && now.getTime() - created < STALE_OPEN_ORDER_DAYS * DAY_MS;
  }
  return false;
}

/** R-2: the newest Lost order (event ahead) to move to Follow-up when nothing live exists for the phone, else null. */
export function lostToFollowUp(rs: EventsResLite[], today: string, now: Date): number | null {
  const upcoming = rs.filter((r) => ahead(r, today));
  if (upcoming.some((r) => isLiveForFollowUp(r, today, now))) return null;
  const lost = upcoming.filter((r) => r.status === "Lost").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return lost[0]?.id ?? null;
}

/** R-1: the one order that wears the "new message" mark - the linked one, else the nearest Paid ahead, else the newest. */
export function markedReservation(rs: EventsResLite[], linkedId: number | null, today: string): number | null {
  const live = rs.filter((r) => !r.isDeleted);
  if (linkedId !== null) return linkedId;
  const paid = live
    .filter((r) => r.status === "Paid" && !!r.eventDate && r.eventDate >= today)
    .sort((a, b) => (a.eventDate ?? "").localeCompare(b.eventDate ?? ""));
  if (paid[0]) return paid[0].id;
  const newest = [...live].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return newest[0]?.id ?? null;
}

/**
 * What a signup asks Meta to sync. Mega Events: no phone book - nothing in its design reads `wa_contacts`, and the
 * phone book on the number's phone may hold personal contacts (spec section 6). The history is always offered.
 */
export function signupSyncs(productTypes: readonly string[]): { contacts: boolean; history: boolean } {
  return { contacts: !isEventsCompany(productTypes), history: true };
}

/** The reply box: free text only inside the 24-hour window after the customer wrote; past it, the rep answers in the app. */
export function replyState(lastInAt: string | null, now: string): { open: boolean; note: string | null } {
  if (canSendText(lastInAt, now)) return { open: true, note: null };
  return { open: false, note: lastInAt ? "הלקוח כתב לפני יותר מ-24 שעות - עונים מהאפליקציה" : "הלקוח עוד לא כתב - עונים מהאפליקציה" };
}

/** The orders of the reservations list that wear the "new message" mark: one per unseen chat (markedReservation). */
export function marksFor(
  unseen: { phoneKey: string; linkedReservationId: number | null; phone?: string }[],
  orders: (EventsResLite & { phoneKey: string; phone?: string | null })[],
  today: string,
): Set<number> {
  const out = new Set<number>();
  for (const chat of unseen) {
    // full-number binding when both sides carry the phone (sameNumber)
    const own = orders.filter((o) => o.phoneKey === chat.phoneKey && (chat.phone === undefined || o.phone === undefined || sameNumber(o.phone, chat.phone)));
    if (own.length === 0 && chat.linkedReservationId === null) continue;
    const id = markedReservation(own, chat.linkedReservationId, today);
    if (id !== null) out.add(id);
  }
  return out;
}

/** The reservation columns only WhatsApp writes - the edit page's whole-row save must never carry them back. */
const WA_RESERVATION_COLUMNS = ["whatsapp_off_at", "whatsapp_off_by", "main_contact_phone_key"] as const;

export function withoutWaColumns<T extends Record<string, unknown>>(row: T): Omit<T, (typeof WA_RESERVATION_COLUMNS)[number]> {
  const copy: Record<string, unknown> = { ...row };
  for (const c of WA_RESERVATION_COLUMNS) delete copy[c];
  return copy as Omit<T, (typeof WA_RESERVATION_COLUMNS)[number]>;
}

/**
 * The order fold answers EACH chat on its own (review 08.11): the order's own phone first, then the companions a rep
 * attached - a reply to one never goes to the other, and each has its own 24-hour window.
 */
export function foldTargets<C extends { id: string; phoneKey: string; phone: string; lastInAt: string | null }>(
  chats: C[],
  orderPhoneKey: string,
): { chatId: string; phone: string; lastInAt: string | null; own: boolean }[] {
  return [...chats]
    .sort((a, b) => Number(b.phoneKey === orderPhoneKey) - Number(a.phoneKey === orderPhoneKey))
    .map((c) => ({ chatId: c.id, phone: c.phone, lastInAt: c.lastInAt, own: c.phoneKey === orderPhoneKey }));
}

/** "הצמד להזמנה": what the term is - an order number, a phone (any spelling, matched by its key), or a name. */
export function linkSearchOf(term: string): { kind: "id"; id: number } | { kind: "phone"; key: string } | { kind: "name"; text: string } | null {
  const t = term.trim().slice(0, 60);
  if (t.length < 2) return null;
  const digits = t.replace(/\D/g, "");
  if (/^\d{2,7}$/.test(t)) return { kind: "id", id: Number(t) };
  if (digits.length >= 9 && /^[\d\s()+\-.]+$/.test(t)) return { kind: "phone", key: digits.slice(-9) };
  const text = t.replace(/[%_,()]/g, " ").trim();
  return text ? { kind: "name", text } : null;
}

/** The phone keys a reservation's thread reads: its own phone always (what we sent shows before the customer ever wrote) + its chats. */
export function threadKeysOf(chats: { phoneKey: string }[], reservationKey: string): string[] {
  return [...new Set([reservationKey, ...chats.map((c) => c.phoneKey)].filter(Boolean))];
}

/**
 * Full-number binding (the tours security review of 21.10, applied to Mega Events): a chat and an order share the last
 * 9 digits by their key, but they are the same person only when the order's phone normalises to the chat's FULL
 * number - another country's number with the same last 9 digits is someone else.
 */
export function sameNumber(orderPhone: string | null | undefined, chatPhone: string): boolean {
  const full = whatsappPhone(orderPhone);
  return !!full && full === chatPhone;
}

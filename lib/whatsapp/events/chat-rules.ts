/**
 * Mega Events WhatsApp - the pure rules of a conversation (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md,
 * sections 5 and 7). Mega Events has no tours `customers` / `leads`: a conversation is one `wa_chats` row per phone, and it
 * shows on every order of that phone. Selftest: scripts/whatsapp-events-selftest.ts.
 */
import { OPT_OUT_WORDS, canSendText, type WaMessageType } from "@/lib/whatsapp/rules";

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

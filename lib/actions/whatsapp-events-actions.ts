"use server";

/**
 * Mega Events' WhatsApp conversations (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md, section
 * 8): the WhatsApp screen's list and thread, the reply box, "טופל", attaching a companion's chat to an order, and the
 * opt-out mark. Every Mega Events staff member (B-2). Each action answers ActionResult and never throws past itself.
 */
import { requireCompany, type Company } from "@/lib/company";
import { logAudit } from "@/lib/audit";
import { supabaseTyped } from "@/lib/supabase-server";
import { actionFail, actionOk, UserError, type ActionResult } from "@/lib/tours/action-kit";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import { WA_THREAD_PAGE, WA_TEXT_MAX, standInText, type WaMessageType } from "@/lib/whatsapp/rules";
import { replyState } from "@/lib/whatsapp/events/chat-rules";
import { assembleThread, emptyWaThread, type WaThread, type WaThreadMessage } from "@/lib/tours/cases";
import { sendText } from "@/lib/services/whatsapp-cloud";
import { accountOfCompany, listThread } from "@/lib/services/whatsapp-db";
import {
  chatById,
  lastMessages,
  listChats,
  markChat,
  reservationsByIds,
  reservationsByPhoneKeys,
  upsertChat,
  type ChatFilter,
  type EventsOrderLite,
  type WaChat,
} from "@/lib/services/whatsapp-events-db";

const SCOPE = "whatsapp-events-actions";
const PAGE_SIZE = 50;
const NOTE_MIN = 3;
const SEARCH_MAX = 20;
const FILTERS: readonly ChatFilter[] = ["all", "new", "unanswered", "no_order"];

export type ChatOrder = { id: number; status: string };
export type ChatRow = WaChat & {
  orders: ChatOrder[];
  displayName: string;
  lastText: string | null;
  /** Working minutes the chat has waited for an answer (60+), else null - filled by the unanswered rule. */
  unansweredMinutes: number | null;
};

async function staff() {
  return requireCompany("events");
}

function displayNameOf(chat: WaChat, orders: EventsOrderLite[]): string {
  const named = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((o) => o.contactName);
  return named?.contactName || chat.profileName || chat.phone;
}

async function rowsOf(company: Company, chats: WaChat[]): Promise<ChatRow[]> {
  const keys = chats.map((c) => c.phoneKey);
  const linkedIds = chats.map((c) => c.linkedReservationId).filter((x): x is number => x !== null);
  const [byKey, linked, last] = await Promise.all([reservationsByPhoneKeys(keys), reservationsByIds(linkedIds), lastMessages(company.id, keys)]);
  return chats.map((chat) => {
    const orders = byKey.filter((o) => o.phoneKey === chat.phoneKey && !o.isDeleted);
    const link = linked.find((o) => o.id === chat.linkedReservationId);
    if (link && !orders.some((o) => o.id === link.id)) orders.push(link);
    const lm = last.get(chat.phoneKey);
    return {
      ...chat,
      orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => ({ id: o.id, status: o.status })),
      displayName: displayNameOf(chat, orders),
      lastText: lm ? lm.text ?? standInText(lm.type as WaMessageType) : null,
      unansweredMinutes: null,
    };
  });
}

/** The chat a staff member of this company may act on - another company's id answers "not found". */
async function ownChat(company: Company, chatId: string): Promise<WaChat> {
  if (typeof chatId !== "string" || !chatId) throw new UserError("Conversation not found.");
  const chat = await chatById(chatId);
  if (!chat || chat.companyId !== company.id) throw new UserError("Conversation not found.");
  return chat;
}

async function threadOfChats(company: Company, chats: WaChat[], before?: string): Promise<WaThread> {
  if (chats.length === 0) return emptyWaThread();
  const [page, account] = await Promise.all([
    listThread(company.id, chats.map((c) => c.phoneKey), { before, limit: WA_THREAD_PAGE }),
    accountOfCompany(company.id),
  ]);
  const lastInAt = chats.map((c) => c.lastInAt).filter((x): x is string => !!x).sort().pop() ?? null;
  const optedOut = chats.find((c) => c.optedOutAt);
  return assembleThread({
    newestFirst: page.messages,
    hasMore: page.hasMore,
    consent: optedOut ? { state: "opted_out", source: null, at: optedOut.optedOutAt } : { state: "none", source: null, at: null },
    lastInAt,
    connected: account !== null,
    now: new Date().toISOString(),
  });
}

export async function listEventsChats(input: { filter: ChatFilter; page: number }): Promise<ActionResult<{ rows: ChatRow[]; total: number; pageSize: number }>> {
  try {
    const { company } = await staff();
    const filter = FILTERS.includes(input?.filter) ? input.filter : "all";
    const page = Number.isInteger(input?.page) && input.page >= 0 ? input.page : 0;
    const { rows, total } = await listChats(company.id, filter, page, PAGE_SIZE);
    return actionOk({ rows: await rowsOf(company, rows), total, pageSize: PAGE_SIZE });
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** Opens a chat: its row and its newest page; stamps it seen (never while impersonating). */
export async function openEventsChat(chatId: string): Promise<ActionResult<{ chat: ChatRow; thread: WaThread }>> {
  try {
    const { session, company } = await staff();
    const chat = await ownChat(company, chatId);
    const [[row], thread] = await Promise.all([rowsOf(company, [chat]), threadOfChats(company, [chat])]);
    if (!session.impersonator && chat.lastInAt) await markChat(chat.id, { seenAt: new Date().toISOString(), seenBy: session.sub });
    return actionOk({ chat: row, thread });
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** The page before `before` (an ISO instant), oldest first. */
export async function loadEventsChatBefore(chatId: string, before: string): Promise<ActionResult<{ messages: WaThreadMessage[]; hasMore: boolean }>> {
  try {
    const { company } = await staff();
    const chat = await ownChat(company, chatId);
    if (typeof before !== "string" || Number.isNaN(Date.parse(before))) throw new UserError("Bad page.");
    const page = await listThread(company.id, [chat.phoneKey], { before, limit: WA_THREAD_PAGE });
    return actionOk({ messages: [...page.messages].reverse(), hasMore: page.hasMore });
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** The reply box: free text inside the 24-hour window; it answers the chat. */
export async function replyEventsChat(input: { chatId: string; text: string; reservationId: number | null }): Promise<ActionResult<{ sentAt: string }>> {
  try {
    const { session, company } = await staff();
    const chat = await ownChat(company, input?.chatId);
    const text = typeof input?.text === "string" ? input.text.trim() : "";
    if (!text) throw new UserError("There is nothing to send.");
    if (text.length > WA_TEXT_MAX) throw new UserError(`At most ${WA_TEXT_MAX} characters.`);
    const now = new Date().toISOString();
    const state = replyState(chat.lastInAt, now);
    if (!state.open) throw new UserError(state.note ?? "The 24-hour window is closed.");
    const reservationId = Number.isInteger(input?.reservationId) ? (input.reservationId as number) : null;
    const answer = await sendText(company, { to: chat.phone, text, lastInAt: chat.lastInAt, origin: "api", sentBy: session.sub, reservationId });
    if (!answer.ok) throw new UserError(`Not sent: ${answer.error}`);
    await upsertChat(company.id, chat.phone, chat.phoneKey, { lastOutAt: now, answeredAt: now, seenAt: now });
    return actionOk({ sentAt: now });
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** "טופל": a chat that needs no reply (a thank-you, a sticker) stops waiting - nothing is sent. */
export async function markChatHandled(chatId: string): Promise<ActionResult<{ at: string }>> {
  try {
    const { session, company } = await staff();
    const chat = await ownChat(company, chatId);
    const at = new Date().toISOString();
    await markChat(chat.id, { answeredAt: at, seenAt: at, seenBy: session.sub });
    await logAudit({ action: "whatsapp.handled", entityType: "wa_chat", entityId: chat.id, metadata: { company_id: company.id } });
    return actionOk({ at });
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** R-3: a companion's phone attached to an order (null detaches). */
export async function linkChatToReservation(chatId: string, reservationId: number | null): Promise<ActionResult<{ linkedReservationId: number | null }>> {
  try {
    const { session, company } = await staff();
    const chat = await ownChat(company, chatId);
    if (reservationId !== null) {
      if (!Number.isInteger(reservationId) || reservationId <= 0) throw new UserError("Pick an order.");
      const [order] = await reservationsByIds([reservationId]);
      if (!order || order.isDeleted) throw new UserError("Order not found.");
    }
    await markChat(chat.id, { linkedReservationId: reservationId, linkedBy: session.sub });
    await logAudit({
      action: "whatsapp.chat_linked",
      entityType: "wa_chat",
      entityId: chat.id,
      changes: { linked_reservation_id: { from: chat.linkedReservationId, to: reservationId } },
      metadata: { company_id: company.id },
    });
    return actionOk({ linkedReservationId: reservationId });
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

export type LinkCandidate = { id: number; name: string; status: string; eventName: string | null };

/** "הצמד להזמנה": an order number, a name, or a phone - 20 at most, newest first. */
export async function searchReservationsForLink(q: string): Promise<ActionResult<LinkCandidate[]>> {
  try {
    await staff();
    const term = (typeof q === "string" ? q : "").trim().slice(0, 60);
    if (term.length < 2) return actionOk([]);
    const digits = term.replace(/\D/g, "");
    let query = supabaseTyped
      .from("reservations")
      .select("id, main_contact_first_name, main_contact_last_name, status, event_order_info")
      .is("is_deleted", null)
      .order("created_at", { ascending: false })
      .limit(SEARCH_MAX);
    if (/^\d+$/.test(term) && term.length <= 7) query = query.eq("id", Number(term));
    else if (digits.length >= 9) query = query.ilike("main_contact_phone_number", `%${digits.slice(-7)}%`);
    else {
      const safe = term.replace(/[%_,()]/g, " ").trim();
      query = query.or(`main_contact_first_name.ilike.%${safe}%,main_contact_last_name.ilike.%${safe}%`);
    }
    const { data, error } = await query;
    if (error) throw new Error(`reservations: ${error.message}`);
    return actionOk(
      (data ?? []).map((r) => {
        const first = normalizeReservationEventOrderInfo(r.event_order_info as never)[0];
        return {
          id: r.id,
          name: [r.main_contact_first_name, r.main_contact_last_name].filter(Boolean).join(" "),
          status: r.status ?? "",
          eventName: first?.name ?? null,
        };
      }),
    );
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** Staff mark or clear an opt-out with a note (Mega Events only - M-3). */
export async function setChatOptOut(chatId: string, optedOut: boolean, note: string): Promise<ActionResult<{ optedOutAt: string | null }>> {
  try {
    const { session, company } = await staff();
    const chat = await ownChat(company, chatId);
    const clean = (typeof note === "string" ? note : "").trim();
    if (clean.length < NOTE_MIN) throw new UserError("Write a short note (3 characters at least).");
    const optedOutAt = optedOut ? new Date().toISOString() : null;
    await markChat(chat.id, { optedOutAt, optedOutSource: optedOut ? `staff:${session.sub}` : null });
    await logAudit({
      action: "whatsapp.consent",
      entityType: "wa_chat",
      entityId: chat.id,
      changes: { opted_out: { from: !!chat.optedOutAt, to: optedOut } },
      metadata: { company_id: company.id, note: clean.slice(0, 300) },
    });
    return actionOk({ optedOutAt });
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

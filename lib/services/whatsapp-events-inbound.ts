/**
 * The Mega Events branch of the inbound flow (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md,
 * section 7). Mega Events has no tours customers / leads: every message is stored, the phone's conversation (wa_chats)
 * keeps its seen / answered / opt-out state, and a NEW conversation from a phone whose only orders ahead are Lost moves
 * the newest one to Follow-up (R-2). Nothing here writes leads or customers. History is stored and marks nothing.
 * Dependencies are injected (`EventsInboundDeps`) - scripts/whatsapp-events-selftest.ts runs it over stubs.
 */
import { OPT_OUT_REPLY, shouldOpenInquiry, type WaEvent } from "@/lib/whatsapp/rules";
import { countsAsInbound, isOptOutWhole, lostToFollowUp, normAutoText, suggestAutoTexts } from "@/lib/whatsapp/events/chat-rules";
import { israelToday } from "@/lib/marketing/range";
import type { WaAccount } from "@/lib/services/whatsapp-db";
import type { ChatMark, ChatPatch, EventsOrderLite, WaChat } from "@/lib/services/whatsapp-events-db";
import type { InboundDeps, InboundSummary } from "@/lib/services/whatsapp-inbound";

export interface EventsInboundDeps {
  chatByKey(companyId: string, phoneKey: string): Promise<WaChat | null>;
  upsertChat(companyId: string, phone: string, phoneKey: string, patch: ChatPatch): Promise<WaChat>;
  markChat(chatId: string, patch: ChatMark): Promise<void>;
  reservationsByPhoneKeys(keys: string[]): Promise<EventsOrderLite[]>;
  reservationsByIds(ids: number[]): Promise<EventsOrderLite[]>;
  moveToFollowUp(reservationId: number, today: string, chatId: string): Promise<boolean>;
  autoTexts(companyId: string): Promise<Set<string>>;
  addAutoTexts(companyId: string, texts: string[], source: "history" | "staff"): Promise<void>;
  recentEchoes(companyId: string, days: number): Promise<{ phoneKey: string; text: string | null }[]>;
}

type MessageEvent = Extract<WaEvent, { kind: "message" }>;

/** How far back the app's automatic texts are looked for once the history sync ends (the sync covers 6 months). */
const AUTO_TEXT_LOOKBACK_DAYS = 200;

/** One Mega Events message; `phone` / `key` = the customer's number and its last 9 digits (the caller resolved both). */
export async function handleEventsMessage(
  ev: MessageEvent,
  account: WaAccount,
  phone: string,
  key: string,
  deps: InboundDeps,
  ed: EventsInboundDeps,
  out: InboundSummary,
): Promise<void> {
  const companyId = account.companyId;
  const live = ev.origin !== "history";
  const media = ev.media
    ? { ...ev.media, storage_path: live && ev.media.id ? await deps.storeMedia(account, ev.media.id, ev.media.mime) : null }
    : null;
  const stored = await deps.insertMessage({
    companyId,
    waMessageId: ev.waMessageId,
    phone,
    phoneKey: key,
    customerId: null,
    caseId: null,
    direction: ev.direction,
    origin: ev.origin,
    type: ev.type,
    text: ev.text,
    media,
    template: null,
    status: ev.direction === "in" ? "received" : "sent",
    sentBy: null,
    sentAt: ev.sentAt,
  });
  if (!stored.inserted || !stored.id) {
    out.skipped += 1;
    return;
  }
  out.stored += 1;

  // history (connect day's 6 months): the conversation exists, but nothing in it is new or waiting for an answer
  if (!live) {
    const now = deps.now();
    await ed.upsertChat(companyId, phone, key, { seenAt: now, answeredAt: now });
    return;
  }

  // an echo: a rep wrote from the app - an answer, and a sign someone saw the chat - unless it is the app's own text
  if (ev.direction === "out") {
    const automatic = (await ed.autoTexts(companyId)).has(normAutoText(ev.text));
    await ed.upsertChat(companyId, phone, key, automatic ? { lastOutAt: ev.sentAt } : { lastOutAt: ev.sentAt, answeredAt: ev.sentAt, seenAt: ev.sentAt });
    return;
  }

  // a reaction or a sticker asks nothing: stored and shown, but no mark, no timer, no order move
  if (!countsAsInbound(ev.type)) {
    await ed.upsertChat(companyId, phone, key, ev.profileName ? { profileName: ev.profileName } : {});
    return;
  }

  // read BEFORE this message moves it: the 24-hour gap is measured against the previous live inbound message
  const before = await ed.chatByKey(companyId, key);
  const chat = await ed.upsertChat(companyId, phone, key, { lastInAt: ev.sentAt, ...(ev.profileName ? { profileName: ev.profileName } : {}) });

  if (isOptOutWhole(ev.text)) {
    await ed.markChat(chat.id, { optedOutAt: ev.sentAt, optedOutSource: "reply" });
    const answer = await deps.sendServiceText(account, phone, OPT_OUT_REPLY);
    if (!answer.ok) deps.log.warn(`opt-out reply to ${key} not sent: ${answer.error ?? "unknown"}`);
    out.optOuts += 1;
    return;
  }

  if (!shouldOpenInquiry(before?.lastInAt ?? null, ev.sentAt)) return;
  const orders = await ed.reservationsByPhoneKeys([key]);
  if (chat.linkedReservationId !== null && !orders.some((o) => o.id === chat.linkedReservationId)) {
    orders.push(...(await ed.reservationsByIds([chat.linkedReservationId])));
  }
  const now = new Date(deps.now());
  const today = israelToday(now);
  const target = lostToFollowUp(orders, today, now);
  if (target !== null) await ed.moveToFollowUp(target, today, chat.id);
}

/** The last chunk of the history sync: the texts the app sent word for word to many chats are its greeting / away message. */
export async function suggestAutoTextsAfterHistory(
  ev: Extract<WaEvent, { kind: "history" }>,
  account: WaAccount,
  ed: EventsInboundDeps,
): Promise<void> {
  if ((ev.progress ?? 0) < 100) return;
  const texts = suggestAutoTexts(await ed.recentEchoes(account.companyId, AUTO_TEXT_LOOKBACK_DAYS));
  if (texts.length) await ed.addAutoTexts(account.companyId, texts, "history");
}

// scripts/whatsapp-events-selftest.ts - `npx tsx scripts/whatsapp-events-selftest.ts`
// Mega Events WhatsApp (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md): the pure rules -
// which company is Events, what counts as an inbound message, the whole-message opt-out, the app's own automatic
// texts, which order a conversation marks, and the Lost -> Follow-up move. No DB, no network.
import assert from "node:assert/strict";
import {
  countsAsInbound,
  isEventsCompany,
  isOptOutWhole,
  lostToFollowUp,
  markedReservation,
  normAutoText,
  signupSyncs,
  suggestAutoTexts,
  type EventsResLite,
} from "../lib/whatsapp/events/chat-rules";
import { OPT_OUT_REPLY, type WaEvent } from "../lib/whatsapp/rules";
import { handleWebhookEvents, type InboundDeps } from "../lib/services/whatsapp-inbound";
import { templateUpsertRow, type WaAccount, type WaMessageInsert } from "../lib/services/whatsapp-db";
import type { EventsOrderLite, WaChat } from "../lib/services/whatsapp-events-db";

const NOW = new Date("2026-11-08T10:00:00Z");
const TODAY = "2026-11-08";
const r = (id: number, status: string, createdAt: string, eventDate: string | null): EventsResLite => ({ id, status, createdAt, eventDate, isDeleted: false });

async function main(): Promise<void> {
  // ------------------------------------------------------------ Task 1: conversations, orders, opt-out, auto texts
  assert.equal(isEventsCompany(["events"]), true);
  assert.equal(isEventsCompany(["tours"]), false);
  assert.equal(isEventsCompany(["events", "tours"]), false);
  assert.equal(countsAsInbound("reaction"), false);
  assert.equal(countsAsInbound("sticker"), false);
  assert.equal(countsAsInbound("text"), true);
  assert.equal(isOptOutWhole("הסר"), true);
  assert.equal(isOptOutWhole(" הסר! "), true);
  assert.equal(isOptOutWhole("הסר את המלון מההזמנה"), false);
  assert.equal(isOptOutWhole("STOP"), true);
  assert.equal(isOptOutWhole(null), false);
  assert.equal(normAutoText("  שלום!  נחזור\n אליכם "), "שלום! נחזור אליכם");
  assert.deepEqual(
    suggestAutoTexts([1, 2, 3, 4, 5].map((i) => ({ phoneKey: `54000000${i}`, text: "שלום!  נחזור אליכם " }))),
    ["שלום! נחזור אליכם"],
  );
  assert.deepEqual(suggestAutoTexts([1, 2, 3, 4].map((i) => ({ phoneKey: `54000000${i}`, text: "x" }))), []);
  // five messages to ONE chat are not an automatic text
  assert.deepEqual(suggestAutoTexts([1, 2, 3, 4, 5].map(() => ({ phoneKey: "540000001", text: "תודה" }))), []);

  // R-2: only orders whose event is ahead count; old Lost never moves
  assert.equal(lostToFollowUp([r(1, "Lost", "2026-01-01T00:00:00Z", "2026-03-01")], TODAY, NOW), null);
  assert.equal(lostToFollowUp([r(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01"), r(2, "Lost", "2026-10-05T00:00:00Z", "2026-12-01")], TODAY, NOW), 2);
  // a stale Pending (abandoned checkout, 10 days old) does not block; a fresh one does
  assert.equal(lostToFollowUp([r(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01"), r(2, "Pending", "2026-10-29T00:00:00Z", "2026-12-01")], TODAY, NOW), 1);
  assert.equal(lostToFollowUp([r(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01"), r(2, "Pending", "2026-11-05T00:00:00Z", "2026-12-01")], TODAY, NOW), null);
  assert.equal(lostToFollowUp([r(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01"), r(2, "Paid", "2026-09-01T00:00:00Z", "2026-12-20")], TODAY, NOW), null);
  // a soft-deleted Lost never moves
  assert.equal(lostToFollowUp([{ ...r(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01"), isDeleted: true }], TODAY, NOW), null);
  // the mark: linked, else nearest upcoming Paid, else newest
  const rs = [r(1, "Paid", "2026-09-01T00:00:00Z", "2026-12-20"), r(2, "Paid", "2026-10-01T00:00:00Z", "2026-11-20"), r(3, "Lost", "2026-11-01T00:00:00Z", "2027-01-01")];
  assert.equal(markedReservation(rs, null, TODAY), 2);
  assert.equal(markedReservation(rs, 3, TODAY), 3);
  assert.equal(markedReservation([r(4, "Lost", "2026-10-01T00:00:00Z", "2026-01-01"), r(5, "Lost", "2026-10-02T00:00:00Z", "2026-01-01")], null, TODAY), 5);
  assert.equal(markedReservation([], null, TODAY), null);

  // Task 5: what a signup asks Meta to sync - no phone book for Mega Events (Nir's phone may hold personal contacts)
  assert.deepEqual(signupSyncs(["events"]), { contacts: false, history: true });
  assert.deepEqual(signupSyncs(["tours"]), { contacts: true, history: true });

  await inboundSection();

  console.log("whatsapp-events selftest: OK");
}


// ------------------------------------------------------------ Task 4: the Mega Events inbound branch
const EV_ACCOUNT: WaAccount = {
  id: "acc-ev",
  companyId: "co-ev",
  wabaId: "333",
  phoneNumberId: "444",
  displayPhone: "+972 54-200-2722",
  verifiedName: "Mega Events",
  mode: "coexistence",
  provider: "meta",
  qualityRating: null,
  messagingLimit: null,
  historyRequestedAt: null,
  historySyncedAt: null,
  contactsRequestedAt: null,
  contactsSyncedAt: null,
  connectedAt: "2026-11-08T00:00:00.000Z",
  isActive: true,
};
const TOURS_ACCOUNT: WaAccount = { ...EV_ACCOUNT, id: "acc-1", companyId: "co-1", phoneNumberId: "111", wabaId: "222" };
const CUSTOMER = "972542002722";

function makeEventsDeps(opts: { orders?: EventsOrderLite[]; autoTexts?: string[]; now?: string } = {}) {
  const messages: (WaMessageInsert & { id: string })[] = [];
  const chats = new Map<string, WaChat>();
  const moves: { id: number; today: string; chatId: string }[] = [];
  const marks: { chatId: string; patch: Record<string, unknown> }[] = [];
  const sent: { to: string; text: string }[] = [];
  const calls = { insertLead: 0, findCustomers: 0, suggested: [] as string[][] };
  let seq = 0;
  let now = opts.now ?? "2026-11-08T10:00:00.000Z";
  const later = (a: string | null | undefined, b: string | null | undefined) => (!a ? b ?? null : !b ? a : b > a ? b : a);
  const deps: InboundDeps = {
    now: () => now,
    accountByPhoneId: async (id) => (id === "444" ? EV_ACCOUNT : id === "111" ? TOURS_ACCOUNT : null),
    accountByWabaId: async (id) => (id === "333" ? EV_ACCOUNT : null),
    companyProducts: async (id) => (id === "co-ev" ? ["events"] : ["tours"]),
    patchAccount: async () => {},
    knownMessageIds: async (ids) => new Set(ids.filter((id) => messages.some((m) => m.waMessageId === id))),
    insertMessage: async (row) => {
      if (messages.some((m) => m.waMessageId === row.waMessageId)) return { inserted: false, id: null };
      const id = `m-${++seq}`;
      messages.push({ ...row, id });
      return { inserted: true, id };
    },
    linkMessage: async () => {},
    updateStatus: async () => true,
    lastInbound: async () => null,
    findCustomers: async () => {
      calls.findCustomers += 1;
      return [];
    },
    setCustomerFields: async () => {},
    insertLead: async () => {
      calls.insertLead += 1;
      return { id: "lead-1", caseNo: 1001, joinedIntoId: null, customerId: "c-1" };
    },
    attachOrphans: async () => 0,
    storeMedia: async () => null,
    sendServiceText: async (_a, to, text) => {
      sent.push({ to, text });
      return { ok: true };
    },
    upsertTemplate: async () => {},
    saveContacts: async () => {},
    removeContacts: async () => {},
    log: { warn: () => {}, error: () => {} },
    events: {
      chatByKey: async (_c, key) => chats.get(key) ?? null,
      upsertChat: async (companyId, phone, key, patch) => {
        const cur = chats.get(key);
        const next: WaChat = {
          id: cur?.id ?? `chat-${key}`,
          companyId,
          phone,
          phoneKey: key,
          profileName: cur?.profileName || patch.profileName || null,
          lastInAt: later(cur?.lastInAt, patch.lastInAt),
          lastOutAt: later(cur?.lastOutAt, patch.lastOutAt),
          answeredAt: later(cur?.answeredAt, patch.answeredAt),
          seenAt: later(cur?.seenAt, patch.seenAt),
          linkedReservationId: cur?.linkedReservationId ?? null,
          optedOutAt: cur?.optedOutAt ?? null,
          alertedAt: cur?.alertedAt ?? null,
        };
        chats.set(key, next);
        return next;
      },
      markChat: async (chatId, patch) => {
        marks.push({ chatId, patch: patch as Record<string, unknown> });
        for (const c of chats.values()) if (c.id === chatId && patch.optedOutAt !== undefined) c.optedOutAt = patch.optedOutAt;
      },
      reservationsByPhoneKeys: async (keys) => (opts.orders ?? []).filter((o) => keys.includes(o.phoneKey)),
      reservationsByIds: async (ids) => (opts.orders ?? []).filter((o) => ids.includes(o.id)),
      moveToFollowUp: async (id, today, chatId) => {
        moves.push({ id, today, chatId });
        return true;
      },
      autoTexts: async () => new Set((opts.autoTexts ?? []).map(normAutoText)),
      addAutoTexts: async (_c, texts) => {
        calls.suggested.push(texts);
      },
      recentEchoes: async () => [1, 2, 3, 4, 5].map((i) => ({ phoneKey: `50000000${i}`, text: "שלום, נחזור אליכם" })),
    },
  };
  return { deps, messages, chats, moves, marks, sent, calls, setNow: (t: string) => (now = t) };
}

const evMsg = (id: string, at: string, text: string | null, extra: Partial<Extract<WaEvent, { kind: "message" }>> = {}): WaEvent => ({
  kind: "message",
  phoneNumberId: "444",
  waMessageId: id,
  from: CUSTOMER,
  to: null,
  profileName: "דנה",
  type: "text",
  text,
  media: null,
  sentAt: at,
  origin: "customer",
  direction: "in",
  ...extra,
});
const evEcho = (id: string, at: string, text: string, origin: "app" | "history" = "app"): WaEvent => ({
  ...evMsg(id, at, text),
  from: "972542002722000",
  to: CUSTOMER,
  profileName: null,
  origin,
  direction: "out",
});
const order = (id: number, status: string, createdAt: string, eventDate: string | null): EventsOrderLite => ({
  ...r(id, status, createdAt, eventDate),
  phoneKey: "542002722",
  eventId: 1,
  contactName: "דנה כהן",
});

async function inboundSection(): Promise<void> {
  // no tours rows for an events company
  {
    const t = makeEventsDeps();
    await handleWebhookEvents([evMsg("w1", "2026-11-08T09:59:00.000Z", "שלום")], t.deps);
    assert.equal(t.calls.insertLead, 0, "no tours rows for an events company: no lead");
    assert.equal(t.calls.findCustomers, 0, "no tours rows for an events company: no customer read");
    assert.equal(t.messages.length, 1);
    assert.equal(t.messages[0].customerId, null);
    assert.equal(t.chats.get("542002722")?.lastInAt, "2026-11-08T09:59:00.000Z");
  }
  // a reaction stores but does not open
  {
    const t = makeEventsDeps({ orders: [order(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01")] });
    await handleWebhookEvents([evMsg("w1", "2026-11-08T09:59:00.000Z", "👍", { type: "reaction" })], t.deps);
    assert.equal(t.messages.length, 1);
    assert.equal(t.chats.get("542002722")?.lastInAt ?? null, null, "a reaction stores but does not open");
    assert.equal(t.moves.length, 0);
  }
  // history marks nothing
  {
    const t = makeEventsDeps({ orders: [order(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01")] });
    const batch: WaEvent[] = [];
    for (let i = 0; i < 300; i++) {
      const at = new Date(Date.parse("2026-06-01T00:00:00Z") + i * 60_000).toISOString();
      batch.push(i % 2 ? { ...evMsg(`h${i}`, at, `hist ${i}`), origin: "history" } : evEcho(`h${i}`, at, `reply ${i}`, "history"));
    }
    const started = Date.now();
    await handleWebhookEvents(batch, t.deps);
    assert.ok(Date.now() - started < 2000, "history batch under 2 s on stubs");
    const chat = t.chats.get("542002722");
    assert.equal(t.messages.length, 300);
    assert.equal(chat?.lastInAt ?? null, null, "history marks nothing: no last_in_at");
    assert.ok(chat?.seenAt && chat?.answeredAt, "history marks nothing: seen and answered");
    assert.equal(t.moves.length, 0, "history moves no order");
    assert.equal(t.sent.length, 0, "history sends nothing");
  }
  // an echo answers; the app's own automatic text does not
  {
    const t = makeEventsDeps({ autoTexts: ["תודה שפנית, נחזור אליך בהקדם"] });
    await handleWebhookEvents([evMsg("w1", "2026-11-08T09:00:00.000Z", "שאלה")], t.deps);
    await handleWebhookEvents([evEcho("e1", "2026-11-08T09:00:05.000Z", "תודה שפנית,  נחזור אליך בהקדם")], t.deps);
    assert.equal(t.chats.get("542002722")?.answeredAt ?? null, null, "an automatic text is no answer");
    await handleWebhookEvents([evEcho("e2", "2026-11-08T09:10:00.000Z", "היי, בודק לך")], t.deps);
    assert.equal(t.chats.get("542002722")?.answeredAt, "2026-11-08T09:10:00.000Z", "an echo answers");
    assert.equal(t.chats.get("542002722")?.seenAt, "2026-11-08T09:10:00.000Z");
  }
  // R-2 on a new conversation only
  {
    const t = makeEventsDeps({ orders: [order(7, "Lost", "2026-10-01T00:00:00Z", "2026-12-01")] });
    await handleWebhookEvents([evMsg("w1", "2026-11-08T08:00:00.000Z", "היי")], t.deps);
    assert.deepEqual(t.moves, [{ id: 7, today: "2026-11-08", chatId: "chat-542002722" }], "R-2 on a new conversation");
    await handleWebhookEvents([evMsg("w2", "2026-11-08T09:00:00.000Z", "עוד שאלה")], t.deps);
    assert.equal(t.moves.length, 1, "R-2 not inside the gap");
    t.setNow("2026-11-09T10:00:00.000Z");
    await handleWebhookEvents([evMsg("w3", "2026-11-09T10:00:00.000Z", "שוב")], t.deps);
    assert.equal(t.moves.length, 2, "R-2 again after 24 h");
  }
  // opt-out is the whole message
  {
    const t = makeEventsDeps();
    await handleWebhookEvents([evMsg("w1", "2026-11-08T09:00:00.000Z", "הסר את המלון")], t.deps);
    assert.equal(t.sent.length, 0);
    assert.equal(t.chats.get("542002722")?.optedOutAt ?? null, null);
    await handleWebhookEvents([evMsg("w2", "2026-11-08T09:01:00.000Z", "הסר")], t.deps);
    assert.deepEqual(t.sent, [{ to: CUSTOMER, text: OPT_OUT_REPLY }], "opt-out is the whole message");
    assert.equal(t.chats.get("542002722")?.optedOutAt, "2026-11-08T09:01:00.000Z");
  }
  // tours path unchanged
  {
    const t = makeEventsDeps();
    await handleWebhookEvents([{ ...evMsg("w1", "2026-11-08T09:00:00.000Z", "שלום"), phoneNumberId: "111" }], t.deps);
    assert.equal(t.calls.insertLead, 1, "tours path unchanged");
    assert.equal(t.chats.size, 0);
  }
  // the final history chunk suggests the app's automatic texts
  {
    const t = makeEventsDeps();
    await handleWebhookEvents([{ kind: "history", phoneNumberId: "444", phase: 2, chunkOrder: 9, progress: 100 }], t.deps);
    assert.deepEqual(t.calls.suggested, [["שלום, נחזור אליכם"]]);
    const u = makeEventsDeps();
    await handleWebhookEvents([{ kind: "history", phoneNumberId: "444", phase: 0, chunkOrder: 1, progress: 40 }], u.deps);
    assert.deepEqual(u.calls.suggested, [], "only the last chunk suggests");
  }
  // template status keeps the body: a status-only update writes no null body / category / param count
  {
    const row = templateUpsertRow("co-ev", { name: "payment_received", language: "he", category: null, status: "APPROVED", body: null, paramCount: null });
    assert.equal("body" in row, false, "template status keeps the body");
    assert.equal("param_count" in row, false);
    assert.equal("category" in row, false);
    assert.equal(row.status, "APPROVED");
    const full = templateUpsertRow("co-ev", { name: "x", language: "he", category: "UTILITY", status: "APPROVED", body: "שלום {{1}}", paramCount: 1 });
    assert.equal(full.body, "שלום {{1}}");
  }
}

// run last: every section's helpers above must be initialized first
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

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
  marksFor,
  markedReservation,
  normAutoText,
  foldTargets,
  linkSearchOf,
  replyState,
  sameNumber,
  signupSyncs,
  threadKeysOf,
  suggestAutoTexts,
  withoutWaColumns,
  type EventsResLite,
} from "../lib/whatsapp/events/chat-rules";
import { OPT_OUT_REPLY, type WaEvent } from "../lib/whatsapp/rules";
import { isAlertTime, unansweredFor, workingMinutesBetween } from "../lib/whatsapp/events/working-time";
import { outboxDecision, type OrderLite, type OutboxKind, type OutboxRowLite } from "../lib/whatsapp/events/outbox";
import { cleanParam, documentsOf, greetingName, paramsFor, type ParamSource } from "../lib/whatsapp/events/params";
import { drainOutbox, type DrainDeps, type DrainRow } from "../lib/services/whatsapp-events-outbox";
import { airportLabel, candidateWindow, dueThisHour, flightFacts, flightParams, lateBooking, slotFor } from "../lib/whatsapp/events/schedule";
import { runEventsSchedule, type ScheduleCandidate, type ScheduleDeps } from "../lib/services/whatsapp-events-schedule";
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

  // Task 6: the reply box opens only inside the 24-hour window
  assert.deepEqual(replyState("2026-11-08T09:00:00Z", "2026-11-08T10:00:00Z"), { open: true, note: null });
  assert.deepEqual(replyState("2026-11-07T09:00:00Z", "2026-11-08T10:00:00Z"), { open: false, note: "הלקוח כתב לפני יותר מ-24 שעות - עונים מהאפליקציה" });
  assert.equal(replyState(null, "2026-11-08T10:00:00Z").open, false);

  // Task 8: which orders wear the "new message" mark, and the edit page's whole-row save never writes the WhatsApp columns
  {
    const orders = [{ ...r(10, "Paid", "2026-09-01T00:00:00Z", "2026-12-01"), phoneKey: "542002722" }, { ...r(11, "Lost", "2026-10-01T00:00:00Z", "2026-12-05"), phoneKey: "542002722" }];
    assert.deepEqual([...marksFor([{ phoneKey: "542002722", linkedReservationId: null }], orders, TODAY)], [10]);
    assert.deepEqual([...marksFor([{ phoneKey: "500000000", linkedReservationId: 11 }], orders, TODAY)], [11]);
    assert.deepEqual([...marksFor([{ phoneKey: "599999999", linkedReservationId: null }], orders, TODAY)], [], "a chat with no order marks nothing");
    assert.deepEqual([...marksFor([], orders, TODAY)], []);
    assert.deepEqual(withoutWaColumns({ status: "Paid", whatsapp_off_at: null, whatsapp_off_by: null, main_contact_phone_key: "x" }), { status: "Paid" });
  }

  // Task 9: working minutes (Sunday-Thursday 09:00-17:00 Israel) and the unanswered rule
  // Sunday 08.11.2026 is IST (UTC+2): 09:00 IL = 07:00Z
  assert.equal(workingMinutesBetween(new Date("2026-11-08T07:00:00Z"), new Date("2026-11-08T08:00:00Z")), 60);
  // 16:30 Sunday -> 09:30 Monday = 30 + 30
  assert.equal(workingMinutesBetween(new Date("2026-11-08T14:30:00Z"), new Date("2026-11-09T07:30:00Z")), 60);
  // Thursday 16:00 -> Sunday 09:00 = 60 (Friday and Saturday do not count)
  assert.equal(workingMinutesBetween(new Date("2026-11-12T14:00:00Z"), new Date("2026-11-15T07:00:00Z")), 60);
  // a message at night counts from 09:00
  assert.equal(workingMinutesBetween(new Date("2026-11-08T22:00:00Z"), new Date("2026-11-09T08:00:00Z")), 60);
  assert.equal(workingMinutesBetween(new Date("2026-11-08T08:00:00Z"), new Date("2026-11-08T07:00:00Z")), 0, "to before from");
  // summer (IDT, UTC+3): Sunday 07.06.2026 09:00 IL = 06:00Z
  assert.equal(workingMinutesBetween(new Date("2026-06-07T06:00:00Z"), new Date("2026-06-07T07:00:00Z")), 60);
  assert.equal(unansweredFor("2026-11-08T07:00:00Z", null, new Date("2026-11-08T07:59:00Z")), null);
  assert.equal(unansweredFor("2026-11-08T07:00:00Z", null, new Date("2026-11-08T08:00:00Z")), 60);
  assert.equal(unansweredFor("2026-11-08T07:00:00Z", "2026-11-08T07:10:00Z", new Date("2026-11-08T09:00:00Z")), null, "answered");
  assert.equal(unansweredFor(null, null, new Date("2026-11-08T09:00:00Z")), null);
  assert.equal(isAlertTime(new Date("2026-11-08T08:00:00Z")), true);
  assert.equal(isAlertTime(new Date("2026-11-13T08:00:00Z")), false, "Friday is not alert time");
  assert.equal(isAlertTime(new Date("2026-11-08T16:00:00Z")), false, "18:00 is not alert time");

  // Task 11: the send decision (spec section 9, in its order) and the template parameters
  {
    const env = { auto: true, approved: new Set(["payment_received:he", "payment_failed:he", "order_cancelled:he", "flight_reminder:he"]) };
    const obRow = (kind: OutboxKind, o: Partial<OutboxRowLite> = {}): OutboxRowLite => ({ id: "ob-1", kind, reservationId: 1, dueAt: "2026-11-08T09:00:00Z", fromStatus: null, createdAt: "2026-11-08T08:45:00Z", ...o });
    const obOrder = (o: Partial<OrderLite> = {}): OrderLite => ({
      id: 1, status: "Paid", isDeleted: false, whatsappOffAt: null, itineraryGroup: null, phone: "0542002722", phoneKey: "542002722",
      eventId: 1, eventDate: "2026-12-01", createdAt: "2026-10-01T00:00:00Z", paymentReceivedSent: false, ...o,
    });
    assert.deepEqual(outboxDecision(obRow("payment_received"), obOrder(), null, { ...env, auto: false }, NOW), { act: "skip", reason: "הופסק ידנית" });
    assert.deepEqual(outboxDecision(obRow("payment_received"), obOrder({ isDeleted: true }), null, env, NOW), { act: "skip", reason: "ההזמנה נמחקה" });
    assert.deepEqual(outboxDecision(obRow("payment_received"), obOrder({ whatsappOffAt: "2026-11-01T00:00:00Z" }), null, env, NOW), { act: "skip", reason: "כבוי להזמנה הזו" });
    assert.deepEqual(outboxDecision(obRow("payment_received"), obOrder({ itineraryGroup: "g1" }), null, env, NOW), { act: "skip", reason: "טיול יורו - לא בסבב הזה" });
    assert.deepEqual(outboxDecision(obRow("payment_received"), obOrder({ phone: "12" }), null, env, NOW), { act: "skip", reason: "אין טלפון תקין" });
    assert.deepEqual(outboxDecision(obRow("materials_sent"), obOrder(), null, env, NOW), { act: "skip", reason: "התבנית לא אושרה" });
    assert.deepEqual(outboxDecision(obRow("payment_failed", { dueAt: "2026-11-08T10:10:00Z" }), obOrder({ status: "Pending" }), null, env, NOW), { act: "wait" });
    assert.deepEqual(outboxDecision(obRow("payment_failed"), obOrder({ status: "Pending" }), "paid", env, NOW), { act: "skip", reason: "שולם בהזמנה חדשה" });
    assert.deepEqual(outboxDecision(obRow("payment_failed"), obOrder({ status: "Pending" }), "other", env, NOW), { act: "skip", reason: "יש ניסיון תשלום חדש יותר" }, "repeated failures: the newest attempt speaks");
    assert.deepEqual(outboxDecision(obRow("payment_failed", { fromStatus: "Paid" }), obOrder({ status: "Pending" }), null, env, NOW), { act: "skip", reason: "ההזמנה כבר שולמה" }, "Paid -> Pending never tells a paid customer it failed");
    assert.deepEqual(outboxDecision(obRow("payment_failed"), obOrder({ status: "Pending", paymentReceivedSent: true }), null, env, NOW), { act: "skip", reason: "ההזמנה כבר שולמה" });
    assert.deepEqual(outboxDecision(obRow("payment_failed"), obOrder({ status: "Paid" }), null, env, NOW), { act: "skip", reason: "ההזמנה השתנתה" });
    assert.deepEqual(outboxDecision(obRow("payment_failed"), obOrder({ status: "Pending" }), null, env, NOW), { act: "send", to: "972542002722" });
    assert.deepEqual(outboxDecision(obRow("order_cancelled", { fromStatus: "Pending" }), obOrder({ status: "Cancelled" }), null, env, NOW), { act: "skip", reason: "ההזמנה לא שולמה" });
    assert.deepEqual(outboxDecision(obRow("order_cancelled", { fromStatus: "Paid" }), obOrder({ status: "Cancelled" }), null, env, NOW), { act: "send", to: "972542002722" });
    assert.deepEqual(outboxDecision(obRow("order_cancelled", { fromStatus: "Follow-up" }), obOrder({ status: "Cancelled", paymentReceivedSent: true }), null, env, NOW), { act: "send", to: "972542002722" }, "paid earlier, moved, then cancelled");
    assert.deepEqual(outboxDecision(obRow("payment_received"), obOrder({ eventDate: "2026-10-01" }), null, env, NOW), { act: "skip", reason: "האירוע עבר" });
    assert.deepEqual(outboxDecision(obRow("flight_reminder", { dueAt: "2026-11-07T07:00:00Z" }), obOrder(), null, env, NOW), { act: "skip", reason: "עבר הזמן" });
    assert.deepEqual(outboxDecision(obRow("flight_reminder"), obOrder({ status: "Cancelled" }), null, env, NOW), { act: "skip", reason: "ההזמנה השתנתה" });
    assert.deepEqual(outboxDecision(obRow("payment_received"), obOrder(), null, env, NOW), { act: "send", to: "972542002722" });
    assert.equal(documentsOf({ hasFlight: true, hasHotel: true }), "אישור ההזמנה, כרטיסי הטיסה ושובר המלון");
    assert.equal(documentsOf({ hasFlight: false, hasHotel: true }), "אישור ההזמנה ושובר המלון");
    assert.equal(documentsOf({ hasFlight: true, hasHotel: false }), "אישור ההזמנה וכרטיסי הטיסה");
    assert.equal(documentsOf({ hasFlight: false, hasHotel: false }), "אישור ההזמנה");
    assert.equal(greetingName("דנה"), "דנה");
    assert.equal(greetingName("dana123"), "חברים");
    assert.equal(greetingName(null), "חברים");
    assert.equal(cleanParam("a\nb\t c     d"), "a b c d");
    const src: ParamSource = { firstName: "דנה", orderId: 4821, eventLabel: "אוואסיס במנצ׳סטר", eventName: "אוואסיס", resumeUrl: "https://www.mega-events.co.il/order/1", documents: "אישור ההזמנה" };
    assert.deepEqual(paramsFor("payment_received", src), ["דנה", "4821", "אוואסיס במנצ׳סטר", "אישור ההזמנה"]);
    assert.deepEqual(paramsFor("order_cancelled", src), ["דנה", "אוואסיס במנצ׳סטר", "4821"]);
    assert.deepEqual(paramsFor("payment_failed", src), ["דנה", "אוואסיס במנצ׳סטר", "https://www.mega-events.co.il/order/1"]);
    const flight = { ...src, flight: { city: "לונדון", number: "LY317", date: "12.11", hour: "06:40", airport: "נתב״ג" } };
    assert.deepEqual(paramsFor("flight_reminder", flight), ["דנה", "לונדון", "LY317", "12.11", "06:40", "נתב״ג"]);
    assert.deepEqual(paramsFor("event_today", { ...src, place: "אצטדיון הית׳אד, מנצ׳סטר" }), ["דנה", "אוואסיס", "אצטדיון הית׳אד, מנצ׳סטר"]);
  }

  // Task 13: the reminder slots (Israel time) and the flight's facts
  {
    const amadeus = { outbound: { departureTime: "2026-11-12T06:40:00", departureAirport: "TLV", flightNumber: "LY315" }, inbound: { arrivalTime: "2026-11-15T22:10:00" }, offer: { itineraries: [{ segments: [{ carrierCode: "LY", number: "317" }] }] } };
    const ff = flightFacts({ flightOrderInfo: amadeus, offline: null });
    assert.ok(ff);
    assert.equal(ff.number, "LY317", "the operating segment, not the validating carrier's stored number");
    assert.equal(flightFacts({ flightOrderInfo: {}, offline: null }), null, "a skipped flight has no reminder");
    assert.equal(flightFacts({ flightOrderInfo: { outbound: { departureTime: "0" } }, offline: null }), null, "an unreadable time");
    const offline = { outbound_departure_time: "2026-11-12 09:00:00", outbound_flight_number: "IZ101", outbound_departure_airport: "TLV", inbound_arrival_time: null, is_deleted: null, cancelled_at: null };
    assert.equal(flightFacts({ flightOrderInfo: amadeus, offline })?.number, "IZ101", "a live offline row wins");
    assert.equal(flightFacts({ flightOrderInfo: amadeus, offline: { ...offline, cancelled_at: "2026-11-01T00:00:00Z" } })?.number, "LY317", "a cancelled offline row does not");
    // 3 days before 12.11 at 09:00 Israel (IST, UTC+2) = 2026-11-09T07:00:00Z
    assert.equal(slotFor("flight_reminder", { flight: ff, eventDate: "2026-11-13" }), "2026-11-09T07:00:00.000Z");
    assert.equal(slotFor("event_today", { flight: ff, eventDate: "2026-11-13" }), "2026-11-13T08:00:00.000Z");
    assert.equal(slotFor("after_trip", { flight: ff, eventDate: "2026-11-13" }), "2026-11-16T09:00:00.000Z");
    assert.equal(slotFor("after_trip", { flight: null, eventDate: "2026-11-13" }), "2026-11-14T09:00:00.000Z");
    assert.equal(slotFor("flight_reminder", { flight: null, eventDate: "2026-11-13" }), null);
    assert.equal(slotFor("event_today", { flight: null, eventDate: null }), null);
    assert.equal(dueThisHour("2026-11-09T07:00:00.000Z", new Date("2026-11-09T07:05:00Z")), true);
    assert.equal(dueThisHour("2026-11-09T07:00:00.000Z", new Date("2026-11-09T08:05:00Z")), false);
    assert.equal(dueThisHour("2026-11-09T07:00:00.000Z", new Date("2026-11-09T06:59:00Z")), false);
    assert.equal(lateBooking("2026-11-10T10:00:00Z", "2026-11-09T07:00:00.000Z"), true);
    assert.equal(lateBooking("2026-11-01T10:00:00Z", "2026-11-09T07:00:00.000Z"), false);
    assert.equal(airportLabel("TLV"), "נתב״ג");
    assert.equal(airportLabel("ETM"), "ETM");
    assert.deepEqual(flightParams(ff, "לונדון"), { city: "לונדון", number: "LY317", date: "12.11", hour: "06:40", airport: "נתב״ג" });
  }

  // review fixes: the fold answers each chat on its own; the link search reads a typed phone; the thread always reads the
  // order's own phone; the schedule's window reaches a flight two weeks before the show
  {
    const own = { id: "c1", phoneKey: "542002722", phone: "972542002722", lastInAt: "2026-11-08T09:00:00Z" };
    const mate = { id: "c2", phoneKey: "525287144", phone: "972525287144", lastInAt: "2026-11-08T09:30:00Z" };
    assert.deepEqual(foldTargets([mate, own], "542002722").map((t) => [t.chatId, t.own]), [["c1", true], ["c2", false]], "the order's own phone first");
    assert.deepEqual(linkSearchOf("4821"), { kind: "id", id: 4821 });
    assert.deepEqual(linkSearchOf("054-200-2722"), { kind: "phone", key: "542002722" });
    assert.deepEqual(linkSearchOf("+972 54 200 2722"), { kind: "phone", key: "542002722" });
    assert.deepEqual(linkSearchOf("דנה"), { kind: "name", text: "דנה" });
    assert.equal(linkSearchOf("a"), null);
    assert.deepEqual(threadKeysOf([], "542002722"), ["542002722"], "a customer who never wrote still shows what we sent");
    assert.deepEqual(threadKeysOf([own, mate], "542002722"), ["542002722", "525287144"]);
    const w = candidateWindow("2026-11-08");
    assert.ok(w.from <= "2026-10-31" && w.to >= "2026-11-22", `the window reaches 8 days back and 14 ahead (${w.from}..${w.to})`);
  }

  await scheduleSection();
  await drainSection();
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

function makeEventsDeps(opts: { orders?: EventsOrderLite[]; autoTexts?: string[]; now?: string; upsertFailsOnce?: boolean } = {}) {
  let upsertFails = !!opts.upsertFailsOnce;
  const echoArgs: { days: number; max: number }[] = [];
  const messages: (WaMessageInsert & { id: string })[] = [];
  const chats = new Map<string, WaChat>();
  const moves: { id: number; today: string; chatId: string }[] = [];
  const marks: { chatId: string; patch: Record<string, unknown> }[] = [];
  const sent: { to: string; text: string }[] = [];
  const calls = { insertLead: 0, findCustomers: 0, suggested: [] as string[][], upserts: 0, contacts: 0 };
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
    saveContacts: async () => {
      calls.contacts += 1;
    },
    removeContacts: async () => {},
    log: { warn: () => {}, error: () => {} },
    events: {
      chatByKey: async (_c, key) => chats.get(key) ?? null,
      upsertChat: async (companyId, phone, key, patch) => {
        calls.upserts += 1;
        if (upsertFails) {
          upsertFails = false;
          throw new Error("wa_chats: a blip");
        }
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
      recentEchoes: async (_c, days, max) => {
        echoArgs.push({ days, max });
        return [1, 2, 3, 4, 5].map((i) => ({ phoneKey: `50000000${i}`, text: "שלום, נחזור אליכם" }));
      },
    },
  };
  return { deps, messages, chats, moves, marks, sent, calls, echoArgs, setNow: (t: string) => (now = t) };
}

type MsgEvent = Extract<WaEvent, { kind: "message" }>;
const evMsg = (id: string, at: string, text: string | null, extra: Partial<MsgEvent> = {}): MsgEvent => ({
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
const evEcho = (id: string, at: string, text: string, origin: "app" | "history" = "app"): MsgEvent => ({
  ...evMsg(id, at, text),
  from: "972542002722000",
  to: CUSTOMER,
  profileName: null,
  origin,
  direction: "out",
});
const order = (id: number, status: string, createdAt: string, eventDate: string | null, phone = "054-200-2722"): EventsOrderLite => ({
  ...r(id, status, createdAt, eventDate),
  phone,
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
    assert.equal(chat?.seenAt ?? null, null, "history stamps no seen (it would hide a live message)");
    assert.equal(chat?.answeredAt ?? null, null, "history stamps no answer");
    assert.equal(t.calls.upserts, 1, "one chat write per phone per history batch");
    assert.equal(t.moves.length, 0, "history moves no order");
    assert.equal(t.sent.length, 0, "history sends nothing");
  }
  // a live message, then a history chunk of the same phone: the live message stays new and unanswered
  {
    const t = makeEventsDeps();
    await handleWebhookEvents([evMsg("live1", "2026-11-08T08:00:00.000Z", "שלום")], t.deps);
    await handleWebhookEvents([{ ...evMsg("old1", "2026-06-01T08:00:00.000Z", "ישן"), origin: "history" }, evEcho("old2", "2026-06-01T08:05:00.000Z", "תשובה ישנה", "history")], t.deps);
    const chat = t.chats.get("542002722");
    assert.equal(chat?.lastInAt, "2026-11-08T08:00:00.000Z");
    assert.equal(chat?.seenAt ?? null, null, "history never hides a live message");
    assert.equal(chat?.answeredAt ?? null, null);
  }
  // a chat write that fails once is tried again - the message was stored and Meta will not re-deliver it
  {
    const t = makeEventsDeps({ upsertFailsOnce: true });
    await handleWebhookEvents([evMsg("w1", "2026-11-08T09:00:00.000Z", "שלום")], t.deps);
    assert.equal(t.chats.get("542002722")?.lastInAt, "2026-11-08T09:00:00.000Z", "a chat write is retried once");
  }
  // "הסר" is answered by the system - the chat does not wait for a rep
  {
    const t = makeEventsDeps();
    await handleWebhookEvents([evMsg("w1", "2026-11-08T09:00:00.000Z", "הסר")], t.deps);
    assert.ok(t.marks.some((m) => m.patch.answeredAt === "2026-11-08T09:00:00.000Z"), "an opt-out is answered");
  }
  // full-number binding: an order of another country whose last 9 digits are the same is not this customer's
  {
    assert.equal(sameNumber("054-200-2722", "972542002722"), true);
    assert.equal(sameNumber("+44 7542 002722", "972542002722"), false);
    const t = makeEventsDeps({ orders: [order(9, "Lost", "2026-10-01T00:00:00Z", "2026-12-01", "+44 7542 002722")] });
    await handleWebhookEvents([evMsg("w1", "2026-11-08T08:00:00.000Z", "היי")], t.deps);
    assert.equal(t.moves.length, 0, "another country's order never moves");
  }
  // the phone book of an events number is never stored (spec section 6)
  {
    const t = makeEventsDeps();
    await handleWebhookEvents([{ kind: "contact", phoneNumberId: "444", phone: "972501112233", fullName: "אמא", firstName: "אמא", action: "add", at: null }], t.deps);
    assert.equal(t.calls.contacts, 0, "no phone book for Mega Events");
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
    assert.ok(t.echoArgs[0].max <= 5000, "the webhook's suggestion reads a bounded slice (30 s)");
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

// ------------------------------------------------------------ Task 12: the drain over injected deps
function makeDrainDeps(opts: { rows: DrainRow[]; trialPhone?: string | null; sendFails?: boolean; auto?: boolean; finishThrowsFor?: string }) {
  const claimed = new Set<string>();
  const touched: { phone: string; at: string }[] = [];
  const sends: { to: string; template: string; params: string[]; reservationId: number }[] = [];
  const finishes: { id: string; patch: Record<string, unknown> }[] = [];
  const rows = opts.rows.map((r) => ({ ...r }));
  const deps: DrainDeps = {
    now: () => new Date("2026-11-08T10:00:00Z"),
    env: () => ({ auto: opts.auto ?? true, trialPhone: opts.trialPhone ?? null }),
    pendingRows: async ({ reservationId }) => rows.filter((r) => r.status === "pending" && (reservationId === undefined || r.reservationId === reservationId)),
    approved: async () => new Set(["payment_received:he", "payment_failed:he"]),
    load: async (id) => ({
      order: { id, status: "Paid", isDeleted: false, whatsappOffAt: null, itineraryGroup: null, phone: "054-200-2722", phoneKey: "542002722", eventId: 1, eventDate: "2026-12-01", createdAt: "2026-10-01T00:00:00Z", paymentReceivedSent: false },
      source: { firstName: "דנה", orderId: id, eventLabel: "אוואסיס במנצ׳סטר", eventName: "אוואסיס", resumeUrl: "https://x/order/1", documents: "אישור ההזמנה" },
    }),
    newerOrderSameEvent: async () => null,
    touchChat: async (phone, at) => {
      touched.push({ phone, at });
    },
    claim: async (id) => {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    },
    failStale: async () => 0,
    send: async (to, template, params, reservationId) => {
      sends.push({ to, template, params, reservationId });
      return opts.sendFails ? { ok: false, error: "(#131026) undeliverable" } : { ok: true };
    },
    finish: async (id, patch) => {
      if (id === opts.finishThrowsFor) throw new Error("wa_outbox: down");
      claimed.delete(id);
      finishes.push({ id, patch: patch as Record<string, unknown> });
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.status = patch.status;
        r.attempts = patch.attempts;
      }
    },
  };
  return { deps, sends, finishes, rows, touched };
}
const drainRow = (id: string, kind: OutboxKind, o: Partial<DrainRow> = {}): DrainRow => ({
  id, kind, reservationId: 7, dueAt: "2026-11-08T09:00:00Z", fromStatus: "Pending", createdAt: "2026-11-08T08:59:00Z", status: "pending", attempts: 0, ...o,
});

async function drainSection(): Promise<void> {
  // trial sends to the trial phone, with the customer's parameters
  {
    const t = makeDrainDeps({ rows: [drainRow("a", "payment_received")], trialPhone: "0525287144" });
    const out = await drainOutbox({ budgetMs: 5000, dryRun: false }, t.deps);
    assert.equal(t.sends.length, 1);
    assert.equal(t.sends[0].to, "972525287144", "trial sends to the trial phone");
    assert.deepEqual(t.sends[0].params, ["דנה", "7", "אוואסיס במנצ׳סטר", "אישור ההזמנה"]);
    assert.equal(t.finishes[0].patch.status, "sent");
    assert.equal(t.finishes[0].patch.sentTo, "972525287144");
    assert.equal(t.finishes[0].patch.reason, "נשלח לטלפון הניסיון");
    assert.equal(out.sent, 1);
  }
  // without trial, to the customer - and the customer's chat shows the message went out
  {
    const t = makeDrainDeps({ rows: [drainRow("a", "payment_received")] });
    await drainOutbox({ budgetMs: 5000, dryRun: false }, t.deps);
    assert.equal(t.sends[0].to, "972542002722");
    assert.equal(t.finishes[0].patch.reason, null);
    assert.deepEqual(t.touched.map((x) => x.phone), ["972542002722"], "an automatic send touches the customer's chat");
  }
  {
    const t = makeDrainDeps({ rows: [drainRow("a", "payment_received")], trialPhone: "0525287144" });
    await drainOutbox({ budgetMs: 5000, dryRun: false }, t.deps);
    assert.equal(t.touched.length, 0, "a trial send touches no customer chat");
  }
  // dry run sends nothing and finishes nothing
  {
    const t = makeDrainDeps({ rows: [drainRow("a", "payment_received")] });
    const out = await drainOutbox({ budgetMs: 5000, dryRun: true }, t.deps);
    assert.equal(t.sends.length, 0, "dry run sends nothing");
    assert.equal(t.finishes.length, 0, "dry run finishes nothing");
    assert.equal(out.lines[0].result, "send");
  }
  // a failed send retries twice then stays failed
  {
    const t = makeDrainDeps({ rows: [drainRow("a", "payment_received")], sendFails: true });
    for (let i = 0; i < 4; i++) await drainOutbox({ budgetMs: 5000, dryRun: false }, t.deps);
    assert.deepEqual(t.finishes.map((f) => [f.patch.status, f.patch.attempts]), [["pending", 1], ["pending", 2], ["failed", 3]], "two retries, then failed");
    assert.match(String(t.finishes[2].patch.reason), /131026/);
  }
  // a skip is final, with its reason
  {
    const t = makeDrainDeps({ rows: [drainRow("a", "materials_sent")] });
    await drainOutbox({ budgetMs: 5000, dryRun: false }, t.deps);
    assert.deepEqual([t.finishes[0].patch.status, t.finishes[0].patch.reason], ["skipped", "התבנית לא אושרה"]);
  }
  // a trial phone that is set but unusable fails CLOSED - real customers never get the trial week's messages
  {
    const t = makeDrainDeps({ rows: [drainRow("a", "payment_received")], trialPhone: "542002722" });
    await drainOutbox({ budgetMs: 5000, dryRun: false }, t.deps);
    assert.equal(t.sends.length, 0, "an unusable trial phone sends nothing");
    assert.deepEqual([t.finishes[0].patch.status, t.finishes[0].patch.reason], ["skipped", "טלפון הניסיון לא תקין"]);
  }
  // two drains at once: a row is claimed by one of them - the customer gets ONE message
  {
    const t = makeDrainDeps({ rows: [drainRow("a", "payment_received")] });
    await Promise.all([drainOutbox({ budgetMs: 5000, dryRun: false }, t.deps), drainOutbox({ budgetMs: 5000, dryRun: false }, t.deps)]);
    assert.equal(t.sends.length, 1, "a claimed row is sent once");
  }
  // one row failing does not stop the rows behind it
  {
    const t = makeDrainDeps({ rows: [drainRow("a", "payment_received", { reservationId: 7 }), drainRow("b", "payment_received", { reservationId: 8 })], finishThrowsFor: "a" });
    const out = await drainOutbox({ budgetMs: 5000, dryRun: false }, t.deps);
    assert.equal(t.sends.length, 2, "the second row still goes");
    assert.equal(out.lines.find((l) => l.id === "a")?.result.startsWith("error"), true);
  }
  // pending wait is left pending
  {
    const t = makeDrainDeps({ rows: [drainRow("a", "payment_failed", { dueAt: "2026-11-08T10:10:00Z" })] });
    const out = await drainOutbox({ budgetMs: 5000, dryRun: false }, t.deps);
    assert.equal(t.finishes.length, 0, "pending wait is left pending");
    assert.equal(out.waiting, 1);
  }
}

// ------------------------------------------------------------ Task 14: the schedule cron over injected deps
function makeScheduleDeps(candidates: ScheduleCandidate[], afterTrip = false) {
  const queued: { kind: string; reservationId: number; dueAt: string; dedupeKey: string }[] = [];
  const deps: ScheduleDeps = {
    afterTripOn: () => afterTrip,
    candidates: async () => candidates,
    enqueue: async (rows) => {
      queued.push(...rows);
    },
  };
  return { deps, queued };
}
async function scheduleSection(): Promise<void> {
  const flying: ScheduleCandidate = {
    id: 1, createdAt: "2026-10-01T00:00:00Z", eventDate: "2026-11-13", itineraryGroup: null, paymentReceivedSent: true,
    flight: { departureLocal: "2026-11-12T06:40:00", number: "LY317", airport: "TLV", returnArrivalLocal: "2026-11-15T22:10:00" },
  };
  const ticketOnly: ScheduleCandidate = { id: 2, createdAt: "2026-10-01T00:00:00Z", eventDate: "2026-11-13", itineraryGroup: null, paymentReceivedSent: false, flight: null };
  {
    const t = makeScheduleDeps([flying, ticketOnly]);
    const out = await runEventsSchedule({ dryRun: false, now: new Date("2026-11-09T07:05:00Z") }, t.deps);
    assert.deepEqual(t.queued.map((q) => [q.kind, q.reservationId, q.dedupeKey]), [["flight_reminder", 1, "flight_reminder:1:2026-11-12"]]);
    assert.equal(out.enqueued.length, 1);
  }
  {
    const t = makeScheduleDeps([flying, ticketOnly]);
    await runEventsSchedule({ dryRun: false, now: new Date("2026-11-13T08:05:00Z") }, t.deps);
    assert.deepEqual(t.queued.map((q) => [q.kind, q.reservationId, q.dedupeKey]), [["event_today", 1, "event_today:1:2026-11-13"], ["event_today", 2, "event_today:2:2026-11-13"]]);
  }
  {
    const off = makeScheduleDeps([flying]);
    await runEventsSchedule({ dryRun: false, now: new Date("2026-11-16T09:05:00Z") }, off.deps);
    assert.equal(off.queued.length, 0, "after_trip is off by default");
    const on = makeScheduleDeps([flying, ticketOnly], true);
    const out = await runEventsSchedule({ dryRun: false, now: new Date("2026-11-16T09:05:00Z") }, on.deps);
    assert.deepEqual(on.queued.map((q) => q.dedupeKey), ["after_trip:1:2026-11-16"]);
    const onDay14 = makeScheduleDeps([ticketOnly], true);
    const out14 = await runEventsSchedule({ dryRun: false, now: new Date("2026-11-14T09:05:00Z") }, onDay14.deps);
    assert.deepEqual(out14.skipped, [{ reservationId: 2, why: "הזמנה מלפני ההפעלה" }], "no after_trip for an order paid before launch");
    assert.equal(out.enqueued.length, 1);
  }
  {
    const late = { ...flying, id: 3, createdAt: "2026-11-10T00:00:00Z" };
    const trip = { ...flying, id: 4, itineraryGroup: "g1" };
    const t = makeScheduleDeps([late, trip]);
    const out = await runEventsSchedule({ dryRun: false, now: new Date("2026-11-09T07:05:00Z") }, t.deps);
    assert.equal(t.queued.length, 0);
    assert.deepEqual(out.skipped, [{ reservationId: 3, why: "הזמנה מאוחרת" }, { reservationId: 4, why: "טיול יורו - לא בסבב הזה" }]);
  }
  {
    const t = makeScheduleDeps([flying]);
    const out = await runEventsSchedule({ dryRun: true, now: new Date("2026-11-09T07:05:00Z") }, t.deps);
    assert.equal(t.queued.length, 0, "dry run writes nothing");
    assert.equal(out.enqueued.length, 1, "dry run lists what it would enqueue");
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

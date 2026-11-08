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
  suggestAutoTexts,
  type EventsResLite,
} from "../lib/whatsapp/events/chat-rules";

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

  console.log("whatsapp-events selftest: OK");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

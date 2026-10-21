// scripts/tours-cases-selftest.ts - `npx tsx scripts/tours-cases-selftest.ts`
// Pure only: the rules of a tours case (lib/tours/cases.ts). No DB, no network.
//
// What it guards: one row per customer - TYPE from the form, TASK from the case, the phone key a
// site booking finds its lead by, the status list staff edit (system statuses and statuses in use
// never disappear, a rename keeps the key), and the booking link with its composition.
import assert from "node:assert/strict";
import {
  assembleThread,
  deliveryMark,
  originLabel,
  threadKeys,
  type WaThreadMessage,
  DEFAULT_STATUSES,
  bookingBlocksDelete,
  bookingLink,
  caseMatches,
  cardStage,
  checkFuture,
  cleanPhones,
  customerLabel,
  daysLate,
  inquiriesOf,
  isOpenCard,
  knownFrom,
  paymentAnswerOf,
  routeInquiry,
  sameEmailSuggestion,
  seasonOptions,
  senderDiffers,
  statusOnReturn,
  todayRank,
  todayReason,
  cleanRoomKeys,
  confirmationPendingOf,
  followUpDue,
  followUpTone,
  htmlToText,
  siteHref,
  isClosedStatus,
  linkMessage,
  packagePathOf,
  packageSlugOf,
  phoneKey,
  sameCustomer,
  productIdOf,
  seatBookingOf,
  owedSeatRefs,
  seatGap,
  sourceLabel,
  splitName,
  typeOfKind,
  validateStatuses,
  waLink,
  whatsappAppLink,
  whatsappPhone,
  needsCloseReason,
  checkCloseReason,
  statusAfterLink,
  bookingPhase,
  travelerGroups,
  payloadText,
  closeBlockedBy,
  parseOffer,
  offerSent,
  isOfferChannel,
  type CaseRow,
  type CaseStatus,
  type RouteCard,
  type SeatBooking,
  type SeatGap,
  type TodayFacts,
  type TodayReason,
} from "../lib/tours/cases";
import {
  BOARD_ORDER_MAX,
  NOTE_LINE_MAX,
  afterSave,
  arrivalOf,
  boardViewerOf,
  canSeeCard,
  cleanOrderIds,
  moveInOrder,
  noteLine,
  orderBoard,
  placeInOrder,
  visibleCards,
  writtenToday,
} from "../lib/tours/board";

const TODAY = "2026-10-14";
const S = DEFAULT_STATUSES;

// ---------------------------------------------------------------- TYPE from the form
assert.equal(typeOfKind("notify"), "potential");
assert.equal(typeOfKind("waitlist"), "potential");
assert.equal(typeOfKind("newsletter"), "potential");
assert.equal(typeOfKind("booking"), "reservation");
assert.equal(typeOfKind("advisor"), "reservation");
assert.equal(typeOfKind("lead"), "lead");
assert.equal(typeOfKind("contact"), "lead");
assert.equal(typeOfKind("manual"), "lead");

// ---------------------------------------------------------------- TODAY: why a card waits for a rep (Nir 19.10)
const facts = (over: Partial<TodayFacts> = {}): TodayFacts => ({
  status: "new",
  followUpDate: null,
  toFile: false,
  paymentAnswer: null,
  confirmationPending: false,
  waUnseen: 0,
  ...over,
});
assert.equal(todayReason(facts(), S, TODAY), "new");
assert.equal(todayReason(facts({ status: "returned", followUpDate: "2026-10-01" }), S, TODAY), "returned", "came back beats a late follow-up");
assert.equal(todayReason(facts({ status: "pending_payment", paymentAnswer: "paid" }), S, TODAY), "payment");
assert.equal(todayReason(facts({ status: "pending_payment" }), S, TODAY), null, "money on its way, no answer yet: nothing to do");
assert.equal(todayReason(facts({ toFile: true, status: "new" }), S, TODAY), "file");
assert.equal(todayReason(facts({ status: "no_answer", followUpDate: "2026-10-10" }), S, TODAY), "late");
assert.equal(todayReason(facts({ status: "offer_sent", followUpDate: TODAY }), S, TODAY), "today");
assert.equal(todayReason(facts({ status: "offer_sent", followUpDate: "2026-10-15" }), S, TODAY), null, "a day ahead is not today's");
assert.equal(todayReason(facts({ status: "paid", confirmationPending: true }), S, TODAY), "confirmation");
assert.equal(todayReason(facts({ status: "paid" }), S, TODAY), null);
assert.equal(todayReason(facts({ status: "not_relevant", followUpDate: "2026-10-01" }), S, TODAY), null, "closed = nothing, even a late day");
assert.equal(todayReason(facts({ status: "future", followUpDate: "2027-03-01" }), S, TODAY), null, "a future lead waits for its season");
assert.deepEqual(
  (["today", "returned", "file", "late", "payment", "new"] as TodayReason[]).sort((a, b) => todayRank(a) - todayRank(b)),
  ["returned", "payment", "file", "new", "late", "today"],
  "Nir's order",
);
assert.equal(daysLate("2026-10-12", TODAY), 2);
assert.equal(paymentAnswerOf("pending_payment", ["paid", "failed"]), "paid", "the newest booking speaks");
assert.equal(paymentAnswerOf("pending_payment", ["pending_payment", "failed"]), null, "an older failure is not this payment's answer");
assert.equal(paymentAnswerOf("paid", ["paid"]), null, "confirmed already");
assert.equal(paymentAnswerOf("pending_payment", ["review"]), "review");
assert.equal(isClosedStatus("mystery", S), false, "a status no list knows is open");
assert.equal(isClosedStatus("spam", []), true, "the default closed keys hold with no list");
assert.equal(followUpDue({ followUpDate: TODAY, status: "new" }, S, TODAY), true);
assert.equal(followUpDue({ followUpDate: TODAY, status: "not_relevant" }, S, TODAY), false);
assert.equal(followUpDue({ followUpDate: null, status: "new" }, S, TODAY), false);
// the table's follow-up pill + row tint: only an open case with a day says anything
assert.equal(followUpTone({ followUpDate: "2026-10-10", status: "new" }, S, TODAY), "overdue");
assert.equal(followUpTone({ followUpDate: TODAY, status: "in_progress" }, S, TODAY), "today");
assert.equal(followUpTone({ followUpDate: "2099-01-01", status: "new" }, S, TODAY), "upcoming");
assert.equal(followUpTone({ followUpDate: "2026-10-10", status: "not_relevant" }, S, TODAY), null, "a closed case is not late");
assert.equal(followUpTone({ followUpDate: null, status: "new" }, S, TODAY), null, "no day, no pill");
assert.equal(followUpTone({ followUpDate: "garbage", status: "new" }, S, TODAY), null);

// ---------------------------------------------------------------- phone key: the last 9 digits, whatever the writing
assert.equal(phoneKey("054-123 4567"), "541234567");
assert.equal(phoneKey("+972 54 123 4567"), "541234567");
assert.equal(phoneKey("00972541234567"), "541234567");
assert.equal(phoneKey("0541234567"), phoneKey("+972-54-1234567"));
assert.equal(phoneKey("12345"), "", "too short to match anyone");
assert.equal(phoneKey(null), "");

// the case page's "sent by someone else" warning: a name differing only in case or spacing is the same person
assert.equal(sameCustomer({ name: "tammy  Aharon ", phone: null }, { name: "Tammy aharon", phone: null }), true);
assert.equal(sameCustomer({ name: "דנה כהן", phone: "054-1234567" }, { name: "דנה כהן", phone: "+972541234567" }), true);
assert.equal(sameCustomer({ name: "דנה כהן", phone: null }, { name: "יוסי לוי", phone: null }), false);
assert.equal(sameCustomer({ name: "דנה", phone: "0541234567" }, { name: "דנה", phone: "0529999999" }), false, "same name, another phone");
assert.equal(sameCustomer({ name: "", phone: null }, { name: "דנה", phone: null }), true, "nothing to compare is no warning");

// ---------------------------------------------------------------- names
assert.deepEqual(splitName("  דנה   כהן לוי "), { first: "דנה", last: "כהן לוי" });
assert.deepEqual(splitName("דנה"), { first: "דנה", last: "" });
assert.deepEqual(splitName(null), { first: "", last: "" });

// ---------------------------------------------------------------- product / package from the form's page
assert.equal(productIdOf("/package/%D7%98%D7%99%D7%95%D7%9C/?product_id=100234"), 100234);
assert.equal(productIdOf("/package/x/?a=1&product_id=77&b=2"), 77);
assert.equal(productIdOf("/package/x/?product_id=77abc"), null, "a number that runs on is no id");
assert.equal(productIdOf("/contact/"), null);
assert.equal(packageSlugOf("/package/%D7%98%D7%99%D7%95%D7%9C-%D7%91%D7%A8%D7%9C%D7%99%D7%9F/?product_id=1"), "טיול-ברלין");
assert.equal(packageSlugOf("/package/%E0%A4%A/"), "%E0%A4%A", "a broken escape keeps the raw text");
assert.equal(packageSlugOf("/about/"), null);
assert.equal(packageSlugOf(null), null);

// ---------------------------------------------------------------- source
assert.equal(sourceLabel("site", {}), "Website");
assert.equal(sourceLabel("site", { source: "facebook", medium: "paid" }), "facebook / paid");
assert.equal(sourceLabel("phone", { source: "google" }), "google");
assert.equal(sourceLabel("whatever", {}), "whatever");

// ---------------------------------------------------------------- statuses
const drafts = (list: readonly CaseStatus[]) =>
  list.map((s) => ({ key: s.key as string | null, label: s.label, color: s.color as string, isClosed: s.isClosed, isActive: s.isActive }));
const added = validateStatuses([...drafts(S), { key: null, label: "מחכה לאישור משפחה", color: "violet", isClosed: false, isActive: true }], S);
assert.ok(added.ok);
if (added.ok) {
  assert.equal(added.statuses.length, S.length + 1);
  assert.equal(added.statuses.at(-1)?.key, "custom_1");
  assert.equal(added.statuses.at(-1)?.isSystem, false);
}
assert.ok(!validateStatuses(drafts(S).filter((s) => s.key !== "no_answer"), S).ok, "a status is switched off, never removed");
assert.ok(!validateStatuses(drafts(S).map((s) => (s.key === "new" ? { ...s, isActive: false } : s)), S).ok, "a system status stays on");
const closedPaid = validateStatuses(drafts(S).map((s) => (s.key === "paid" ? { ...s, isClosed: true } : s)), S);
assert.ok(closedPaid.ok && closedPaid.statuses.find((s) => s.key === "paid")?.isClosed === false, "system statuses keep their closed flag");
assert.ok(!validateStatuses(drafts(S).map((s) => (s.key === "no_answer" ? { ...s, label: "חדש" } : s)), S).ok, "no two statuses share a label");
assert.ok(!validateStatuses(drafts(S).map((s) => ({ ...s, color: "neon" })), S).ok, "an unknown colour is refused");
assert.ok(!validateStatuses(drafts(S).map((s) => (s.key === "no_answer" ? { ...s, label: "  " } : s)), S).ok, "an empty name is refused");
assert.ok(
  !validateStatuses([...drafts(S), { key: "made_up", label: "x", color: "gray", isClosed: false, isActive: true }], S).ok,
  "a key the list never had is refused",
);
const renamed = validateStatuses(drafts(S).map((s) => (s.key === "no_answer" ? { ...s, label: "לא עונה" } : s)), S);
assert.ok(renamed.ok && renamed.statuses.find((s) => s.key === "no_answer")?.label === "לא עונה", "a rename keeps the key");
const custom: CaseStatus[] = [...S, { key: "custom_4", label: "x", color: "gray", isClosed: false, isSystem: false, isActive: true }];
const next = validateStatuses([...drafts(custom), { key: null, label: "y", color: "gray", isClosed: false, isActive: true }], custom);
assert.ok(next.ok && next.statuses.at(-1)?.key === "custom_5");
const reordered = validateStatuses([...drafts(S)].reverse(), S);
assert.ok(reordered.ok && reordered.statuses[0].key === S.at(-1)?.key, "the order is the order saved");
// Nir's list (19.10): the ten statuses + spam on, the old ones off but kept
assert.deepEqual(
  S.filter((s) => s.isActive).map((s) => s.key),
  ["new", "no_answer", "returned", "offer_sent", "future", "pending_payment", "deposit_paid", "paid", "not_relevant", "cancelled", "spam"],
);
assert.deepEqual(S.filter((s) => !s.isActive).map((s) => s.key), ["in_progress", "follow_up", "done", "payment_failed", "payment_review"]);
assert.ok(!validateStatuses(drafts(S).map((s) => (s.key === "returned" ? { ...s, isActive: false } : s)), S).ok, "a status the code reads stays on");
const offRetired = validateStatuses(drafts(S).map((s) => (s.key === "done" ? { ...s, isActive: true } : s)), S);
assert.ok(offRetired.ok, "a retired status may be switched back on by a company that wants it");
assert.ok(validateStatuses([...drafts(S), { key: null, label: "cyan one", color: "cyan", isClosed: false, isActive: true }], S).ok, "cyan is a colour");

// ---------------------------------------------------------------- booking link
assert.deepEqual(cleanRoomKeys(["double_room", "bogus", "couple_kid", "double_room"], ["double_room", "couple_kid"]), [
  "double_room",
  "couple_kid",
  "double_room",
]);
assert.equal(cleanRoomKeys(Array(12).fill("double_room"), ["double_room"]).length, 9);
assert.equal(packagePathOf("טיול-ברלין", null), "/package/%D7%98%D7%99%D7%95%D7%9C-%D7%91%D7%A8%D7%9C%D7%99%D7%9F/");
assert.equal(packagePathOf("x", "/package/old-wp-path/"), "/package/old-wp-path/");
assert.equal(packagePathOf("x", "https://evil.example/"), "/package/x/", "only a site-relative path is trusted");
assert.equal(packagePathOf("x", "//evil.example/"), "/package/x/", "a protocol-relative path is not site-relative");
const token = "abcDEF0123456789_-xy";
assert.equal(
  bookingLink({ siteUrl: "https://megafamily.co.il/", packagePath: "/package/x/", productId: 100234, rooms: ["double_room", "couple_kid"], token }),
  `https://megafamily.co.il/package/x/?product_id=100234&rooms=double_room%2Ccouple_kid&lr=${token}`,
);
assert.equal(whatsappPhone("054-1234567"), "972541234567");
assert.equal(whatsappPhone("+972 54 1234567"), "972541234567");
assert.equal(whatsappPhone("00972541234567"), "972541234567");
assert.equal(whatsappPhone("1234"), null);
assert.equal(waLink("0541234567", "שלום"), "https://wa.me/972541234567?text=%D7%A9%D7%9C%D7%95%D7%9D");
assert.equal(waLink("12", "x"), null);
const message = linkMessage("דנה", "טיול לברלין", "https://x.example/a");
assert.ok(message.includes("https://x.example/a") && message.includes("דנה") && message.includes("טיול לברלין"));
assert.ok(linkMessage(null, null, "https://x").startsWith("היי,"));

// ---------------------------------------------------------------- search
const row = {
  caseNo: 1042,
  firstName: "דנה",
  lastName: "כהן",
  phone: "054-1234567",
  email: "dana@example.com",
  idNumber: "123456782",
  accNum: "A-77",
  bookingRef: "T10005",
  tourName: "טיול לברלין",
  departureCode: "BER1103",
  notes: null,
  message: null,
} as unknown as CaseRow;
assert.ok(caseMatches(row, "כהן דנה"), "names in any order");
assert.ok(caseMatches(row, "1042"));
assert.ok(caseMatches(row, "t10005"));
assert.ok(caseMatches(row, "123456782"));
assert.ok(!caseMatches(row, "לונדון"));
assert.ok(caseMatches({ ...row, customerNo: 1004 } as CaseRow, "C-1004"), "the old C- label still finds the customer");
assert.ok(caseMatches({ ...row, customerNo: 1004 } as CaseRow, "1004"), "the bare customer number too");

// ---------------------------------------------------------------- cancellation terms as text (no HTML reaches the page)
assert.equal(
  htmlToText('<p>ביטול עד 30 יום: <strong>100$</strong></p><ul><li>א</li><li>ב&nbsp;&amp;&nbsp;ג</li></ul><script>alert(1)</script><img src=x onerror=alert(1)>סוף'),
  "ביטול עד 30 יום: 100$\nא\nב & ג\nסוף",
);
assert.equal(htmlToText("שורה<br/>שורה"), "שורה\nשורה");
assert.equal(htmlToText(null), "");

// ---------------------------------------------------------------- a visitor's page path links to OUR site only
assert.equal(siteHref("https://megafamily.co.il/", "/package/x/?product_id=1"), "https://megafamily.co.il/package/x/?product_id=1");
assert.equal(siteHref("https://megafamily.co.il", "@evil.example/x"), null, "a userinfo trick never leaves the site");
assert.equal(siteHref("https://megafamily.co.il", "//evil.example/x"), null);
assert.equal(siteHref("https://megafamily.co.il", "https://evil.example/"), null);
assert.equal(siteHref("https://megafamily.co.il", "/\\evil.example"), null);
assert.equal(siteHref(null, "/x"), null);
assert.equal(siteHref("https://megafamily.co.il", null), null);

// ---------------------------------------------------------------- a case whose money is taken or on the way is never deleted
assert.equal(bookingBlocksDelete("paid"), true);
assert.equal(bookingBlocksDelete("review"), true, "a charge to check");
assert.equal(bookingBlocksDelete("pending_payment"), true, "the customer may be paying right now");
assert.equal(bookingBlocksDelete("new"), false, "a request with no payment");
assert.equal(bookingBlocksDelete("failed"), false);
assert.equal(bookingBlocksDelete("cancelled"), false);
// ---------------------------------------------------------------- "send the confirmation" looks at every booking of the case
assert.equal(confirmationPendingOf([{ status: "new", confirmationSentAt: null }, { status: "paid", confirmationSentAt: null }]), true, "an older paid booking still waits");
assert.equal(confirmationPendingOf([{ status: "paid", confirmationSentAt: "2026-10-14T10:00:00Z" }]), false);
assert.equal(confirmationPendingOf([]), false);

// ---------------------------------------------------------------- seats a settled booking still owes the departure
// a booking's travelers: seniors are adults with a discount, never extra people
const withSenior = { ref: "T1", status: "done", departureId: "dep-a", adults: 3, children: 2, seniors: 1, kind: "request", createdAt: "2026-10-14T10:00:00Z", salesEntryId: null };
assert.deepEqual(seatBookingOf(withSenior), {
  ref: "T1",
  status: "done",
  departureId: "dep-a",
  travelers: 5,
  kind: "request",
  createdAt: "2026-10-14T10:00:00Z",
  salesEntryId: null,
});
const bk = (over: Partial<SeatBooking> = {}): SeatBooking => ({
  ref: "T10026",
  status: "done",
  departureId: "dep-a",
  travelers: 4,
  kind: "request",
  createdAt: "2026-10-14T10:00:00Z",
  salesEntryId: null,
  ...over,
});
const missingOf = (gap: SeatGap | null) => gap?.missing ?? 0;
const head = (gap: SeatGap | null) => gap && { ref: gap.ref, departureId: gap.departureId, travelers: gap.travelers, missing: gap.missing };
// prod case #1004: a request closed by phone - booking Done, case paid, nothing on the departure
assert.deepEqual(head(seatGap("paid", S, [bk()], [])), { ref: "T10026", departureId: "dep-a", travelers: 4, missing: 4 });
assert.deepEqual(seatGap("paid", S, [bk()], [])?.owed, [{ ref: "T10026", departureId: "dep-a", travelers: 4, missing: 4, link: true }], "the whole booking: its seat row is tied to it");
assert.equal(seatGap("paid", S, [bk()], [{ departureId: "dep-a", pax: 4 }]), null, "every traveler holds a seat");
assert.equal(missingOf(seatGap("in_progress", S, [bk()], [{ departureId: "dep-a", pax: 1 }])), 3, "a Done booking alone is enough");
assert.equal(missingOf(seatGap("new", S, [bk({ status: "paid" })], [])), 4, "a paid booking whose seats are gone");
assert.equal(seatGap("in_progress", S, [bk({ status: "new" })], []), null, "nothing settled - nothing owed yet");
assert.equal(missingOf(seatGap("done", S, [bk({ status: "in_progress" })], [])), 4, "a closed deal owes its booking's travelers");
assert.equal(missingOf(seatGap("paid", S, [bk({ ref: "T2", status: "new", travelers: 2 }), bk({ ref: "T1", status: "failed" })], [])), 2, "...the newest booking's");
assert.equal(seatGap("paid", S, [bk({ status: "cancelled" })], []), null, "a cancelled booking owes nothing");
assert.equal(seatGap("cancelled", S, [bk()], []), null, "a cancelled case owes nothing");
assert.equal(seatGap("not_relevant", S, [bk()], []), null);
const closedCustom: CaseStatus[] = [...S, { key: "custom_1", label: "חזר בו", color: "gray", isClosed: true, isSystem: false, isActive: true }];
assert.equal(seatGap("custom_1", closedCustom, [bk()], []), null, "any closed status but Done");
assert.equal(seatGap("paid", S, [], []), null, "no booking - nothing to compare with");
assert.equal(seatGap("paid", S, [bk({ travelers: 0 })], []), null);
assert.equal(
  seatGap(
    "paid",
    S,
    [bk({ ref: "T2", status: "paid", kind: "card", createdAt: "2026-10-15T10:00:00Z", salesEntryId: "s1" }), bk({ ref: "T1" })],
    [{ id: "s1", departureId: "dep-a", pax: 4 }],
  ),
  null,
  "a card payment covers the request for the same date sent before it - one party, not two",
);
// Alon 18.10: each closed booking holds its own seats - five bookings, five parties
const five = ["T1", "T2", "T3"].map((ref, i) => bk({ ref, travelers: 2 + i, createdAt: `2026-10-1${i}T10:00:00Z` }));
assert.equal(missingOf(seatGap("in_progress", S, five, [])), 9, "2 + 3 + 4 - not the biggest one alone");
assert.equal(missingOf(seatGap("in_progress", S, five, [{ id: "x", departureId: "dep-a", pax: 2 }])), 7, "a seat row of no booking covers the oldest first");
const linkedOne = five.map((b) => (b.ref === "T2" ? { ...b, salesEntryId: "s2" } : b));
assert.equal(missingOf(seatGap("in_progress", S, linkedOne, [{ id: "s2", departureId: "dep-a", pax: 3 }])), 6, "a booking with its own seat row is covered");
assert.equal(missingOf(seatGap("in_progress", S, linkedOne, [])), 9, "...only while that row is live");
assert.deepEqual(
  seatGap("in_progress", S, five, [{ id: "x", departureId: "dep-a", pax: 3 }])?.owed.map((o) => [o.ref, o.missing, o.link]),
  [["T1", 0, false], ["T2", 2, false], ["T3", 4, true]].filter(([, m]) => m !== 0),
  "a partly covered booking gets an untied row; only a wholly owed one is tied",
);
const twoCards = [bk({ ref: "T2", status: "paid", kind: "card", salesEntryId: "s1" }), bk({ ref: "T1", status: "paid", kind: "card", salesEntryId: "s0", createdAt: "2026-10-13T10:00:00Z" })];
assert.equal(seatGap("paid", S, twoCards, [{ id: "s1", departureId: "dep-a", pax: 4 }, { id: "s0", departureId: "dep-a", pax: 4 }]), null, "two paid cards, two seat rows");
assert.equal(missingOf(seatGap("paid", S, [bk()], [{ departureId: "dep-a", pax: 4 }, { departureId: "dep-a", pax: -4 }])), 4, "a cancellation gave them back");
assert.equal(seatGap("paid", S, [bk()], [{ departureId: "dep-b", pax: 4 }]), null, "seats moved to another departure still count");
const twoTrips = seatGap("paid", S, [bk({ ref: "T2", departureId: "dep-b", travelers: 2, createdAt: "2026-10-15T10:00:00Z" }), bk()], [{ departureId: "dep-a", pax: 4 }]);
assert.deepEqual(head(twoTrips), { ref: "T2", departureId: "dep-b", travelers: 2, missing: 2 }, "two trips: the one short is named");

// prod case #1016 (18.10): "not relevant" over Done bookings - the notice stays quiet, the order chips do not lie
const case1016 = [
  bk({ ref: "T10033", travelers: 5, createdAt: "2026-10-18T10:20:00Z", salesEntryId: "s5" }),
  bk({ ref: "T10034", travelers: 1, createdAt: "2026-10-18T10:30:00Z" }),
  bk({ ref: "T10035", travelers: 1, createdAt: "2026-10-18T10:34:00Z" }),
];
const held1016 = [{ id: "s5", departureId: "dep-a", pax: 5 }];
assert.equal(seatGap("not_relevant", S, case1016, held1016), null, "a closed case raises no notice");
assert.deepEqual([...owedSeatRefs(S, case1016, held1016)], ["T10034", "T10035"], "...but its two unseated orders are named");
assert.deepEqual([...owedSeatRefs(S, case1016.slice(0, 1), held1016)], [], "an order with its own seat row owes nothing");
assert.deepEqual([...owedSeatRefs(S, [bk({ status: "new" })], [])], [], "an open order owes nothing yet, whatever the case says");

// C1 (Alon 18.10): a case with a live booking is not "not relevant" - cancel the booking first
assert.equal(closeBlockedBy("not_relevant", S, [{ ref: "T9", status: "new" }]), "T9");
assert.equal(closeBlockedBy("not_relevant", S, [{ ref: "T9", status: "done" }]), "T9", "a closed deal is not irrelevant either");
assert.equal(closeBlockedBy("not_relevant", S, [{ ref: "T9", status: "cancelled" }, { ref: "T8", status: "failed" }]), null);
assert.equal(closeBlockedBy("custom_1", closedCustom, [{ ref: "T9", status: "paid" }]), "T9", "a closed status of the company own");
assert.equal(closeBlockedBy("cancelled", S, [{ ref: "T9", status: "paid" }]), null, "cancelling the case is how it ends");
assert.equal(closeBlockedBy("spam", S, [{ ref: "T9", status: "new" }]), null);
assert.equal(closeBlockedBy("done", S, [{ ref: "T9", status: "new" }]), null);

// A2 (Alon 18.10): the offer a case was sent
const offer = { departureId: "d1", departureCode: "FDUA1204", startDate: "2026-12-04", tourName: "תמרים", rooms: ["double_room"], roomTitles: ["זוגי"], total: 6600, currency: "USD", url: "https://x/y", followUpDate: "2026-10-20", createdAt: "2026-10-18T10:00:00Z", sentAt: null, sentVia: null };
assert.deepEqual(parseOffer(offer), { ...offer, bookingRef: null });
assert.equal(parseOffer({ ...offer, rooms: "x" }), null, "a broken offer is no offer");
assert.equal(parseOffer(null), null);
assert.equal(parseOffer({ ...offer, sentVia: "fax" })?.sentVia, null, "an unknown channel reads as not sent");
assert.equal(offerSent(parseOffer(offer)), false);
assert.equal(offerSent(parseOffer({ ...offer, sentAt: "2026-10-18T10:05:00Z", sentVia: "whatsapp" })), true);
assert.equal(isOfferChannel("email"), true);
assert.equal(isOfferChannel("copy"), false, "a copied link is not a sent offer");

// ---- Alon's rejects 15.10
// 5. closing as not relevant asks why; Done and Spam do not
assert.equal(needsCloseReason("not_relevant", S), true);
assert.equal(needsCloseReason("cancelled", S), true, "cancelled by hand says why too");
assert.equal(needsCloseReason("custom_1", closedCustom), true, "a closed status of the company's own");
assert.equal(needsCloseReason("done", S), false, "a closed deal needs no excuse");
assert.equal(needsCloseReason("spam", S), false);
assert.equal(needsCloseReason("in_progress", S), false);
assert.deepEqual(checkCloseReason("  לא   עונה  "), { ok: true, reason: "לא עונה" });
assert.equal(checkCloseReason("").ok, false, "empty is no reason");
assert.equal(checkCloseReason("ab").ok, false, "two letters are not a reason");
assert.equal(checkCloseReason("x".repeat(501)).ok, false, "too long");

// 4. a link sent = "Offer sent" - but never over a payment or a closed case
assert.equal(DEFAULT_STATUSES.some((s) => s.key === "offer_sent" && s.isSystem && !s.isClosed), true, "a system status");
assert.equal(statusAfterLink("new", S), "offer_sent");
assert.equal(statusAfterLink("follow_up", S), "offer_sent");
assert.equal(statusAfterLink("offer_sent", S), "offer_sent");
assert.equal(statusAfterLink("pending_payment", S), "pending_payment", "a payment on its way stays");
assert.equal(statusAfterLink("paid", S), "paid");
assert.equal(statusAfterLink("payment_review", S), "payment_review");
assert.equal(statusAfterLink("not_relevant", S), "offer_sent", "a link reopens a closed lead - the rep is selling again");
assert.equal(statusAfterLink("done", S), "done", "a closed deal stays closed");
const noOffer = S.filter((s) => s.key !== "offer_sent");
assert.equal(statusAfterLink("new", noOffer), "new", "a list without the status (migration not applied) keeps the case");
const offOffer = S.map((s) => (s.key === "offer_sent" ? { ...s, isActive: false } : s));
assert.equal(statusAfterLink("new", offOffer), "offer_sent", "a system status is never off - a stale row still counts");

// 9. a customer's orders, each with where it stands
assert.equal(bookingPhase({ status: "cancelled", departureStart: "2099-01-01" }, "2026-10-15"), "cancelled");
assert.equal(bookingPhase({ status: "failed", departureStart: "2099-01-01" }, "2026-10-15"), "cancelled", "a failed card payment is not a live order");
assert.equal(bookingPhase({ status: "paid", departureStart: "2026-10-01" }, "2026-10-15"), "past");
assert.equal(bookingPhase({ status: "paid", departureStart: "2026-10-15" }, "2026-10-15"), "active", "leaving today is still active");
assert.equal(bookingPhase({ status: "new", departureStart: null }, "2026-10-15"), "active");

// 2. every traveler's name on the case
const pax = (first: string, last: string, type: "adult" | "child" = "adult") => ({ first, last, type });
const groups = travelerGroups([
  { ref: "T3", status: "cancelled", passengers: [pax("Old", "Trip")] },
  { ref: "T2", status: "paid", passengers: [pax("tammy", "Aharon"), pax("", ""), pax("Kid", "Aharon", "child")] },
  { ref: "T1", status: "new", passengers: [] },
]);
assert.deepEqual(
  groups.map((g) => [g.ref, g.names]),
  [["T2", ["tammy Aharon", "Kid Aharon"]]],
  "live bookings only, blank rows dropped, a booking with no names left out",
);
assert.equal(groups[0].passengers[1].type, "child");

// 1. WhatsApp opens the app itself - no browser tab
assert.equal(whatsappAppLink("052-896-8912", "היי"), `whatsapp://send?phone=972528968912&text=${encodeURIComponent("היי")}`);
assert.equal(whatsappAppLink("12", "x"), null);

// the waiting list's date reads as its label, not as JSON
assert.equal(payloadText({ productId: 31, code: "CBEA1014", label: "14.10 - 20.10" }), "14.10 - 20.10");
assert.equal(payloadText({ a: 1 }), '{"a":1}');
assert.equal(payloadText("text"), "text");

// ---------------------------------------------------------------- one customer, deal cards (Nir 19.10)
const card = (over: Partial<RouteCard> = {}): RouteCard => ({
  id: "k1",
  packageId: "tour-a",
  status: "no_answer",
  toFile: false,
  departureStart: "2026-12-04",
  createdAt: "2026-10-10T10:00:00Z",
  ...over,
});
assert.equal(isOpenCard(card(), S, TODAY), true);
assert.equal(isOpenCard(card({ status: "not_relevant" }), S, TODAY), false, "closed");
assert.equal(isOpenCard(card({ toFile: true }), S, TODAY), false, "an inquiry waiting to be filed is not a card yet");
assert.equal(isOpenCard(card({ status: "paid", departureStart: "2026-09-01" }), S, TODAY), false, "a paid trip that left is history");
assert.equal(isOpenCard(card({ status: "paid", departureStart: "2026-12-01" }), S, TODAY), true, "a paid trip ahead is open");
assert.equal(isOpenCard(card({ status: "paid", departureStart: null }), S, TODAY), true);
// the SQL twin (public.leads_fill): same tour -> join, no tour + open cards -> file, else new
assert.deepEqual(routeInquiry({ kind: "lead", packageId: "tour-a" }, [card()], S, TODAY), { kind: "join", cardId: "k1" });
assert.deepEqual(
  routeInquiry({ kind: "waitlist", packageId: "tour-a" }, [card(), card({ id: "k2", createdAt: "2026-10-12T10:00:00Z" })], S, TODAY),
  { kind: "join", cardId: "k2" },
  "the newest open card of the tour",
);
assert.deepEqual(routeInquiry({ kind: "lead", packageId: "tour-b" }, [card()], S, TODAY), { kind: "new" }, "another tour = another card");
assert.deepEqual(routeInquiry({ kind: "contact", packageId: null }, [card()], S, TODAY), { kind: "file" });
assert.deepEqual(routeInquiry({ kind: "contact", packageId: null }, [card({ status: "not_relevant" })], S, TODAY), { kind: "new" }, "only closed cards: a fresh start");
assert.deepEqual(routeInquiry({ kind: "lead", packageId: "tour-a" }, [card({ status: "paid", departureStart: "2026-01-01" })], S, TODAY), { kind: "new" }, "last year's trip, same tour: a new deal");
assert.deepEqual(routeInquiry({ kind: "newsletter", packageId: null }, [card()], S, TODAY), { kind: "new" }, "a newsletter is no inquiry");
assert.deepEqual(routeInquiry({ kind: "booking", packageId: "tour-a" }, [card()], S, TODAY), { kind: "new" }, "a booking routes itself");
assert.equal(statusOnReturn("no_answer", S), "returned");
assert.equal(statusOnReturn("offer_sent", S), "returned");
assert.equal(statusOnReturn("future", S), "returned");
assert.equal(statusOnReturn("paid", S), "paid", "a paid card keeps its status - the follow-up day calls the rep");
assert.equal(statusOnReturn("no_answer", S.filter((s) => s.key !== "returned")), "no_answer", "before the migration");

// the card's step: lead -> offer -> order -> paid
assert.equal(cardStage("new", false, S), 0);
assert.equal(cardStage("offer_sent", false, S), 1);
assert.equal(cardStage("new", true, S), 2, "a site request is an order");
assert.equal(cardStage("pending_payment", false, S), 2);
assert.equal(cardStage("deposit_paid", true, S), 2.5);
assert.equal(cardStage("paid", true, S), 3);
assert.equal(cardStage("not_relevant", true, S), null);

// a deposit counts as paid
assert.equal(statusAfterLink("deposit_paid", S), "deposit_paid", "a link never writes over money taken");
assert.equal(missingOf(seatGap("deposit_paid", S, [bk({ status: "new" })], [])), 4, "a deposit holds the seats like paid");

// what a new card knows about the customer's earlier deals
const earlier = [
  { id: "k0", caseNo: 1010, status: "not_relevant", closeReason: "מחיר", tourName: "וייטנאם", createdAt: "2026-10-05T09:00:00Z" },
  { id: "k1", caseNo: 1011, status: "no_answer", closeReason: null, tourName: "תמרים", createdAt: "2026-10-08T09:00:00Z" },
  { id: "k2", caseNo: 1012, status: "new", closeReason: null, tourName: "לפלנד", createdAt: "2026-10-19T07:55:00Z" },
];
assert.equal(knownFrom({ id: "k2", createdAt: "2026-10-19T07:55:00Z" }, earlier, S)?.caseNo, 1010, "the closed one, not the open one");
assert.equal(knownFrom({ id: "k0", createdAt: "2026-10-05T09:00:00Z" }, earlier, S), null, "a first contact knows nothing");
assert.equal(knownFrom({ id: "k9", createdAt: "2026-11-01T00:00:00Z" }, [...earlier, { ...earlier[1], id: "k3", status: "paid", caseNo: 1013, createdAt: "2026-10-20T00:00:00Z" }], S)?.caseNo, 1013, "the newest: a paid trip");

// the customer: C-number, phones
assert.equal(customerLabel(1041), "1041", "no C- prefix any more (Alon 21.10)");
assert.equal(customerLabel(null), "");
assert.deepEqual(cleanPhones([" 052-441-8820 ", "+972524418820", "", "03-555 0192"]), { ok: true, phones: ["052-441-8820", "03-555 0192"] }, "the same phone twice is one");
assert.equal(cleanPhones(["12"]).ok, false, "not a phone");
assert.equal(cleanPhones(["0501111111", "0502222222", "0503333333", "0504444444", "0505555555", "0506666666"]).ok, false, "at most five");

// the same e-mail suggests, never joins
const me = { id: "c1", email: "Dana@Example.com", phones: ["053-318-4471"], notSame: [] as string[] };
const twin = { id: "c2", email: "dana@example.com ", phones: ["050-612-3380"], notSame: [] as string[] };
assert.equal(sameEmailSuggestion(me, [twin]), "c2");
assert.equal(sameEmailSuggestion(me, [{ ...twin, phones: ["0533184471"] }]), null, "a shared phone would have joined them already");
assert.equal(sameEmailSuggestion({ ...me, notSame: ["c2"] }, [twin]), null, "staff said they are other people");
assert.equal(sameEmailSuggestion(me, [{ ...twin, notSame: ["c1"] }]), null, "...on either side");
assert.equal(sameEmailSuggestion({ ...me, email: null }, [twin]), null);

// a future lead: a tour and a season
assert.deepEqual(
  seasonOptions(
    [
      { season: "פסח", seasonYear: 2027, startDate: "2027-04-04" },
      { season: "חנוכה", seasonYear: 2026, startDate: "2026-12-20" },
      { season: "קיץ", seasonYear: 2026, startDate: "2026-07-01" },
      { season: null, seasonYear: 2027, startDate: "2027-05-01" },
    ],
    ["פסח", "סוכות"],
    TODAY,
  ),
  ["חנוכה 2026", "פסח 2027", "פסח 2026", "סוכות 2026", "סוכות 2027"],
  "coming departures first (a past one left out), then the tour's own seasons for this year and the next",
);
assert.equal(checkFuture("tour-a", "פסח 2027"), null);
assert.ok(checkFuture(null, "פסח 2027"));
assert.ok(checkFuture("tour-a", "  "));

// forms that joined the card, newest first
assert.deepEqual(
  inquiriesOf({ inquiries: [{ case_no: 1006, at: "2026-10-19T09:12:00Z", kind: "waitlist", message: "again", source_path: "/package/x/" }, { at: "2026-10-20T09:00:00Z", kind: "lead", message: " " }, "junk"] }),
  [
    { caseNo: null, at: "2026-10-20T09:00:00Z", kind: "lead", message: null, sourcePath: null, sentAs: null, otherSender: false },
    { caseNo: 1006, at: "2026-10-19T09:12:00Z", kind: "waitlist", message: "again", sourcePath: "/package/x/", sentAs: null, otherSender: false },
  ],
);
assert.deepEqual(inquiriesOf({}), []);

// a form joins by the phone alone - who it was SENT AS is kept and checked against the card's person
const sendCard = { name: "דנה כהן", email: "dana@example.com" };
assert.equal(senderDiffers(null, sendCard), false);
assert.equal(senderDiffers({ name: "דנה", phone: "0500000000", email: null }, sendCard), false, "first name alone = the same person");
assert.equal(senderDiffers({ name: "דָּנָה כהן-לוי", phone: null, email: null }, sendCard), false, "niqqud and a double surname still share a word");
assert.equal(senderDiffers({ name: "יוסי לוי", phone: null, email: null }, sendCard), true, "another name");
assert.equal(senderDiffers({ name: null, phone: "0500000000", email: "DANA@example.com " }, sendCard), false, "same e-mail, any case");
assert.equal(senderDiffers({ name: "דנה", phone: null, email: "other@example.com" }, sendCard), true, "same name, another e-mail");
assert.equal(senderDiffers({ name: "Yossi", phone: null, email: null }, { name: "", email: null }), false, "a card with no name: nothing to compare");
assert.equal(senderDiffers({ name: "-", phone: null, email: null }, sendCard), false, "no real word typed");
const joined = inquiriesOf(
  { inquiries: [{ at: "2026-10-21T08:00:00Z", kind: "lead", name: " יוסי לוי ", phone: "050-000 0000", email: "" }] },
  sendCard,
);
assert.deepEqual(joined[0].sentAs, { name: "יוסי לוי", phone: "050-000 0000", email: null });
assert.equal(joined[0].otherSender, true);
assert.equal(inquiriesOf({ inquiries: [{ at: "x", name: "יוסי" }] })[0].otherSender, false, "no card given: never flagged");

// ---------------------------------------------------------------- board (Alon 21.10): who sees what, the rep's own order, the note line
const manager = boardViewerOf("u1", "editor", "admin");
const rep = boardViewerOf("u2", "editor", "editor");
assert.equal(manager.manager, true, "a company admin membership is a manager");
assert.equal(boardViewerOf("u3", "admin", null).manager, true, "a global admin is a manager everywhere");
assert.equal(rep.manager, false);
assert.equal(boardViewerOf("u4", "superadmin", "editor").manager, true);
assert.equal(boardViewerOf("u5", "editor", null).manager, false, "no membership row read = a rep");
const seen = [
  { id: "a", assignedTo: "u2" },
  { id: "b", assignedTo: null },
  { id: "c", assignedTo: "u9" },
];
assert.deepEqual(
  visibleCards(seen, rep).map((c) => c.id),
  ["a", "b"],
  "a rep: own + unassigned",
);
assert.deepEqual(
  visibleCards(seen, manager).map((c) => c.id),
  ["a", "b", "c"],
);
assert.equal(canSeeCard({ assignedTo: "u9" }, rep), false);
assert.equal(canSeeCard({ assignedTo: null }, rep), true);

assert.equal(arrivalOf("2026-10-01T10:00:00Z", []), "2026-10-01T10:00:00Z");
assert.equal(
  arrivalOf("2026-10-01T10:00:00Z", ["2026-10-19T09:00:00Z", "2026-10-20T08:00:00Z"]),
  "2026-10-20T08:00:00Z",
  "the newest inquiry is the arrival",
);
assert.equal(arrivalOf("2026-10-21T10:00:00Z", ["2026-10-01T09:00:00Z"]), "2026-10-21T10:00:00Z", "never earlier than the card itself");

const ordered = [
  { id: "n", arrivedAt: "2026-10-21T08:00:00Z" },
  { id: "o", arrivedAt: "2026-10-01T08:00:00Z" },
  { id: "m", arrivedAt: "2026-10-10T08:00:00Z" },
];
assert.deepEqual(
  orderBoard(ordered, []).map((r) => [r.row.id, r.position]),
  [
    ["o", 1],
    ["m", 2],
    ["n", 3],
  ],
  "default = arrival, oldest first",
);
assert.deepEqual(orderBoard(ordered, ["n", "gone", "n"]).map((r) => r.row.id), ["n", "o", "m"], "saved first; ids not on the list and repeats are ignored");
assert.deepEqual(orderBoard(ordered, ["m", "n", "o"]).map((r) => r.position), [1, 2, 3], "no gaps");
assert.deepEqual(orderBoard([], ["m"]), []);
assert.deepEqual(moveInOrder(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
assert.deepEqual(moveInOrder(["a", "b", "c", "d"], "b", "d"), ["a", "c", "d", "b"]);
assert.deepEqual(moveInOrder(["a", "b"], "x", "a"), ["a", "b"], "an unknown id moves nothing");
assert.deepEqual(placeInOrder(["a", "b", "c", "d"], "d", 1), ["d", "a", "b", "c"]);
assert.deepEqual(placeInOrder(["a", "b", "c", "d"], "a", 99), ["b", "c", "d", "a"], "clamped to the end");
assert.deepEqual(placeInOrder(["a", "b", "c", "d"], "c", 0), ["c", "a", "b", "d"], "clamped to the start");
assert.deepEqual(placeInOrder(["a", "b"], "a", 1.5), ["a", "b"], "not a whole number: unchanged");
const uuid = "123e4567-e89b-12d3-a456-426614174000";
assert.deepEqual(cleanOrderIds([uuid, uuid.toUpperCase(), "junk", 7, null]), [uuid], "uuids only, case-folded, deduped");
assert.equal(cleanOrderIds(Array.from({ length: 600 }, (_, i) => `123e4567-e89b-12d3-a456-${String(i).padStart(12, "0")}`)).length, BOARD_ORDER_MAX);

assert.equal(noteLine("  \r\n\r\n  call back at 15:00 \r\nsecond line"), "call back at 15:00");
assert.equal(noteLine(" \n \r\n"), "");
assert.equal(noteLine(null), "");
assert.equal(noteLine("x".repeat(100)), `${"x".repeat(NOTE_LINE_MAX - 1)}…`);
assert.equal(writtenToday("2026-10-20T22:30:00Z", "2026-10-21"), true, "22:30Z is already the 21st in Israel");
assert.equal(writtenToday("2026-10-20T12:00:00Z", "2026-10-21"), false);
assert.equal(writtenToday(null, "2026-10-21"), false);
assert.equal(writtenToday("not a date", "2026-10-21"), false);

// the row an action answered: kept, or - handed to another rep - dropped with the new owner named (review fix, 21.10)
const seenA = [{ id: "a", assignedTo: "u2" }, { id: "b", assignedTo: null }];
assert.deepEqual(afterSave(seenA, { id: "a", assignedTo: null }, rep), { cards: [{ id: "a", assignedTo: null }, { id: "b", assignedTo: null }], handedTo: null }, "unassigning keeps the row for a rep");
assert.deepEqual(afterSave(seenA, { id: "a", assignedTo: "u9" }, rep), { cards: [{ id: "b", assignedTo: null }], handedTo: "u9" }, "handed to another rep: the row leaves, the new owner is named");
assert.equal(afterSave(seenA, { id: "a", assignedTo: "u9" }, manager).handedTo, null, "a manager keeps every row");
assert.equal(afterSave(seenA, { id: "a", assignedTo: "u9" }, manager).cards[0].assignedTo, "u9");

// ---- WhatsApp (2026-10-21): a message joins the newest open card whatever its tour, and is never filed
{
  const openA = { id: "a", packageId: "p1", status: "new", toFile: false, departureStart: null, createdAt: "2026-10-01", updatedAt: "2026-10-05" };
  const openB = { id: "b", packageId: "p2", status: "offer_sent", toFile: false, departureStart: null, createdAt: "2026-10-03", updatedAt: "2026-10-02" };
  assert.deepEqual(routeInquiry({ kind: "whatsapp", packageId: null }, [openA, openB], DEFAULT_STATUSES, "2026-10-21"), { kind: "join", cardId: "a" }, "newest by updatedAt, not createdAt");
  assert.deepEqual(routeInquiry({ kind: "whatsapp", packageId: null }, [{ ...openA, status: "not_relevant" }], DEFAULT_STATUSES, "2026-10-21"), { kind: "new" });
  assert.deepEqual(routeInquiry({ kind: "whatsapp", packageId: null }, [], DEFAULT_STATUSES, "2026-10-21"), { kind: "new" });
  assert.deepEqual(routeInquiry({ kind: "contact", packageId: null }, [openA], DEFAULT_STATUSES, "2026-10-21"), { kind: "file" }, "a tourless site form is still filed");
  // TODAY: unseen WhatsApp beats a site payment, loses to "came back"
  const base = { status: "new", followUpDate: null, toFile: false, paymentAnswer: null, confirmationPending: false, waUnseen: 0 };
  assert.equal(todayReason({ ...base, waUnseen: 2 }, DEFAULT_STATUSES, "2026-10-21"), "whatsapp");
  assert.equal(todayReason({ ...base, status: "returned", waUnseen: 2 }, DEFAULT_STATUSES, "2026-10-21"), "returned");
  assert.equal(todayReason({ ...base, status: "pending_payment", paymentAnswer: "paid", waUnseen: 1 }, DEFAULT_STATUSES, "2026-10-21"), "whatsapp");
  assert.equal(todayReason({ ...base, status: "not_relevant", waUnseen: 5 }, DEFAULT_STATUSES, "2026-10-21"), null, "a closed card never waits");
  assert.equal(todayReason(base, DEFAULT_STATUSES, "2026-10-21"), "new");
  assert.ok(todayRank("whatsapp") < todayRank("payment"));
}

// ---- WhatsApp on the card (phase 1): the thread as the card reads it
{
  const msg = (id: string, direction: "in" | "out", sentAt: string, origin = direction === "in" ? "customer" : "api"): WaThreadMessage => ({
    id, waMessageId: `wamid.${id}`, direction, origin, type: "text", text: id, mediaUrl: null, mediaMime: null, template: null, status: direction === "in" ? "received" : "sent", error: null, sentAt, sentBy: null, caseId: null,
  });
  const newestFirst = [msg("c", "out", "2026-10-21T09:30:00Z"), msg("b", "in", "2026-10-21T09:00:00Z"), msg("a", "in", "2026-10-20T08:00:00Z")];
  const thread = assembleThread({ newestFirst, hasMore: true, consent: { state: "form", source: "site_form:x", at: "2026-10-01T00:00:00Z" }, lastInAt: null, connected: true, now: "2026-10-21T10:00:00Z" });
  assert.deepEqual(thread.messages.map((m) => m.id), ["a", "b", "c"], "oldest first on the card");
  assert.equal(thread.hasMore, true);
  assert.equal(thread.lastInAt, "2026-10-21T09:00:00Z", "no stamp on the customer: the newest inbound message");
  assert.equal(thread.windowOpen, true);
  assert.equal(thread.connected, true);
  assert.deepEqual(thread.consent, { state: "form", source: "site_form:x", at: "2026-10-01T00:00:00Z" });
  const stamped = assembleThread({ newestFirst, hasMore: false, consent: null, lastInAt: "2026-10-19T09:00:00Z", connected: false, now: "2026-10-21T10:00:00Z" });
  assert.equal(stamped.lastInAt, "2026-10-19T09:00:00Z", "the customer stamp wins over the page");
  assert.equal(stamped.windowOpen, false);
  assert.deepEqual(stamped.consent, { state: "none", source: null, at: null }, "no customer row = no consent");
  assert.equal(assembleThread({ newestFirst: [], hasMore: false, consent: null, lastInAt: null, connected: true, now: "2026-10-21T10:00:00Z" }).lastInAt, null);
  assert.equal(assembleThread({ newestFirst: [msg("h", "in", "2026-10-21T09:00:00Z", "history")], hasMore: false, consent: null, lastInAt: null, connected: true, now: "2026-10-21T10:00:00Z" }).lastInAt, null, "a history row opens no window");
  assert.deepEqual(threadKeys(["527654321", ""], ["+972 52-765-4321", "054-1234567", ""]), ["527654321", "541234567"], "the customer keys plus the card phones, deduped");
  assert.deepEqual(threadKeys(null, ["0541234567"]), ["541234567"]);
  assert.equal(deliveryMark("accepted", null), "✓");
  assert.equal(deliveryMark("sent", null), "✓");
  assert.equal(deliveryMark("delivered", null), "✓✓");
  assert.equal(deliveryMark("read", null), "✓✓ נקרא");
  assert.equal(deliveryMark("failed", "131026: no WhatsApp"), "✗ 131026: no WhatsApp");
  assert.equal(deliveryMark("failed", null), "✗ לא נשלח");
  assert.equal(deliveryMark("received", null), "", "an inbound message carries no ticks");
  assert.equal(originLabel("app"), "מהאפליקציה");
  assert.equal(originLabel("automation"), "אוטומציה");
  assert.equal(originLabel("broadcast"), "דיוור");
  assert.equal(originLabel("history"), "היסטוריה");
  assert.equal(originLabel("customer"), "");
  assert.equal(originLabel("api"), "");
}
console.log("tours-cases selftest: ok");

// scripts/tours-cases-selftest.ts - `npx tsx scripts/tours-cases-selftest.ts`
// Pure only: the rules of a tours case (lib/tours/cases.ts). No DB, no network.
//
// What it guards: one row per customer - TYPE from the form, TASK from the case, the phone key a
// site booking finds its lead by, the status list staff edit (system statuses and statuses in use
// never disappear, a rename keeps the key), and the booking link with its composition.
import assert from "node:assert/strict";
import {
  DEFAULT_STATUSES,
  bookingBlocksDelete,
  bookingLink,
  caseMatches,
  caseTask,
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
  relatedCaseOf,
  mergedIntoOf,
  payloadText,
  type CaseRow,
  type CaseStatus,
  type SeatBooking,
  type SeatGap,
  type TaskFacts,
} from "../lib/tours/cases";

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

// ---------------------------------------------------------------- TASK
const facts = (over: Partial<TaskFacts> = {}): TaskFacts => ({
  type: "lead",
  kind: "lead",
  status: "new",
  followUpDate: null,
  taskOverride: null,
  confirmationPending: false,
  ...over,
});
assert.equal(caseTask(facts(), S, TODAY), "new_lead");
assert.equal(caseTask(facts({ type: "reservation", kind: "advisor" }), S, TODAY), "new_order");
assert.equal(caseTask(facts({ kind: "contact" }), S, TODAY), "service_call");
assert.equal(caseTask(facts({ kind: "cancellation" }), S, TODAY), "service_call");
assert.equal(caseTask(facts({ type: "potential", kind: "notify" }), S, TODAY), null, "a potential waits for its tour");
assert.equal(
  caseTask(facts({ status: "payment_review", followUpDate: "2026-10-01" }), S, TODAY),
  "payment_check",
  "a charge to check beats a due follow-up",
);
assert.equal(caseTask(facts({ status: "in_progress", followUpDate: TODAY }), S, TODAY), "follow_up");
assert.equal(caseTask(facts({ status: "in_progress", followUpDate: "2026-10-01" }), S, TODAY), "follow_up");
assert.equal(caseTask(facts({ status: "in_progress", followUpDate: "2026-10-15" }), S, TODAY), null);
assert.equal(caseTask(facts({ status: "pending_payment" }), S, TODAY), "payment_chase");
assert.equal(caseTask(facts({ status: "payment_failed" }), S, TODAY), "payment_chase");
assert.equal(caseTask(facts({ status: "paid", confirmationPending: true }), S, TODAY), "send_confirmation");
assert.equal(caseTask(facts({ status: "paid", confirmationPending: false }), S, TODAY), null);
assert.equal(caseTask(facts({ status: "done", followUpDate: "2026-10-01" }), S, TODAY), null, "closed = no task, even a due follow-up");
assert.equal(caseTask(facts({ status: "done", taskOverride: "follow_up" }), S, TODAY), "follow_up", "an override always wins");
assert.equal(caseTask(facts({ taskOverride: "nonsense" }), S, TODAY), "new_lead", "an unknown override is ignored");
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
assert.ok(reordered.ok && reordered.statuses[0].key === "spam", "the order is the order saved");

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
const withSenior = { ref: "T1", status: "done", departureId: "dep-a", adults: 3, children: 2, seniors: 1 };
assert.deepEqual(seatBookingOf(withSenior), {
  ref: "T1",
  status: "done",
  departureId: "dep-a",
  travelers: 5,
});
const bk = (over: Partial<SeatBooking> = {}): SeatBooking => ({ ref: "T10026", status: "done", departureId: "dep-a", travelers: 4, ...over });
const missingOf = (gap: SeatGap | null) => gap?.missing ?? 0;
// prod case #1004: a request closed by phone - booking Done, case paid, nothing on the departure
assert.deepEqual(seatGap("paid", S, [bk()], []), { ref: "T10026", departureId: "dep-a", travelers: 4, missing: 4 });
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
  seatGap("paid", S, [bk({ ref: "T2", status: "paid" }), bk({ ref: "T1" })], [{ departureId: "dep-a", pax: 4 }]),
  null,
  "a request and a card payment for the same trip are one party, not two",
);
assert.equal(missingOf(seatGap("paid", S, [bk()], [{ departureId: "dep-a", pax: 4 }, { departureId: "dep-a", pax: -4 }])), 4, "a cancellation gave them back");
assert.equal(seatGap("paid", S, [bk()], [{ departureId: "dep-b", pax: 4 }]), null, "seats moved to another departure still count");
const twoTrips = seatGap("paid", S, [bk({ ref: "T2", departureId: "dep-b", travelers: 2 }), bk()], [{ departureId: "dep-a", pax: 4 }]);
assert.deepEqual(twoTrips, { ref: "T2", departureId: "dep-b", travelers: 2, missing: 2 }, "two trips: the one short is named");

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

// 6-7. the earlier case a booking points at, and a merged case
assert.deepEqual(relatedCaseOf({ related_case: { id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427", case_no: 1004 } }), {
  id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
  caseNo: 1004,
});
assert.equal(relatedCaseOf({ related_case: { id: "nope", case_no: 1004 } }), null, "a broken id is no link");
assert.equal(relatedCaseOf({}), null);
assert.equal(mergedIntoOf({ merged_into: { id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427", case_no: "1007" } })?.caseNo, 1007);

// 1. WhatsApp opens the app itself - no browser tab
assert.equal(whatsappAppLink("052-896-8912", "היי"), `whatsapp://send?phone=972528968912&text=${encodeURIComponent("היי")}`);
assert.equal(whatsappAppLink("12", "x"), null);

// the waiting list's date reads as its label, not as JSON
assert.equal(payloadText({ productId: 31, code: "CBEA1014", label: "14.10 - 20.10" }), "14.10 - 20.10");
assert.equal(payloadText({ a: 1 }), '{"a":1}');
assert.equal(payloadText("text"), "text");

console.log("tours-cases selftest: ok");

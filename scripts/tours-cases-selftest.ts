// scripts/tours-cases-selftest.ts - `npx tsx scripts/tours-cases-selftest.ts`
// Pure only: the rules of a tours case (lib/tours/cases.ts). No DB, no network.
//
// What it guards: one row per customer - TYPE from the form, TASK from the case, the phone key a
// site booking finds its lead by, the status list staff edit (system statuses and statuses in use
// never disappear, a rename keeps the key), and the booking link with its composition.
import assert from "node:assert/strict";
import {
  DEFAULT_STATUSES,
  bookingLink,
  caseMatches,
  caseTask,
  cleanRoomKeys,
  followUpDue,
  htmlToText,
  isClosedStatus,
  linkMessage,
  packagePathOf,
  packageSlugOf,
  phoneKey,
  productIdOf,
  sourceLabel,
  splitName,
  typeOfKind,
  validateStatuses,
  waLink,
  whatsappPhone,
  type CaseRow,
  type CaseStatus,
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

// ---------------------------------------------------------------- phone key: the last 9 digits, whatever the writing
assert.equal(phoneKey("054-123 4567"), "541234567");
assert.equal(phoneKey("+972 54 123 4567"), "541234567");
assert.equal(phoneKey("00972541234567"), "541234567");
assert.equal(phoneKey("0541234567"), phoneKey("+972-54-1234567"));
assert.equal(phoneKey("12345"), "", "too short to match anyone");
assert.equal(phoneKey(null), "");

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

console.log("tours-cases selftest: ok");

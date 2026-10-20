// scripts/tours-payments-selftest.ts - `npx tsx scripts/tours-payments-selftest.ts`
// Pure only: an order's payments and balance (lib/tours/payments.ts) and a tour's cancellation fees as of today
// (lib/tours/cancellation.ts) - Alon's drawing of an opened order, 20.10.2026. No DB, no network.
import assert from "node:assert/strict";
import { balanceTone, checkPaymentInput, orderBalance, type PaymentInput } from "@/lib/tours/payments";
import {
  cancellationFeeToday,
  checkCancellationRules,
  daysLeft,
  ruleFee,
  ruleFeeText,
  ruleUntil,
  sortRules,
  type CancellationRule,
} from "@/lib/tours/cancellation";

// ---------------------------------------------------------------- payments
const ok: PaymentInput = { kind: "deposit", status: "paid", amount: 1000, paidOn: "2026-10-20", method: "transfer" };
assert.equal(checkPaymentInput(ok), null);
assert.ok(checkPaymentInput({ ...ok, kind: "tip" }), "unknown kind");
assert.ok(checkPaymentInput({ ...ok, status: "maybe" }), "unknown status");
assert.ok(checkPaymentInput({ ...ok, amount: 0 }), "zero");
assert.ok(checkPaymentInput({ ...ok, amount: -5 }), "negative");
assert.ok(checkPaymentInput({ ...ok, amount: Number.NaN }), "not a number");
assert.ok(checkPaymentInput({ ...ok, paidOn: null }), "paid needs its day");
assert.ok(checkPaymentInput({ ...ok, paidOn: "2026-13-40" }), "a real day");
assert.equal(checkPaymentInput({ kind: "balance", status: "scheduled", amount: 9000, dueDate: "2026-12-01" }), null);
assert.ok(checkPaymentInput({ kind: "balance", status: "scheduled", amount: 9000 }), "scheduled needs its due day");
assert.ok(checkPaymentInput({ ...ok, method: "site" }), "the site's card payment is written by the site alone");
assert.ok(checkPaymentInput({ ...ok, invoiceNo: "x".repeat(201) }), "long invoice number");
assert.ok(checkPaymentInput({ ...ok, amountIls: -1 }), "negative shekels");

// Alon's drawing: $1,000 deposit paid, $9,000 scheduled
const drawn = orderBalance(10_000, "USD", [
  { kind: "deposit", status: "paid", amount: 1000, currency: "USD" },
  { kind: "balance", status: "scheduled", amount: 9000, currency: "USD" },
]);
assert.deepEqual(drawn, { currency: "USD", total: 10_000, paid: 1000, scheduled: 9000, due: 9000, otherCurrency: false });
assert.equal(balanceTone(drawn), "owed");
// a refund counts back, a failed one not at all, another currency is set aside
const mixed = orderBalance(4965, "USD", [
  { kind: "full", status: "paid", amount: 4965, currency: "USD" },
  { kind: "refund", status: "paid", amount: 500, currency: "USD" },
  { kind: "deposit", status: "failed", amount: 300, currency: "USD" },
  { kind: "deposit", status: "paid", amount: 1000, currency: "ILS" },
]);
assert.equal(mixed.paid, 4465);
assert.equal(mixed.due, 500);
assert.equal(mixed.otherCurrency, true);
assert.equal(balanceTone(orderBalance(100, "USD", [{ kind: "full", status: "paid", amount: 100, currency: "USD" }])), "settled");
assert.equal(balanceTone(orderBalance(100, "USD", [{ kind: "full", status: "paid", amount: 150, currency: "USD" }])), "over");
assert.equal(orderBalance(0.1 + 0.2, "USD", [{ kind: "full", status: "paid", amount: 0.3, currency: "USD" }]).due, 0, "cents round");

// ---------------------------------------------------------------- cancellation
const rules: CancellationRule[] = [
  { component: "flight", untilDaysBefore: null, feeKind: "per_pax", feeValue: 200 },
  { component: "hotel", untilDaysBefore: 12, feeKind: "per_order", feeValue: 0 },
  { component: "flight", untilDaysBefore: 17, feeKind: "per_pax", feeValue: 100 },
  { component: "hotel", untilDaysBefore: null, feeKind: "percent", feeValue: 50 },
];
assert.equal(checkCancellationRules(rules), null);
assert.deepEqual(
  sortRules(rules).map((r) => `${r.component}:${r.untilDaysBefore}`),
  ["hotel:12", "hotel:null", "flight:17", "flight:null"],
  "by part, earliest window first, the last window last",
);
assert.ok(checkCancellationRules([...rules, { component: "flight", untilDaysBefore: null, feeKind: "per_order", feeValue: 1 }]), "two last windows");
assert.ok(checkCancellationRules([...rules, { component: "flight", untilDaysBefore: 17, feeKind: "per_order", feeValue: 1 }]), "same day twice");
assert.ok(checkCancellationRules([{ component: "spa" as never, untilDaysBefore: null, feeKind: "per_order", feeValue: 1 }]), "unknown part");
assert.ok(checkCancellationRules([{ component: "land", untilDaysBefore: null, feeKind: "percent", feeValue: 101 }]), "over 100%");
assert.ok(checkCancellationRules([{ component: "land", untilDaysBefore: 1.5, feeKind: "per_order", feeValue: 1 }]), "whole days");
assert.ok(checkCancellationRules([{ component: "land", untilDaysBefore: null, feeKind: "per_order", feeValue: -1 }]), "negative fee");

assert.equal(daysLeft("2026-11-10", "2026-12-07"), 27);
assert.equal(daysLeft("2026-12-08", "2026-12-07"), -1);
assert.equal(ruleUntil({ untilDaysBefore: 17 }, "2026-12-07"), "2026-11-20", "the last day the fee holds");
assert.equal(ruleUntil({ untilDaysBefore: null }, "2026-12-07"), null);
assert.equal(ruleFee({ feeKind: "per_pax", feeValue: 100 }, 3, 0), 300);
assert.equal(ruleFee({ feeKind: "per_order", feeValue: 250 }, 3, 0), 250);
assert.equal(ruleFee({ feeKind: "percent", feeValue: 25 }, 3, 4965), 1241.25);

// Alon's example, 27 days before a 07.12 departure, 2 travelers: hotel $0 until 25.11, flights $100 each until 20.11
const early = cancellationFeeToday({ rules, departureStart: "2026-12-07", today: "2026-11-10", travelers: 2, orderTotal: 4000 });
assert.ok(early);
assert.equal(early.daysLeft, 27);
assert.deepEqual(
  early.lines.map((l) => [l.component, l.fee, l.until, l.next?.feeValue ?? null]),
  [
    ["hotel", 0, "2026-11-25", 50],
    ["flight", 200, "2026-11-20", 200],
  ],
);
assert.equal(early.total, 200);
assert.equal(early.incomplete, false);
// 10 days before: both last windows
const late = cancellationFeeToday({ rules, departureStart: "2026-12-07", today: "2026-11-27", travelers: 2, orderTotal: 4000 });
assert.ok(late);
assert.deepEqual(late.lines.map((l) => [l.component, l.fee, l.until, l.next]), [
  ["hotel", 2000, null, null],
  ["flight", 400, null, null],
]);
assert.equal(late.total, 2400);
// a part whose windows do not reach today (no "until the departure" rule) is left out and said so
const gap = cancellationFeeToday({
  rules: [{ component: "land", untilDaysBefore: 30, feeKind: "per_order", feeValue: 50 }],
  departureStart: "2026-12-07",
  today: "2026-11-27",
  travelers: 2,
  orderTotal: 4000,
});
assert.ok(gap);
assert.equal(gap.lines[0].fee, null);
assert.equal(gap.incomplete, true);
assert.equal(gap.total, 0);
assert.equal(cancellationFeeToday({ rules: [], departureStart: "2026-12-07", today: "2026-11-27", travelers: 2, orderTotal: 1 }), null);

assert.equal(ruleFeeText({ feeKind: "per_pax", feeValue: 100 }, (n) => `$${n}`), "$100 per passenger");
assert.equal(ruleFeeText({ feeKind: "percent", feeValue: 25 }, (n) => `$${n}`), "25% of the order");

console.log("tours-payments selftest: ok");

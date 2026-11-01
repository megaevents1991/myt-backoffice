// Self-test for a superadmin's manual deduction from an influencer's site credit
// (lib/partner-credit-deduction.ts). Pure - no DB.
//   npx tsx scripts/partner-credit-deduction-selftest.ts
import assert from "node:assert/strict";
import {
  canDeductCredit,
  deductionCouponCode,
  deductionProblem,
} from "../lib/partner-credit-deduction";

// ── canDeductCredit ──────────────────────────────────────────────────────────
assert.equal(canDeductCredit({ type: "affiliate", name_hebrew: "שגיא" }), true);
assert.equal(canDeductCredit({ type: "agent", name_hebrew: "דימור" }), false, "an office's credit is split per agent");
assert.equal(canDeductCredit({ type: "customer_refund", name_hebrew: "החזר" }), false);
assert.equal(
  canDeductCredit({ type: "affiliate", name_hebrew: "החזר ללקוח ניתן להתעלם" }),
  false,
  "a refund row typed affiliate by the column's default",
);
assert.equal(canDeductCredit({ type: null, name_hebrew: "שגיא" }), false, "an unknown type gets no money button");
assert.equal(canDeductCredit({}), false);

// ── deductionProblem ─────────────────────────────────────────────────────────
assert.equal(deductionProblem(680, 1160), null);
assert.equal(deductionProblem(1160, 1160), null, "the whole balance");
assert.equal(deductionProblem(62.5, 62.5), null, "cents");
assert.equal(deductionProblem(1, 1), null, "the minimum");
assert.ok(deductionProblem(1160.01, 1160)?.includes("1160"), "above the balance names the balance");
assert.ok(deductionProblem(0, 1160), "zero - an empty box reads as 0");
assert.ok(deductionProblem(0.5, 1160), "under the minimum");
assert.ok(deductionProblem(-680, 1160), "a negative amount would ADD credit");
assert.ok(deductionProblem(Number.NaN, 1160));
assert.ok(deductionProblem(Number.POSITIVE_INFINITY, 1160));
assert.ok(deductionProblem(680, 0), "nothing to take");

// ── deductionCouponCode ──────────────────────────────────────────────────────
assert.equal(deductionCouponCode("sagi", 680, "K7QX"), "SAGI-USED-680-K7QX");
assert.equal(deductionCouponCode("OASISTRUEFANS", 62.5, "K7QX"), "OASIST-USED-63-K7QX", "six letters, whole dollars");
assert.equal(deductionCouponCode("אבירן", 100, "K7QX"), "PARTNER-USED-100-K7QX", "no latin letters to print");
assert.equal(deductionCouponCode("zeor sagie_766", 100, "K7QX"), "ZEORSA-USED-100-K7QX", "spaces and marks are dropped");

console.log("partner-credit-deduction selftest: ok");

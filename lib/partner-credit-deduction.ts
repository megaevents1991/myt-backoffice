import { round2 } from "@/lib/partner-commission";
import { isCustomerRefundPartner } from "@/types/partner.types";

/**
 * A superadmin takes an influencer's site credit down by hand, when it was used
 * outside the site (Dor, 2026-11-01). The balance has no column to edit - it is
 * accrued + returned - redeemed - so a deduction is a redemption row like any
 * conversion, pointing at a coupon nobody can spend (deductPartnerCredit).
 */

export const MIN_DEDUCT_USD = 1;

/**
 * Influencers only: an agent office's credit is split per agent by the ledger's
 * `created_by`, so a staff row there would land in the manager's bucket. Strict
 * on `type` - a refund row or an unknown type never gets a money button.
 */
export function canDeductCredit(partner: {
  type?: string | null;
  name_hebrew?: string | null;
}): boolean {
  return partner.type === "affiliate" && !isCustomerRefundPartner(partner);
}

/** Why this amount cannot come off this balance, or null. Shown as-is. */
export function deductionProblem(
  amountUsd: number,
  balanceUsd: number,
): string | null {
  if (!Number.isFinite(amountUsd) || round2(amountUsd) < MIN_DEDUCT_USD) {
    return `יש להזין סכום של $${MIN_DEDUCT_USD} לפחות`;
  }
  if (round2(amountUsd) > balanceUsd) {
    return `יש רק $${balanceUsd} בצבירה`;
  }
  return null;
}

/** Printed on the partner's credit page, so it says what the row is. */
export function deductionCouponCode(
  trackingCode: string,
  amountUsd: number,
  suffix: string,
): string {
  const prefix = trackingCode
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase();
  return `${prefix || "PARTNER"}-USED-${Math.round(amountUsd)}-${suffix}`;
}

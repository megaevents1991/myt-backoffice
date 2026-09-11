/**
 * Pure influencer-coupon helpers and types - NO server imports.
 *
 * The client component (components/influencer-coupon-card.tsx) needs the code
 * and terms helpers, but lib/services/influencer-coupon.ts pulls in the
 * server Supabase client + auth guards (next/headers). Importing a value from
 * that module into a client component drags the whole server graph into the
 * client bundle and fails the build - so the shared, side-effect-free pieces
 * live here and both sides import from here.
 */

export interface InfluencerCoupon {
  id: number;
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  per_person: boolean;
  is_active: boolean;
  times_used: number;
  times_paid: number;
}

export type InfluencerCouponResult =
  | { ok: true; coupon: InfluencerCoupon; created: boolean }
  | { ok: false; error: string };

/** "aviran-il" + 30 → "AVIRANIL30". Same charset main's normalizeCouponCode accepts. */
export function influencerCouponCode(trackingCode: string, value: number): string {
  const base = trackingCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${base}${Math.round(value)}`;
}

/**
 * Same normalization as main's finalPurchasePriceCalc / confirm-order floor:
 * 1..10 reads as a percent of the total, anything else as USD per ticket.
 */
export function influencerCouponTerms(userDiscount: number): {
  discount_type: "percent" | "fixed";
  discount_value: number;
  per_person: boolean;
} | null {
  const value = Math.floor(Number(userDiscount));
  if (!Number.isFinite(value) || value <= 0) return null;
  return value <= 10
    ? { discount_type: "percent", discount_value: value, per_person: false }
    : { discount_type: "fixed", discount_value: value, per_person: true };
}

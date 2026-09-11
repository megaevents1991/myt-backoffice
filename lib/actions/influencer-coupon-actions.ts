"use server";

import { requirePartner, requireStaff } from "@/lib/auth/guards";
import {
  findInfluencerCoupon,
  syncInfluencerCoupon,
  type InfluencerCoupon,
  type InfluencerCouponResult,
} from "@/lib/services/influencer-coupon";

/** Staff: the partner editor's "Influencer coupon" box. */
export async function getInfluencerCoupon(
  trackingCode: string,
): Promise<InfluencerCoupon | null> {
  await requireStaff();
  return findInfluencerCoupon(trackingCode);
}

/** Staff: build the coupon (or re-sync an existing one) from the partner row. */
export async function createInfluencerCoupon(
  trackingCode: string,
): Promise<InfluencerCouponResult> {
  const session = await requireStaff();
  return syncInfluencerCoupon(trackingCode, { create: true, actor: session.email });
}

/** Portal: the signed-in influencer's own coupon (null for agents / none yet). */
export async function getMyInfluencerCoupon(): Promise<InfluencerCoupon | null> {
  const session = await requirePartner();
  if (session.role !== "affiliate") return null;
  return findInfluencerCoupon(session.partner_code);
}

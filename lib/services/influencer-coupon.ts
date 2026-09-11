/**
 * The influencer's own coupon (Tom, 2026-09-10: "שלכל משפיען יהיה קופון אחד
 * בנוי עם השם שלו וגודל ההנחה שהוא נותן לעוקבים שלו").
 *
 * One coupon per affiliate partner, derived from the partner row:
 * - code   = tracking code + discount value, e.g. AVIRAN + 30 → "AVIRAN30"
 *            (Dor's pick, 2026-09-11)
 * - terms  = the follower discount (partners.user_discount), in the same
 *            unit main applies it on the tracking link: 1..10 = percent of
 *            the order, anything above = USD per person (per_person = true)
 * - attribution = partner_tracking_code, which main already falls back to
 *            when the order has no tracking cookie - so a coupon order counts
 *            as the influencer's order.
 *
 * Not a server action on purpose: the sync runs inside other guarded actions
 * (partner save, portal rebalance). The guarded wrappers live in
 * lib/actions/influencer-coupon-actions.ts.
 */

import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import {
  influencerCouponCode,
  influencerCouponTerms,
  type InfluencerCoupon,
  type InfluencerCouponResult,
} from "@/lib/influencer-coupon-shared";

// Re-export so existing server importers (actions) keep their import path;
// the pure helpers/types live in the shared module so a client component can
// use them without dragging this server module's Supabase client in.
export {
  influencerCouponCode,
  influencerCouponTerms,
  type InfluencerCoupon,
  type InfluencerCouponResult,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const COUPON_COLUMNS =
  "id,code,discount_type,discount_value,per_person,is_active,times_used,times_paid";

export async function findInfluencerCoupon(
  trackingCode: string,
): Promise<InfluencerCoupon | null> {
  const { data, error } = await db
    .from("coupons")
    .select(COUPON_COLUMNS)
    .eq("influencer_partner_code", trackingCode)
    .maybeSingle();
  if (error) {
    console.error("influencer-coupon: find failed", JSON.stringify(error));
    return null;
  }
  return (data as InfluencerCoupon | null) ?? null;
}

/**
 * Create the partner's coupon, or bring the existing one in line with the
 * partner's current follower discount (code included - "AVIRAN30" becomes
 * "AVIRAN25" when the discount drops to 25; the old code stops working).
 * `create = false` only touches a coupon that already exists.
 */
export async function syncInfluencerCoupon(
  trackingCode: string,
  options: { create: boolean; actor?: string | null } = { create: false },
): Promise<InfluencerCouponResult> {
  const { data: partner, error: partnerError } = await db
    .from("partners")
    .select("partner_tracking_code,name_hebrew,type,user_discount")
    .eq("partner_tracking_code", trackingCode)
    .maybeSingle();
  if (partnerError || !partner) {
    console.error("influencer-coupon: partner load failed", JSON.stringify(partnerError));
    return { ok: false, error: "השותף לא נמצא" };
  }
  if (partner.type !== "affiliate") {
    return { ok: false, error: "קופון משפיען נבנה רק לשותף מסוג משפיען" };
  }

  const terms = influencerCouponTerms(Number(partner.user_discount ?? 0));
  const existing = await findInfluencerCoupon(trackingCode);

  if (!terms) {
    // No follower discount → nothing to sell. Switch an existing coupon off
    // rather than deleting it (times_used / times_paid history stays).
    if (existing && existing.is_active) {
      await db.from("coupons").update({ is_active: false }).eq("id", existing.id);
      return { ok: true, coupon: { ...existing, is_active: false }, created: false };
    }
    if (existing) return { ok: true, coupon: existing, created: false };
    return { ok: false, error: "לשותף אין הנחה לעוקבים - אין מה לבנות ממנה קופון" };
  }

  const code = influencerCouponCode(trackingCode, terms.discount_value);

  // The code must not belong to a different coupon - unless that coupon was
  // hand-made for this same partner (Tom built AVIRAN30 by hand before this
  // existed): then it IS the influencer coupon, adopt it in place so its
  // usage history and the code people already have keep working.
  const { data: clash } = await db
    .from("coupons")
    .select("id,partner_tracking_code,influencer_partner_code")
    .ilike("code", code)
    .maybeSingle();
  let target = existing;
  if (clash && clash.id !== existing?.id) {
    const adoptable =
      !existing &&
      clash.influencer_partner_code == null &&
      (clash.partner_tracking_code == null || clash.partner_tracking_code === trackingCode);
    if (!adoptable) {
      return { ok: false, error: `הקוד ${code} כבר תפוס על ידי קופון אחר` };
    }
    target = { id: clash.id } as InfluencerCoupon;
  }

  if (target) {
    const patch = {
      code,
      ...terms,
      is_active: true,
      partner_tracking_code: trackingCode,
      influencer_partner_code: trackingCode,
    };
    const { data, error } = await db
      .from("coupons")
      .update(patch)
      .eq("id", target.id)
      .select(COUPON_COLUMNS)
      .single();
    if (error || !data) {
      console.error("influencer-coupon: update failed", JSON.stringify(error));
      return { ok: false, error: "עדכון הקופון נכשל" };
    }
    await logAudit({
      action: "update",
      entityType: "coupon",
      entityId: target.id,
      changes: patch,
      metadata: {
        influencer_partner_code: trackingCode,
        adopted: !existing,
        actor: options.actor ?? null,
      },
    });
    return { ok: true, coupon: data as InfluencerCoupon, created: false };
  }

  if (!options.create) {
    return { ok: false, error: "לשותף עדיין אין קופון משפיען" };
  }

  const row = {
    code,
    ...terms,
    event_id: null,
    valid_until: null,
    max_uses: null,
    is_active: true,
    partner_tracking_code: trackingCode,
    influencer_partner_code: trackingCode,
  };
  const { data, error } = await db
    .from("coupons")
    .insert(row)
    .select(COUPON_COLUMNS)
    .single();
  if (error || !data) {
    console.error("influencer-coupon: insert failed", JSON.stringify(error));
    return { ok: false, error: "יצירת הקופון נכשלה" };
  }
  await logAudit({
    action: "create",
    entityType: "coupon",
    entityId: (data as InfluencerCoupon).id,
    changes: row,
    metadata: { influencer_partner_code: trackingCode, actor: options.actor ?? null },
  });
  return { ok: true, coupon: data as InfluencerCoupon, created: true };
}

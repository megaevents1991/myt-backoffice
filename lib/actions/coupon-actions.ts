"use server";

import { supabase } from "@/lib/supabase-server";
import { requireStaff } from "@/lib/auth/guards";
import type { Coupon } from "@/types/app.types";
import { isCustomerRefundPartner } from "@/types/partner.types";
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit";

export type CouponInput = {
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  event_id: number | null;
  valid_until: string | null;
  max_uses: number | null;
  /** Partner credited for orders redeeming this coupon (when order has no affiliate). */
  partner_tracking_code: string | null;
  is_active: boolean;
};

// Codes are stored UPPERCASE; the main app matches case-insensitively.
const normalizeCode = (code: string) => code.trim().toUpperCase();

// `coupons` isn't in the generated client types - same untyped-table
// pattern as template-crud.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const coupons = () => (supabase as any).from("coupons");

export async function getCoupons() {
  await requireStaff();
  const { data, error } = await coupons()
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Coupon[];
}

export async function createCoupon(coupon: CouponInput) {
  await requireStaff();
  const payload = { ...coupon, code: normalizeCode(coupon.code) };
  const { data, error } = await coupons().insert(payload).select();

  if (error) throw error;
  const created = data[0] as Coupon;
  await logAudit({
    action: "create",
    entityType: "coupon",
    entityId: created.id,
    changes: payload,
  });
  return created;
}

export async function updateCoupon(id: number, coupon: Partial<CouponInput>) {
  await requireStaff();
  const patch = coupon.code
    ? { ...coupon, code: normalizeCode(coupon.code) }
    : coupon;
  const before = await fetchBefore("coupons", "id", id, patch);
  const { data, error } = await coupons().update(patch).eq("id", id).select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "coupon",
    entityId: id,
    changes: diffChanges(before, patch),
  });
  return data[0] as Coupon;
}

export async function toggleCouponActive(id: number, isActive: boolean) {
  await requireStaff();
  const { data, error } = await coupons()
    .update({ is_active: isActive })
    .eq("id", id)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "coupon",
    entityId: id,
    changes: { is_active: { from: !isActive, to: isActive } },
  });
  return data[0] as Coupon;
}

export async function deleteCoupon(id: number) {
  await requireStaff();
  const { error } = await coupons().delete().eq("id", id);

  if (error) throw error;
  await logAudit({ action: "delete", entityType: "coupon", entityId: id });
  return true;
}

/** Light event list for the "restrict to event" dropdown (live events only). */
export async function getCouponEventOptions() {
  await requireStaff();
  const { data, error } = await supabase
    .from("events")
    .select("id, name, date")
    .is("is_deleted", null)
    .order("date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as { id: number; name: string; date: string }[];
}

/** Light partner list for the "attribute to affiliate" dropdown.
 *  Excludes the auto-created per-customer refund rows - ~1235 of the 1312 -
 *  so only real agents/influencers/affiliate codes appear. Code-only affiliates
 *  (null name, e.g. "mega") are kept. */
export async function getCouponPartnerOptions() {
  await requireStaff();
  const { data, error } = await supabase
    .from("partners")
    .select("partner_tracking_code, name_hebrew, type")
    // `type.is.null` must be spelled out - a bare `neq` drops NULL-typed rows,
    // which is where the code-only affiliates live.
    .or("type.is.null,type.neq.customer_refund")
    .order("name_hebrew", { ascending: true, nullsFirst: false });

  if (error) throw error;
  const rows = (data ?? []) as {
    partner_tracking_code: string;
    name_hebrew: string | null;
    type: string | null;
  }[];
  // Second pass for any row the backfill migration hasn't typed yet.
  return rows.filter((row) => !isCustomerRefundPartner(row));
}

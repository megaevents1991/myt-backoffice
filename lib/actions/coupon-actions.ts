"use server"

import { supabase } from "@/lib/supabase-server"
import type { Coupon } from "@/types/app.types"

export type CouponInput = {
  code: string
  discount_type: "percent" | "fixed"
  discount_value: number
  event_id: number | null
  valid_until: string | null
  max_uses: number | null
  /** Partner credited for orders redeeming this coupon (when order has no affiliate). */
  partner_tracking_code: string | null
  is_active: boolean
}

// Codes are stored UPPERCASE; the main app matches case-insensitively.
const normalizeCode = (code: string) => code.trim().toUpperCase()

// `coupons` isn't in the generated client types — same untyped-table
// pattern as template-crud.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const coupons = () => (supabase as any).from("coupons")

export async function getCoupons() {
  const { data, error } = await coupons()
    .select("*")
    .order("created_at", { ascending: false })

  if (error) throw error
  return data as Coupon[]
}

export async function createCoupon(coupon: CouponInput) {
  const { data, error } = await coupons()
    .insert({ ...coupon, code: normalizeCode(coupon.code) })
    .select()

  if (error) throw error
  return data[0] as Coupon
}

export async function updateCoupon(id: number, coupon: Partial<CouponInput>) {
  const patch = coupon.code
    ? { ...coupon, code: normalizeCode(coupon.code) }
    : coupon
  const { data, error } = await coupons()
    .update(patch)
    .eq("id", id)
    .select()

  if (error) throw error
  return data[0] as Coupon
}

export async function toggleCouponActive(id: number, isActive: boolean) {
  const { data, error } = await coupons()
    .update({ is_active: isActive })
    .eq("id", id)
    .select()

  if (error) throw error
  return data[0] as Coupon
}

export async function deleteCoupon(id: number) {
  const { error } = await coupons().delete().eq("id", id)

  if (error) throw error
  return true
}

/** Light event list for the "restrict to event" dropdown (live events only). */
export async function getCouponEventOptions() {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, date")
    .is("is_deleted", null)
    .order("date", { ascending: true })

  if (error) throw error
  return (data ?? []) as { id: number; name: string; date: string }[]
}

/** Light partner list for the "attribute to affiliate" dropdown. */
export async function getCouponPartnerOptions() {
  const { data, error } = await supabase
    .from("partners")
    .select("partner_tracking_code, name_hebrew, type")
    .order("partner_tracking_code", { ascending: true })

  if (error) throw error
  return (data ?? []) as {
    partner_tracking_code: string
    name_hebrew: string | null
    type: string | null
  }[]
}

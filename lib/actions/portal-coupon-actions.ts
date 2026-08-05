"use server"

import { requirePartner } from "@/lib/auth/guards"
import { supabase } from "@/lib/supabase-server"
import { logAudit } from "@/lib/audit"
import { fundedCodeSet } from "@/lib/partner-commission"
import type { CommissionType } from "@/types/partner.types"

/**
 * Commission-funded coupons — the partner gives their audience an extra
 * discount OUT OF their own commission.
 *
 * The cap is the whole deal: a fixed-per-ticket partner may create a fixed
 * coupon up to their per-ticket rate (a coupon applies once per order, an
 * order has at least one ticket, so commission always covers it), and a
 * percent-of-sale partner a percent coupon up to their percent. The coupon is
 * marked `funded_by_commission`, and lib/partner-commission.ts deducts its
 * recorded discount from the commission of the reservation it was spent on.
 */

export interface MyCouponTerms {
  type: CommissionType
  rate: number
}

export async function getMyCouponTerms(): Promise<MyCouponTerms | null> {
  const session = await requirePartner()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("partners")
    .select("commission,commission_type")
    .eq("partner_tracking_code", session.partner_code)
    .maybeSingle()
  if (error) {
    console.error("getMyCouponTerms:", JSON.stringify(error))
    return null
  }
  if (!data) return null
  return {
    type: (data.commission_type as CommissionType | null) ?? "fixed_per_ticket",
    rate: Number(data.commission ?? 0),
  }
}

/** Codes of this partner's commission-funded coupons, uppercased — what
 *  CommissionTerms.fundedCouponCodes wants. Empty until the flag's migration
 *  lands (42703 is silence, not an error). */
export async function fundedCouponCodesFor(trackingCode: string): Promise<Set<string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("coupons")
    .select("code")
    .eq("partner_tracking_code", trackingCode)
    .eq("funded_by_commission", true)
  if (error) {
    if (error.code !== "42703") {
      console.error("fundedCouponCodesFor:", JSON.stringify(error))
    }
    return new Set()
  }
  return fundedCodeSet(((data ?? []) as { code: string | null }[]).map((row) => row.code))
}

export type CreateCouponResult =
  | { ok: true; code: string }
  | { ok: false; error: string }

export interface CreateCouponInput {
  discount_type: "percent" | "fixed"
  discount_value: number
  code?: string | null
  valid_until?: string | null
  max_uses?: number | null
}

/** Customer-typed codes — no 0/O/1/I lookalikes in the generated ones. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$/

function generateCouponCode(trackingCode: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const suffix = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")
  const prefix = trackingCode.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase()
  return `${prefix || "PARTNER"}-${suffix}`
}

export async function createPartnerCoupon(
  input: CreateCouponInput
): Promise<CreateCouponResult> {
  const session = await requirePartner()
  const terms = await getMyCouponTerms()
  if (!terms) {
    return { ok: false, error: "לא הצלחנו לקרוא את תנאי העמלה שלכם. נסו שוב." }
  }
  if (!Number.isFinite(terms.rate) || terms.rate <= 0) {
    return {
      ok: false,
      error: "אין לחשבון עמלה מוגדרת — אין ממה לממן את ההנחה. פנו אלינו.",
    }
  }

  const value = Number(input.discount_value)
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "יש להזין ערך הנחה תקין" }
  }

  // The cap: the coupon's unit must match the commission's unit, so the
  // deduction can never exceed what the reservation earns.
  if (terms.type === "percent_of_sale") {
    if (input.discount_type !== "percent") {
      return {
        ok: false,
        error: "העמלה שלכם באחוזים — אפשר ליצור רק קופון באחוזים",
      }
    }
    if (value > terms.rate) {
      return { ok: false, error: `עד תקרת העמלה שלכם: ${terms.rate}%` }
    }
  } else {
    if (input.discount_type !== "fixed") {
      return {
        ok: false,
        error: "העמלה שלכם קבועה לכרטיס — אפשר ליצור רק קופון בסכום קבוע",
      }
    }
    if (value > terms.rate) {
      return { ok: false, error: `עד תקרת העמלה שלכם: $${terms.rate}` }
    }
  }

  const maxUses =
    input.max_uses == null ? 1 : Math.floor(Number(input.max_uses))
  if (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 100) {
    return { ok: false, error: "מספר שימושים בין 1 ל-100" }
  }

  let validUntil: string | null = null
  if (input.valid_until) {
    const parsed = input.valid_until.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
      return { ok: false, error: "תאריך תוקף לא תקין" }
    }
    if (parsed < new Date().toISOString().slice(0, 10)) {
      return { ok: false, error: "תאריך התוקף כבר עבר" }
    }
    validUntil = parsed
  }

  const chosen = input.code?.trim() ?? ""
  const custom = chosen.length > 0
  let code = custom
    ? chosen.toUpperCase().replace(/\s+/g, "-")
    : generateCouponCode(session.partner_code)
  if (custom && !CODE_PATTERN.test(code)) {
    return {
      ok: false,
      error:
        "שם הקופון צריך 3-32 אותיות באנגלית, ספרות או מקפים, ולא להתחיל או להסתיים במקף",
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("coupons")
      .insert({
        code,
        discount_type: input.discount_type,
        discount_value: value,
        max_uses: maxUses,
        valid_until: validUntil,
        is_active: true,
        partner_tracking_code: session.partner_code,
        funded_by_commission: true,
      })
      .select("id")
      .single()

    if (!error) {
      await logAudit({
        action: "create",
        entityType: "coupon",
        entityId: String((data as { id: number }).id),
        metadata: {
          funded_by_commission: true,
          partner_tracking_code: session.partner_code,
          discount_type: input.discount_type,
          discount_value: value,
          code,
        },
      })
      return { ok: true, code }
    }

    const errorCode = (error as { code?: string }).code
    if (errorCode === "42703" || errorCode === "PGRST204") {
      // The funded_by_commission migration hasn't landed. Fail CLOSED: without
      // the flag the discount would never come out of the commission, which is
      // the exact opposite of the deal this screen offers.
      return {
        ok: false,
        error: "היכולת הזו תהיה זמינה אחרי עדכון המערכת הקרוב. נסו שוב מאוחר יותר.",
      }
    }
    if (errorCode !== "23505") {
      console.error("createPartnerCoupon:", JSON.stringify(error))
      return { ok: false, error: "לא הצלחנו ליצור את הקופון. נסו שוב." }
    }
    if (custom) {
      return { ok: false, error: `השם "${code}" כבר תפוס. בחרו שם אחר.` }
    }
    code = generateCouponCode(session.partner_code)
  }
  return { ok: false, error: "לא הצלחנו ליצור את הקופון. נסו שוב." }
}

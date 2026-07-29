"use server"

import { requirePartner, requireStaff } from "@/lib/auth/guards"
import { supabase } from "@/lib/supabase-server"
import { logAudit } from "@/lib/audit"
import {
  countTickets,
  creditAccrued,
  creditBalance,
  isPaid,
  round2,
} from "@/lib/partner-commission"
import type { ReservationEventOrderInfo } from "@/types/reservation.types"

/**
 * Partner site credit: accrued per ticket on paid reservations, converted in
 * one go into a single-use coupon.
 *
 * The balance is always derived — accrued minus the redemption ledger — never
 * stored as a counter, so it cannot drift from the reservations behind it.
 */

export interface PartnerCredit {
  creditPerTicket: number
  /** Everything ever earned. */
  accruedUsd: number
  /** Everything already turned into coupons. */
  redeemedUsd: number
  /** What can be converted right now. */
  balanceUsd: number
  paidTickets: number
  history: PartnerCreditRedemption[]
}

export interface PartnerCreditRedemption {
  id: number
  amount_usd: number
  coupon_code: string
  created_at: string
}

type ReservationRow = {
  status: string | null
  event_order_info: ReservationEventOrderInfo | null
}

async function loadCredit(trackingCode: string): Promise<PartnerCredit> {
  const [partnerResult, reservationsResult, redemptionsResult] = await Promise.all([
    supabase
      .from("partners")
      .select("credit_per_ticket")
      .eq("partner_tracking_code", trackingCode)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select("status,event_order_info")
      .eq("aff_partner_tracking_code", trackingCode),
    supabase
      .from("partner_credit_redemptions")
      .select("id,amount_usd,coupon_code,created_at")
      .eq("partner_tracking_code", trackingCode)
      .order("created_at", { ascending: false }),
  ])

  if (partnerResult.error) throw partnerResult.error
  if (reservationsResult.error) throw reservationsResult.error
  if (redemptionsResult.error) throw redemptionsResult.error

  const creditPerTicket =
    (partnerResult.data as { credit_per_ticket: number } | null)?.credit_per_ticket ?? 0
  const reservations = (reservationsResult.data ?? []) as unknown as ReservationRow[]
  const history = (redemptionsResult.data ?? []) as unknown as PartnerCreditRedemption[]

  const accruedUsd = round2(creditAccrued(reservations, creditPerTicket))
  const redeemedUsd = round2(
    history.reduce((sum, r) => sum + Number(r.amount_usd ?? 0), 0)
  )

  return {
    creditPerTicket,
    accruedUsd,
    redeemedUsd,
    balanceUsd: creditBalance(accruedUsd, redeemedUsd),
    // Tickets, not reservations — this is shown next to the accrued amount,
    // which is priced per ticket, so a row count would contradict it.
    paidTickets: countTickets(reservations.filter(isPaid)),
    history,
  }
}

/** The signed-in partner's own credit. */
export async function getMyCredit(): Promise<PartnerCredit> {
  const session = await requirePartner()
  return loadCredit(session.partner_code)
}

/** Any partner's credit, for the staff performance screen. */
export async function getPartnerCredit(trackingCode: string): Promise<PartnerCredit> {
  await requireStaff()
  return loadCredit(trackingCode)
}

export type ConvertResult =
  | { ok: true; code: string; amountUsd: number }
  | { ok: false; error: string }

/** Coupon codes are typed by customers — no 0/O/1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function generateCouponCode(trackingCode: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const suffix = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")
  const prefix = trackingCode.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase()
  return `${prefix || "PARTNER"}-${suffix}`
}

/**
 * Convert the whole balance into one single-use coupon.
 *
 * The coupon is created INACTIVE, the ledger row is written, and only then is
 * the coupon switched on. A live coupon with no ledger row would be spendable
 * credit that the balance still offers — free money — whereas an inactive
 * orphan is worth nothing. So every failure path leans that way.
 */
export async function convertCreditToCoupon(): Promise<ConvertResult> {
  const session = await requirePartner()
  return convertFor(session.partner_code, session.sub)
}

/** Staff-initiated conversion on a partner's behalf. */
export async function convertPartnerCreditToCoupon(
  trackingCode: string
): Promise<ConvertResult> {
  const actor = await requireStaff()
  return convertFor(trackingCode, actor.sub)
}

/**
 * Insert the coupon switched off, retrying if the random code collides with an
 * existing one (`coupons.code` is unique).
 */
async function insertCoupon(
  firstCode: string,
  amountUsd: number,
  trackingCode: string
): Promise<{ ok: true; id: number; code: string } | { ok: false; error: string }> {
  let code = firstCode
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from("coupons")
      .insert({
        code,
        discount_type: "fixed",
        discount_value: amountUsd,
        max_uses: 1,
        is_active: false,
        partner_tracking_code: trackingCode,
      })
      .select("id")
      .single()

    if (!error) return { ok: true, id: (data as { id: number }).id, code }

    // 23505 = unique violation. Any other error is not worth retrying.
    if ((error as { code?: string }).code !== "23505") {
      console.error("convertCreditToCoupon coupon:", JSON.stringify(error))
      return { ok: false, error: "Could not create the coupon. Please try again." }
    }
    code = generateCouponCode(trackingCode)
  }
  return { ok: false, error: "Could not create the coupon. Please try again." }
}

async function convertFor(
  trackingCode: string,
  actorId: string | null
): Promise<ConvertResult> {
  const credit = await loadCredit(trackingCode)
  const amountUsd = credit.balanceUsd

  // The coupons table rejects a non-positive discount, and there is nothing to
  // give anyway.
  if (amountUsd <= 0) {
    return { ok: false, error: "There is no credit to convert yet" }
  }

  // Created switched OFF: until the ledger records it, this coupon must not be
  // spendable, because the balance still offers the same credit.
  const coupon = await insertCoupon(generateCouponCode(trackingCode), amountUsd, trackingCode)
  if (!coupon.ok) return { ok: false, error: coupon.error }
  // Use the code that was actually inserted — a collision retry changes it.
  const { id: couponId, code } = coupon

  const { data: ledgerData, error: ledgerError } = await supabase
    .from("partner_credit_redemptions")
    .insert({
      partner_tracking_code: trackingCode,
      amount_usd: amountUsd,
      coupon_id: couponId,
      coupon_code: code,
      created_by: actorId,
    })
    .select("id")
    .single()

  if (ledgerError) {
    console.error("convertCreditToCoupon ledger:", JSON.stringify(ledgerError))
    // The coupon was never activated, so it is already worthless. Delete it so
    // the code can be reused rather than leaving dead rows behind.
    await supabase.from("coupons").delete().eq("id", couponId)
    return { ok: false, error: "Could not record the conversion. Please try again." }
  }

  const ledgerId = (ledgerData as { id: number }).id

  // No transaction is available here, so check after the fact: two conversions
  // racing (a double-click) leaves the ledger summing past what was ever
  // earned. Only the LATER row backs out — otherwise both would, and the
  // partner would lose credit they were entitled to convert once.
  const after = await loadCredit(trackingCode)
  // Compare against everything redeemed BEFORE this row, not "does an older row
  // exist" — every partner who has ever converted has older rows, and testing
  // for their mere presence would make a legitimate conversion undo itself.
  const priorRedeemed = after.history
    .filter((row) => row.id < ledgerId)
    .reduce((sum, row) => sum + Number(row.amount_usd ?? 0), 0)

  if (round2(priorRedeemed + amountUsd) > after.accruedUsd + 0.001) {
    console.error(
      `convertCreditToCoupon: lost a race for ${trackingCode} — prior ${priorRedeemed} + ${amountUsd} > accrued ${after.accruedUsd}. Backing out ledger ${ledgerId} / coupon ${code}.`
    )
    await supabase.from("partner_credit_redemptions").delete().eq("id", ledgerId)
    await supabase.from("coupons").delete().eq("id", couponId)
    return {
      ok: false,
      error: "That credit was just converted. Refresh to see the coupon.",
    }
  }

  // Safe to hand over now that the credit is recorded as spent.
  const { error: activateError } = await supabase
    .from("coupons")
    .update({ is_active: true })
    .eq("id", couponId)
  if (activateError) {
    console.error(
      `convertCreditToCoupon: coupon ${code} recorded but not activated:`,
      JSON.stringify(activateError)
    )
    return {
      ok: false,
      error: `Coupon ${code} was created but could not be activated. Contact support.`,
    }
  }

  await logAudit({
    action: "create",
    entityType: "coupon",
    entityId: String(couponId),
    metadata: {
      partner_credit_conversion: true,
      partner_tracking_code: trackingCode,
      amount_usd: amountUsd,
      code,
    },
  })

  return { ok: true, code, amountUsd }
}

import { normalizeReservationEventOrderInfo } from "@/lib/utils"
import type { CommissionType } from "@/types/partner.types"
import type { ReservationEventOrderInfo } from "@/types/reservation.types"

/**
 * Single source of truth for partner payout.
 *
 * `partners.commission` carries no unit of its own — `commission_type` says how
 * to read it. The portal once read the column as a percentage while the monthly
 * report cron paid it as $/ticket, so the same partner saw two different
 * payouts for the same month. Every surface now calls in here.
 */

type ReservationLike = {
  status?: string | null
  user_shown_price?: number | null
  event_order_info?: ReservationEventOrderInfo | null
  /** Needed only when terms carry fundedCouponCodes — the coupon spent on the
   *  order and what it actually discounted. */
  coupon_code?: string | null
  coupon_discount_usd?: number | null
}

/** How a partner is paid. `rate` is `partners.commission`. */
export type CommissionTerms = {
  type: CommissionType | null
  rate: number | null
  /**
   * UPPERCASED codes of this partner's commission-funded coupons
   * (`coupons.funded_by_commission`). When present, the discount such a coupon
   * put on a reservation is deducted from that reservation's commission —
   * that's the deal the coupon was created under. Absent = gross, the
   * behavior every pre-existing surface has.
   */
  fundedCouponCodes?: ReadonlySet<string>
}

/** Uppercase a coupon-code list into the set CommissionTerms carries. */
export function fundedCodeSet(codes: (string | null | undefined)[]): Set<string> {
  return new Set(
    codes
      .map((code) => (code ?? "").trim().toUpperCase())
      .filter((code) => code.length > 0)
  )
}

/** Tickets in one reservation, summed across every event in its order info. */
export function countReservationTickets(reservation: ReservationLike): number {
  return normalizeReservationEventOrderInfo(reservation.event_order_info).reduce(
    (sum, event) => sum + (Number(event.number_of_ticket) || 0),
    0
  )
}

/** Tickets across many reservations. */
export function countTickets(reservations: ReservationLike[]): number {
  return reservations.reduce((sum, r) => sum + countReservationTickets(r), 0)
}

/**
 * The one status that earns commission. Every writer in the app stores exactly
 * this casing (the reservation status dropdowns emit `value="Paid"`), and the
 * monthly cron bills on `.eq("status", PAID_STATUS)` — so the match here is
 * exact too. A looser check would show partners commission the cron never pays.
 */
export const PAID_STATUS = "Paid"

/** A reservation only earns commission once it is paid. */
export function isPaid(reservation: ReservationLike): boolean {
  return reservation.status === PAID_STATUS
}

/** The package price the customer paid — the base for percentage commission. */
export function saleValue(reservation: ReservationLike): number {
  return reservation.user_shown_price ?? 0
}

/** Sales total across reservations. */
export function sumSales(reservations: ReservationLike[]): number {
  return reservations.reduce((sum, r) => sum + saleValue(r), 0)
}

function isUsableRate(rate: number | null): rate is number {
  return rate != null && Number.isFinite(rate)
}

/**
 * Commission in USD for one reservation. Returns 0 unless it is paid, so this
 * is safe to map over a mixed list.
 */
export function commissionForReservation(
  reservation: ReservationLike,
  terms: CommissionTerms
): number {
  if (!isPaid(reservation)) return 0
  if (!isUsableRate(terms.rate)) return 0
  const gross =
    terms.type === "percent_of_sale"
      ? (saleValue(reservation) * terms.rate) / 100
      : // `fixed_per_ticket` is the default for every legacy row, so an unset or
        // unrecognised type must land here — that is how the cron has always paid.
        countReservationTickets(reservation) * terms.rate

  // Commission-funded coupon: its recorded discount comes out of THIS
  // reservation's commission, floored at zero (creation caps the coupon at the
  // commission, so a negative can only mean drifted data — never a debt).
  const codes = terms.fundedCouponCodes
  const code = (reservation.coupon_code ?? "").trim().toUpperCase()
  if (codes && code && codes.has(code)) {
    const discount = Number(reservation.coupon_discount_usd ?? 0)
    if (Number.isFinite(discount) && discount > 0) {
      return Math.max(0, gross - discount)
    }
  }
  return gross
}

/** Commission in USD earned by the paid reservations in the list. */
export function commissionForReservations(
  reservations: ReservationLike[],
  terms: CommissionTerms
): number {
  return reservations.reduce((sum, r) => sum + commissionForReservation(r, terms), 0)
}

/**
 * Site credit accrued on paid reservations — separate from cash commission,
 * and paid in addition to it. Accrues per ticket, the same unit the monthly
 * report counts, so the two figures always agree about what a "passenger" is.
 */
export function creditAccrued(
  reservations: ReservationLike[],
  creditPerTicket: number | null
): number {
  if (!creditPerTicket || !Number.isFinite(creditPerTicket)) return 0
  return countTickets(reservations.filter(isPaid)) * creditPerTicket
}

/**
 * The instant historical partner balances were settled outside this system —
 * commission and site credit both. Mirrors the backfill in migration
 * 20260729220000, which stamps exactly this value into `billed_at`.
 *
 * That makes the two distinguishable: a reservation stamped AT the cutoff was
 * part of the settlement, while anything the monthly cron stamps later was not.
 */
export const SETTLEMENT_CUTOFF_ISO = "2026-07-01T00:00:00+00:00"
const SETTLEMENT_CUTOFF_MS = Date.parse(SETTLEMENT_CUTOFF_ISO)

/** True when this reservation was part of the pre-cutoff settlement. */
export function wasSettledAtCutoff(billedAt: string | null | undefined): boolean {
  if (!billedAt) return false
  const stamped = Date.parse(billedAt)
  return Number.isFinite(stamped) && stamped <= SETTLEMENT_CUTOFF_MS
}

/** Money is compared and stored to the cent; floats drift past that. */
export function round2(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

/**
 * Human-readable rate, e.g. "$25 per ticket" or "8% of sales". A rate of 0 is
 * shown as "$0", not "—": partners created alongside a user start at 0, and
 * "not configured yet" must not look like "no data".
 */
export function describeCommission(terms: CommissionTerms): string {
  if (!isUsableRate(terms.rate)) return "—"
  return terms.type === "percent_of_sale"
    ? `${terms.rate}% of sales`
    : `$${terms.rate} per ticket`
}

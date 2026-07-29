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
}

/** How a partner is paid. `rate` is `partners.commission`. */
export type CommissionTerms = {
  type: CommissionType | null
  rate: number | null
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
  if (terms.type === "percent_of_sale") {
    return (saleValue(reservation) * terms.rate) / 100
  }
  // `fixed_per_ticket` is the default for every legacy row, so an unset or
  // unrecognised type must land here — that is how the cron has always paid.
  return countReservationTickets(reservation) * terms.rate
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
 * What the partner can convert right now: everything earned, less everything
 * already converted. Derived every time rather than stored, so a failed or
 * repeated conversion can't leave a balance that disagrees with the ledger.
 * Clamped at 0 — a rate lowered after a conversion must not go negative.
 */
export function creditBalance(accrued: number, redeemed: number): number {
  return Math.max(0, round2(accrued - redeemed))
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

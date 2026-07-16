import { normalizeReservationEventOrderInfo } from "@/lib/utils"
import type { ReservationEventOrderInfo } from "@/types/reservation.types"

/**
 * Single source of truth for partner payout.
 *
 * `partners.commission` is a FLAT USD AMOUNT PER TICKET — not a percentage.
 * The monthly report cron has always paid `tickets * commission`; the portal
 * once read the same column as a percent of sales and showed partners a wildly
 * different number for the same month. Both surfaces now call in here.
 */

type ReservationLike = {
  status?: string | null
  event_order_info?: ReservationEventOrderInfo | null
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

/** Commission in USD for a ticket count at a given per-ticket rate. */
export function commissionForTickets(tickets: number, ratePerTicket: number | null): number {
  if (!ratePerTicket || !Number.isFinite(ratePerTicket)) return 0
  return tickets * ratePerTicket
}

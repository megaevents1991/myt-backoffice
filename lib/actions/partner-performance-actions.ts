"use server"

import { requireStaff } from "@/lib/auth/guards"
import { supabase } from "@/lib/supabase-server"
import {
  commissionForReservation,
  commissionForReservations,
  countReservationTickets,
  countTickets,
  isPaid,
  sumSales,
  type CommissionTerms,
} from "@/lib/partner-commission"
import type { CommissionType } from "@/types/partner.types"
import { getReservationEventOrderInfoPrimaryName } from "@/lib/utils"
import type { ReservationEventOrderInfo } from "@/types/reservation.types"

export interface PartnerPerformanceReservation {
  id: number
  created_at: string
  customer_name: string
  status: string
  event_title: string
  tickets: number
  sales_usd: number
  commission_usd: number
}

export interface PartnerMonthlyPoint {
  /** `YYYY-MM`, ascending. */
  month: string
  reservations: number
  tickets: number
  sales_usd: number
  commission_usd: number
}

export interface PartnerPerformance {
  /** `partners.commission` — read as $/ticket or % per `commissionType`. */
  commissionRate: number
  commissionType: CommissionType
  totalReservations: number
  paidReservations: number
  paidTickets: number
  totalSalesUsd: number
  commissionUsd: number
  /** Paid reservations in the calendar month the monthly cron will next bill. */
  currentMonthCommissionUsd: number
  activeCoupons: number
  couponUses: number
  monthly: PartnerMonthlyPoint[]
  reservations: PartnerPerformanceReservation[]
}

type ReservationRow = {
  id: number
  created_at: string
  main_contact_first_name: string | null
  main_contact_last_name: string | null
  status: string | null
  user_shown_price: number | null
  event_order_info: ReservationEventOrderInfo | null
}

/**
 * Staff-side view of what a partner earned. Deliberately shares
 * `lib/partner-commission` with the partner portal so the number staff sees and
 * the number the partner sees can never drift apart again.
 */
export async function getPartnerPerformance(
  trackingCode: string
): Promise<PartnerPerformance> {
  await requireStaff()

  const [partnerResult, reservationsResult, couponsResult] = await Promise.all([
    supabase
      .from("partners")
      .select("commission,commission_type")
      .eq("partner_tracking_code", trackingCode)
      .single(),
    supabase
      .from("reservations")
      .select(
        "id,created_at,main_contact_first_name,main_contact_last_name,status,user_shown_price,event_order_info"
      )
      .eq("aff_partner_tracking_code", trackingCode)
      .order("created_at", { ascending: false }),
    supabase
      .from("coupons")
      .select("id,is_active,times_used")
      .eq("partner_tracking_code", trackingCode),
  ])

  if (partnerResult.error) throw partnerResult.error
  if (reservationsResult.error) throw reservationsResult.error
  if (couponsResult.error) {
    console.error("getPartnerPerformance coupons:", JSON.stringify(couponsResult.error))
  }

  const partnerRow = partnerResult.data as {
    commission: number
    commission_type: CommissionType | null
  } | null
  const terms: CommissionTerms = {
    type: partnerRow?.commission_type ?? "fixed_per_ticket",
    rate: partnerRow?.commission ?? 0,
  }
  const rows = (reservationsResult.data ?? []) as unknown as ReservationRow[]
  const coupons = (couponsResult.data ?? []) as unknown as {
    is_active: boolean
    times_used: number | null
  }[]

  const reservations: PartnerPerformanceReservation[] = rows.map((r) => {
    const tickets = countReservationTickets(r)
    return {
      id: r.id,
      created_at: r.created_at,
      customer_name:
        [r.main_contact_first_name, r.main_contact_last_name].filter(Boolean).join(" ") ||
        "—",
      status: r.status ?? "",
      event_title: getReservationEventOrderInfoPrimaryName(r.event_order_info),
      tickets,
      sales_usd: r.user_shown_price ?? 0,
      // Only paid reservations earn — commissionForReservation enforces that.
      commission_usd: commissionForReservation(r, terms),
    }
  })

  const paid = rows.filter(isPaid)
  const paidTickets = countTickets(paid)
  const currentMonth = new Date().toISOString().slice(0, 7)

  const byMonth = new Map<string, PartnerMonthlyPoint>()
  for (const r of paid) {
    const month = r.created_at.slice(0, 7)
    const point =
      byMonth.get(month) ??
      { month, reservations: 0, tickets: 0, sales_usd: 0, commission_usd: 0 }
    const tickets = countReservationTickets(r)
    point.reservations += 1
    point.tickets += tickets
    point.sales_usd += r.user_shown_price ?? 0
    point.commission_usd += commissionForReservation(r, terms)
    byMonth.set(month, point)
  }
  const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))

  return {
    commissionRate: terms.rate ?? 0,
    commissionType: terms.type ?? "fixed_per_ticket",
    totalReservations: rows.length,
    paidReservations: paid.length,
    paidTickets,
    totalSalesUsd: sumSales(paid),
    commissionUsd: commissionForReservations(paid, terms),
    currentMonthCommissionUsd: byMonth.get(currentMonth)?.commission_usd ?? 0,
    activeCoupons: coupons.filter((c) => c.is_active).length,
    couponUses: coupons.reduce((sum, c) => sum + (c.times_used ?? 0), 0),
    monthly,
    reservations,
  }
}

"use server"

import { requireStaff } from "@/lib/auth/guards"
import { supabase } from "@/lib/supabase-server"
import {
  commissionForReservation,
  commissionForReservations,
  countReservationTickets,
  countTickets,
  isPaid,
  round2,
  sumSales,
  type CommissionTerms,
} from "@/lib/partner-commission"
import {
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABELS,
  emptyTraffic,
  type PartnerTraffic,
} from "@/lib/partner-funnel"
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
  /** Commission owed but not yet in a monthly report — the same `billed_at`
   *  fact the cron bills on, so staff and the partner never see two numbers. */
  pendingCommissionUsd: number
  activeCoupons: number
  couponUses: number
  monthly: PartnerMonthlyPoint[]
  reservations: PartnerPerformanceReservation[]
  traffic: PartnerTraffic
}

type ReservationRow = {
  id: number
  created_at: string
  main_contact_first_name: string | null
  main_contact_last_name: string | null
  status: string | null
  user_shown_price: number | null
  event_order_info: ReservationEventOrderInfo | null
  billed_at: string | null
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

  const [partnerResult, reservationsResult, couponsResult, trafficResult] =
    await Promise.all([
    supabase
      .from("partners")
      .select("commission,commission_type")
      .eq("partner_tracking_code", trackingCode)
      .single(),
    supabase
      .from("reservations")
      .select(
        "id,created_at,main_contact_first_name,main_contact_last_name,status,user_shown_price,event_order_info,billed_at"
      )
      .eq("aff_partner_tracking_code", trackingCode)
      .order("created_at", { ascending: false }),
    supabase
      .from("coupons")
      .select("id,is_active,times_used")
      .eq("partner_tracking_code", trackingCode),
    // Aggregated in the DB — see partner_funnel_counts. Selecting the raw rows
    // would pull the partner's whole visit history on every page view.
    supabase.rpc("partner_funnel_counts", { p_tracking_code: trackingCode }),
  ])

  if (partnerResult.error) throw partnerResult.error
  if (reservationsResult.error) throw reservationsResult.error
  if (couponsResult.error) {
    console.error("getPartnerPerformance coupons:", JSON.stringify(couponsResult.error))
  }
  if (trafficResult.error) {
    // Traffic is a nice-to-have; never fail the whole page over it.
    console.error("getPartnerPerformance traffic:", JSON.stringify(trafficResult.error))
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

  // The RPC returns one row per stage with a DISTINCT visitor count, so a
  // person who browsed five events counts once, not five times.
  const stageCounts = new Map<string, number>()
  for (const row of (trafficResult.data ?? []) as { stage: string; visitors: number }[]) {
    stageCounts.set(row.stage, Number(row.visitors) || 0)
  }
  const traffic: PartnerTraffic = trafficResult.error
    ? emptyTraffic()
    : {
        byStage: FUNNEL_STAGES.map((stage) => ({
          stage,
          label: FUNNEL_STAGE_LABELS[stage],
          visitors: stageCounts.get(stage) ?? 0,
        })),
        // Everyone is recorded at VISIT first, so that stage is the total.
        totalVisitors: stageCounts.get("VISIT") ?? 0,
        hasData: stageCounts.size > 0,
      }

  return {
    commissionRate: terms.rate ?? 0,
    commissionType: terms.type ?? "fixed_per_ticket",
    totalReservations: rows.length,
    paidReservations: paid.length,
    paidTickets,
    totalSalesUsd: sumSales(paid),
    commissionUsd: commissionForReservations(paid, terms),
    pendingCommissionUsd: round2(
      commissionForReservations(paid.filter((r) => !r.billed_at), terms)
    ),
    activeCoupons: coupons.filter((c) => c.is_active).length,
    couponUses: coupons.reduce((sum, c) => sum + (c.times_used ?? 0), 0),
    monthly,
    reservations,
    traffic,
  }
}

"use server"

import { requireStaff } from "@/lib/auth/guards"
import { supabase } from "@/lib/supabase-server"
import {
  commissionForReservation,
  countReservationTickets,
  isPaid,
  round2,
  type CommissionTerms,
} from "@/lib/partner-commission"
import {
  CUSTOMER_REFUND_NAME_MARKER,
  type CommissionType,
} from "@/types/partner.types"
import type { ReservationEventOrderInfo } from "@/types/reservation.types"
import type { InsightsRange } from "@/lib/actions/partner-performance-actions"

export interface PartnersOverviewTopPartner {
  code: string
  name: string
  type: "agent" | "affiliate"
  paidReservations: number
  tickets: number
  salesUsd: number
  commissionUsd: number
}

export interface PartnersOverviewMonthlyPoint {
  /** `YYYY-MM`, ascending. */
  month: string
  sales_usd: number
  commission_usd: number
}

export interface PartnersOverview {
  range: InsightsRange
  activeAgents: number
  activeAffiliates: number
  /** Marketing partners with at least one PAID attributed booking in range. */
  producingPartners: number
  totalReservations: number
  paidReservations: number
  paidTickets: number
  totalSalesUsd: number
  totalCommissionUsd: number
  /** Sales minus partner commission — what stays with us BEFORE supplier
   *  costs (ticket/flight/hotel costs are not reliably in the data). */
  netAfterCommissionUsd: number
  couponDiscountUsd: number
  monthly: PartnersOverviewMonthlyPoint[]
  topPartners: PartnersOverviewTopPartner[]
}

type PartnerRow = {
  partner_tracking_code: string
  name_hebrew: string | null
  email: string | null
  type: string | null
  is_active: boolean | null
  commission: number | null
  commission_type: CommissionType | null
}

type ReservationRow = {
  created_at: string
  status: string | null
  user_shown_price: number | null
  event_order_info: ReservationEventOrderInfo | null
  aff_partner_tracking_code: string | null
  coupon_discount_usd: number | null
}

/**
 * Cross-partner rollup for the staff Partners Insights dashboard. Commission
 * math goes through lib/partner-commission per partner's own terms — the same
 * numbers the per-partner view and the partner's portal show.
 */
export async function getPartnersOverview(
  range: InsightsRange = "90d"
): Promise<PartnersOverview> {
  await requireStaff()

  const from = (() => {
    if (range === "all") return null
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
    const d = new Date()
    d.setDate(d.getDate() - days)
    return d.toISOString()
  })()

  let reservationsQuery = supabase
    .from("reservations")
    .select(
      "created_at,status,user_shown_price,event_order_info,aff_partner_tracking_code,coupon_discount_usd"
    )
    .not("aff_partner_tracking_code", "is", null)
    .order("created_at", { ascending: false })
    .limit(5000)
  if (from) reservationsQuery = reservationsQuery.gte("created_at", from)

  const [partnersResult, reservationsResult] = await Promise.all([
    supabase
      .from("partners")
      .select(
        "partner_tracking_code,name_hebrew,email,type,is_active,commission,commission_type"
      )
      // Same server-side customer-refund exclusion as getPartners() — those
      // rows are ~95% of the table and would blow the 1000-row cap.
      .or(`name_hebrew.is.null,name_hebrew.not.ilike.*${CUSTOMER_REFUND_NAME_MARKER}*`)
      .or("type.is.null,type.neq.customer_refund"),
    reservationsQuery,
  ])

  if (partnersResult.error) throw partnersResult.error
  if (reservationsResult.error) throw reservationsResult.error

  const partners = (partnersResult.data ?? []) as unknown as PartnerRow[]
  const partnerByCode = new Map<string, PartnerRow>()
  for (const partner of partners) partnerByCode.set(partner.partner_tracking_code, partner)

  const termsFor = (partner: PartnerRow): CommissionTerms => ({
    type: partner.commission_type ?? "fixed_per_ticket",
    rate: partner.commission ?? 0,
  })

  // Only bookings attributed to a real marketing partner — an unknown or
  // refund-row code is not partner production.
  const rows = ((reservationsResult.data ?? []) as unknown as ReservationRow[]).filter(
    (r) => r.aff_partner_tracking_code && partnerByCode.has(r.aff_partner_tracking_code)
  )
  const paid = rows.filter(isPaid)

  const byPartner = new Map<string, PartnersOverviewTopPartner>()
  const byMonth = new Map<string, PartnersOverviewMonthlyPoint>()
  let totalCommission = 0
  let paidTickets = 0
  let couponDiscount = 0

  for (const r of paid) {
    const code = r.aff_partner_tracking_code as string
    const partner = partnerByCode.get(code) as PartnerRow
    const commission = commissionForReservation(r, termsFor(partner))
    const tickets = countReservationTickets(r)
    const sales = r.user_shown_price ?? 0

    totalCommission += commission
    paidTickets += tickets
    couponDiscount += Number(r.coupon_discount_usd ?? 0)

    const top =
      byPartner.get(code) ??
      {
        code,
        name: partner.name_hebrew || partner.email || code,
        type: partner.type === "agent" ? ("agent" as const) : ("affiliate" as const),
        paidReservations: 0,
        tickets: 0,
        salesUsd: 0,
        commissionUsd: 0,
      }
    top.paidReservations += 1
    top.tickets += tickets
    top.salesUsd += sales
    top.commissionUsd = round2(top.commissionUsd + commission)
    byPartner.set(code, top)

    const month = r.created_at.slice(0, 7)
    const point = byMonth.get(month) ?? { month, sales_usd: 0, commission_usd: 0 }
    point.sales_usd += sales
    point.commission_usd = round2(point.commission_usd + commission)
    byMonth.set(month, point)
  }

  const totalSales = paid.reduce((sum, r) => sum + (r.user_shown_price ?? 0), 0)

  return {
    range,
    activeAgents: partners.filter((p) => p.type === "agent" && p.is_active !== false).length,
    activeAffiliates: partners.filter(
      (p) => p.type !== "agent" && p.is_active !== false
    ).length,
    producingPartners: byPartner.size,
    totalReservations: rows.length,
    paidReservations: paid.length,
    paidTickets,
    totalSalesUsd: totalSales,
    totalCommissionUsd: round2(totalCommission),
    netAfterCommissionUsd: round2(totalSales - totalCommission),
    couponDiscountUsd: round2(couponDiscount),
    monthly: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    topPartners: [...byPartner.values()]
      .sort((a, b) => b.salesUsd - a.salesUsd)
      .slice(0, 10),
  }
}

"use server"

import { requireStaff } from "@/lib/auth/guards"
import { supabase } from "@/lib/supabase-server"
import {
  commissionForReservation,
  countReservationTickets,
  countTickets,
  isPaid,
  round2,
  type CommissionTerms,
} from "@/lib/partner-commission"
import {
  CUSTOMER_REFUND_NAME_MARKER,
  type CommissionType,
} from "@/types/partner.types"
import {
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABELS,
  emptyTraffic,
  type PartnerTraffic,
} from "@/lib/partner-funnel"
import { normalizeReservationEventOrderInfo } from "@/lib/utils"
import type { ReservationEventOrderInfo } from "@/types/reservation.types"
import {
  rangeWindowISO,
  type InsightsRange,
} from "@/lib/actions/partner-performance-actions"

export interface PartnersOverviewTopPartner {
  code: string
  name: string
  type: "agent" | "affiliate"
  paidReservations: number
  tickets: number
  salesUsd: number
  commissionUsd: number
  /** Distinct VISIT visitors in the window; 0 when tracking has none. */
  visitors: number
  /** Paid ÷ visitors; null when no visitors. */
  conversionRate: number | null
}

export interface HotEvent {
  name: string
  date: string | null
  location: string | null
  clicks: number
  visitors: number
  /** Distinct partners whose audiences clicked it. */
  partners: number
  /** A paid partner-attributed booking of it exists in the window. */
  booked: boolean
}

export interface OpenHoldsSummary {
  count: number
  valueUsd: number
  top: { code: string; name: string; count: number; valueUsd: number }[]
}

export interface PackagesSummary {
  created: number
  locked: number
  editable: number
  /** Packages with a later PAID booking of the same event by the same partner —
   *  a match, not proof (links carry no reservation id back). */
  matched: number
  topCreators: { code: string; name: string; count: number }[]
}

export interface PartnersOverviewMonthlyPoint {
  /** `YYYY-MM`, ascending. */
  month: string
  sales_usd: number
  commission_usd: number
}

export interface TopBookedEvent {
  name: string
  date: string | null
  bookings: number
  tickets: number
  salesUsd: number
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
  /** Tickets across ALL orders entered in the window, any status. */
  allTickets: number
  /** Gross volume of ALL orders entered in the window, any status. */
  grossSalesUsd: number
  /** PAID sales only — what the commission/net math runs on. */
  totalSalesUsd: number
  /** Component costs on paid rows: flight price (or inventory cost when
   *  offline), hotel price (or inventory cost), the ticket line, coupons. */
  knownSupplierCostsUsd: number
  /** Paid sales − commission − component costs. Conservative: the ticket
   *  line is SALE price, so our per-ticket sync markup hides inside costs. */
  netAfterCostsUsd: number
  totalCommissionUsd: number
  /** Sales minus partner commission — what stays with us BEFORE supplier
   *  costs (ticket/flight/hotel costs are not reliably in the data). */
  netAfterCommissionUsd: number
  couponDiscountUsd: number
  monthly: PartnersOverviewMonthlyPoint[]
  topPartners: PartnersOverviewTopPartner[]
  /** Funnel across ALL partner traffic in the window. */
  globalFunnel: PartnerTraffic
  /** Paid partner bookings ÷ distinct visitors; null when no visitors. */
  globalConversionRate: number | null
  /** Hot right now: most-clicked events across every partner's audience. */
  hotEvents: HotEvent[]
  /** Top 3 most-BOOKED events (paid) in the window, by tickets. */
  topBookedEvents: TopBookedEvent[]
  /** Live 24h holds (status 24Save within its 25h window) — leads in flight. */
  openHolds: OpenHoldsSummary
  /** Prepared-package links built in the window. */
  packages: PackagesSummary
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
  event_id: number | null
  offline_flight_cost: number | null
  offline_hotel_cost: number | null
  offline_hotel_ids: number[] | null
  /** JSON sub-selects — component prices without dragging the raw offer blobs. */
  flight_price: number | string | null
  flight_offline: boolean | null
  hotel_price: number | string | null
  hotel_offline: boolean | null
}

const HOLD_STATUS = "24Save"
const HOLD_WINDOW_MS = 25 * 60 * 60 * 1000

/**
 * Cross-partner rollup for the staff Partners Insights dashboard. Commission
 * math goes through lib/partner-commission per partner's own terms — the same
 * numbers the per-partner view and the partner's portal show.
 */
export async function getPartnersOverview(
  range: InsightsRange = "90d"
): Promise<PartnersOverview> {
  await requireStaff()

  const { from, to } = await rangeWindowISO(range)

  let reservationsQuery = supabase
    .from("reservations")
    .select(
      "created_at,status,user_shown_price,event_order_info,aff_partner_tracking_code,coupon_discount_usd,event_id,offline_flight_cost,offline_hotel_cost,offline_hotel_ids,flight_price:flight_order_info->price,flight_offline:flight_order_info->isOffline,hotel_price:hotel_order_info->price,hotel_offline:hotel_order_info->isOffline"
    )
    .not("aff_partner_tracking_code", "is", null)
    .order("created_at", { ascending: false })
    .limit(5000)
  if (from) reservationsQuery = reservationsQuery.gte("created_at", from)
  if (to) reservationsQuery = reservationsQuery.lt("created_at", to)

  let packagesQuery = supabase
    .from("prepared_packages")
    .select("partner_tracking_code,event_id,allow_edit,created_at")
    .order("created_at", { ascending: false })
    .limit(2000)
  if (from) packagesQuery = packagesQuery.gte("created_at", from)
  if (to) packagesQuery = packagesQuery.lt("created_at", to)

  const [
    partnersResult,
    reservationsResult,
    funnelResult,
    hotResult,
    visitorsResult,
    holdsResult,
    packagesResult,
  ] = await Promise.all([
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partners_funnel_counts_all", { p_from: from, p_to: to }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partners_clicked_events_all", {
      p_from: from,
      p_to: to,
      p_limit: 12,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partners_visitors_by_code", { p_from: from, p_to: to }),
    // Live leads: 24h holds still inside their real 25h window — always "now",
    // deliberately not range-filtered.
    supabase
      .from("reservations")
      .select("created_at,user_shown_price,aff_partner_tracking_code")
      .eq("status", HOLD_STATUS)
      .not("aff_partner_tracking_code", "is", null)
      .gte("created_at", new Date(Date.now() - HOLD_WINDOW_MS).toISOString()),
    packagesQuery,
  ])

  if (partnersResult.error) throw partnersResult.error
  if (reservationsResult.error) throw reservationsResult.error
  // The tracking/holds/packages blocks are nice-to-have — log and degrade,
  // never fail the whole tab over one of them.
  for (const [label, result] of [
    ["funnel", funnelResult],
    ["hot", hotResult],
    ["visitors", visitorsResult],
    ["holds", holdsResult],
    ["packages", packagesResult],
  ] as const) {
    if (result.error) {
      console.error(`getPartnersOverview ${label}:`, JSON.stringify(result.error))
    }
  }

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
        // Filled from partners_visitors_by_code just before returning.
        visitors: 0,
        conversionRate: null,
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
  const grossSales = rows.reduce((sum, r) => sum + (r.user_shown_price ?? 0), 0)
  const allTickets = countTickets(rows)

  // Costs on PAID rows, per Dor's model: every reservation carries its
  // component prices — flight (Amadeus price, or our inventory cost when
  // offline), hotel (Ratehawk price / inventory cost), tickets (the package's
  // ticket line — sale price incl. the per-ticket sync markup, so this net is
  // conservative), plus coupon discounts. Commission is subtracted separately.
  let knownSupplierCosts = 0
  const topBooked = new Map<string, TopBookedEvent>()
  for (const r of paid) {
    const tickets = countReservationTickets(r)
    if (r.flight_offline === true && r.offline_flight_cost != null) {
      knownSupplierCosts += Number(r.offline_flight_cost) * Math.max(1, tickets)
    } else if (r.flight_price != null && Number.isFinite(Number(r.flight_price))) {
      knownSupplierCosts += Number(r.flight_price)
    }
    if (r.hotel_offline === true && r.offline_hotel_cost != null) {
      const rooms = Math.max(1, r.offline_hotel_ids?.length ?? 1)
      knownSupplierCosts += Number(r.offline_hotel_cost) * rooms
    } else if (r.hotel_price != null && Number.isFinite(Number(r.hotel_price))) {
      knownSupplierCosts += Number(r.hotel_price)
    }
    knownSupplierCosts += Number(r.coupon_discount_usd ?? 0)
    for (const item of normalizeReservationEventOrderInfo(r.event_order_info)) {
      knownSupplierCosts += Number(item?.total_tickets_price ?? 0)
    }

    for (const item of normalizeReservationEventOrderInfo(r.event_order_info)) {
      if (!item?.name) continue
      const date =
        typeof item.date === "string" ? item.date : item.date ? String(item.date) : null
      const key = `${item.name.trim().toLowerCase()}|${date ?? ""}`
      const entry =
        topBooked.get(key) ??
        { name: item.name, date, bookings: 0, tickets: 0, salesUsd: 0 }
      entry.bookings += 1
      entry.tickets += item.number_of_ticket ?? 0
      entry.salesUsd += item.total_tickets_price ?? 0
      topBooked.set(key, entry)
    }
  }
  const topBookedEvents = [...topBooked.values()]
    .sort((a, b) => b.tickets - a.tickets || b.bookings - a.bookings)
    .slice(0, 3)

  // ---- Global funnel + per-partner visitors → conversion ----
  const stageCounts = new Map<string, number>()
  for (const row of (funnelResult.data ?? []) as { stage: string; visitors: number }[]) {
    stageCounts.set(row.stage, Number(row.visitors) || 0)
  }
  const globalFunnel: PartnerTraffic = funnelResult.error
    ? emptyTraffic()
    : {
        byStage: FUNNEL_STAGES.map((stage) => ({
          stage,
          label: FUNNEL_STAGE_LABELS[stage],
          visitors: stageCounts.get(stage) ?? 0,
        })),
        totalVisitors: stageCounts.get("VISIT") ?? 0,
        hasData: stageCounts.size > 0,
      }

  const visitorsByCode = new Map<string, number>()
  for (const row of (visitorsResult.data ?? []) as {
    affiliate_id: string
    visitors: number
  }[]) {
    visitorsByCode.set(row.affiliate_id, Number(row.visitors) || 0)
  }

  // ---- Hot events across every partner's audience ----
  const bookedNames = new Set(
    paid
      .flatMap((r) => normalizeReservationEventOrderInfo(r.event_order_info))
      .map((event) => event?.name)
      .filter((name): name is string => !!name)
      .map((name) => name.trim().toLowerCase())
  )
  const hotEvents: HotEvent[] = (
    (hotResult.data ?? []) as {
      event_name: string | null
      event_date: string | null
      event_location: string | null
      clicks: number | null
      visitors: number | null
      partners: number | null
    }[]
  )
    .filter((row) => !!row.event_name)
    .map((row) => ({
      name: row.event_name as string,
      date: row.event_date,
      location: row.event_location,
      clicks: Number(row.clicks ?? 0),
      visitors: Number(row.visitors ?? 0),
      partners: Number(row.partners ?? 0),
      booked: bookedNames.has((row.event_name as string).trim().toLowerCase()),
    }))

  // ---- Open holds (live leads) ----
  const holdRows = (holdsResult.data ?? []) as {
    created_at: string
    user_shown_price: number | null
    aff_partner_tracking_code: string | null
  }[]
  const holdsByPartner = new Map<string, { count: number; valueUsd: number }>()
  let holdsValue = 0
  for (const hold of holdRows) {
    const code = hold.aff_partner_tracking_code
    if (!code || !partnerByCode.has(code)) continue
    const value = hold.user_shown_price ?? 0
    holdsValue += value
    const entry = holdsByPartner.get(code) ?? { count: 0, valueUsd: 0 }
    entry.count += 1
    entry.valueUsd += value
    holdsByPartner.set(code, entry)
  }
  const openHolds: OpenHoldsSummary = {
    count: [...holdsByPartner.values()].reduce((sum, h) => sum + h.count, 0),
    valueUsd: round2(holdsValue),
    top: [...holdsByPartner.entries()]
      .map(([code, entry]) => ({
        code,
        name:
          partnerByCode.get(code)?.name_hebrew ||
          partnerByCode.get(code)?.email ||
          code,
        count: entry.count,
        valueUsd: round2(entry.valueUsd),
      }))
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .slice(0, 5),
  }

  // ---- Prepared packages built in the window ----
  const packageRows = (
    (packagesResult.data ?? []) as {
      partner_tracking_code: string
      event_id: number | null
      allow_edit: boolean | null
      created_at: string
    }[]
  ).filter((row) => partnerByCode.has(row.partner_tracking_code))
  const packagesByPartner = new Map<string, number>()
  let matched = 0
  for (const row of packageRows) {
    packagesByPartner.set(
      row.partner_tracking_code,
      (packagesByPartner.get(row.partner_tracking_code) ?? 0) + 1
    )
    // A later PAID booking of the same event by the same partner counts as a
    // match — links carry no reservation id back, so this is signal, not proof.
    if (
      row.event_id != null &&
      paid.some(
        (r) =>
          r.aff_partner_tracking_code === row.partner_tracking_code &&
          r.event_id === row.event_id &&
          r.created_at >= row.created_at
      )
    ) {
      matched += 1
    }
  }
  const packages: PackagesSummary = {
    created: packageRows.length,
    locked: packageRows.filter((row) => row.allow_edit === false).length,
    editable: packageRows.filter((row) => row.allow_edit !== false).length,
    matched,
    topCreators: [...packagesByPartner.entries()]
      .map(([code, count]) => ({
        code,
        name:
          partnerByCode.get(code)?.name_hebrew ||
          partnerByCode.get(code)?.email ||
          code,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  }

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
    allTickets,
    grossSalesUsd: round2(grossSales),
    totalSalesUsd: totalSales,
    knownSupplierCostsUsd: round2(knownSupplierCosts),
    netAfterCostsUsd: round2(totalSales - totalCommission - knownSupplierCosts),
    totalCommissionUsd: round2(totalCommission),
    netAfterCommissionUsd: round2(totalSales - totalCommission),
    couponDiscountUsd: round2(couponDiscount),
    monthly: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    topPartners: [...byPartner.values()]
      .map((top) => {
        const visitors = visitorsByCode.get(top.code) ?? 0
        return {
          ...top,
          visitors,
          conversionRate: visitors > 0 ? top.paidReservations / visitors : null,
        }
      })
      .sort((a, b) => b.salesUsd - a.salesUsd)
      .slice(0, 10),
    globalFunnel,
    globalConversionRate:
      globalFunnel.totalVisitors > 0 ? paid.length / globalFunnel.totalVisitors : null,
    hotEvents,
    topBookedEvents,
    openHolds,
    packages,
  }
}

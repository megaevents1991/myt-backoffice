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
import {
  getReservationEventOrderInfoPrimaryName,
  normalizeReservationEventOrderInfo,
} from "@/lib/utils"
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

/** Time window for the whole performance view. */
export type InsightsRange = "7d" | "30d" | "90d" | "all"

export interface TopCount {
  label: string
  count: number
}

/** What this partner's PAYING customers actually chose — for marketing. */
export interface PartnerMix {
  /** Airlines on paid bookings (display name), most-booked first. */
  airlines: TopCount[]
  offlineFlights: number
  liveFlights: number
  flightSkipped: number
  /** Star levels on paid bookings ("5", "4"… / "לא ידוע"). */
  hotelStars: TopCount[]
  hotelNames: TopCount[]
  meals: TopCount[]
  hotelSkipped: number
  /** Ticket categories weighted by ticket count. */
  ticketCategories: TopCount[]
  /** Average tickets per paid booking. */
  avgPartySize: number
}

export interface PartnerClickedEvent {
  name: string
  date: string | null
  location: string | null
  clicks: number
  visitors: number
  /** Someone who clicked this event went on to a PAID booking of it. */
  booked: boolean
}

export interface PartnerPerformance {
  range: InsightsRange
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
  /** Paid bookings ÷ distinct visitors in the window; null when no visitors. */
  conversionRate: number | null
  /** Sales ÷ paid bookings; null when nothing paid. */
  avgOrderValueUsd: number | null
  monthly: PartnerMonthlyPoint[]
  reservations: PartnerPerformanceReservation[]
  traffic: PartnerTraffic
  clickedEvents: PartnerClickedEvent[]
  mix: PartnerMix
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
  flight_order_info: {
    airline?: string
    metadata?: { name?: string } | string
    isOffline?: boolean
  } | null
  hotel_order_info: {
    name?: string
    isOffline?: boolean
    rate?: { meal?: string; meal_data?: { value?: string } }
    hotelInformation?: { hotelName?: string; stars?: number } | null
  } | null
}

export async function rangeStartISO(range: InsightsRange): Promise<string | null> {
  if (range === "all") return null
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function topCounts(map: Map<string, number>, limit = 6): TopCount[] {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

function bump(map: Map<string, number>, label: string | null | undefined, by = 1) {
  const key = (label ?? "").trim()
  if (!key) return
  map.set(key, (map.get(key) ?? 0) + by)
}

const hasContent = (value: object | null | undefined): boolean =>
  !!value && Object.keys(value).length > 0

/**
 * Staff-side view of what a partner earned — now windowed and with the
 * marketing mix. Deliberately shares `lib/partner-commission` with the partner
 * portal so the number staff sees and the number the partner sees can never
 * drift apart again.
 */
export async function getPartnerPerformance(
  trackingCode: string,
  range: InsightsRange = "all"
): Promise<PartnerPerformance> {
  await requireStaff()

  const from = await rangeStartISO(range)

  let reservationsQuery = supabase
    .from("reservations")
    .select(
      "id,created_at,main_contact_first_name,main_contact_last_name,status,user_shown_price,event_order_info,billed_at,flight_order_info,hotel_order_info"
    )
    .eq("aff_partner_tracking_code", trackingCode)
    .order("created_at", { ascending: false })
  if (from) reservationsQuery = reservationsQuery.gte("created_at", from)

  const [partnerResult, reservationsResult, couponsResult, trafficResult, clicksResult] =
    await Promise.all([
    supabase
      .from("partners")
      .select("commission,commission_type")
      .eq("partner_tracking_code", trackingCode)
      .single(),
    reservationsQuery,
    supabase
      .from("coupons")
      .select("id,is_active,times_used")
      .eq("partner_tracking_code", trackingCode),
    // Aggregated in the DB — see partner_funnel_counts_range. Selecting the
    // raw rows would pull the partner's whole visit history on every view.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partner_funnel_counts_range", {
      p_tracking_code: trackingCode,
      p_from: from,
      p_to: null,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partner_clicked_events_range", {
      p_tracking_code: trackingCode,
      p_from: from,
      p_to: null,
      p_limit: 12,
    }),
  ])

  if (partnerResult.error) throw partnerResult.error
  if (reservationsResult.error) throw reservationsResult.error
  if (couponsResult.error) {
    console.error("getPartnerPerformance coupons:", JSON.stringify(couponsResult.error))
  }

  // The *_range RPCs ship with this feature's migration. Until it lands (or
  // on any transient failure) fall back to the legacy all-time RPC rather
  // than blanking the section — same never-fail-the-page policy as before.
  let trafficData = trafficResult.data as { stage: string; visitors: number }[] | null
  let trafficFailed = !!trafficResult.error
  if (trafficResult.error) {
    console.error("getPartnerPerformance traffic:", JSON.stringify(trafficResult.error))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = await (supabase as any).rpc("partner_funnel_counts", {
      p_tracking_code: trackingCode,
    })
    if (!legacy.error) {
      trafficData = legacy.data as { stage: string; visitors: number }[]
      trafficFailed = false
    }
  }
  if (clicksResult.error) {
    console.error("getPartnerPerformance clicks:", JSON.stringify(clicksResult.error))
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
  for (const row of trafficData ?? []) {
    stageCounts.set(row.stage, Number(row.visitors) || 0)
  }
  const traffic: PartnerTraffic = trafficFailed
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

  // Clicked events — event NAME + DATE + LOCATION level (tracking carries no
  // event id), cross-referenced against every event on every PAID booking so
  // "clicked, never booked" means exactly that.
  const bookedNames = new Set(
    paid
      .flatMap((r) => normalizeReservationEventOrderInfo(r.event_order_info))
      .map((event) => event?.name)
      .filter((name): name is string => !!name)
      .map((name) => name.trim().toLowerCase())
  )
  const clickedEvents: PartnerClickedEvent[] = (
    (clicksResult.data ?? []) as unknown as {
      event_name: string | null
      event_date: string | null
      event_location: string | null
      clicks: number | null
      visitors: number | null
    }[]
  )
    .filter((row) => !!row.event_name)
    .map((row) => ({
      name: row.event_name as string,
      date: row.event_date,
      location: row.event_location,
      clicks: Number(row.clicks ?? 0),
      visitors: Number(row.visitors ?? 0),
      booked: bookedNames.has((row.event_name as string).trim().toLowerCase()),
    }))

  // ---- Marketing mix, over PAID bookings only (money talks) ----
  const airlines = new Map<string, number>()
  const hotelStars = new Map<string, number>()
  const hotelNames = new Map<string, number>()
  const meals = new Map<string, number>()
  const ticketCategories = new Map<string, number>()
  let offlineFlights = 0
  let liveFlights = 0
  let flightSkipped = 0
  let hotelSkipped = 0

  for (const r of paid) {
    const flight = r.flight_order_info
    if (!hasContent(flight)) {
      flightSkipped += 1
    } else {
      // main writes metadata as an Airline object; older rows may carry a
      // string. The two-letter code is the last resort.
      const metaName =
        typeof flight?.metadata === "object" ? flight.metadata?.name : undefined
      bump(airlines, metaName || flight?.airline)
      if (flight?.isOffline) offlineFlights += 1
      else liveFlights += 1
    }

    const hotel = r.hotel_order_info
    if (!hasContent(hotel)) {
      hotelSkipped += 1
    } else {
      const stars = hotel?.hotelInformation?.stars
      bump(hotelStars, stars && stars > 0 ? `${stars}★` : "Unknown")
      bump(hotelNames, hotel?.hotelInformation?.hotelName || hotel?.name)
      bump(meals, hotel?.rate?.meal_data?.value || hotel?.rate?.meal || "nomeal")
    }

    for (const item of normalizeReservationEventOrderInfo(r.event_order_info)) {
      bump(ticketCategories, item?.category, item?.number_of_ticket ?? 1)
    }
  }

  const mix: PartnerMix = {
    airlines: topCounts(airlines),
    offlineFlights,
    liveFlights,
    flightSkipped,
    hotelStars: topCounts(hotelStars),
    hotelNames: topCounts(hotelNames),
    meals: topCounts(meals),
    hotelSkipped,
    ticketCategories: topCounts(ticketCategories),
    avgPartySize: paid.length > 0 ? round2(paidTickets / paid.length) : 0,
  }

  const totalSalesUsd = sumSales(paid)

  return {
    range,
    commissionRate: terms.rate ?? 0,
    commissionType: terms.type ?? "fixed_per_ticket",
    totalReservations: rows.length,
    paidReservations: paid.length,
    paidTickets,
    totalSalesUsd,
    commissionUsd: commissionForReservations(paid, terms),
    pendingCommissionUsd: round2(
      commissionForReservations(paid.filter((r) => !r.billed_at), terms)
    ),
    activeCoupons: coupons.filter((c) => c.is_active).length,
    couponUses: coupons.reduce((sum, c) => sum + (c.times_used ?? 0), 0),
    conversionRate:
      traffic.totalVisitors > 0 ? round2(paid.length / traffic.totalVisitors) : null,
    avgOrderValueUsd: paid.length > 0 ? round2(totalSalesUsd / paid.length) : null,
    monthly,
    reservations,
    traffic,
    clickedEvents,
    mix,
  }
}

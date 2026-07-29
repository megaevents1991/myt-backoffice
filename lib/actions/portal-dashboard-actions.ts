"use server"

import { requirePartner } from "@/lib/auth/guards"
import { supabase } from "@/lib/supabase-server"
import {
  commissionForReservations,
  countTickets,
  describeCommission,
  isPaid,
  round2,
  sumSales,
  type CommissionTerms,
} from "@/lib/partner-commission"
import {
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABELS_HE,
  emptyTraffic,
  type PartnerTraffic,
} from "@/lib/partner-funnel"
import { normalizeReservationEventOrderInfo } from "@/lib/utils"
import type { CommissionType } from "@/types/partner.types"
import type { ReservationEventOrderInfo } from "@/types/reservation.types"

/**
 * Everything the partner dashboard shows, in one round trip.
 *
 * Commission is deliberately split into two figures. The monthly report bills
 * the PREVIOUS calendar month, so a single "this month" number would show a
 * partner a total that is still growing and is not what they are about to be
 * paid — the kind of ambiguity that turns into an argument about money.
 */

export interface PortalCommission {
  /** Ready-to-display rate, e.g. "$25 per ticket". */
  label: string
  /** Earned since 1 January, all paid reservations. */
  yearToDateUsd: number
  /** Accrued in the current calendar month. Not billed yet. */
  thisMonthUsd: number
  /** The previous calendar month — what the monthly report pays out. */
  lastMonthUsd: number
  /** `YYYY-MM` of the month being paid, so the UI can name it. */
  lastMonthKey: string
}

export interface PortalClickedEvent {
  name: string
  date: string | null
  location: string | null
  visitors: number
  clicks: number
  /** True when someone who clicked this event went on to book it. */
  booked: boolean
}

export interface PortalDashboard {
  totalReservations: number
  paidReservations: number
  paidTickets: number
  totalSalesUsd: number
  commission: PortalCommission
  activeCoupons: number
  couponUses: number
  traffic: PartnerTraffic
  clickedEvents: PortalClickedEvent[]
}

type ReservationRow = {
  created_at: string
  status: string | null
  user_shown_price: number | null
  event_order_info: ReservationEventOrderInfo | null
}

/** `YYYY-MM` for a date, in UTC — the same basis the monthly cron groups on. */
function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

export async function getPortalDashboard(): Promise<PortalDashboard> {
  const session = await requirePartner()
  const code = session.partner_code

  const [partnerResult, reservationsResult, couponsResult, funnelResult, clicksResult] =
    await Promise.all([
      supabase
        .from("partners")
        .select("commission,commission_type")
        .eq("partner_tracking_code", code)
        .maybeSingle(),
      supabase
        .from("reservations")
        .select("created_at,status,user_shown_price,event_order_info")
        .eq("aff_partner_tracking_code", code),
      supabase
        .from("coupons")
        .select("is_active,times_used")
        .eq("partner_tracking_code", code),
      supabase.rpc("partner_funnel_counts", { p_tracking_code: code }),
      supabase.rpc("partner_clicked_events", { p_tracking_code: code, p_limit: 8 }),
    ])

  if (partnerResult.error) throw partnerResult.error
  if (reservationsResult.error) throw reservationsResult.error
  // The rest are decoration — never fail the whole dashboard over them.
  if (couponsResult.error) {
    console.error("getPortalDashboard coupons:", JSON.stringify(couponsResult.error))
  }
  if (funnelResult.error) {
    console.error("getPortalDashboard funnel:", JSON.stringify(funnelResult.error))
  }
  if (clicksResult.error) {
    console.error("getPortalDashboard clicks:", JSON.stringify(clicksResult.error))
  }

  const partner = partnerResult.data as {
    commission: number
    commission_type: CommissionType | null
  } | null
  const terms: CommissionTerms = {
    type: partner?.commission_type ?? "fixed_per_ticket",
    rate: partner?.commission ?? 0,
  }

  const rows = (reservationsResult.data ?? []) as unknown as ReservationRow[]
  const paid = rows.filter(isPaid)

  const now = new Date()
  const thisMonth = monthKey(now)
  const lastMonth = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))
  const yearPrefix = String(now.getUTCFullYear())

  const inMonth = (key: string) => paid.filter((r) => r.created_at?.startsWith(key))

  const coupons = (couponsResult.data ?? []) as unknown as {
    is_active: boolean
    times_used: number | null
  }[]

  // Which of the clicked events actually converted, so the dashboard can say
  // "clicked, never booked" — that is the list worth acting on.
  // Every event on the reservation, not just the first — a two-event booking
  // would otherwise mark its second event "never booked", inverting the exact
  // signal this list exists to give.
  const bookedNames = new Set(
    paid
      .flatMap((r) => normalizeReservationEventOrderInfo(r.event_order_info))
      .map((event) => event?.name)
      .filter((name): name is string => !!name)
      .map((name) => name.trim().toLowerCase())
  )

  const clickedEvents: PortalClickedEvent[] = (
    (clicksResult.data ?? []) as unknown as {
      event_name: string | null
      event_date: string | null
      event_location: string | null
      visitors: number | null
      clicks: number | null
    }[]
  )
    .filter((row) => !!row.event_name)
    .map((row) => ({
      name: row.event_name as string,
      date: row.event_date,
      location: row.event_location,
      visitors: Number(row.visitors ?? 0),
      clicks: Number(row.clicks ?? 0),
      booked: bookedNames.has((row.event_name as string).trim().toLowerCase()),
    }))

  const stageCounts = new Map<string, number>()
  for (const row of (funnelResult.data ?? []) as { stage: string; visitors: number }[]) {
    stageCounts.set(row.stage, Number(row.visitors) || 0)
  }
  const traffic: PartnerTraffic = funnelResult.error
    ? emptyTraffic()
    : {
        byStage: FUNNEL_STAGES.map((stage) => ({
          stage,
          label: FUNNEL_STAGE_LABELS_HE[stage],
          visitors: stageCounts.get(stage) ?? 0,
        })),
        totalVisitors: stageCounts.get("VISIT") ?? 0,
        hasData: stageCounts.size > 0,
      }

  return {
    totalReservations: rows.length,
    paidReservations: paid.length,
    paidTickets: countTickets(paid),
    totalSalesUsd: sumSales(paid),
    commission: {
      label: describeCommission(terms),
      yearToDateUsd: round2(
        commissionForReservations(
          paid.filter((r) => r.created_at?.startsWith(yearPrefix)),
          terms
        )
      ),
      thisMonthUsd: round2(commissionForReservations(inMonth(thisMonth), terms)),
      lastMonthUsd: round2(commissionForReservations(inMonth(lastMonth), terms)),
      lastMonthKey: lastMonth,
    },
    activeCoupons: coupons.filter((c) => c.is_active).length,
    couponUses: coupons.reduce((sum, c) => sum + (c.times_used ?? 0), 0),
    traffic,
    clickedEvents,
  }
}


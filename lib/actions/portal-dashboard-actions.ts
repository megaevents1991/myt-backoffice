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
import { buildEntryFunnels, type EntryFunnels } from "@/lib/partner-entry-funnels"
import { fundedCouponCodesFor } from "@/lib/actions/portal-coupon-actions"
import {
  rangeWindowISO,
  type InsightsRange,
} from "@/lib/actions/partner-performance-actions"
import { partnerLink } from "@/lib/site"
import { normalizeReservationEventOrderInfo } from "@/lib/utils"
import type { CommissionType } from "@/types/partner.types"
import type { ReservationEventOrderInfo } from "@/types/reservation.types"

/**
 * Everything the partner dashboard shows, in one round trip.
 *
 * The activity tiles, funnel, entry funnels and clicked events are scoped to
 * the requested time range (the top filter). The commission money tiles are
 * deliberately NOT ranged: pending/billed are read from the same `billed_at`
 * fact the monthly report bills on, and a windowed figure would disagree with
 * the invoice — the kind of ambiguity that turns into an argument about money.
 */

export interface PortalCommission {
  /** Ready-to-display rate, e.g. "$25 per ticket". */
  label: string
  /** Earned since 1 January, all paid reservations. */
  yearToDateUsd: number
  /**
   * Owed but not yet in a monthly report — reservations that are paid and
   * carry no `billed_at`. This is the same fact the report bills on, so the
   * portal and the invoice cannot drift apart.
   */
  pendingUsd: number
  /** Already included in a monthly report. */
  billedUsd: number
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

/** A package that went live on the site in the last 30 days — the "מה חדש"
 *  rail. `href` is the partner's own tracking link to it. */
export interface PortalNewEvent {
  id: number
  name: string
  date: string | null
  location: string | null
  image_url: string | null
  href: string
}

export interface PortalDashboard {
  range: InsightsRange
  totalReservations: number
  paidReservations: number
  paidTickets: number
  totalSalesUsd: number
  commission: PortalCommission
  /** partners.user_discount, formatted for the influencer tile: 1–10 reads as
   *  a percent, anything larger as $ per ticket (the main app's rule). */
  userDiscountLabel: string
  activeCoupons: number
  couponUses: number
  traffic: PartnerTraffic
  /** The three entry-segmented funnels; null when the RPC isn't available. */
  entryFunnels: EntryFunnels | null
  clickedEvents: PortalClickedEvent[]
  newEvents: PortalNewEvent[]
}

type ReservationRow = {
  created_at: string
  status: string | null
  user_shown_price: number | null
  event_order_info: ReservationEventOrderInfo | null
  billed_at: string | null
  coupon_code: string | null
  coupon_discount_usd: number | null
}

/** The main app's affiliate-discount rule: 1–10 is a percent of the package,
 *  anything else (> 0) is absolute USD per ticket. */
function describeUserDiscount(discount: number | null | undefined): string {
  const value = Number(discount ?? 0)
  if (!Number.isFinite(value) || value <= 0) return "לא מוגדרת"
  return value >= 1 && value <= 10 ? `${value}%` : `$${value} לכרטיס`
}

export async function getPortalDashboard(
  range: InsightsRange = "all"
): Promise<PortalDashboard> {
  const session = await requirePartner()
  const code = session.partner_code
  const { from, to } = await rangeWindowISO(range)

  const today = new Date().toISOString().slice(0, 10)
  const newSince = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [
    partnerResult,
    reservationsResult,
    couponsResult,
    funnelResult,
    clicksResult,
    entryResult,
    newEventsResult,
    fundedCodes,
  ] = await Promise.all([
    supabase
      .from("partners")
      .select("commission,commission_type,user_discount")
      .eq("partner_tracking_code", code)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select(
        "created_at,status,user_shown_price,event_order_info,billed_at,coupon_code,coupon_discount_usd"
      )
      .eq("aff_partner_tracking_code", code),
    supabase
      .from("coupons")
      .select("is_active,times_used")
      .eq("partner_tracking_code", code),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partner_funnel_counts_range", {
      p_tracking_code: code,
      p_from: from,
      p_to: to,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partner_clicked_events_range", {
      p_tracking_code: code,
      p_from: from,
      p_to: to,
      p_limit: 8,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("partner_entry_funnels_range", {
      p_tracking_code: code,
      p_from: from,
      p_to: to,
    }),
    supabase
      .from("events")
      .select("id,name,date,location,card_image_url,created_at")
      .is("is_deleted", null)
      .gte("date", today)
      .gte("created_at", newSince)
      .order("created_at", { ascending: false })
      .limit(12),
    fundedCouponCodesFor(code),
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
  if (entryResult.error) {
    console.error("getPortalDashboard entry funnels:", JSON.stringify(entryResult.error))
  }
  if (newEventsResult.error) {
    console.error("getPortalDashboard new events:", JSON.stringify(newEventsResult.error))
  }

  const partner = partnerResult.data as {
    commission: number
    commission_type: CommissionType | null
    user_discount?: number | null
  } | null
  const terms: CommissionTerms = {
    type: partner?.commission_type ?? "fixed_per_ticket",
    rate: partner?.commission ?? 0,
    // Commission-funded coupons deduct their discount from the reservation
    // they were spent on — the same terms the monthly report bills with.
    fundedCouponCodes: fundedCodes,
  }

  const allRows = (reservationsResult.data ?? []) as unknown as ReservationRow[]
  // Money tiles bill on the whole history; the activity tiles follow the
  // selected window. ISO strings compare correctly as strings.
  const rangedRows = allRows.filter(
    (r) =>
      (!from || (r.created_at ?? "") >= from) && (!to || (r.created_at ?? "") < to)
  )
  const paidAll = allRows.filter(isPaid)
  const paidRanged = rangedRows.filter(isPaid)

  const yearPrefix = String(new Date().getUTCFullYear())

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
    paidAll
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

  // Entry-segmented funnels — fold the RPC's (entry, stage, visitors) rows the
  // same way the staff insights tab does.
  let entryFunnels: EntryFunnels | null = null
  if (!entryResult.error) {
    const countsByEntry = new Map<string, Map<string, number>>()
    for (const row of (entryResult.data ?? []) as {
      entry: string
      stage: string
      visitors: number
    }[]) {
      const perStage = countsByEntry.get(row.entry) ?? new Map<string, number>()
      perStage.set(row.stage, Number(row.visitors) || 0)
      countsByEntry.set(row.entry, perStage)
    }
    entryFunnels = buildEntryFunnels(countsByEntry, false)
  }

  const newEvents: PortalNewEvent[] = newEventsResult.error
    ? []
    : (
        (newEventsResult.data ?? []) as unknown as {
          id: number
          name: string
          date: string | null
          location: { name?: string } | null
          card_image_url: string | null
        }[]
      ).map((event) => ({
        id: event.id,
        name: event.name,
        date: event.date,
        location: event.location?.name ?? null,
        image_url: event.card_image_url,
        href: partnerLink(code, event.id),
      }))

  return {
    range,
    totalReservations: rangedRows.length,
    paidReservations: paidRanged.length,
    paidTickets: countTickets(paidRanged),
    totalSalesUsd: sumSales(paidRanged),
    commission: {
      label: describeCommission(terms),
      yearToDateUsd: round2(
        commissionForReservations(
          paidAll.filter((r) => r.created_at?.startsWith(yearPrefix)),
          terms
        )
      ),
      pendingUsd: round2(
        commissionForReservations(
          paidAll.filter((r) => !r.billed_at),
          terms
        )
      ),
      billedUsd: round2(
        commissionForReservations(
          paidAll.filter((r) => !!r.billed_at),
          terms
        )
      ),
    },
    userDiscountLabel: describeUserDiscount(partner?.user_discount),
    activeCoupons: coupons.filter((c) => c.is_active).length,
    couponUses: coupons.reduce((sum, c) => sum + (c.times_used ?? 0), 0),
    traffic,
    entryFunnels,
    clickedEvents,
    newEvents,
  }
}

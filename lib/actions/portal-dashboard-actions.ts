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
import { fundedCouponCodesFor, quoteUpliftsFor } from "@/lib/actions/portal-coupon-actions"
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
  /** Most-picked flight routes / hotels / ticket categories on this partner's
   *  PAID bookings — the per-partner cut of the staff performance view. */
  topPicks: {
    flights: TopPick[]
    hotels: TopPick[]
    tickets: TopPick[]
  }
}

type ReservationRow = {
  created_at: string
  status: string | null
  user_shown_price: number | null
  event_order_info: ReservationEventOrderInfo | null
  flight_order_info?: unknown
  hotel_order_info?: unknown
  quote_id?: number | null
  billed_at: string | null
  coupon_code: string | null
  coupon_discount_usd: number | null
}

/** One "most picked" line: a flight route / hotel / ticket category + count. */
export interface TopPick {
  label: string
  count: number
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
    quoteUplifts,
  ] = await Promise.all([
    supabase
      .from("partners")
      .select("commission,commission_type,user_discount")
      .eq("partner_tracking_code", code)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select(
        "created_at,status,user_shown_price,event_order_info,flight_order_info,hotel_order_info,quote_id,billed_at,coupon_code,coupon_discount_usd"
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
      .select("id,name,date,location,card_image_url,art_image_url,created_at")
      .is("is_deleted", null)
      .gte("date", today)
      .gte("created_at", newSince)
      .order("created_at", { ascending: false })
      .limit(24),
    fundedCouponCodesFor(code),
    quoteUpliftsFor(code),
  ])

  // A thrown error here used to take the WHOLE portal down with a bare
  // "Application error" page. Log loudly and degrade instead — a dashboard of
  // zeros with a working nav beats a dead portal.
  if (partnerResult.error) {
    console.error("getPortalDashboard partner:", JSON.stringify(partnerResult.error))
  }
  if (reservationsResult.error) {
    console.error(
      "getPortalDashboard reservations:",
      JSON.stringify(reservationsResult.error)
    )
  }
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
    // Quote-priced margin belongs to the agent, on top of the base rate.
    quoteUpliftById: quoteUplifts,
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

  // Most-picked picks across PAID bookings. Same permissive JSON reads as the
  // reservations page: provider payloads vary, a missing key just doesn't count.
  const flightCounts = new Map<string, number>()
  const hotelCounts = new Map<string, number>()
  const ticketCounts = new Map<string, number>()
  const bump = (map: Map<string, number>, label: string | null | undefined) => {
    const key = (label ?? "").trim()
    if (key) map.set(key, (map.get(key) ?? 0) + 1)
  }
  for (const row of allRows) {
    if (row.status !== "Paid") continue
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const offer = (row.flight_order_info as any)?.offer
      const segs = offer?.itineraries?.[0]?.segments
      if (Array.isArray(segs) && segs.length > 0) {
        const from = segs[0]?.departure?.iataCode
        const to = segs[segs.length - 1]?.arrival?.iataCode
        bump(flightCounts, from && to ? `${from} → ${to}` : null)
      }
    } catch { /* skip row */ }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hotelInfo = row.hotel_order_info as any
      bump(
        hotelCounts,
        hotelInfo?.hotel?.name ?? hotelInfo?.hotel_name ?? hotelInfo?.name ?? null
      )
    } catch { /* skip row */ }
    const first = normalizeReservationEventOrderInfo(row.event_order_info)[0]
    if (first) {
      bump(
        ticketCounts,
        [first.name, first.category].filter(Boolean).join(" · ") || null
      )
    }
  }
  const topOf = (map: Map<string, number>): TopPick[] =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, count]) => ({ label, count }))

  const newEvents: PortalNewEvent[] = newEventsResult.error
    ? []
    : (
        (newEventsResult.data ?? []) as unknown as {
          id: number
          name: string
          date: string | null
          location: { name?: string } | null
          card_image_url: string | null
          art_image_url: string | null
        }[]
      ).map((event) => ({
        id: event.id,
        name: event.name,
        date: event.date,
        location: event.location?.name ?? null,
        image_url: event.card_image_url ?? event.art_image_url,
        href: partnerLink(code, event.id),
      }))

  // Freshly-synced events usually have no card image yet — borrow the artist
  // template's image (the same blob the site's fallback uses) by name match,
  // so the "מה חדש" rail isn't a wall of grey placeholders (אלון, 2026-08-07).
  if (newEvents.some((event) => !event.image_url)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: artistRows, error: artistsError } = await (supabase as any)
      .from("artists")
      .select("name,name_english,image_url,art_image_url")
      .eq("is_active", true)
      .eq("is_deleted", false)
      .limit(400)
    if (artistsError) {
      console.error("getPortalDashboard artists fallback:", JSON.stringify(artistsError))
    } else {
      const norm = (value: string | null | undefined) =>
        (value ?? "").toLowerCase().replace(/[^a-z0-9֐-׾]+/g, " ").trim()
      const artists = (artistRows ?? []) as {
        name: string | null
        name_english: string | null
        image_url: string | null
        art_image_url: string | null
      }[]
      for (const event of newEvents) {
        if (event.image_url) continue
        const eventName = norm(event.name)
        if (!eventName) continue
        const match = artists.find((artist) => {
          const he = norm(artist.name)
          const en = norm(artist.name_english)
          return (he && eventName.includes(he)) || (en && eventName.includes(en))
        })
        event.image_url = match?.image_url ?? match?.art_image_url ?? null
      }
    }
  }

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
    topPicks: {
      flights: topOf(flightCounts),
      hotels: topOf(hotelCounts),
      tickets: topOf(ticketCounts),
    },
  }
}

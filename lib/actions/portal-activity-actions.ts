"use server"

import { requirePartner } from "@/lib/auth/guards"
import { supabase } from "@/lib/supabase-server"
import { PAID_STATUS } from "@/lib/partner-commission"
import {
  rangeWindowISO,
  type InsightsRange,
} from "@/lib/actions/partner-performance-actions"
import { normalizeReservationEventOrderInfo } from "@/lib/utils"
import type { ReservationEventOrderInfo } from "@/types/reservation.types"

/**
 * Two derived views over data the portal already owns — no new tables:
 *
 * 1. The activity feed (עדכונים): quote created / package link created /
 *    order entered / order paid, folded from quotes, prepared_packages and
 *    reservations.
 * 2. The user search log: every visitor's tracked journey from
 *    affiliates_tracking, grouped per user and folded into one row per
 *    SIMULATION (an event they explored), not one row per click.
 */

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export type PortalActivityType =
  | "quote_created"
  | "package_created"
  | "order_created"
  | "order_paid"

export interface PortalActivityItem {
  type: PortalActivityType
  at: string
  title: string
  subtitle: string | null
}

const FEED_LIMIT = 60

export async function getPortalActivityFeed(): Promise<PortalActivityItem[]> {
  const session = await requirePartner()
  const code = session.partner_code

  const [quotesResult, packagesResult, reservationsResult] = await Promise.all([
    session.role === "agent"
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("quotes")
          .select("id,created_at,customer_name,title")
          .eq("partner_tracking_code", code)
          .order("created_at", { ascending: false })
          .limit(FEED_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("prepared_packages")
      .select("id,created_at,event_order_info")
      .eq("partner_tracking_code", code)
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("reservations")
      .select("id,created_at,status,main_contact_first_name,event_order_info")
      .eq("aff_partner_tracking_code", code)
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
  ])

  for (const [label, result] of [
    ["quotes", quotesResult],
    ["packages", packagesResult],
    ["reservations", reservationsResult],
  ] as const) {
    if (result.error) {
      console.error(`getPortalActivityFeed ${label}:`, JSON.stringify(result.error))
    }
  }

  const items: PortalActivityItem[] = []

  for (const quote of (quotesResult.data ?? []) as {
    id: number
    created_at: string
    customer_name: string | null
    title: string | null
  }[]) {
    items.push({
      type: "quote_created",
      at: quote.created_at,
      title: `הצעת מחיר #${quote.id} נוצרה`,
      subtitle:
        [quote.customer_name, quote.title].filter(Boolean).join(" · ") || null,
    })
  }

  for (const pkg of (packagesResult.data ?? []) as {
    id: number
    created_at: string
    event_order_info: ReservationEventOrderInfo | null
  }[]) {
    const eventName =
      normalizeReservationEventOrderInfo(pkg.event_order_info)[0]?.name ?? null
    items.push({
      type: "package_created",
      at: pkg.created_at,
      title: "לינק חבילה נוצר",
      subtitle: eventName,
    })
  }

  for (const reservation of (reservationsResult.data ?? []) as {
    id: number
    created_at: string
    status: string | null
    main_contact_first_name: string | null
    event_order_info: ReservationEventOrderInfo | null
  }[]) {
    const eventName =
      normalizeReservationEventOrderInfo(reservation.event_order_info)[0]?.name ?? null
    const subtitle =
      [reservation.main_contact_first_name, eventName].filter(Boolean).join(" · ") ||
      null
    // A paid order is worth two beats in the story ("נכנסה" ואז "שולמה"), but
    // reservations carry no payment timestamp — so it appears once, as its
    // strongest state.
    items.push({
      type: reservation.status === PAID_STATUS ? "order_paid" : "order_created",
      at: reservation.created_at,
      title:
        reservation.status === PAID_STATUS
          ? `הזמנה #${reservation.id} שולמה`
          : `הזמנה #${reservation.id} נכנסה`,
      subtitle,
    })
  }

  return items
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, FEED_LIMIT)
}

// ---------------------------------------------------------------------------
// User search log
// ---------------------------------------------------------------------------

/** One simulation — an event a visitor explored, folded to a single row. */
export interface UserSimulation {
  event: string | null
  event_date: string | null
  event_location: string | null
  tickets_type: string | null
  num_tickets: number | null
  /** null = the step never happened; otherwise chosen or skipped. */
  flight: "chosen" | "skipped" | null
  hotel: "chosen" | "skipped" | null
  confirmed: boolean
  last_seen: string
}

export interface UserActivityGroup {
  user_id: string
  last_seen: string
  simulations: UserSimulation[]
}

export interface PortalUserActivity {
  users: UserActivityGroup[]
  /** True when the scan hit its row cap — older activity exists beyond it. */
  truncated: boolean
}

const ACTIVITY_SCAN_LIMIT = 8000
const MAX_USERS = 40

type TrackingRow = {
  user_id: string
  stage: string | null
  created_at: string
  event: string | null
  event_name: string | null
  event_date: string | null
  event_location: string | null
  tickets_type: string | null
  num_tickets: string | null
  flight: string | null
  hotel: string | null
}

/** The tracked stages fold into simulations; VISIT rows only prove presence. */
function foldSimulations(rows: TrackingRow[]): UserSimulation[] {
  const sims: UserSimulation[] = []
  let current: UserSimulation | null = null

  const startNew = (row: TrackingRow, event: string | null): UserSimulation => {
    const sim: UserSimulation = {
      event,
      event_date: null,
      event_location: null,
      tickets_type: null,
      num_tickets: null,
      flight: null,
      hotel: null,
      confirmed: false,
      last_seen: row.created_at,
    }
    sims.push(sim)
    return sim
  }

  for (const row of rows) {
    const stage = row.stage
    if (!stage || stage === "VISIT") continue
    const rowEvent = row.event ?? row.event_name ?? null

    // A different event name means a new simulation — the visitor moved on.
    if (
      current &&
      rowEvent &&
      current.event &&
      rowEvent.trim().toLowerCase() !== current.event.trim().toLowerCase()
    ) {
      current = null
    }
    if (!current) current = startNew(row, rowEvent)
    if (!current.event && rowEvent) current.event = rowEvent
    current.last_seen = row.created_at

    switch (stage) {
      case "EVENT_SELECTED":
        current.event_date = row.event_date ?? current.event_date
        current.event_location = row.event_location ?? current.event_location
        break
      case "TICKET_SELECTED": {
        current.tickets_type = row.tickets_type ?? current.tickets_type
        const parsed = Number(row.num_tickets)
        if (Number.isFinite(parsed) && parsed > 0) current.num_tickets = parsed
        break
      }
      case "FLIGHT_SELECTED":
        // The stage row exists either way; a null payload means "skipped".
        current.flight = row.flight ? "chosen" : "skipped"
        break
      case "HOTEL_SELECTED":
        current.hotel = row.hotel ? "chosen" : "skipped"
        break
      case "CONFIRMED":
        current.confirmed = true
        break
    }
  }
  return sims.reverse() // newest simulation first
}

export async function getPortalUserActivity(
  range: InsightsRange = "30d"
): Promise<PortalUserActivity> {
  const session = await requirePartner()
  const { from, to } = await rangeWindowISO(range)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("affiliates_tracking")
    .select(
      "user_id,stage,created_at," +
        "event:data->data->>event,event_name:data->data->>eventName," +
        "event_date:data->data->>eventDate,event_location:data->data->>eventLocation," +
        "tickets_type:data->data->>ticketsType,num_tickets:data->data->>numOfTicket," +
        "flight:data->data->>flight,hotel:data->data->>hotel"
    )
    .eq("affiliate_id", session.partner_code)
    .order("created_at", { ascending: true })
    .limit(ACTIVITY_SCAN_LIMIT)
  if (from) query = query.gte("created_at", from)
  if (to) query = query.lt("created_at", to)

  const { data, error } = await query
  if (error) {
    console.error("getPortalUserActivity:", JSON.stringify(error))
    return { users: [], truncated: false }
  }

  const rows = (data ?? []) as TrackingRow[]
  const byUser = new Map<string, TrackingRow[]>()
  for (const row of rows) {
    if (!row.user_id) continue
    const list = byUser.get(row.user_id) ?? []
    list.push(row)
    byUser.set(row.user_id, list)
  }

  const users: UserActivityGroup[] = []
  for (const [userId, userRows] of byUser) {
    const simulations = foldSimulations(userRows)
    if (simulations.length === 0) continue
    users.push({
      user_id: userId,
      last_seen: userRows[userRows.length - 1].created_at,
      simulations,
    })
  }
  users.sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1))

  return {
    users: users.slice(0, MAX_USERS),
    truncated: rows.length >= ACTIVITY_SCAN_LIMIT || users.length > MAX_USERS,
  }
}

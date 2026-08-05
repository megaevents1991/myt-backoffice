/**
 * Entry-segmented funnels: the shared classification, aggregation and
 * paid-matching used by BOTH the cross-partner Insights tab and the
 * per-partner performance view. Pure helpers — the server actions run the
 * queries and the entry RPCs mirror this exact logic in SQL.
 */

import {
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABELS,
  type PartnerTraffic,
} from "@/lib/partner-funnel"
import { normalizeReservationEventOrderInfo } from "@/lib/utils"
import type { ReservationEventOrderInfo } from "@/types/reservation.types"

/** Where a visitor's first tracked page in the window was. */
export type EntryKind = "home" | "artist" | "event" | "other"

export interface EntryFunnels {
  home: PartnerTraffic
  artist: PartnerTraffic
  event: PartnerTraffic
  /** Visitors who entered on any other page (category, blog, search…). */
  otherVisitors: number
  /** Users whose CONFIRMED matched a now-Paid reservation of the same partner
   *  + event name within ±30min — a match, not proof (reservations carry no
   *  tracking user id) — split by where they entered. */
  paidByEntry: { home: number; artist: number; event: number }
  /** True while computed from a capped client-side scan (RPC not deployed
   *  yet) — numbers may undercount on long windows. */
  approximate: boolean
}

/** Row cap for the client-side entry-funnel fallback scans. */
export const ENTRY_SCAN_LIMIT = 10000

export const PAID_MATCH_WINDOW_MS = 30 * 60 * 1000

/** One paged row of an entry-funnel fallback scan over affiliates_tracking. */
export type EntryScanRow = {
  id: number | string
  user_id: string
  stage: string | null
  created_at: string
  affiliate_id: string | null
  path: string | null
  /** CONFIRMED rows carry the event under `eventName`… */
  event_name: string | null
  /** …EVENT_SELECTED rows under `event` (+ date and location). */
  event: string | null
  event_date: string | null
  event_location: string | null
}

/** The PostgREST select behind EntryScanRow. */
export const ENTRY_SCAN_SELECT =
  "id,user_id,stage,created_at,affiliate_id,path:data->>path,event_name:data->data->>eventName,event:data->data->>event,event_date:data->data->>eventDate,event_location:data->data->>eventLocation"

/** Mirror of the classification in partners_entry_funnels_all (SQL). A first
 *  row that is not a VISIT means the user surfaced inside the order flow —
 *  order pages fired no VISIT until main's Aug 2026 tracker fix, so that's a
 *  direct event landing. Newer order landings arrive as VISIT + /order path
 *  and classify the same way. */
export function classifyEntry(stage: string | null, path: string | null): EntryKind {
  if (stage !== "VISIT") return "event"
  if (!path || path === "/") return "home"
  if (path.startsWith("/artists") || path.startsWith("/football")) return "artist"
  if (path.startsWith("/order")) return "event"
  return "other"
}

export function trafficFromCounts(
  counts: Map<string, number> | undefined
): PartnerTraffic {
  const byStage = FUNNEL_STAGES.map((stage) => ({
    stage,
    label: FUNNEL_STAGE_LABELS[stage],
    visitors: counts?.get(stage) ?? 0,
  }))
  return {
    byStage,
    totalVisitors: counts?.get("VISIT") ?? 0,
    hasData: byStage.some((s) => s.visitors > 0),
  }
}

export function buildEntryFunnels(
  countsByEntry: Map<string, Map<string, number>>,
  approximate: boolean
): EntryFunnels {
  return {
    home: trafficFromCounts(countsByEntry.get("home")),
    artist: trafficFromCounts(countsByEntry.get("artist")),
    event: trafficFromCounts(countsByEntry.get("event")),
    otherVisitors: countsByEntry.get("other")?.get("VISIT") ?? 0,
    paidByEntry: {
      home: countsByEntry.get("home")?.get("PAID") ?? 0,
      artist: countsByEntry.get("artist")?.get("PAID") ?? 0,
      event: countsByEntry.get("event")?.get("PAID") ?? 0,
    },
    approximate,
  }
}

export interface PaidMatchCandidate {
  code: string
  time: number
  names: Set<string>
}

/** Paid reservations as match candidates for the CONFIRMED → Paid link. */
export function paidCandidatesFrom(
  paid: {
    aff_partner_tracking_code: string | null
    created_at: string
    event_order_info: ReservationEventOrderInfo | null
  }[]
): PaidMatchCandidate[] {
  return paid.map((r) => ({
    code: r.aff_partner_tracking_code ?? "",
    time: new Date(r.created_at).getTime(),
    names: new Set(
      normalizeReservationEventOrderInfo(r.event_order_info)
        .map((item) => item?.name?.trim().toLowerCase())
        .filter((name): name is string => !!name)
    ),
  }))
}

/** Mirror of the RPCs' paid_users match: a CONFIRMED row against a now-Paid
 *  reservation of the same partner + event name within ±30min. */
export function matchPaidUsers(
  rows: Pick<EntryScanRow, "user_id" | "stage" | "created_at" | "affiliate_id" | "event_name">[],
  candidates: PaidMatchCandidate[]
): Set<string> {
  const paidUsers = new Set<string>()
  for (const row of rows) {
    if (row.stage !== "CONFIRMED" || !row.event_name || paidUsers.has(row.user_id))
      continue
    const name = row.event_name.trim().toLowerCase()
    const time = new Date(row.created_at).getTime()
    if (
      candidates.some(
        (r) =>
          r.code === row.affiliate_id &&
          Math.abs(r.time - time) <= PAID_MATCH_WINDOW_MS &&
          r.names.has(name)
      )
    ) {
      paidUsers.add(row.user_id)
    }
  }
  return paidUsers
}

/** The scan-side aggregation the entry RPCs perform in SQL: entry = first row
 *  per user, every non-VISIT stage counted once per user, VISIT = every
 *  classified user, PAID = matched users. */
export function entryCountsFromRows(
  rows: Pick<EntryScanRow, "user_id" | "stage" | "path">[],
  paidUsers: Set<string>
): Map<string, Map<string, number>> {
  const countsByEntry = new Map<string, Map<string, number>>()
  const entryByUser = new Map<string, EntryKind>()
  const stagesByUser = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!entryByUser.has(row.user_id)) {
      entryByUser.set(row.user_id, classifyEntry(row.stage, row.path))
    }
    if (row.stage && row.stage !== "VISIT") {
      const set = stagesByUser.get(row.user_id) ?? new Set<string>()
      set.add(row.stage)
      stagesByUser.set(row.user_id, set)
    }
  }
  for (const [userId, entry] of entryByUser) {
    const perStage = countsByEntry.get(entry) ?? new Map<string, number>()
    perStage.set("VISIT", (perStage.get("VISIT") ?? 0) + 1)
    for (const stage of stagesByUser.get(userId) ?? []) {
      perStage.set(stage, (perStage.get(stage) ?? 0) + 1)
    }
    if (paidUsers.has(userId)) {
      perStage.set("PAID", (perStage.get("PAID") ?? 0) + 1)
    }
    countsByEntry.set(entry, perStage)
  }
  return countsByEntry
}

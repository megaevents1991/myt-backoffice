/**
 * The booking funnel the main app records in `affiliates_tracking`.
 *
 * Deliberately NOT in a "use server" module: those may only export async
 * functions, so the stage list and labels live here and the server action
 * imports them.
 */

/** In order. Matches `AffiliateTracking["stage"]` in types/app.types.ts. */
export const FUNNEL_STAGES = [
  "VISIT",
  "EVENT_SELECTED",
  "TICKET_SELECTED",
  "FLIGHT_SELECTED",
  "HOTEL_SELECTED",
  "CONFIRMED",
] as const

export type FunnelStage = (typeof FUNNEL_STAGES)[number]

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  VISIT: "Visited",
  EVENT_SELECTED: "Picked an event",
  TICKET_SELECTED: "Picked tickets",
  FLIGHT_SELECTED: "Picked a flight",
  HOTEL_SELECTED: "Picked a hotel",
  CONFIRMED: "Confirmed",
}

export interface PartnerTraffic {
  /**
   * Distinct visitors who reached each stage at least once. A visitor who
   * confirms is counted in every stage they passed through, so the list reads
   * as a funnel rather than a breakdown.
   */
  byStage: { stage: FunnelStage; label: string; visitors: number }[]
  totalVisitors: number
  /** False when the main app has never recorded anything for this partner. */
  hasData: boolean
}

export function emptyTraffic(): PartnerTraffic {
  return {
    byStage: FUNNEL_STAGES.map((stage) => ({
      stage,
      label: FUNNEL_STAGE_LABELS[stage],
      visitors: 0,
    })),
    totalVisitors: 0,
    hasData: false,
  }
}

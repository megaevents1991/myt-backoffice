/**
 * Where an order came from (spec 2026-10-14 section 3) - ONE rule for the Executive funnel and
 * the Traffic tab's order counts. Pure; scripts/marketing-funnel-selftest.ts.
 *
 * The last paid touch first (`paidTouchOf`, the P&L's own rule, so an order the Media tab credits
 * to Meta is a Meta order here too), then a partner (the booking carries a partner code, or the
 * credited touch is an influencer's), then any other captured UTM touch, else no UTM at all.
 */
import { paidTouchOf, type AttributionLookups, type UtmTouchLike } from "@/lib/services/marketing-attribution";

export const ORDER_SOURCES = ["meta", "google", "partners", "no_utm", "other"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export type SourceFilter = "all" | OrderSource;
export const SOURCE_FILTERS: readonly SourceFilter[] = ["all", ...ORDER_SOURCES];

export const SOURCE_LABEL: Record<SourceFilter, string> = {
  all: "All sources",
  meta: "Meta",
  google: "Google Ads",
  partners: "Partners",
  no_utm: "No UTM",
  other: "Other",
};

export function parseSource(v: string | null | undefined): SourceFilter {
  return (SOURCE_FILTERS as readonly string[]).includes(v ?? "") ? (v as SourceFilter) : "all";
}

/** Resolution to a campaign does not matter here - only which platform the paid touch is on. */
const NO_LOOKUPS: AttributionLookups = { metaAdCampaign: () => null, gclidCampaign: () => null };

export function orderSourceOf(o: { touches: UtmTouchLike[]; partnerCode: string | null }): OrderSource {
  const paid = paidTouchOf(o.touches, NO_LOOKUPS);
  if (paid) return paid.platform;
  if (o.partnerCode?.trim()) return "partners";
  const credited = [...o.touches].sort((a, b) => a.position - b.position)[0];
  if (credited?.is_influencer) return "partners";
  return o.touches.length > 0 ? "other" : "no_utm";
}

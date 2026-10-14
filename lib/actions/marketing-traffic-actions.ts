"use server";

import { unstable_cache } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { mdb } from "@/lib/services/marketing-db";
import { ga4BatchReports, ga4Configured } from "@/lib/services/ga4";
import { funnelOrders } from "@/lib/services/marketing-funnel";
import { MARKETING_TAG, MARKETING_TTL_S } from "@/lib/services/marketing-cache";
import { daysBetween, resolveWindow } from "@/lib/marketing/range";
import { parseSource, type SourceFilter } from "@/lib/marketing/order-source";
import { buildTraffic, TRAFFIC_EVENTS, type TrafficView } from "@/lib/marketing/traffic";
import type { MarketingQuery } from "@/lib/actions/marketing-actions";

/**
 * The Traffic tab in ONE action (spec 2026-10-14 section 7): two GA4 reports in one batch + our orders of the same
 * window + the partner codes that name a source. Cached 10 minutes per (window, source). GA4 not configured ->
 * `{ connected: false }` (the tab says which two variables); any other failure THROWS like every marketing read.
 */

async function partnerCodes(): Promise<string[]> {
  const { data, error } = await mdb.from("partners").select("partner_tracking_code").not("partner_tracking_code", "is", null).limit(5000);
  if (error) throw new Error(`partners read: ${error.message}`);
  return ((data ?? []) as { partner_tracking_code: string | null }[]).map((p) => (p.partner_tracking_code ?? "").trim().toLowerCase()).filter(Boolean);
}

async function buildTrafficFor(since: string, until: string, src: SourceFilter): Promise<TrafficView & { since: string; until: string }> {
  const dateRanges = [{ startDate: since, endDate: until }];
  const [[reports, codes], orders] = await Promise.all([
    Promise.all([
      ga4BatchReports([
        {
          dateRanges,
          dimensions: [{ name: "date" }, { name: "sessionSource" }, { name: "sessionMedium" }],
          metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagedSessions" }],
        },
        {
          dateRanges,
          dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }, { name: "landingPage" }, { name: "eventName" }],
          metrics: [{ name: "sessions" }],
          dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: [...TRAFFIC_EVENTS] } } },
        },
      ]),
      partnerCodes(),
    ]),
    funnelOrders(since, until),
  ]);
  const [a, b] = reports;
  const view = buildTraffic({
    daily: a.map((r) => ({ date: r.dims[0], source: r.dims[1], medium: r.dims[2], sessions: r.mets[0], users: r.mets[1], engaged: r.mets[2] })),
    steps: b.map((r) => ({ source: r.dims[0], medium: r.dims[1], landingPage: r.dims[2], eventName: r.dims[3], sessions: r.mets[0] })),
    partnerCodes: new Set(codes),
    src,
    orders,
    days: daysBetween(since, until),
  });
  return { ...view, since, until };
}

const cachedTraffic = unstable_cache(buildTrafficFor, ["marketing-traffic"], { tags: [MARKETING_TAG.traffic], revalidate: MARKETING_TTL_S.traffic });

export async function getTraffic(q: MarketingQuery): Promise<{ connected: false } | ({ connected: true } & TrafficView & { since: string; until: string })> {
  await requireAdmin();
  if (!ga4Configured()) return { connected: false };
  const window = resolveWindow(q);
  return { connected: true, ...(await cachedTraffic(window.since, window.until, parseSource(q.src))) };
}

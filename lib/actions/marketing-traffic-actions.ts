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
 * The Traffic tab in ONE action (spec 2026-10-14 section 7): four GA4 reports in one batch + our orders of the same
 * window + the partner codes that name a source. Cached 10 minutes per (window, source). GA4 not configured ->
 * `{ connected: false }`; a GA4 failure -> `{ connected: true, error }` shown in the tab (spec: "a GA4 error -> the
 * error inline") - thrown, Next would replace the message with its generic one in production.
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
        // A: sessions per day per source. No users: a user back on five days is in five date rows.
        {
          dateRanges,
          dimensions: [{ name: "date" }, { name: "sessionSource" }, { name: "sessionMedium" }],
          metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
        },
        // B: the funnel steps per landing page and source.
        {
          dateRanges,
          dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }, { name: "landingPage" }, { name: "eventName" }],
          metrics: [{ name: "sessions" }],
          dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: [...TRAFFIC_EVENTS] } } },
        },
        // C: users per source over the whole period; D: unique users of the period.
        { dateRanges, dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }], metrics: [{ name: "totalUsers" }] },
        { dateRanges, metrics: [{ name: "totalUsers" }] },
      ]),
      partnerCodes(),
    ]),
    funnelOrders(since, until),
  ]);
  const [a, b, c, d] = reports;
  const view = buildTraffic({
    daily: a.map((r) => ({ date: r.dims[0], source: r.dims[1], medium: r.dims[2], sessions: r.mets[0], engaged: r.mets[1] })),
    sourceUsers: c.map((r) => ({ source: r.dims[0], medium: r.dims[1], users: r.mets[0] })),
    totalUsers: d[0]?.mets[0] ?? 0,
    steps: b.map((r) => ({ source: r.dims[0], medium: r.dims[1], landingPage: r.dims[2], eventName: r.dims[3], sessions: r.mets[0] })),
    partnerCodes: new Set(codes),
    src,
    orders,
    days: daysBetween(since, until),
  });
  return { ...view, since, until };
}

const cachedTraffic = unstable_cache(buildTrafficFor, ["marketing-traffic-v2"], { tags: [MARKETING_TAG.traffic], revalidate: MARKETING_TTL_S.traffic });

type TrafficResult =
  | { connected: false }
  | { connected: true; error: string }
  | ({ connected: true; error?: undefined } & TrafficView & { since: string; until: string });

export async function getTraffic(q: MarketingQuery): Promise<TrafficResult> {
  await requireAdmin();
  if (!ga4Configured()) return { connected: false };
  const window = resolveWindow(q);
  try {
    return { connected: true, ...(await cachedTraffic(window.since, window.until, parseSource(q.src))) };
  } catch (e) {
    console.error("[marketing] traffic:", e);
    return { connected: true, error: e instanceof Error ? e.message : String(e) };
  }
}

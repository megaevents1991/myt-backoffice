"use server";

import { unstable_cache } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { mdb } from "@/lib/services/marketing-db";
import { fetchPaged } from "@/lib/supabase-paged";
import { readTouches } from "@/lib/services/marketing-purchases";
import { ga4BatchReports, ga4Configured } from "@/lib/services/ga4";
import { MARKETING_TAG, MARKETING_TTL_S } from "@/lib/services/marketing-cache";
import { addDays, resolveWindow, israelDayStartUtc } from "@/lib/marketing/range";
import { orderSourceOf, parseSource, type SourceFilter } from "@/lib/marketing/order-source";
import { buildGa4Lag, buildTimeLag, type Ga4LagView, type LagOrder, type TimeLagView } from "@/lib/marketing/time-to-purchase";
import type { MarketingQuery } from "@/lib/actions/marketing-actions";

/**
 * The "Time to purchase" tab in ONE action (2026-10-21, lib/marketing/time-to-purchase.ts): our Paid orders of the
 * window with the earliest dated touch of each (hours, by source, under the source filter) beside GA4's purchase
 * events by days since the user's first session (every buyer, no filter). The two halves are cached apart - 10
 * minutes each - so a GA4 failure is shown inline under our half, never cached, never hides it.
 */

/** Paid orders read per window. Past it the read throws - a report missing orders is worse than none. */
const ORDERS_MAX = 20_000;

type OrderRow = { id: number; created_at: string; aff_partner_tracking_code: string | null };

async function lagOrders(since: string, until: string): Promise<LagOrder[]> {
  const { rows, truncated, error } = await fetchPaged<OrderRow>(
    () => mdb.from("reservations").select("id, created_at, aff_partner_tracking_code").eq("status", "Paid").is("is_deleted", null).gte("created_at", israelDayStartUtc(since)).lt("created_at", israelDayStartUtc(addDays(until, 1))).order("id"),
    ORDERS_MAX,
  );
  if (error) throw new Error(`reservations read: ${error.message}`);
  if (truncated) throw new Error(`reservations read: more than ${ORDERS_MAX} Paid orders in ${since}..${until} - narrow the range`);
  const touches = await readTouches(rows.map((r) => r.id));
  return rows.map((r) => {
    const list = touches.get(r.id) ?? [];
    const dated = list.map((t) => (t.visited_at ? Date.parse(t.visited_at) : NaN)).filter((n) => Number.isFinite(n));
    return {
      id: r.id,
      createdAt: r.created_at,
      source: orderSourceOf({ touches: list, partnerCode: r.aff_partner_tracking_code }),
      firstVisitAt: dated.length ? new Date(Math.min(...dated)).toISOString() : null,
    };
  });
}

async function buildOursFor(since: string, until: string, src: SourceFilter): Promise<TimeLagView> {
  return buildTimeLag(await lagOrders(since, until), src);
}

/** One GA4 report: purchase events by their day and the buyer's first-session day. Throws on a GA4 failure (so it is never cached). */
async function buildGa4For(since: string, until: string): Promise<Ga4LagView> {
  const [rows] = await ga4BatchReports([
    {
      dateRanges: [{ startDate: since, endDate: until }],
      dimensions: [{ name: "date" }, { name: "firstSessionDate" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "purchase", matchType: "EXACT" } } },
    },
  ]);
  return buildGa4Lag(rows.map((r) => ({ date: r.dims[0], firstSessionDate: r.dims[1], purchases: r.mets[0] })));
}

const cachedOurs = unstable_cache(buildOursFor, ["marketing-timelag-ours-v1"], { tags: [MARKETING_TAG.timelag], revalidate: MARKETING_TTL_S.timelag });
const cachedGa4 = unstable_cache(buildGa4For, ["marketing-timelag-ga4-v1"], { tags: [MARKETING_TAG.timelag], revalidate: MARKETING_TTL_S.timelag });

export type Ga4LagPart = { connected: false } | { connected: true; error: string } | ({ connected: true; error?: undefined } & Ga4LagView);

export interface TimeToPurchaseResult {
  ours: TimeLagView;
  ga4: Ga4LagPart;
  since: string;
  until: string;
}

export async function getTimeToPurchase(q: MarketingQuery): Promise<TimeToPurchaseResult> {
  await requireAdmin();
  const window = resolveWindow(q);
  const ga4 = async (): Promise<Ga4LagPart> => {
    if (!ga4Configured()) return { connected: false };
    try {
      return { connected: true, ...(await cachedGa4(window.since, window.until)) };
    } catch (e) {
      console.error("[marketing] time to purchase, GA4:", e);
      return { connected: true, error: e instanceof Error ? e.message : String(e) };
    }
  };
  const [ours, ga4Part] = await Promise.all([cachedOurs(window.since, window.until, parseSource(q.src)), ga4()]);
  return { ours, ga4: ga4Part, since: window.since, until: window.until };
}

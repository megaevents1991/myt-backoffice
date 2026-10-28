/**
 * The Influencers tab (spec 2026-10-28 section 3): every affiliate partner's traffic and sales in the period, against
 * the previous period of the same length, plus the top seller / top traffic maker the Executive tab shows. Pure;
 * scripts/marketing-sales-selftest.ts.
 *
 * The numbers are the Partners screen's: visitors = distinct users its links brought (`affiliates_tracking` VISIT,
 * `partners_visitors_by_code`), orders = bookings carrying its code (`aff_partner_tracking_code`), commission = its
 * own terms (`commissionForReservation`). Codes are matched case-insensitively.
 */
import { trendOf, type Trend } from "@/lib/marketing/sales";
import { influencerFlag, type PerfFlag } from "@/lib/marketing/perf-alerts";
import type { MarketingSettings } from "@/types/marketing.types";

export interface InfluencerPartner {
  code: string;
  name: string;
  active: boolean;
}

/** One booking with an influencer's code. Money is in the screen's currency; `revenue` / `commission` are 0 unless Paid. */
export interface InfluencerOrder {
  code: string;
  current: boolean;
  paid: boolean;
  tickets: number;
  revenue: number;
  commission: number;
}

export interface InfluencerRow {
  code: string;
  name: string;
  active: boolean;
  visitors: number;
  prevVisitors: number;
  /** Every booking with the code, any status. */
  leads: number;
  paid: number;
  prevPaid: number;
  tickets: number;
  revenue: number;
  prevRevenue: number;
  commission: number;
  /** Paid / visitors in %, null with no visitors. */
  conversion: number | null;
  flag: PerfFlag | null;
  /** On Paid orders. */
  trend: Trend;
  visitorsTrend: Trend;
}

export interface InfluencersView {
  rows: InfluencerRow[];
  totals: { visitors: number; prevVisitors: number; leads: number; paid: number; prevPaid: number; tickets: number; revenue: number; prevRevenue: number; commission: number; conversion: number | null };
  /** Most revenue (then Paid orders). Null when nobody sold. */
  topSeller: InfluencerRow | null;
  /** Most visitors. Null when nobody brought any. */
  topTraffic: InfluencerRow | null;
  /** Highest Paid / visitors among those with enough visitors to be judged (`influencer_min_visitors`). */
  bestConversion: InfluencerRow | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const conv = (paid: number, visitors: number) => (visitors > 0 ? Math.round((paid / visitors) * 10_000) / 100 : null);
const keyOf = (code: string) => code.trim().toLowerCase();

export function buildInfluencers(input: {
  partners: InfluencerPartner[];
  visitors: Map<string, number>;
  prevVisitors: Map<string, number>;
  orders: InfluencerOrder[];
  settings: Pick<MarketingSettings, "influencer_min_visitors" | "influencer_hot_orders">;
}): InfluencersView {
  const lower = (m: Map<string, number>) => {
    const out = new Map<string, number>();
    for (const [k, v] of m) out.set(keyOf(k), (out.get(keyOf(k)) ?? 0) + v);
    return out;
  };
  const visitors = lower(input.visitors);
  const prevVisitors = lower(input.prevVisitors);

  const rows = new Map<string, InfluencerRow>();
  for (const p of input.partners) {
    const k = keyOf(p.code);
    if (!k || rows.has(k)) continue;
    rows.set(k, {
      code: p.code,
      name: p.name,
      active: p.active,
      visitors: visitors.get(k) ?? 0,
      prevVisitors: prevVisitors.get(k) ?? 0,
      leads: 0,
      paid: 0,
      prevPaid: 0,
      tickets: 0,
      revenue: 0,
      prevRevenue: 0,
      commission: 0,
      conversion: null,
      flag: null,
      trend: { dir: "none", change: null },
      visitorsTrend: { dir: "none", change: null },
    });
  }
  for (const o of input.orders) {
    const row = rows.get(keyOf(o.code));
    if (!row) continue;
    if (o.current) {
      row.leads += 1;
      if (o.paid) {
        row.paid += 1;
        row.tickets += o.tickets;
        row.revenue += o.revenue;
        row.commission += o.commission;
      }
    } else if (o.paid) {
      row.prevPaid += 1;
      row.prevRevenue += o.revenue;
    }
  }

  const list = [...rows.values()]
    .map((r) => ({
      ...r,
      revenue: r2(r.revenue),
      prevRevenue: r2(r.prevRevenue),
      commission: r2(r.commission),
      conversion: conv(r.paid, r.visitors),
      flag: influencerFlag(r, input.settings),
      trend: trendOf(r.paid, r.prevPaid),
      visitorsTrend: trendOf(r.visitors, r.prevVisitors),
    }))
    // An influencer with nothing in either period is noise in the table (21 affiliates, 7 active on 28.10).
    .filter((r) => r.visitors > 0 || r.prevVisitors > 0 || r.leads > 0 || r.prevPaid > 0)
    .sort((a, b) => b.revenue - a.revenue || b.paid - a.paid || b.visitors - a.visitors || a.code.localeCompare(b.code));

  const sum = (k: "visitors" | "prevVisitors" | "leads" | "paid" | "prevPaid" | "tickets" | "revenue" | "prevRevenue" | "commission") => list.reduce((a, r) => a + r[k], 0);
  const totals = {
    visitors: sum("visitors"),
    prevVisitors: sum("prevVisitors"),
    leads: sum("leads"),
    paid: sum("paid"),
    prevPaid: sum("prevPaid"),
    tickets: sum("tickets"),
    revenue: r2(sum("revenue")),
    prevRevenue: r2(sum("prevRevenue")),
    commission: r2(sum("commission")),
    conversion: conv(sum("paid"), sum("visitors")),
  };

  const sellers = list.filter((r) => r.paid > 0);
  const traffic = [...list].filter((r) => r.visitors > 0).sort((a, b) => b.visitors - a.visitors || b.paid - a.paid);
  const judged = list
    .filter((r) => r.visitors >= input.settings.influencer_min_visitors && r.paid > 0)
    .sort((a, b) => (b.conversion ?? 0) - (a.conversion ?? 0) || b.paid - a.paid);

  return { rows: list, totals, topSeller: sellers[0] ?? null, topTraffic: traffic[0] ?? null, bestConversion: judged[0] ?? null };
}

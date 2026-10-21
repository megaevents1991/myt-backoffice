/**
 * Time to purchase (2026-10-21, Tom's "דוח הזמן מהכניסה לאתר ועד לרכישה"): how long a buyer takes from the first
 * visit to the order. Two bases, printed side by side and never summed:
 *
 *  - OURS, in hours: a Paid order's `created_at` minus the EARLIEST `visited_at` among its `utm_touches` (main's
 *    `myt_utm` cookie keeps the newest 5 touches for 90 days; a touch exists only for a visit that carried a UTM,
 *    a gclid or an fbclid). An order with no dated touch - direct, organic, a partner booking typed by an agent -
 *    is "unmeasured" and counted, never guessed. Split by the order's source (`orderSourceOf`, the Executive
 *    funnel's rule); "No UTM" orders are unmeasured by definition.
 *  - GA4, in days: purchase events by `date` minus the user's `firstSessionDate` - every buyer, whatever brought
 *    them, by GA4's cookie (a new device or cleared cookies = a new user), day granularity.
 *
 * Pure; scripts/marketing-time-lag-selftest.ts.
 */
import { ORDER_SOURCES, type OrderSource, type SourceFilter } from "@/lib/marketing/order-source";

export interface LagOrder {
  id: number;
  /** ISO instant the order was created. */
  createdAt: string;
  source: OrderSource;
  /** ISO instant of the earliest dated touch; null = unmeasured. */
  firstVisitAt: string | null;
}

export const LAG_BUCKETS = [
  { key: "h1", label: "Under 1 hour", maxHours: 1 },
  { key: "h24", label: "1-24 hours", maxHours: 24 },
  { key: "d3", label: "1-3 days", maxHours: 72 },
  { key: "d7", label: "3-7 days", maxHours: 168 },
  { key: "d30", label: "7-30 days", maxHours: 720 },
  { key: "more", label: "Over 30 days", maxHours: Infinity },
] as const;
export type LagBucketKey = (typeof LAG_BUCKETS)[number]["key"];

export interface LagBucket { key: string; label: string; count: number; pct: number | null }

export interface LagStats {
  measured: number;
  medianHours: number | null;
  meanHours: number | null;
  /** Share of the measured orders placed within 24 hours of the first visit. */
  within24hPct: number | null;
  /** Share placed after more than 7 days. */
  over7dPct: number | null;
  buckets: LagBucket[];
}

export interface SourceLag { source: OrderSource; orders: number; measured: number; stats: LagStats }

export interface TimeLagView {
  /** Paid orders of the period (after the source filter). */
  orders: number;
  measured: number;
  unmeasured: number;
  all: LagStats;
  bySource: SourceLag[];
}

/** Hours from the first visit to the order; null when a side is missing or unreadable; a visit after the order reads 0. */
export function lagHours(firstVisitAt: string | null | undefined, createdAt: string): number | null {
  if (!firstVisitAt) return null;
  const a = Date.parse(firstVisitAt);
  const b = Date.parse(createdAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, (b - a) / 3_600_000);
}

export function lagBucketOf(hours: number): LagBucketKey {
  for (const b of LAG_BUCKETS) if (hours < b.maxHours) return b.key;
  return "more";
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? (part / whole) * 100 : null);

function median(sorted: readonly number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Stats over a list of lags in hours. */
export function lagStats(hoursList: readonly number[]): LagStats {
  const sorted = [...hoursList].sort((a, b) => a - b);
  const counts = new Map<string, number>();
  for (const h of sorted) counts.set(lagBucketOf(h), (counts.get(lagBucketOf(h)) ?? 0) + 1);
  const n = sorted.length;
  return {
    measured: n,
    medianHours: median(sorted),
    meanHours: n ? sorted.reduce((a, b) => a + b, 0) / n : null,
    within24hPct: pct(sorted.filter((h) => h < 24).length, n),
    over7dPct: pct(sorted.filter((h) => h >= 168).length, n),
    buckets: LAG_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: counts.get(b.key) ?? 0, pct: pct(counts.get(b.key) ?? 0, n) })),
  };
}

/** The ours-side view: every Paid order of the period under the source filter, measured where a dated touch exists. */
export function buildTimeLag(orders: readonly LagOrder[], src: SourceFilter): TimeLagView {
  const kept = src === "all" ? orders : orders.filter((o) => o.source === src);
  const hoursOf = (o: LagOrder) => lagHours(o.firstVisitAt, o.createdAt);
  const all = kept.map(hoursOf).filter((h): h is number => h !== null);
  const bySource: SourceLag[] = [];
  for (const source of ORDER_SOURCES) {
    const of = kept.filter((o) => o.source === source);
    if (!of.length) continue;
    const hours = of.map(hoursOf).filter((h): h is number => h !== null);
    bySource.push({ source, orders: of.length, measured: hours.length, stats: lagStats(hours) });
  }
  return { orders: kept.length, measured: all.length, unmeasured: kept.length - all.length, all: lagStats(all), bySource };
}

// ---- GA4: days from the user's first session to the purchase

/** One GA4 row of report (date x firstSessionDate -> purchase events); both dates are GA4's yyyymmdd. */
export interface Ga4LagRow { firstSessionDate: string; date: string; purchases: number }

export const GA4_DAY_BUCKETS = [
  { key: "same", label: "Same day", maxDays: 1 },
  { key: "d1", label: "1 day", maxDays: 2 },
  { key: "d3", label: "2-3 days", maxDays: 4 },
  { key: "d7", label: "4-7 days", maxDays: 8 },
  { key: "d30", label: "8-30 days", maxDays: 31 },
  { key: "more", label: "Over 30 days", maxDays: Infinity },
] as const;

export interface Ga4LagView {
  purchases: number;
  /** Purchase events whose first-session date GA4 did not give ("(not set)"). */
  unmeasured: number;
  medianDays: number | null;
  meanDays: number | null;
  sameDayPct: number | null;
  over7dPct: number | null;
  buckets: LagBucket[];
}

const GA4_DATE = /^(\d{4})(\d{2})(\d{2})$/;
/** yyyymmdd -> days since the epoch (UTC noon, so DST never shifts a day); null when GA4 printed "(not set)". */
export function ga4DayNumber(yyyymmdd: string): number | null {
  const m = GA4_DATE.exec(yyyymmdd);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isFinite(t) ? Math.floor(t / 864e5) : null;
}

export function ga4DayBucketOf(days: number): string {
  for (const b of GA4_DAY_BUCKETS) if (days < b.maxDays) return b.key;
  return "more";
}

/** Weighted by purchases: a row of 3 purchases at 2 days counts three times. A purchase before its first session (GA4 oddity) reads 0 days. */
export function buildGa4Lag(rows: readonly Ga4LagRow[]): Ga4LagView {
  const days: number[] = [];
  let unmeasured = 0;
  for (const r of rows) {
    const n = Math.max(0, Math.floor(Number(r.purchases) || 0));
    if (!n) continue;
    const first = ga4DayNumber(r.firstSessionDate);
    const day = ga4DayNumber(r.date);
    if (first === null || day === null) {
      unmeasured += n;
      continue;
    }
    const d = Math.max(0, day - first);
    for (let i = 0; i < n; i++) days.push(d);
  }
  days.sort((a, b) => a - b);
  const counts = new Map<string, number>();
  for (const d of days) counts.set(ga4DayBucketOf(d), (counts.get(ga4DayBucketOf(d)) ?? 0) + 1);
  const n = days.length;
  return {
    purchases: n + unmeasured,
    unmeasured,
    medianDays: median(days),
    meanDays: n ? days.reduce((a, b) => a + b, 0) / n : null,
    sameDayPct: pct(days.filter((d) => d === 0).length, n),
    over7dPct: pct(days.filter((d) => d > 7).length, n),
    buckets: GA4_DAY_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: counts.get(b.key) ?? 0, pct: pct(counts.get(b.key) ?? 0, n) })),
  };
}

/** "42 min" / "3.5 h" / "26 h" / "4.2 d" - how a lag in hours prints. */
export function formatLagHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

/** "same day" / "1 day" / "2.5 days" - how a lag in days prints. */
export function formatLagDays(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return "—";
  if (days < 0.5) return "same day";
  const r = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return `${r} ${days === 1 ? "day" : "days"}`;
}

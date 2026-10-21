// Run: npx tsx scripts/marketing-time-lag-selftest.ts
import assert from "node:assert/strict";
import {
  buildGa4Lag,
  buildTimeLag,
  formatLagDays,
  formatLagHours,
  ga4DayBucketOf,
  ga4DayNumber,
  lagBucketOf,
  lagHours,
  lagStats,
  type LagOrder,
} from "../lib/marketing/time-to-purchase";

const order = (id: number, source: LagOrder["source"], hoursBefore: number | null, createdAt = "2026-10-10T12:00:00.000Z"): LagOrder => ({
  id,
  createdAt,
  source,
  firstVisitAt: hoursBefore === null ? null : new Date(Date.parse(createdAt) - hoursBefore * 3_600_000).toISOString(),
});

// ---- hours and buckets
assert.equal(lagHours("2026-10-10T10:00:00Z", "2026-10-10T12:00:00Z"), 2);
assert.equal(lagHours(null, "2026-10-10T12:00:00Z"), null, "no dated touch = unmeasured");
assert.equal(lagHours("nonsense", "2026-10-10T12:00:00Z"), null);
assert.equal(lagHours("2026-10-10T13:00:00Z", "2026-10-10T12:00:00Z"), 0, "a visit stamped after the order reads 0, never negative");
assert.equal(lagBucketOf(0.5), "h1");
assert.equal(lagBucketOf(1), "h24", "the bound belongs to the next bucket");
assert.equal(lagBucketOf(23.9), "h24");
assert.equal(lagBucketOf(24), "d3");
assert.equal(lagBucketOf(72), "d7");
assert.equal(lagBucketOf(168), "d30");
assert.equal(lagBucketOf(720), "more");
assert.equal(lagBucketOf(5000), "more");

// ---- stats
const empty = lagStats([]);
assert.equal(empty.measured, 0);
assert.equal(empty.medianHours, null);
assert.equal(empty.within24hPct, null, "no measured orders = no share, never 0%");
assert.ok(empty.buckets.every((b) => b.count === 0 && b.pct === null));
const s = lagStats([0.2, 3, 30, 100, 400]);
assert.equal(s.measured, 5);
assert.equal(s.medianHours, 30);
assert.equal(s.meanHours, (0.2 + 3 + 30 + 100 + 400) / 5);
assert.equal(s.within24hPct, 40, "0.2 and 3 are under a day");
assert.equal(s.over7dPct, 20, "400 h is over seven days");
assert.deepEqual(
  s.buckets.map((b) => [b.key, b.count]),
  [["h1", 1], ["h24", 1], ["d3", 1], ["d7", 1], ["d30", 1], ["more", 0]],
);
assert.equal(lagStats([1, 2]).medianHours, 1.5, "an even count takes the middle pair's mean");

// ---- the view: every Paid order, measured where a dated touch exists, by source; "No UTM" is unmeasured by definition
const orders: LagOrder[] = [
  order(1, "meta", 0.5),
  order(2, "meta", 30),
  order(3, "google", 2),
  order(4, "google", null), // a google-sourced order whose touch has no visited_at (older rows)
  order(5, "partners", 200),
  order(6, "no_utm", null),
  order(7, "other", 5),
];
const v = buildTimeLag(orders, "all");
assert.equal(v.orders, 7);
assert.equal(v.measured, 5);
assert.equal(v.unmeasured, 2);
assert.equal(v.all.medianHours, 5);
assert.deepEqual(
  v.bySource.map((r) => [r.source, r.orders, r.measured, r.stats.medianHours]),
  [["meta", 2, 2, 15.25], ["google", 2, 1, 2], ["partners", 1, 1, 200], ["no_utm", 1, 0, null], ["other", 1, 1, 5]],
  "sources in ORDER_SOURCES order; a source with no orders is left out",
);
const meta = buildTimeLag(orders, "meta");
assert.equal(meta.orders, 2, "the source filter narrows the orders");
assert.deepEqual(meta.bySource.map((r) => r.source), ["meta"]);
assert.equal(buildTimeLag([], "all").orders, 0);
assert.equal(buildTimeLag(orders, "no_utm").measured, 0);

// ---- GA4 days
assert.equal(ga4DayNumber("20261010"), ga4DayNumber("20261009")! + 1);
assert.equal(ga4DayNumber("20261101"), ga4DayNumber("20261031")! + 1, "a month boundary is one day");
assert.equal(ga4DayNumber("(not set)"), null);
assert.equal(ga4DayNumber(""), null);
assert.equal(ga4DayBucketOf(0), "same");
assert.equal(ga4DayBucketOf(1), "d1");
assert.equal(ga4DayBucketOf(3), "d3");
assert.equal(ga4DayBucketOf(4), "d7");
assert.equal(ga4DayBucketOf(7), "d7");
assert.equal(ga4DayBucketOf(8), "d30");
assert.equal(ga4DayBucketOf(30), "d30");
assert.equal(ga4DayBucketOf(31), "more");

const g = buildGa4Lag([
  { firstSessionDate: "20261010", date: "20261010", purchases: 3 },
  { firstSessionDate: "20261001", date: "20261010", purchases: 1 },
  { firstSessionDate: "20261012", date: "20261010", purchases: 1 }, // GA4 oddity: first session after the purchase -> 0 days
  { firstSessionDate: "(not set)", date: "20261010", purchases: 2 },
  { firstSessionDate: "20260901", date: "20261010", purchases: 0 }, // a zero row counts nothing
]);
assert.equal(g.purchases, 7);
assert.equal(g.unmeasured, 2);
assert.equal(g.medianDays, 0, "weighted by purchases: four of five measured are same-day");
assert.equal(g.meanDays, 9 / 5);
assert.equal(g.sameDayPct, 80);
assert.equal(g.over7dPct, 20);
assert.deepEqual(
  g.buckets.map((b) => [b.key, b.count]),
  [["same", 4], ["d1", 0], ["d3", 0], ["d7", 0], ["d30", 1], ["more", 0]],
);
const g0 = buildGa4Lag([]);
assert.equal(g0.purchases, 0);
assert.equal(g0.medianDays, null);
assert.equal(g0.sameDayPct, null);

// ---- formats
assert.equal(formatLagHours(null), "—");
assert.equal(formatLagHours(0.7), "42 min");
assert.equal(formatLagHours(3.46), "3.5 h");
assert.equal(formatLagHours(25.9), "26 h");
assert.equal(formatLagHours(100), "4.2 d");
assert.equal(formatLagDays(null), "—");
assert.equal(formatLagDays(0), "same day");
assert.equal(formatLagDays(1), "1 day");
assert.equal(formatLagDays(2.5), "2.5 days");
assert.equal(formatLagDays(9), "9 days");

console.log("marketing-time-lag selftest: ok");

// Run: npx tsx scripts/marketing-pnl-selftest.ts
import assert from "node:assert/strict";
import { buildPnl, rangeWindow, type AttributedReservation } from "../lib/services/marketing-pnl";

const spend = [
  { platform: "meta" as const, campaign_id: "c1", adset_key: "a1", day: "2026-10-01", spend_usd: 100, clicks: 50, impressions: 1000, platform_conversions: 3, platform_value: 4500 },
  { platform: "meta" as const, campaign_id: "c1", adset_key: "a2", day: "2026-10-02", spend_usd: 100, clicks: 50, impressions: 1000, platform_conversions: 0, platform_value: 0 },
  { platform: "google" as const, campaign_id: "g1", adset_key: "", day: "2026-10-02", spend_usd: 50, clicks: 10, impressions: 100, platform_conversions: 0, platform_value: 0 },
];
const entities = [
  { platform: "meta" as const, id: "c1", kind: "campaign", name: "MYT feed", brand: "mega_events" as const, status: "ACTIVE" },
  { platform: "meta" as const, id: "a1", kind: "adset", name: "adset 1", brand: "mega_events" as const, status: "ACTIVE", campaign_id: "c1" },
  { platform: "google" as const, id: "g1", kind: "campaign", name: "pmax", brand: "other" as const, status: "ENABLED" },
];
const res: AttributedReservation[] = [
  { id: 1, day: "2026-10-01", revenue: 1000, cogs: 700, estimated: false, touch: { platform: "meta", campaignId: "c1", adsetId: "a1", adId: null, resolved: true } },
  { id: 2, day: "2026-10-02", revenue: 500, cogs: 300, estimated: true, touch: { platform: "meta", campaignId: null, adsetId: null, adId: null, resolved: false } },
  { id: 3, day: "2026-10-02", revenue: 800, cogs: 500, estimated: false, touch: null },
];
const pnl = buildPnl({ spend, entities, reservations: res, feePct: 2, brand: "mega_events" });
const c1 = pnl.campaigns.find((c) => c.key === "meta:c1")!;
assert.equal(c1.spendUsd, 200);
assert.equal(c1.purchases, 1);
assert.equal(c1.revenueUsd, 1000);
assert.equal(c1.cogsUsd, 700);
assert.equal(c1.feeUsd, 20);
assert.equal(c1.netUsd, 80);
assert.equal(c1.poas, 0.4);
assert.equal(c1.roas, 5);
assert.equal(c1.cacUsd, 200);
assert.equal(c1.platformPurchases, 3);
assert.equal(c1.adsets.length, 2, "a2 has spend but no entity row -> still listed by its key");
assert.equal(c1.adsets.find((a) => a.key === "a1")!.purchases, 1);
assert.equal(pnl.campaigns.find((c) => c.key === "google:g1"), undefined, "other brand filtered out");
assert.equal(pnl.unresolved.find((u) => u.platform === "meta")!.revenueUsd, 500);
assert.equal(pnl.unattributed.revenueUsd, 800);
assert.equal(pnl.totals.spendUsd, 200);
assert.equal(pnl.totals.revenueUsd, 1500, "totals = campaigns of the brand + unresolved; unattributed shown apart");
assert.equal(pnl.totals.estimatedCount, 1);
assert.deepEqual(pnl.daily.map((d) => [d.day, d.spendUsd, d.revenueUsd]), [["2026-10-01", 100, 1000], ["2026-10-02", 100, 500]]);

const all = buildPnl({ spend, entities, reservations: res, feePct: 0, brand: "all" });
assert.equal(all.totals.spendUsd, 250);
assert.equal(all.campaigns.length, 2);
assert.equal(all.otherBrand.purchases, 0, "under 'all' no campaign is another brand's");

// Revenue never drops out of a brand view: a sale credited to another brand's campaign, or to a campaign with no
// entity row (brand unknown = "other", as its spend), lands in otherBrand - beside the totals, never inside them.
const elsewhere: AttributedReservation[] = [
  ...res,
  { id: 4, day: "2026-10-02", revenue: 600, cogs: 400, estimated: false, touch: { platform: "google", campaignId: "g1", adsetId: null, adId: null, resolved: true } },
  { id: 5, day: "2026-10-03", revenue: 300, cogs: 100, estimated: true, touch: { platform: "meta", campaignId: "gone", adsetId: null, adId: null, resolved: true } },
];
const mega = buildPnl({ spend, entities, reservations: elsewhere, feePct: 0, brand: "mega_events" });
assert.equal(mega.otherBrand.purchases, 2, "google:g1 (brand other) and meta:gone (no entity row)");
assert.equal(mega.otherBrand.revenueUsd, 900);
assert.equal(mega.otherBrand.cogsUsd, 500);
assert.equal(mega.otherBrand.estimatedCount, 1);
assert.equal(mega.otherBrand.netUsd, 400, "no spend of its own: revenue - cogs");
assert.equal(mega.totals.revenueUsd, 1500, "otherBrand stays out of the totals");
assert.equal(mega.campaigns.find((c) => c.key === "meta:gone"), undefined, "an unknown campaign is not listed under Mega Events");
assert.deepEqual(mega.daily.map((d) => d.day), ["2026-10-01", "2026-10-02"], "the daily series follows the totals: no otherBrand day");
const g1Only = buildPnl({ spend, entities, reservations: [elsewhere[3]], feePct: 0, brand: "mega_events" });
assert.equal(g1Only.otherBrand.revenueUsd, 600, "(1) a sale on google:g1 under mega_events lands in otherBrand with its revenue");
const goneOnly = buildPnl({ spend, entities, reservations: [elsewhere[4]], feePct: 0, brand: "mega_events" });
assert.equal(goneOnly.otherBrand.revenueUsd, 300, "(2) a sale on a campaign with no entity row lands in otherBrand");

// Under "other", the unresolved line (a click on OUR ad link) is listed but never joins the totals.
const other = buildPnl({ spend, entities, reservations: elsewhere, feePct: 0, brand: "other" });
assert.equal(other.unresolved.find((u) => u.platform === "meta")!.revenueUsd, 500, "still listed");
assert.equal(other.totals.revenueUsd, 600 + 300, "(3) totals = g1 + the unknown campaign; the unresolved 500 is excluded");
assert.equal(other.otherBrand.revenueUsd, 1000, "c1 is Mega Events: another brand from here");
assert.equal(other.unattributed.revenueUsd, 800);
assert.ok(!other.daily.some((d) => d.day === "2026-10-01" && d.revenueUsd > 0), "no unresolved or other-brand revenue in the chart");

// The windows are N calendar days INCLUSIVE of today (since = today - (N-1)), like the alerts' windowStart.
const w = rangeWindow("30d", new Date("2026-10-08T10:00:00Z"));
assert.equal(w.since, "2026-09-09");
assert.equal(w.until, "2026-10-08");
assert.equal(rangeWindow("7d", new Date("2026-10-08T10:00:00Z")).since, "2026-10-02");
assert.equal(rangeWindow("90d", new Date("2026-10-08T10:00:00Z")).since, "2026-07-11");
assert.equal(rangeWindow("month", new Date("2026-10-08T10:00:00Z")).since, "2026-10-01");

console.log("marketing-pnl selftest OK");

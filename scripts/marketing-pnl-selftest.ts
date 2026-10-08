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

const w = rangeWindow("30d", new Date("2026-10-08T10:00:00Z"));
assert.equal(w.since, "2026-09-08");
assert.equal(w.until, "2026-10-08");
assert.equal(rangeWindow("month", new Date("2026-10-08T10:00:00Z")).since, "2026-10-01");

console.log("marketing-pnl selftest OK");

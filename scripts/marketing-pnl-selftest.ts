// Run: npx tsx scripts/marketing-pnl-selftest.ts
import assert from "node:assert/strict";
import { buildPnl, type AttributedReservation } from "../lib/services/marketing-pnl";

const spend = [
  { platform: "meta" as const, campaign_id: "c1", adset_key: "a1", day: "2026-10-01", spend: 400, currency: "ILS", fx_rate: 0.25, spend_usd: 100, clicks: 50, impressions: 1000, platform_conversions: 3, platform_value: 4500 },
  { platform: "meta" as const, campaign_id: "c1", adset_key: "a2", day: "2026-10-02", spend: 400, currency: "ILS", fx_rate: 0.25, spend_usd: 100, clicks: 50, impressions: 1000, platform_conversions: 0, platform_value: 0 },
  { platform: "google" as const, campaign_id: "g1", adset_key: "", day: "2026-10-02", spend: 200, currency: "ILS", fx_rate: 0.25, spend_usd: 50, clicks: 10, impressions: 100, platform_conversions: 0, platform_value: 0 },
];
const entities = [
  { platform: "meta" as const, id: "c1", kind: "campaign", name: "MYT feed", brand: "mega_events" as const, status: "ACTIVE" },
  { platform: "meta" as const, id: "a1", kind: "adset", name: "adset 1", brand: "mega_events" as const, status: "ACTIVE", campaign_id: "c1" },
  { platform: "google" as const, id: "g1", kind: "campaign", name: "pmax", brand: "other" as const, status: "ENABLED" },
];
const res: AttributedReservation[] = [
  { id: 1, day: "2026-10-01", revenue: 1000, cogs: 700, estimated: false, usdIls: null, touch: { platform: "meta", campaignId: "c1", adsetId: "a1", adId: null, resolved: true } },
  { id: 2, day: "2026-10-02", revenue: 500, cogs: 300, estimated: true, usdIls: null, touch: { platform: "meta", campaignId: null, adsetId: null, adId: null, resolved: false } },
  { id: 3, day: "2026-10-02", revenue: 800, cogs: 500, estimated: false, usdIls: null, touch: null },
];
const pnl = buildPnl({ spend, entities, reservations: res, feePct: 2, brand: "mega_events", currency: "usd", fallbackUsdIls: 4 });
const c1 = pnl.campaigns.find((c) => c.key === "meta:c1")!;
assert.equal(c1.spend, 200);
assert.equal(c1.purchases, 1);
assert.equal(c1.revenue, 1000);
assert.equal(c1.cogs, 700);
assert.equal(c1.fee, 20);
assert.equal(c1.net, 80);
assert.equal(c1.poas, 0.4);
assert.equal(c1.roas, 5);
assert.equal(c1.cac, 200);
assert.equal(c1.platformPurchases, 3);
assert.equal(c1.adsets.length, 2, "a2 has spend but no entity row -> still listed by its key");
assert.equal(c1.adsets.find((a) => a.key === "a1")!.purchases, 1);
assert.equal(pnl.campaigns.find((c) => c.key === "google:g1"), undefined, "other brand filtered out");
assert.equal(pnl.unresolved.find((u) => u.platform === "meta")!.revenue, 500);
assert.equal(pnl.unattributed.revenue, 800);
assert.equal(pnl.totals.spend, 200);
assert.equal(pnl.totals.revenue, 1500, "totals = campaigns of the brand + unresolved; unattributed shown apart");
assert.equal(pnl.totals.estimatedCount, 1);
assert.deepEqual(pnl.daily.map((d) => [d.day, d.spend, d.revenue]), [["2026-10-01", 100, 1000], ["2026-10-02", 100, 500]]);

const all = buildPnl({ spend, entities, reservations: res, feePct: 0, brand: "all", currency: "usd", fallbackUsdIls: 4 });
assert.equal(all.totals.spend, 250);
assert.equal(all.campaigns.length, 2);
assert.equal(all.otherBrand.purchases, 0, "under 'all' no campaign is another brand's");

// Revenue never drops out of a brand view: a sale credited to another brand's campaign, or to a campaign with no
// entity row (brand unknown = "other", as its spend), lands in otherBrand - beside the totals, never inside them.
const elsewhere: AttributedReservation[] = [
  ...res,
  { id: 4, day: "2026-10-02", revenue: 600, cogs: 400, estimated: false, usdIls: null, touch: { platform: "google", campaignId: "g1", adsetId: null, adId: null, resolved: true } },
  { id: 5, day: "2026-10-03", revenue: 300, cogs: 100, estimated: true, usdIls: null, touch: { platform: "meta", campaignId: "gone", adsetId: null, adId: null, resolved: true } },
];
const mega = buildPnl({ spend, entities, reservations: elsewhere, feePct: 0, brand: "mega_events", currency: "usd", fallbackUsdIls: 4 });
assert.equal(mega.otherBrand.purchases, 2, "google:g1 (brand other) and meta:gone (no entity row)");
assert.equal(mega.otherBrand.revenue, 900);
assert.equal(mega.otherBrand.cogs, 500);
assert.equal(mega.otherBrand.estimatedCount, 1);
assert.equal(mega.otherBrand.net, 400, "no spend of its own: revenue - cogs");
assert.equal(mega.totals.revenue, 1500, "otherBrand stays out of the totals");
assert.equal(mega.campaigns.find((c) => c.key === "meta:gone"), undefined, "an unknown campaign is not listed under Mega Events");
assert.deepEqual(mega.daily.map((d) => d.day), ["2026-10-01", "2026-10-02"], "the daily series follows the totals: no otherBrand day");
const g1Only = buildPnl({ spend, entities, reservations: [elsewhere[3]], feePct: 0, brand: "mega_events", currency: "usd", fallbackUsdIls: 4 });
assert.equal(g1Only.otherBrand.revenue, 600, "(1) a sale on google:g1 under mega_events lands in otherBrand with its revenue");
const goneOnly = buildPnl({ spend, entities, reservations: [elsewhere[4]], feePct: 0, brand: "mega_events", currency: "usd", fallbackUsdIls: 4 });
assert.equal(goneOnly.otherBrand.revenue, 300, "(2) a sale on a campaign with no entity row lands in otherBrand");

// Under "other", the unresolved line (a click on OUR ad link) is listed but never joins the totals.
const other = buildPnl({ spend, entities, reservations: elsewhere, feePct: 0, brand: "other", currency: "usd", fallbackUsdIls: 4 });
assert.equal(other.unresolved.find((u) => u.platform === "meta")!.revenue, 500, "still listed");
assert.equal(other.totals.revenue, 600 + 300, "(3) totals = g1 + the unknown campaign; the unresolved 500 is excluded");
assert.equal(other.otherBrand.revenue, 1000, "c1 is Mega Events: another brand from here");
assert.equal(other.unattributed.revenue, 800);
assert.ok(!other.daily.some((d) => d.day === "2026-10-01" && d.revenue > 0), "no unresolved or other-brand revenue in the chart");

// Platform-reported value is stored in the ACCOUNT currency (ILS): USD view = value x fx_rate, ILS view = as stored.
assert.equal(c1.platformValue, 1125, "4500 ILS x 0.25");
assert.equal(pnl.currency, "usd");

// ILS view (spec 2026-10-14 section 2): spend exactly as billed; an order's money x ITS OWN rate, else the fallback.
const ilsRes: AttributedReservation[] = [
  { ...res[0], usdIls: 3.7 },
  { ...res[1], usdIls: null },
  res[2],
];
const ils = buildPnl({ spend, entities, reservations: ilsRes, feePct: 2, brand: "mega_events", currency: "ils", fallbackUsdIls: 3.5 });
const c1Ils = ils.campaigns.find((c) => c.key === "meta:c1")!;
assert.equal(ils.currency, "ils");
assert.equal(c1Ils.spend, 800, "the ILS rows as billed (400 + 400), not spend_usd converted back");
assert.equal(c1Ils.revenue, 3700, "1000 USD x the order's own 3.7");
assert.equal(c1Ils.cogs, 2590, "700 USD x 3.7");
assert.equal(c1Ils.fee, 74, "2% of the ILS revenue");
assert.equal(c1Ils.net, 3700 - 2590 - 74 - 800);
assert.equal(c1Ils.platformValue, 4500, "ILS value as stored");
assert.equal(ils.unresolved.find((u) => u.platform === "meta")!.revenue, 1750, "no rate on the order -> the fallback 3.5, never 0");
assert.equal(ils.daily.find((d) => d.day === "2026-10-01")!.spend, 400);
// The Executive's "Daily spend - Google vs Meta" reads the split from the same series.
const allIls = buildPnl({ spend, entities, reservations: [], feePct: 0, brand: "all", currency: "ils", fallbackUsdIls: 3.5 });
assert.deepEqual(allIls.daily.map((d) => [d.day, d.spendMeta, d.spendGoogle, d.spend]), [["2026-10-01", 400, 0, 400], ["2026-10-02", 400, 200, 600]]);

// A non-ILS spend row in the ILS view goes through USD at the fallback rate.
const usdRow = { platform: "meta" as const, campaign_id: "c1", adset_key: "a1", day: "2026-10-03", spend: 10, currency: "USD", fx_rate: 1, spend_usd: 10, clicks: 0, impressions: 0, platform_conversions: 0, platform_value: 0 };
const mixed = buildPnl({ spend: [...spend, usdRow], entities, reservations: [], feePct: 0, brand: "mega_events", currency: "ils", fallbackUsdIls: 3.5 });
assert.equal(mixed.totals.spend, 800 + 35);

// Platform slice (the Executive source filter meta / google): only that platform's spend, campaigns and orders.
const googleOnly = buildPnl({ spend, entities, reservations: elsewhere, feePct: 0, brand: "all", currency: "usd", fallbackUsdIls: 4, platform: "google" });
assert.deepEqual(googleOnly.campaigns.map((c) => c.key), ["google:g1"]);
assert.equal(googleOnly.totals.spend, 50);
assert.equal(googleOnly.totals.revenue, 600, "only the google-credited order");
assert.equal(googleOnly.unresolved.length, 0, "the meta unresolved order is not google's");
const metaOnly = buildPnl({ spend, entities, reservations: elsewhere, feePct: 0, brand: "mega_events", currency: "usd", fallbackUsdIls: 4, platform: "meta" });
assert.equal(metaOnly.totals.spend, 200);
assert.equal(metaOnly.totals.revenue, 1500, "c1 1000 + the meta unresolved 500");
assert.equal(metaOnly.otherBrand.revenue, 300, "meta:gone (no entity) stays other-brand; google:g1 is not counted at all");

console.log("marketing-pnl selftest OK");

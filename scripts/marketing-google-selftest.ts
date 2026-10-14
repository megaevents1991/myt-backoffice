// Run: npx tsx scripts/marketing-google-selftest.ts
import assert from "node:assert/strict";
import { mergeGooglePurchases } from "../lib/services/ads/google";
import type { AdSpendRow } from "../types/marketing.types";

const row = (p: Partial<AdSpendRow>): AdSpendRow => ({ platform: "google", account_id: "1", campaign_id: "c1", adset_key: "ag1", level: "adset", day: "2026-10-01", spend: 100, currency: "ILS", spend_usd: 27, fx_rate: 0.27, impressions: 10, clicks: 1, platform_conversions: 0, platform_value: 0, ...p });

// "Purchases (platform)" on Google = the PURCHASE category only (spec 2026-10-14 section 5). Before, it held
// metrics.conversions = every primary action (forms, calls, submit_application...) - the "11.368" Tom saw.
const merged = mergeGooglePurchases(
  [
    row({ platform_conversions: 11.368, platform_value: 50_000 }),
    row({ adset_key: "ag2", platform_conversions: 4, platform_value: 9 }),
    row({ adset_key: "", level: "campaign", campaign_id: "pmax", day: "2026-10-02" }),
  ],
  [
    { campaignId: "c1", adsetKey: "ag1", day: "2026-10-01", conversions: 1, value: 7096.5 },
    { campaignId: "pmax", adsetKey: "", day: "2026-10-02", conversions: 0.5, value: 2000 },
    { campaignId: "c9", adsetKey: "ag9", day: "2026-10-01", conversions: 3, value: 1 },
  ],
);
assert.equal(merged.length, 3, "a purchase row with no spend row adds nothing");
assert.equal(merged[0].platform_conversions, 1);
assert.equal(merged[0].platform_value, 7096.5);
assert.equal(merged[1].platform_conversions, 0, "no purchase that day -> 0, never the old all-actions count");
assert.equal(merged[1].platform_value, 0);
assert.equal(merged[2].platform_conversions, 0.5, "P.Max campaign-level row, Google's fraction kept");
assert.equal(merged[0].spend, 100, "nothing else on the row changes");

// Two purchase rows for the same key (two purchase actions, e.g. both GA4 properties) add up.
const twice = mergeGooglePurchases([row({})], [
  { campaignId: "c1", adsetKey: "ag1", day: "2026-10-01", conversions: 1, value: 100 },
  { campaignId: "c1", adsetKey: "ag1", day: "2026-10-01", conversions: 2, value: 50 },
]);
assert.equal(twice[0].platform_conversions, 3);
assert.equal(twice[0].platform_value, 150);

console.log("marketing-google selftest: ok");

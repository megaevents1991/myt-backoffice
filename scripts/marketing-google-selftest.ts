// Run: npx tsx scripts/marketing-google-selftest.ts
import assert from "node:assert/strict";
import { mergeGooglePurchases } from "../lib/services/ads/google";
import { adsTargetFor, isAdId, pickCatalogExamples, previewSrcFrom, productSetOf } from "../lib/marketing/ad-preview";
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

// ---- the live ad preview (spec 2026-10-14 section 6): only a Facebook-hosted https iframe is ever rendered.
const good = `<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=AQKZ&amp;t=AQL" width="540" height="690" scrolling="yes" style="border: none;"></iframe>`;
assert.equal(previewSrcFrom(good), "https://business.facebook.com/ads/api/preview_iframe.php?d=AQKZ&t=AQL", "&amp; unescaped");
assert.equal(previewSrcFrom(`<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=1"></iframe>`), "https://www.facebook.com/ads/api/preview_iframe.php?d=1");
assert.equal(previewSrcFrom(`<iframe src="https://evil.example/x"></iframe>`), null, "another host is refused");
assert.equal(previewSrcFrom(`<iframe src="https://business.facebook.com.evil.example/x"></iframe>`), null, "a look-alike host is refused");
assert.equal(previewSrcFrom(`<iframe src="http://business.facebook.com/x"></iframe>`), null, "http is refused");
assert.equal(previewSrcFrom(`<iframe src="javascript:alert(1)"></iframe>`), null);
assert.equal(previewSrcFrom("no frame here"), null);
assert.equal(previewSrcFrom(""), null);

assert.equal(isAdId("120249159793840141"), true);
assert.equal(isAdId("12' OR 1=1"), false, "nothing but digits reaches a GAQL string or a Graph path");
assert.equal(isAdId(""), false);

// Which ad-set row offers "Ads" (final review 14.10: the UI's own regex lost its backslash and no row ever did).
assert.deepEqual(adsTargetFor("meta", "120249159793840141", "Set A"), { platform: "meta", adsetId: "120249159793840141", title: "Set A" });
assert.deepEqual(adsTargetFor("google", "138746264051", "AG"), { platform: "google", adGroupId: "138746264051", title: "AG" });
assert.equal(adsTargetFor("google", "", "—"), null, "a campaign-level row (P.Max) has no ad group");
assert.equal(adsTargetFor("meta", "ddd", "x"), null);

// ---- catalog ads (14.10): Meta previews them only with a catalog product id, which our read token cannot read yet -
// so the dialog shows the ad's own texts + our feed pictures of the events the ad is most likely about.
assert.equal(productSetOf({ creative: { product_set_id: "272" } }), "272");
assert.equal(productSetOf({ adset: { promoted_object: { product_set_id: "273" } } }), "273");
assert.equal(productSetOf({ creative: {}, adset: { promoted_object: { pixel_id: "1" } } }), null, "a regular ad");
assert.equal(productSetOf(null), null);

const feedEvents = [
  { id: 1, name: "סלין דיון - פריז", date: "2026-10-20", campaign_image_url: "https://x/1.png" },
  { id: 2, name: "אואזיס - לונדון", date: "2027-07-11", campaign_image_url: "https://x/2.png" },
  { id: 3, name: "אואזיס - מנצ'סטר", date: "2027-07-04", campaign_image_url: "https://x/3.png" },
  { id: 4, name: "סטיבי וונדר", date: "2026-11-03", campaign_image_url: "https://x/4.png" },
];
assert.deepEqual(pickCatalogExamples("‎Feed_v2 Broad‎‎ - אואזיס", feedEvents, 3).map((e) => e.id), [3, 2, 1], "the ad's subject first (soonest first), then the rest by date; LRM marks ignored");
assert.deepEqual(pickCatalogExamples("Feed_v2 Broad", feedEvents, 2).map((e) => e.id), [1, 4], "no subject in the name -> soonest events");
assert.deepEqual(pickCatalogExamples("סטיבי וונדר feed_v2", feedEvents, 1).map((e) => e.id), [4]);
assert.equal(pickCatalogExamples("x", [], 3).length, 0);

console.log("marketing-google selftest: ok");

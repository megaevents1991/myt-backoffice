// Run: npx tsx scripts/marketing-attribution-selftest.ts
import assert from "node:assert/strict";
import { paidTouchOf, type UtmTouchLike } from "../lib/services/marketing-attribution";

const touch = (p: Partial<UtmTouchLike>, position = 0): UtmTouchLike => ({ position, utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null, gclid: null, fbclid: null, is_influencer: false, ...p });
const lookups = {
  metaAdCampaign: (adId: string) => (adId === "120248410418770141" ? { campaignId: "120248162596380141", adsetId: "120248410418760141" } : null),
  gclidCampaign: (g: string) => (g === "Cj0abc" ? { campaignId: "23996726850", adGroupId: null } : null),
};

assert.deepEqual(paidTouchOf([touch({ utm_source: "facebook", utm_content: "120248410418770141", fbclid: "x" })], lookups), { platform: "meta", campaignId: "120248162596380141", adsetId: "120248410418760141", adId: "120248410418770141", resolved: true });
assert.deepEqual(paidTouchOf([touch({ utm_source: "fb", utm_medium: "paid", utm_campaign: "120248162596380141", utm_term: "120248410418760141", utm_content: "999" })], { ...lookups, metaAdCampaign: () => null }), { platform: "meta", campaignId: "120248162596380141", adsetId: "120248410418760141", adId: null, resolved: true });
assert.deepEqual(paidTouchOf([touch({ fbclid: "abc" })], lookups), { platform: "meta", campaignId: null, adsetId: null, adId: null, resolved: false });
assert.deepEqual(paidTouchOf([touch({ utm_source: "google", utm_campaign: "p.max", gclid: "Cj0abc" })], lookups), { platform: "google", campaignId: "23996726850", adsetId: null, adId: null, resolved: true });
assert.equal(paidTouchOf([touch({ utm_source: "google", utm_medium: "cpc", gclid: "unknown" })], lookups)?.resolved, false);
assert.equal(paidTouchOf([touch({ utm_source: "google", utm_campaign: "organic" })], lookups), null, "organic google is not paid");
// Influencer protection: protected influencer at position 0 carrying a paid signal with a resolved Google touch behind it
assert.equal(paidTouchOf([touch({ utm_source: "instagram", fbclid: "x", is_influencer: true }, 0), touch({ utm_source: "google", gclid: "Cj0abc" }, 1)], lookups)?.platform, "google", "influencer at 0 is skipped even when it carries a paid signal");
// Influencer protection: a protected influencer touch alone returns null
assert.equal(paidTouchOf([touch({ utm_source: "instagram", fbclid: "x", is_influencer: true })], lookups), null, "a protected influencer is never a paid touch");
// Influencer protection: the protection applies at position 0 only
assert.deepEqual(paidTouchOf([touch({ utm_source: "website" }, 0), touch({ utm_source: "instagram", fbclid: "x", is_influencer: true }, 1)], lookups), { platform: "meta", campaignId: null, adsetId: null, adId: null, resolved: false }, "the protection applies at position 0 only");

// Feed shape: campaign id in utm_campaign takes precedence; lookup not consulted
assert.deepEqual(paidTouchOf([touch({ utm_source: "fb", utm_campaign: "120248162596380141", utm_term: "120248410418760141", utm_content: "120248410418770141" })], { ...lookups, metaAdCampaign: () => ({ campaignId: "OTHER", adsetId: "OTHER" }) }), { platform: "meta", campaignId: "120248162596380141", adsetId: "120248410418760141", adId: "120248410418770141", resolved: true });

// Same-touch precedence: one touch with both Meta and Google signals reads as Meta
assert.equal(paidTouchOf([touch({ utm_source: "facebook", fbclid: "x", gclid: "Cj0abc" })], lookups)?.platform, "meta", "one touch with both signals reads as Meta - fbclid is added at click time, a gclid is often copied into shared links");

// Additional source values for Meta
assert.deepEqual(paidTouchOf([touch({ utm_source: "ig", utm_campaign: "120248162596380141", utm_term: "120248410418760141" })], lookups), { platform: "meta", campaignId: "120248162596380141", adsetId: "120248410418760141", adId: null, resolved: true });
assert.deepEqual(paidTouchOf([touch({ utm_source: "instagram", utm_campaign: "120248162596380141", utm_term: "120248410418760141" })], lookups), { platform: "meta", campaignId: "120248162596380141", adsetId: "120248410418760141", adId: null, resolved: true });
assert.deepEqual(paidTouchOf([touch({ utm_source: "meta", utm_campaign: "120248162596380141", utm_term: "120248410418760141" })], lookups), { platform: "meta", campaignId: "120248162596380141", adsetId: "120248410418760141", adId: null, resolved: true });

// Position scanning and non-paid touches
assert.equal(paidTouchOf([touch({ utm_source: "website" }, 0), touch({ utm_source: "facebook", utm_content: "120248410418770141" }, 1)], lookups)?.platform, "meta", "last PAID touch, wherever it sits");
assert.equal(paidTouchOf([touch({ utm_source: "google", gclid: "Cj0abc" }, 2), touch({ utm_source: "facebook", fbclid: "z" }, 1)], lookups)?.platform, "meta", "positions scanned ascending whatever the array order");
assert.equal(paidTouchOf([touch({ utm_source: "alon_demo" })], lookups), null);
assert.equal(paidTouchOf([], lookups), null);

console.log("marketing-attribution selftest OK");

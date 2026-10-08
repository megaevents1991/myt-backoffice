// Run: npx tsx scripts/ad-brand-selftest.ts
import assert from "node:assert/strict";
import { brandOf, landingDomainOf, pickLandingDomain } from "../lib/services/ads/brand";
import { dayChunks, META_SPEND_CHUNK_DAYS } from "../lib/services/ads/meta";

assert.equal(brandOf({ name: "MYT - Feed V2 - Aug 2026", landingDomain: null }), "mega_events");
assert.equal(brandOf({ name: "לידים מייטי - Submit Application", landingDomain: null }), "mega_events");
assert.equal(brandOf({ name: "מגה אירועים - 1-1-2026", landingDomain: null }), "mega_events");
assert.equal(brandOf({ name: "P.Max - MegaEvents MYT - Football", landingDomain: null }), "mega_events");
assert.equal(brandOf({ name: "search_brand-newn", landingDomain: "mega-events.co.il" }), "mega_events");
assert.equal(brandOf({ name: "search_brand-newn", landingDomain: "www.mega-events.co.il" }), "mega_events");
assert.equal(brandOf({ name: "פמלי טיולי משפחות", landingDomain: "megatr.co.il" }), "other");
assert.equal(brandOf({ name: "פוסט באינסטגרם: ההרשמה לטיולי חגי תשרי", landingDomain: null }), "other");
assert.equal(brandOf({ name: "", landingDomain: null }), "other");

assert.equal(landingDomainOf("https://www.mega-events.co.il/c/football?utm_source=x"), "mega-events.co.il");
assert.equal(landingDomainOf("not a url"), null);
assert.equal(landingDomainOf(null), null);

// A mixed campaign is still ours; otherwise the first domain seen; nothing seen = null.
assert.equal(pickLandingDomain(["megatr.co.il", "www.mega-events.co.il".replace(/^www\./, "")]), "mega-events.co.il");
assert.equal(pickLandingDomain(["megatr.co.il", null, "megafamily.co.il"]), "megatr.co.il");
assert.equal(pickLandingDomain([null, undefined]), null);

// Meta spend is read in 7-day windows (one 30-day insights request outlasts Meta's answer time and the 30 s read timeout).
assert.equal(META_SPEND_CHUNK_DAYS, 7);
const ninety = dayChunks("2026-07-11", "2026-10-08", META_SPEND_CHUNK_DAYS);
assert.equal(ninety.length, 13);
assert.deepEqual(ninety[0], { since: "2026-07-11", until: "2026-07-17" });
assert.deepEqual(ninety[12], { since: "2026-10-03", until: "2026-10-08" });
assert.deepEqual(dayChunks("2026-07-11", "2026-10-08", 14).length, 7);
assert.deepEqual(dayChunks("2026-10-02", "2026-10-08", META_SPEND_CHUNK_DAYS), [{ since: "2026-10-02", until: "2026-10-08" }]);
assert.deepEqual(dayChunks("2026-10-09", "2026-10-08", META_SPEND_CHUNK_DAYS), []);
// Contiguous: every window starts the day after the previous one ends, so no day is read twice or skipped.
for (let i = 1; i < ninety.length; i++) {
  const prevEnd = Date.parse(`${ninety[i - 1].until}T00:00:00Z`);
  assert.equal(Date.parse(`${ninety[i].since}T00:00:00Z`) - prevEnd, 86_400_000);
}
assert.equal(ninety[0].since, "2026-07-11");
assert.equal(ninety[ninety.length - 1].until, "2026-10-08");

console.log("ad-brand selftest OK");

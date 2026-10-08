// Run: npx tsx scripts/ad-brand-selftest.ts
import assert from "node:assert/strict";
import { brandOf, landingDomainOf } from "../lib/services/ads/brand";

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

console.log("ad-brand selftest OK");

// Run: npx tsx scripts/marketing-funnel-selftest.ts
import assert from "node:assert/strict";
import { orderSourceOf, parseSource } from "../lib/marketing/order-source";
import { buildFunnel, type FunnelOrder } from "../lib/marketing/funnel";
import type { UtmTouchLike } from "../lib/services/marketing-attribution";

const touch = (p: Partial<UtmTouchLike>): UtmTouchLike => ({ position: 0, utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null, gclid: null, fbclid: null, is_influencer: false, ...p });

// ---- order source: the last paid touch, then partner, then any UTM, then none
assert.equal(orderSourceOf({ touches: [touch({ gclid: "Cj0abc" })], partnerCode: null }), "google");
assert.equal(orderSourceOf({ touches: [touch({ utm_source: "google", utm_medium: "cpc" })], partnerCode: null }), "google");
assert.equal(orderSourceOf({ touches: [touch({ fbclid: "IwAR1" })], partnerCode: null }), "meta");
assert.equal(orderSourceOf({ touches: [touch({ utm_source: "ig" })], partnerCode: null }), "meta");
assert.equal(orderSourceOf({ touches: [], partnerCode: "AVIRAN" }), "partners", "a partner booking with no touch");
assert.equal(orderSourceOf({ touches: [touch({ utm_source: "michaela", is_influencer: true })], partnerCode: null }), "partners", "influencer touch at position 0");
assert.equal(
  orderSourceOf({ touches: [touch({ utm_source: "michaela", is_influencer: true }), touch({ position: 1, fbclid: "IwAR1" })], partnerCode: null }),
  "meta",
  "an older paid touch still wins - the same rule as the P&L (paidTouchOf skips the influencer at 0)",
);
assert.equal(orderSourceOf({ touches: [touch({ utm_source: "newsletter", utm_medium: "email" })], partnerCode: null }), "other");
assert.equal(orderSourceOf({ touches: [touch({ utm_source: "google", utm_medium: "organic" })], partnerCode: null }), "other", "organic google is not paid");
assert.equal(orderSourceOf({ touches: [], partnerCode: null }), "no_utm");
assert.equal(orderSourceOf({ touches: [], partnerCode: "  " }), "no_utm", "a blank code is no partner");

assert.equal(parseSource("meta"), "meta");
assert.equal(parseSource("nonsense"), "all");
assert.equal(parseSource(undefined), "all");

// ---- funnel
const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
const orders: FunnelOrder[] = [
  { day: "2026-10-01", paid: true, tickets: 2, source: "meta" },
  { day: "2026-10-01", paid: false, tickets: 4, source: "meta" },
  { day: "2026-10-02", paid: true, tickets: 3, source: "google" },
  { day: "2026-10-02", paid: false, tickets: 2, source: "partners" },
  { day: "2026-10-03", paid: true, tickets: 1, source: "no_utm" },
];
const spendDaily = [
  { day: "2026-10-01", meta: 600, google: 100 },
  { day: "2026-10-02", meta: 300, google: 0 },
];

const all = buildFunnel(orders, spendDaily, days, "all");
assert.equal(all.leads, 5);
assert.equal(all.signups, 3);
assert.equal(all.passengers, 6, "tickets on PAID orders only: 2 + 3 + 1");
assert.equal(all.spend, 1000);
assert.equal(all.spendMeta, 900);
assert.equal(all.spendGoogle, 100);
assert.equal(all.costPerLead, 200);
assert.equal(all.costPerSignup, 333.33);
assert.equal(all.costPerPassenger, 166.67);
assert.equal(all.leadToSignup, 60, "percent");
assert.equal(all.paxPerSignup, 2);
assert.equal(all.daily.length, 3, "every day of the period, zeros included");
assert.deepEqual(all.daily[2], { day: "2026-10-03", leads: 1, signups: 1, passengers: 1, spendMeta: 0, spendGoogle: 0, spend: 0 });
assert.deepEqual(all.daily[0], { day: "2026-10-01", leads: 2, signups: 1, passengers: 2, spendMeta: 600, spendGoogle: 100, spend: 700 });

const meta = buildFunnel(orders, spendDaily, days, "meta");
assert.equal(meta.leads, 2);
assert.equal(meta.signups, 1);
assert.equal(meta.spend, 900, "Meta's spend only");
assert.equal(meta.spendGoogle, 0);
assert.equal(meta.costPerSignup, 900);

const partners = buildFunnel(orders, spendDaily, days, "partners");
assert.equal(partners.leads, 1);
assert.equal(partners.spend, 0, "no ad spend for partners");
assert.equal(partners.costPerLead, null, "never Infinity / 0 - no spend means no cost");
assert.equal(partners.costPerSignup, null);
assert.equal(partners.costPerPassenger, null);
assert.equal(partners.leadToSignup, 0);
assert.equal(partners.paxPerSignup, null, "no signup -> no ratio");

const none = buildFunnel([], spendDaily, days, "all");
assert.equal(none.costPerLead, null, "spend but no lead -> no cost per lead");
assert.equal(none.leadToSignup, null);

console.log("marketing-funnel selftest: ok");

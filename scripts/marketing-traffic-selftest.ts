// Run: npx tsx scripts/marketing-traffic-selftest.ts
import assert from "node:assert/strict";
import { buildTraffic, trafficBucket, type TrafficDailyRow, type TrafficSourceUsersRow, type TrafficStepRow } from "../lib/marketing/traffic";
import type { FunnelOrder } from "../lib/marketing/funnel";

const partners = new Set(["sagi", "aviran"]);

// ---- source buckets (spec 2026-10-14 section 7) - the values GA4 answered on 14.10
assert.equal(trafficBucket("facebook", "cpc", partners), "meta");
assert.equal(trafficBucket("m.facebook.com", "referral", partners), "meta");
assert.equal(trafficBucket("l.instagram.com", "referral", partners), "meta");
assert.equal(trafficBucket("ig", "social", partners), "meta");
assert.equal(trafficBucket("google", "cpc", partners), "google");
assert.equal(trafficBucket("google", "organic", partners), "other", "organic search is not Google Ads");
assert.equal(trafficBucket("michaela", "influencer", partners), "partners");
assert.equal(trafficBucket("sagi", "referral", partners), "partners", "a partner tracking code as the source");
assert.equal(trafficBucket("SAGI", "(not set)", partners), "partners", "case-insensitive");
assert.equal(trafficBucket("(direct)", "(none)", partners), "no_utm");
assert.equal(trafficBucket("(not set)", "", partners), "no_utm");
assert.equal(trafficBucket("(data not available)", "", partners), "no_utm");
assert.equal(trafficBucket("megatr.co.il", "referral", partners), "other");
assert.equal(trafficBucket("chatgpt.com", "ai-assistant", partners), "other");
assert.equal(trafficBucket("notfacebook.com", "referral", partners), "other", "a look-alike host is not Meta");

// ---- the view
const days = ["2026-10-01", "2026-10-02"];
const daily: TrafficDailyRow[] = [
  { date: "20261001", source: "facebook", medium: "cpc", sessions: 100, engaged: 50 },
  { date: "20261001", source: "google", medium: "cpc", sessions: 40, engaged: 30 },
  { date: "20261002", source: "(direct)", medium: "(none)", sessions: 20, engaged: 10 },
  { date: "20261002", source: "sagi", medium: "referral", sessions: 10, engaged: 6 },
];
// Users come from reports WITHOUT the date (final review 14.10: summing daily rows counted a returning user once a day).
const sourceUsers: TrafficSourceUsersRow[] = [
  { source: "facebook", medium: "cpc", users: 70 },
  { source: "google", medium: "cpc", users: 30 },
  { source: "(direct)", medium: "(none)", users: 20 },
  { source: "sagi", medium: "referral", users: 8 },
];
const totalUsers = 120; // unique across sources - less than the 128 of the rows
const steps: TrafficStepRow[] = [
  // homepage via facebook
  { source: "facebook", medium: "cpc", landingPage: "/", eventName: "session_start", sessions: 60 },
  { source: "facebook", medium: "cpc", landingPage: "/", eventName: "select_item", sessions: 30 },
  { source: "facebook", medium: "cpc", landingPage: "/", eventName: "add_to_cart", sessions: 20 },
  { source: "facebook", medium: "cpc", landingPage: "/", eventName: "view_cart", sessions: 10 },
  { source: "facebook", medium: "cpc", landingPage: "/", eventName: "begin_checkout", sessions: 2 },
  { source: "facebook", medium: "cpc", landingPage: "/", eventName: "generate_lead", sessions: 1 },
  { source: "facebook", medium: "cpc", landingPage: "/", eventName: "purchase", sessions: 1 },
  // artist page via facebook
  { source: "facebook", medium: "cpc", landingPage: "/c/music/artists/oasis", eventName: "session_start", sessions: 40 },
  { source: "facebook", medium: "cpc", landingPage: "/c/music/artists/oasis", eventName: "select_item", sessions: 20 },
  // event page via google
  { source: "google", medium: "cpc", landingPage: "/order/1031", eventName: "session_start", sessions: 40 },
  { source: "google", medium: "cpc", landingPage: "/order/1031", eventName: "add_to_cart", sessions: 25 },
  { source: "google", medium: "cpc", landingPage: "/order/1031", eventName: "purchase", sessions: 2 },
  // elsewhere
  { source: "(direct)", medium: "(none)", landingPage: "/c/football", eventName: "session_start", sessions: 20 },
  { source: "sagi", medium: "referral", landingPage: "/", eventName: "session_start", sessions: 10 },
];
const orders: FunnelOrder[] = [
  { day: "2026-10-01", paid: true, tickets: 2, source: "meta" },
  { day: "2026-10-01", paid: false, tickets: 2, source: "meta" },
  { day: "2026-10-02", paid: true, tickets: 4, source: "google" },
  { day: "2026-10-02", paid: true, tickets: 1, source: "partners" },
];

const all = buildTraffic({ daily, sourceUsers, totalUsers, steps, partnerCodes: partners, src: "all", orders, days });
assert.equal(all.sessions, 170);
assert.equal(all.users, 120, "All sources = the unique users of the period, not a sum of rows");
assert.equal(all.engagementRate, 56.47, "96 engaged / 170");
assert.equal(all.leads, 4);
assert.equal(all.signups, 3);
assert.equal(all.conversion, 1.76, "3 signups / 170 sessions, percent");
assert.deepEqual(all.daily[0], { day: "2026-10-01", meta: 100, google: 40, partners: 0, no_utm: 0, other: 0 });
assert.deepEqual(all.daily[1], { day: "2026-10-02", meta: 0, google: 0, partners: 10, no_utm: 20, other: 0 });

const home = all.funnels.home;
assert.deepEqual(home.map((s) => [s.key, s.sessions]), [["visited", 70], ["picked", 30], ["flights", 20], ["summary", 10], ["confirmed", 3], ["purchased", 1]], "sagi's 10 homepage sessions count as visited");
assert.equal(home[1].pct, 42.86, "% of visited");
assert.deepEqual(all.funnels.artist.map((s) => s.sessions), [40, 20, 0, 0, 0, 0]);
assert.deepEqual(all.funnels.event.map((s) => s.key), ["visited", "flights", "summary", "confirmed", "purchased"], "they landed inside the order - no 'picked an event' step");
assert.equal(all.funnels.event[0].sessions, 40);
assert.equal(all.otherEntries, 20, "the football category landing");

const meta = all.sources.find((s) => s.bucket === "meta")!;
assert.equal(meta.sessions, 100);
assert.equal(meta.users, 70);
assert.equal(meta.rows[0].users, 70);
assert.equal(meta.confirmed, 3);
assert.equal(meta.purchased, 1);
assert.equal(meta.signups, 1);
assert.equal(meta.rows[0].sourceMedium, "facebook / cpc");
assert.deepEqual(all.sources.map((s) => s.bucket), ["meta", "google", "no_utm", "partners"], "by sessions, empty buckets left out");

assert.equal(all.landing[0].page, "/");
assert.equal(all.landing[0].sessions, 70);
assert.equal(all.landing[0].kind, "home");
assert.equal(all.landing.find((l) => l.page === "/order/1031")!.purchased, 2);

const fb = buildTraffic({ daily, sourceUsers, totalUsers, steps, partnerCodes: partners, src: "meta", orders, days });
assert.equal(fb.sessions, 100);
assert.equal(fb.users, 70, "one source = the users of its rows");
assert.equal(fb.leads, 2);
assert.equal(fb.signups, 1);
assert.equal(fb.funnels.home[0].sessions, 60, "sagi's homepage sessions are not Meta's");
assert.equal(fb.funnels.event[0].sessions, 0);
assert.deepEqual(fb.sources.map((s) => s.bucket), ["meta"]);

const none = buildTraffic({ daily: [], sourceUsers: [], totalUsers: 0, steps: [], partnerCodes: partners, src: "all", orders: [], days });
assert.equal(none.engagementRate, null);
assert.equal(none.conversion, null);
assert.equal(none.funnels.home[1].pct, null, "no visit -> no percent");

console.log("marketing-traffic selftest: ok");

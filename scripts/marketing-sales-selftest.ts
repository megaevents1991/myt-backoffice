// Run: npx tsx scripts/marketing-sales-selftest.ts
import assert from "node:assert/strict";
import { buildSales, splitOrder, trendOf, NO_CATEGORY_KEY, type SaleTag } from "../lib/marketing/sales";
import { buildInfluencers } from "../lib/marketing/influencers";
import { influencerAlertCandidates, influencerFlag, pageAlertCandidates, pageFlag, pageTotals, PERF_ALERTS_MAX } from "../lib/marketing/perf-alerts";
import { normalizePage, pageSold, pageSubject } from "../lib/marketing/page-subject";
import { DEFAULT_MARKETING_SETTINGS } from "../types/marketing.types";

// ---- trends
assert.deepEqual(trendOf(0, 0), { dir: "none", change: null });
assert.deepEqual(trendOf(3, 0), { dir: "new", change: null }, "nothing before = new, never +Infinity%");
assert.deepEqual(trendOf(12, 10), { dir: "up", change: 20 });
assert.deepEqual(trendOf(5, 10), { dir: "down", change: -50 });
assert.deepEqual(trendOf(0, 4), { dir: "down", change: -100 }, "sold out of the period");
assert.equal(trendOf(102, 100).dir, "flat", "under 5% is flat");

// ---- one order -> its events, revenue split by ticket price
const one = splitOrder({ id: 1, current: true, eventId: 812, revenue: 3000 }, [{ event_id: 812, name: "Oasis Manchester", date: "2026-07-11", number_of_ticket: 2, total_tickets_price: 600 }]);
assert.deepEqual(one, [{ orderId: 1, current: true, eventId: 812, name: "Oasis Manchester", date: "2026-07-11", tickets: 2, revenue: 3000 }]);
const two = splitOrder({ id: 2, current: true, eventId: null, revenue: 1000 }, [
  { event_id: 5, name: "A", number_of_ticket: 1, total_tickets_price: 300 },
  { event_id: 6, name: "B", number_of_ticket: 1, total_tickets_price: 100 },
]);
assert.deepEqual(two.map((l) => l.revenue), [750, 250], "split by ticket price");
assert.equal(splitOrder({ id: 3, current: false, eventId: 9, revenue: 100 }, [{ name: "no id", number_of_ticket: 1 }])[0].eventId, 9, "a lone item without an id takes the order's event");
assert.deepEqual(splitOrder({ id: 4, current: true, eventId: null, revenue: 90 }, [{ event_id: 1 }, { event_id: 2 }, { event_id: 3 }]).map((l) => l.revenue), [30, 30, 30], "no prices = equal shares");

// ---- the breakdown
const tag = (type: string, slug: string, name: string, nameEnglish: string | null = null): SaleTag => ({ type, slug, name, nameEnglish });
const tags = new Map<number, SaleTag[]>([
  [1, [tag("vertical", "music", "מוסיקה", "Music"), tag("artist", "oasis", "אואזיס", "Oasis"), tag("genre", "rock", "רוק", "Rock"), tag("city", "manchester", "מנצ'סטר")]],
  [2, [tag("vertical", "football", "כדורגל", "Football"), tag("team", "arsenal", "ארסנל", "Arsenal"), tag("team", "tottenham", "טוטנהאם", "Tottenham"), tag("league", "premier-league", "ליגה אנגלית", "Premier League")]],
  [3, [tag("vertical", "football", "כדורגל", "Football"), tag("team", "arsenal", "ארסנל", "Arsenal"), tag("team", "arsenal", "ארסנל", "Arsenal")]],
]);
const events = new Map([
  [1, { name: "אואזיס מנצ'סטר", nameEnglish: "Oasis Manchester", date: "2026-07-11" }],
  [2, { name: "ארסנל - טוטנהאם", nameEnglish: null, date: "2026-11-22" }],
]);
const line = (orderId: number, current: boolean, eventId: number | null, tickets: number, revenue: number, name = "") => ({ orderId, current, eventId, name, date: null, tickets, revenue });
const view = buildSales({
  lines: [
    line(1, true, 1, 2, 2000),
    line(2, true, 1, 4, 4000),
    line(3, true, 2, 2, 1500),
    line(4, true, 3, 3, 1800, "Arsenal - Chelsea"),
    line(5, false, 1, 2, 1900),
    line(6, false, 2, 4, 3000),
    line(7, true, null, 1, 500, "Some old event"),
  ],
  tagsByEvent: tags,
  events,
});
assert.deepEqual(view.totals, { orders: 5, tickets: 12, revenue: 9800, prevOrders: 2, prevTickets: 6, prevRevenue: 4900, trend: { dir: "up", change: 100 } });
assert.equal(view.events[0].label, "אואזיס מנצ'סטר", "the event's own name, most tickets first");
assert.equal(view.events[0].orders, 2);
assert.equal(view.events[0].eventId, 1);
assert.equal(view.events[0].sublabel, "2026-07-11");
assert.ok(view.events.some((e) => e.label === "Arsenal - Chelsea"), "an event with no row keeps the order's name");
assert.ok(view.events.some((e) => e.label === "Some old event" && e.eventId === null), "no event id = grouped by name");
assert.deepEqual(view.artists.map((a) => [a.label, a.tickets, a.prevTickets, a.trend.dir]), [["אואזיס", 6, 2, "up"]]);
assert.equal(view.artists[0].sublabel, "Oasis");
assert.deepEqual(view.teams.map((t) => [t.label, t.tickets]), [["ארסנל", 5], ["טוטנהאם", 2]], "a derby counts for both teams; a tag listed twice counts once");
assert.equal(view.teams[1].trend.dir, "down", "Tottenham 4 -> 2");
assert.deepEqual(view.categories.map((c) => [c.key, c.tickets]), [["vertical:music", 6], ["vertical:football", 5], [NO_CATEGORY_KEY, 1]], "an event with no vertical lands in 'No category'");
assert.deepEqual(view.leagues.map((l) => l.tickets), [2]);
assert.deepEqual(view.genres.map((g) => g.label), ["רוק"]);
assert.equal(view.bestArtist?.label, "אואזיס");
assert.equal(view.bestTeam?.label, "ארסנל");
assert.deepEqual(view.rising.map((r) => [r.label, r.group]), [["אואזיס", "artist"], ["ארסנל", "team"]], "Oasis 2 -> 6 before Arsenal 4 -> 5; Tottenham fell, so it is not rising");
assert.equal(buildSales({ lines: [], tagsByEvent: new Map(), events: new Map() }).bestArtist, null, "nothing sold = no leader");

// ---- pages: what a page sells
assert.deepEqual(pageSubject("/order/812"), { kind: "event", eventId: 812 });
assert.deepEqual(pageSubject("/order/812/flights?step=2"), { kind: "event", eventId: 812 });
assert.deepEqual(pageSubject("/c/Music/Artists/Oasis/"), { kind: "category", path: "/c/music/artists/oasis" });
assert.equal(pageSubject("/"), null, "the homepage sells nothing of its own");
assert.equal(pageSubject("/cancellation"), null);
assert.equal(pageSubject("/c/"), null, "the bare /c/ is not a category");
assert.equal(pageSubject("(not set)"), null);
assert.equal(normalizePage("/c/football/?utm_source=x"), "/c/football");
const eventOrders = new Map([[1, { orders: 3, prevOrders: 1 }], [2, { orders: 0, prevOrders: 2 }], [9, { orders: 5, prevOrders: 5 }]]);
assert.deepEqual(pageSold(new Set([1, 2]), eventOrders), { sold: 3, prevSold: 3 });
assert.deepEqual(pageSold(new Set([7]), eventOrders), { sold: 0, prevSold: 0 }, "its events sold nothing = 0, not null");
assert.equal(pageSold(undefined, eventOrders), null, "no subject = null");
assert.equal(pageSold(new Set(), eventOrders), null, "a category with no tags (the artists hub) = null");

// GA4's sessions per page; "(not set)" is not a page.
const pages = pageTotals([
  { landingPage: "/order/812", eventName: "session_start", sessions: 900 },
  { landingPage: "(not set)", eventName: "session_start", sessions: 5000 },
]);
assert.deepEqual([...pages.keys()], ["/order/812"]);

const ps = { page_alert_days: 7, page_min_sessions: 200, page_hot_pct: 1 };
assert.equal(pageFlag({ sessions: 900, sold: 0 }, ps), "no_sales");
assert.equal(pageFlag({ sessions: 300, sold: 6 }, ps), "selling", "6 of 300 = 2% >= 1%");
assert.equal(pageFlag({ sessions: 150, sold: 0 }, ps), null, "150 sessions is under the bar - not judged");
assert.equal(pageFlag({ sessions: 5000, sold: null }, ps), null, "a page that sells nothing of its own is never judged");
assert.equal(pageFlag({ sessions: 1000, sold: 1 }, ps), null, "one sale is not 'selling'");
assert.equal(pageFlag({ sessions: 1000, sold: 5 }, ps), null, "0.5% is under 1%");

const pg = (page: string, sessions: number, sold: number | null, prevSessions = 0, prevSold: number | null = 0) => ({ page, sessions, sold, prevSessions, prevSold });
const pageCands = pageAlertCandidates({ pages: [pg("/order/812", 900, 0, 450, 1), pg("/order/900", 300, 6, 300, 2), pg("/", 5000, null)], settings: ps, open: new Set() });
assert.deepEqual(pageCands.map((c) => [c.kind, c.key]), [["page_no_sales", "/order/812"], ["page_converting", "/order/900"]]);
assert.match(pageCands[0].title, /900 sessions in 7 days, no Paid order of what it sells · sessions \+100% vs the 7 days before/);
assert.match(pageCands[1].title, /6 Paid orders against 300 sessions \(2%\) in 7 days · orders \+200% vs the 7 days before/);
assert.equal(pageCands[1].payload.rate_pct, 2);

// The top PERF_ALERTS_MAX by sessions, plus an open one that still qualifies (no re-mail when two swap places).
const many = Array.from({ length: 6 }, (_, i) => pg(`/order/${i}`, 1000 - i * 100, 0));
const top = pageAlertCandidates({ pages: many, settings: ps, open: new Set() });
assert.equal(top.length, PERF_ALERTS_MAX);
assert.deepEqual(top.map((c) => c.key), ["/order/0", "/order/1", "/order/2"]);
const kept = pageAlertCandidates({ pages: many, settings: ps, open: new Set(["page_no_sales:/order/5"]) });
assert.deepEqual(kept.map((c) => c.key), ["/order/0", "/order/1", "/order/2", "/order/5"], "the open alert stays while it qualifies");
const gone = pageAlertCandidates({ pages: [pg("/order/5", 100, 0)], settings: ps, open: new Set(["page_no_sales:/order/5"]) });
assert.equal(gone.length, 0, "below the bar = no longer a candidate (the run resolves it)");

// ---- influencers
const is = { influencer_alert_days: 14, influencer_min_visitors: 30, influencer_hot_orders: 2 };
assert.equal(influencerFlag({ visitors: 37, paid: 0 }, is), "no_sales");
assert.equal(influencerFlag({ visitors: 29, paid: 0 }, is), null, "under the visitors bar");
assert.equal(influencerFlag({ visitors: 5, paid: 2 }, is), "selling", "selling needs no traffic bar");
assert.equal(influencerFlag({ visitors: 300, paid: 1 }, is), null, "one sale: neither");

const inf = buildInfluencers({
  partners: [
    { code: "sagi", name: "שגיא", active: true },
    { code: "michaela", name: "מיכאלה", active: true },
    { code: "OASISTRUEFANS", name: "איתי כספי", active: true },
    { code: "sleepy", name: "Sleepy", active: false },
  ],
  visitors: new Map([["sagi", 37], ["michaela", 33], ["oasistruefans", 11]]),
  prevVisitors: new Map([["sagi", 20], ["michaela", 40]]),
  orders: [
    { code: "SAGI", current: true, paid: true, tickets: 2, revenue: 3000, commission: 100 },
    { code: "sagi", current: true, paid: true, tickets: 4, revenue: 6000, commission: 200 },
    { code: "sagi", current: true, paid: false, tickets: 0, revenue: 0, commission: 0 },
    { code: "sagi", current: false, paid: true, tickets: 2, revenue: 2500, commission: 100 },
    { code: "OASISTRUEFANS", current: true, paid: true, tickets: 2, revenue: 2800, commission: 0 },
    { code: "unknown", current: true, paid: true, tickets: 2, revenue: 9999, commission: 0 },
  ],
  settings: is,
});
assert.deepEqual(inf.rows.map((r) => r.code), ["sagi", "OASISTRUEFANS", "michaela"], "by revenue; an influencer with nothing either way is left out; an unknown code is not an influencer");
const sagi = inf.rows[0];
assert.deepEqual([sagi.visitors, sagi.leads, sagi.paid, sagi.prevPaid, sagi.tickets, sagi.revenue, sagi.commission], [37, 3, 2, 1, 6, 9000, 300], "codes match case-insensitively");
assert.equal(sagi.flag, "selling");
assert.equal(sagi.conversion, 5.41);
assert.deepEqual(sagi.trend, { dir: "up", change: 100 });
assert.equal(inf.rows.find((r) => r.code === "michaela")?.flag, "no_sales");
assert.equal(inf.rows.find((r) => r.code === "michaela")?.visitorsTrend.dir, "down");
assert.equal(inf.topSeller?.code, "sagi");
assert.equal(inf.topTraffic?.code, "sagi");
assert.equal(inf.bestConversion?.code, "sagi", "OASISTRUEFANS converts better but has only 11 visitors");
assert.deepEqual([inf.totals.visitors, inf.totals.paid, inf.totals.revenue], [81, 3, 11800]);

const infCands = influencerAlertCandidates({ rows: inf.rows, settings: is, open: new Set() });
assert.deepEqual(infCands.map((c) => [c.kind, c.key]), [["influencer_no_sales", "michaela"], ["influencer_selling", "sagi"]]);
assert.match(infCands[0].title, /^מיכאלה \(michaela\): 33 visitors in 14 days, no Paid order/);
assert.match(infCands[1].title, /2 Paid orders from 37 visitors in 14 days · orders \+100% vs the 14 days before/);

// Defaults are sane: the rules read every key they need from the settings.
assert.equal(pageFlag({ sessions: DEFAULT_MARKETING_SETTINGS.page_min_sessions, sold: 0 }, DEFAULT_MARKETING_SETTINGS), "no_sales");
assert.equal(influencerFlag({ visitors: 0, paid: DEFAULT_MARKETING_SETTINGS.influencer_hot_orders }, DEFAULT_MARKETING_SETTINGS), "selling");

console.log("marketing-sales selftest: ok");

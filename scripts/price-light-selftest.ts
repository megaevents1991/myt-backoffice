/**
 * Price-light engine selftest - pure functions only, no DB.
 * Run: node --env-file=.env.local scripts/price-light-selftest.ts
 */
import assert from "node:assert/strict";
import {
  BAG_USD, CONNECTION_USD, STAR_STEP_USD, NIGHT_USD, BREAKFAST_USD, TRANSFER_USD,
  ourPackageUsd, ourTicketUsd, ourNights, kindOf, competitorsFor, normalize,
  computeScopeLight, decidePriceDrop, pickRuleMatch, candidateCoversDate, signedUsd,
  type PricedEvent, type LatestMatch,
} from "../lib/services/price-light.ts";
import { UNKNOWN_ATTRS } from "../types/price-light.types.ts";

const NOW = "2026-09-10T12:00:00.000Z";
const base: PricedEvent = {
  type: "sports_event",
  name: "Real Madrid vs Barcelona",
  name_english: "Real Madrid vs Barcelona",
  date: "2026-10-26",
  def_date_depart: "2026-10-24",
  def_date_return: "2026-10-27",
  base_flight_price: 500,
  base_hotel_price: 400,
  tickets_and_rates: [{ price: 300, available: true }, { price: 800, available: true }],
  skip_flight: false,
  ticket_only_markup: 60,
  markup_ticket: null, markup_flight: null, markup_hotel: null,
  event_additional_markup: 0,
};
const m = (over: Partial<LatestMatch>): LatestMatch => ({
  competitor: "liveevents", status: "found", normalized_usd: 1000, raw: 1000,
  raw_currency: "USD", crawled_at: NOW, match_id: 1, ...over,
});

// our prices
assert.equal(ourPackageUsd(base), 500 + 400 + 300 + 175);
assert.equal(ourTicketUsd(base), 300 + 60);
assert.equal(ourNights(base), 3);
assert.equal(ourPackageUsd({ ...base, skip_flight: true }), null);
assert.equal(ourPackageUsd({ ...base, tickets_and_rates: [] }), null);
assert.equal(ourTicketUsd({ ...base, ticket_only_markup: null }), null);
assert.equal(ourPackageUsd({ ...base, markup_ticket: 50, markup_flight: 30, markup_hotel: 20, event_additional_markup: 10 }), 500 + 400 + 300 + 110);

// kinds and competitors
assert.equal(kindOf(base), "sports");
assert.equal(kindOf({ ...base, type: "music_live_event_dynamic" }), "music");
assert.equal(kindOf({ ...base, type: "tx_event" }), "sports");
assert.deepEqual(competitorsFor("sports", "package", ["liveevents", "livetickets"]), ["liveevents"]);
assert.deepEqual(competitorsFor("music", "package", ["liveevents", "ontour", "issta"]), ["liveevents", "ontour"]);
assert.deepEqual(competitorsFor("sports", "ticket", ["liveevents", "livetickets"]), ["livetickets"]);

// normalization
const n1 = normalize(1000, { ...UNKNOWN_ATTRS, bag_included: true }, { nights: 3 });
assert.equal(n1.normalizedUsd, 1000 - BAG_USD);
assert.equal(n1.partial, true);
const n2 = normalize(1000, { bag_included: false, direct_flight: false, hotel_stars: 4, nights: 4, breakfast: true, transfers: true }, { nights: 3 });
assert.equal(n2.normalizedUsd, 1000 + CONNECTION_USD - STAR_STEP_USD * 3 - NIGHT_USD - BREAKFAST_USD * 3 - TRANSFER_USD);
assert.equal(n2.partial, false);
assert.equal(n2.adjustments.length, 5);
const n3 = normalize(1000, { bag_included: false, direct_flight: true, hotel_stars: 2, nights: 2, breakfast: false, transfers: false }, { nights: 3 });
assert.equal(n3.normalizedUsd, 1000 + STAR_STEP_USD * 3 + NIGHT_USD);

// lights
const ours = 1375;
const sports = ["liveevents", "issta", "golasso"] as const;
assert.equal(computeScopeLight({ ourUsd: null, matches: [], competitors: [...sports], now: NOW }).light, "na");
assert.equal(computeScopeLight({ ourUsd: ours, matches: [], competitors: [...sports], now: NOW }).reason, "never");
const allNot = sports.map((c) => m({ competitor: c, status: "not_selling", normalized_usd: null }));
assert.equal(computeScopeLight({ ourUsd: ours, matches: allNot, competitors: [...sports], now: NOW }).light, "alone");
const half = [m({ competitor: "liveevents", status: "not_selling", normalized_usd: null })];
const halfLight = computeScopeLight({ ourUsd: ours, matches: half, competitors: [...sports], now: NOW });
assert.equal(halfLight.light, "unchecked");
assert.equal(halfLight.reason, "partial_coverage");
const green = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1600 })], competitors: [...sports], now: NOW });
assert.equal(green.light, "green"); assert.equal(green.diff_usd, -225);
const orange = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1300 })], competitors: [...sports], now: NOW });
assert.equal(orange.light, "orange"); assert.equal(orange.diff_usd, 75);
const red = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1100 }), m({ competitor: "issta", normalized_usd: 1500 })], competitors: [...sports], now: NOW });
assert.equal(red.light, "red"); assert.equal(red.diff_usd, 275); assert.equal(red.competitor, "liveevents");
assert.equal(computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1525 })], competitors: [...sports], now: NOW }).light, "orange"); // exactly -150 is orange
const stale = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1600, crawled_at: "2026-08-01T00:00:00.000Z" })], competitors: [...sports], now: NOW });
assert.equal(stale.light, "unchecked"); assert.equal(stale.reason, "stale");
const unsure = computeScopeLight({ ourUsd: ours, matches: [m({ status: "unsure", normalized_usd: null })], competitors: [...sports], now: NOW });
assert.equal(unsure.light, "unchecked"); assert.equal(unsure.reason, "unsure");

// price drop
assert.deepEqual(decidePriceDrop({ today: "2026-09-10", todayUsd: 1300, refUsd: 1400, current: null }), { usd: 100, from: 1400, until: "2026-09-24" });
assert.equal(decidePriceDrop({ today: "2026-09-10", todayUsd: 1360, refUsd: 1400, current: null }), null);
assert.equal(decidePriceDrop({ today: "2026-09-10", todayUsd: 1400, refUsd: 1400, current: null }), null); // rose then came back
const cur = { usd: 100, from: 1400, until: "2026-09-20" };
assert.deepEqual(decidePriceDrop({ today: "2026-09-10", todayUsd: 1300, refUsd: 1400, current: cur }), cur); // not extended
assert.equal(decidePriceDrop({ today: "2026-09-10", todayUsd: 1380, refUsd: 1400, current: cur }), null); // price rose back above from-50
assert.equal(decidePriceDrop({ today: "2026-09-21", todayUsd: 1300, refUsd: 1300, current: cur }), null); // expired
assert.equal(decidePriceDrop({ today: "2026-09-10", todayUsd: 1300, refUsd: null, current: null }), null); // no reference

// rule match
const cands = [
  { id: 1, title: "Barcelona vs Real Madrid", event_date: "2026-10-26" },
  { id: 2, title: "Real Madrid vs Atletico", event_date: "2026-10-26" },
  { id: 3, title: "Real Madrid - Barcelona", event_date: "2026-10-27" },
];
const pick = pickRuleMatch({ names: ["Real Madrid vs Barcelona", "ריאל מדריד ברצלונה"], date: "2026-10-26" }, cands);
assert.equal(pick?.candidate.id, 1);
assert.equal(pickRuleMatch({ names: ["Liverpool vs Arsenal"], date: "2026-11-09" }, cands), null);
assert.equal(pickRuleMatch({ names: ["Real Madrid"], date: "2026-10-26" }, cands), null); // ambiguous: two same-date candidates

// window listings (phase 2): no event_date, the travel window must contain our date
const winCands = [
  { id: 10, title: "ברצלונה-ריאל מדריד", event_date: null, travel_depart: "2026-10-23", travel_return: "2026-10-27" },
  { id: 11, title: "Real Madrid vs Barcelona", event_date: null, travel_depart: "2026-11-01", travel_return: "2026-11-04" },
  { id: 12, title: "Real Madrid vs Barcelona", event_date: null, travel_depart: null, travel_return: null }, // no window, no date -> never
];
assert.equal(candidateCoversDate(winCands[0], "2026-10-26"), true);
assert.equal(candidateCoversDate(winCands[0], "2026-10-23"), true);  // inclusive both ends
assert.equal(candidateCoversDate(winCands[0], "2026-10-28"), false);
assert.equal(candidateCoversDate(winCands[2], "2026-10-26"), false);
assert.equal(candidateCoversDate({ id: 1, title: "x", event_date: "2026-10-26", travel_depart: "2026-10-20", travel_return: "2026-10-30" }, "2026-10-27"), false); // a dated listing is date-only, window ignored
const winPick = pickRuleMatch({ names: ["Real Madrid vs Barcelona", "ריאל מדריד ברצלונה"], date: "2026-10-26" }, winCands);
assert.equal(winPick?.candidate.id, 10);
assert.equal(pickRuleMatch({ names: ["Real Madrid vs Barcelona"], date: "2026-10-30" }, winCands), null); // outside every window
assert.equal(pickRuleMatch({ names: ["Real Madrid vs Barcelona"], date: "2026-11-02" }, winCands)?.candidate.id, 11);

// A window longer than MAX_WINDOW_DAYS is a season, not a trip - it never covers our date,
// even when it contains it (final review, M1).
const seasonCand = { id: 13, title: "Real Madrid vs Barcelona", event_date: null, travel_depart: "2026-10-20", travel_return: "2026-11-09" }; // 20 days
assert.equal(candidateCoversDate(seasonCand, "2026-10-26"), false);
assert.equal(candidateCoversDate({ ...seasonCand, travel_return: "2026-11-03" }, "2026-10-26"), true); // exactly 14 days still counts
assert.equal(pickRuleMatch({ names: ["Real Madrid vs Barcelona"], date: "2026-10-26" }, [seasonCand]), null);

assert.equal(signedUsd(-180), "−$180");
assert.equal(signedUsd(35), "+$35");
assert.equal(signedUsd(0), "$0");

console.log("price-light selftest: all assertions passed");

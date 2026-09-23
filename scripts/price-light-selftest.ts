/**
 * Price-light engine selftest - pure functions only, no DB.
 * Run: node --env-file=.env.local scripts/price-light-selftest.ts
 */
import assert from "node:assert/strict";
import {
  BAG_USD, CONNECTION_USD, STAR_STEP_USD, NIGHT_USD, BREAKFAST_USD, TRANSFER_USD,
  NIGHTS_FALLBACK, NIGHT_RATE_MIN_USD, NIGHT_RATE_MAX_USD,
  ourPackageUsd, ourTicketUsd, ourNights, ourNightRateUsd, listingNights, nightsUncertaintyUsd,
  cheapestAvailableTicket, ourOfferLines, ourFromUsd, ourNetFlightUsd, ourNetHotelUsd,
  kindOf, competitorsFor, normalize,
  computeScopeLight, previewMarkupChange, LIGHT_RED_USD, decidePriceDrop, pickRuleMatch, candidateCoversDate, signedUsd, stampLightChange,
  nameTokens, ruleMatchScore, ruleSaysAbsent, isMultiMatchTitle, RULE_MATCH_MIN_SCORE, RULE_ABSENT_BELOW,
  LOW_COST_USD, isLowCostAirline, competitorOverrideHolds,
  type PricedEvent, type LatestMatch,
} from "../lib/services/price-light.ts";
import { UNKNOWN_ATTRS, type LightScopeDetail } from "../types/price-light.types.ts";
import { FLIGHT_MARGIN_USD, HOTEL_MARGIN_USD } from "../lib/services/price-margins.ts";
import {
  adviceBlock, altDateCandidates, altDatesFacts, cheaperTicketFact, markupCutFacts, nightsFact, priceAdviceFacts, supplierSwapFacts,
} from "../lib/services/price-advice.ts";
import { airlineFromCode, bagFrom, formatOfferLines, isMultiMatchText, parseOfferDetail } from "../lib/services/offer-detail.ts";

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
// skip_flight no longer hides the package price (Dor, 2026-09-11): our packages carry flight
// and hotel numbers either way, and the competitors sell the full package, so we want both
// pictures - package vs package AND ticket vs ticket.
assert.equal(ourPackageUsd({ ...base, skip_flight: true }), 500 + 400 + 300 + 175);
// ...but a package price is only a package price when there IS travel in it. A zero flight or
// a zero hotel would read as a confident green against a flight-inclusive competitor package.
assert.equal(ourPackageUsd({ ...base, base_flight_price: 0 }), null);
assert.equal(ourPackageUsd({ ...base, base_hotel_price: null }), null);
assert.equal(ourPackageUsd({ ...base, tickets_and_rates: [] }), null);
assert.equal(ourTicketUsd({ ...base, ticket_only_markup: null }), null);
assert.equal(ourPackageUsd({ ...base, markup_ticket: 50, markup_flight: 30, markup_hotel: 20, event_additional_markup: 10 }), 500 + 400 + 300 + 110);

// kinds and competitors
assert.equal(kindOf(base), "sports");
assert.equal(kindOf({ ...base, type: "music_live_event_dynamic" }), "music");
// A TixStock event with no tags loaded is still sports - the type alone says nothing (136 live
// MUSIC events are `tx_event`, which is why the tags below have to decide).
assert.equal(kindOf({ ...base, type: "tx_event" }), "sports");
assert.equal(kindOf({ ...base, type: "tx_event" }, ["music", "pop"]), "music");
assert.equal(kindOf({ ...base, type: "sports_event" }, ["football"]), "sports");
assert.equal(kindOf({ ...base, type: "music_event" }, []), "music");
assert.deepEqual(competitorsFor("sports", "package", ["liveevents", "livetickets"]), ["liveevents"]);
assert.deepEqual(competitorsFor("music", "package", ["liveevents", "ontour", "issta"]), ["liveevents", "ontour"]);
assert.deepEqual(competitorsFor("sports", "ticket", ["liveevents", "livetickets"]), ["livetickets"]);

// duration: the nights each side actually sells, and what one night is worth on THIS event
assert.equal(ourNights({ ...base, def_date_return: null }), null);        // no window = no guess (was a flat 3)
assert.equal(ourNights({ ...base, def_date_return: "2026-10-24" }), null); // return <= depart
// 2026-09-17: the rate is the NET hotel (base minus the rule's +$120), not the base itself
assert.equal(ourNightRateUsd(base), Math.round((400 - 120) / 3));          // our own net hotel, per night
assert.equal(ourNightRateUsd({ ...base, light_detail: { ours: { hotel: { usd: 300 } } } }), 100); // searched net wins
assert.equal(ourNightRateUsd({ ...base, base_hotel_price: 0 }), NIGHT_USD);        // no hotel number = fallback
assert.equal(ourNightRateUsd({ ...base, base_hotel_price: 100 }), NIGHT_RATE_MIN_USD); // hand-typed base (no margin) kept whole: 100/3, clamped up
assert.equal(ourNightRateUsd({ ...base, def_date_depart: null }), NIGHT_USD);      // no window = fallback
assert.equal(ourNightRateUsd({ ...base, base_hotel_price: 150 }), NIGHT_RATE_MIN_USD);     // net 30 -> 10/night, clamped up
assert.equal(ourNightRateUsd({ ...base, base_hotel_price: 9_000 }), NIGHT_RATE_MAX_USD);   // clamped down
// a detail page that said nothing still leaves the card's travel window to measure
assert.equal(listingNights(null, { travel_depart: "2026-10-24", travel_return: "2026-10-27" }), 3);
assert.equal(listingNights({ nights: 5 }, { travel_depart: "2026-10-24", travel_return: "2026-10-27" }), 5); // page wins
assert.equal(listingNights({ nights: "unknown" }, { travel_depart: null, travel_return: null }), "unknown");
assert.equal(listingNights(null, { travel_depart: "2026-08-01", travel_return: "2027-05-30" }), "unknown");  // a season, not a trip
assert.equal(listingNights(null, { travel_depart: "2026-10-27", travel_return: "2026-10-24" }), "unknown");  // inverted
// A stated count past the window ceiling is their typo (OnTour: return year 2027 -> 368 nights).
assert.equal(listingNights({ nights: 368 }, { travel_depart: "2026-11-04", travel_return: "2027-11-07" }), "unknown");
assert.equal(listingNights({ nights: 368 }, { travel_depart: "2026-11-04", travel_return: "2026-11-07" }), 3); // the window still answers
{
  const typo = normalize(1900, { ...UNKNOWN_ATTRS, nights: 368 }, { nights: 3, nightRateUsd: 150 });
  assert.equal(typo.normalizedUsd, 1900, "an impossible duration moves no money");
  assert.equal(typo.partial, true);
}

// nights doubt: unknown on either side costs one whole night; a wide gap costs half a night each
assert.equal(nightsUncertaintyUsd("unknown", 4, 138), 138);
assert.equal(nightsUncertaintyUsd(3, null, 138), 138);
assert.equal(nightsUncertaintyUsd(3, 4, 138), 0);            // 1-night gap is priced, not doubted
assert.equal(nightsUncertaintyUsd(2, 4, 138), 0);            // exactly NIGHT_GAP_FREE
assert.equal(nightsUncertaintyUsd(1, 4, 138), 69);           // 3-night gap: one night beyond, half rate
assert.equal(nightsUncertaintyUsd(7, 4, 100), 50);           // symmetric: they are longer

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
assert.equal(n3.uncertaintyUsd, 0);
assert.deepEqual(n3.nights, { ours: 3, theirs: 2 });
// the nights gap is priced at THIS event's night rate, not the flat fallback
const n4 = normalize(1000, { ...UNKNOWN_ATTRS, nights: 3 }, { nights: 4, nightRateUsd: 190 });
assert.equal(n4.normalizedUsd, 1000 + 190);
assert.equal(n4.adjustments.find((a) => a.key === "nights")?.usd, 190);
assert.equal(n4.uncertaintyUsd, 0);
// nights unknown on their side: no adjustment, and one night of doubt handed to the light
const n5 = normalize(1000, { ...UNKNOWN_ATTRS }, { nights: 4, nightRateUsd: 190 });
assert.equal(n5.normalizedUsd, 1000);
assert.equal(n5.uncertaintyUsd, 190);
assert.deepEqual(n5.nights, { ours: 4, theirs: "unknown" });
// our own window missing: no gap adjustment either way, per-night scaling falls back to 3 nights
const n6 = normalize(1000, { ...UNKNOWN_ATTRS, nights: 5, hotel_stars: 4 }, { nights: null, nightRateUsd: 190 });
assert.equal(n6.normalizedUsd, 1000 - STAR_STEP_USD * NIGHTS_FALLBACK);
assert.equal(n6.partial, true);
assert.equal(n6.uncertaintyUsd, 190);

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
// a duration we could not see widens the band both ways: the same numbers that are red/green
// with a measured night count are only orange when the competitor never published theirs.
const redBand = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1100, uncertainty_usd: 200 })], competitors: [...sports], now: NOW });
assert.equal(redBand.light, "orange"); assert.equal(redBand.diff_usd, 275); assert.equal(redBand.uncertainty_usd, 200);
const greenBand = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1600, uncertainty_usd: 200 })], competitors: [...sports], now: NOW });
assert.equal(greenBand.light, "orange");
// past the widened threshold it is still red - doubt softens a verdict, it never hides one
assert.equal(computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1000, uncertainty_usd: 200 })], competitors: [...sports], now: NOW }).light, "red");
// the cheapest competitor still wins the comparison, and ITS doubt is the one applied
const mixed = computeScopeLight({
  ourUsd: ours,
  matches: [m({ normalized_usd: 1100, uncertainty_usd: 200 }), m({ competitor: "issta", normalized_usd: 1200, uncertainty_usd: 0 })],
  competitors: [...sports], now: NOW,
});
assert.equal(mixed.competitor, "liveevents"); assert.equal(mixed.light, "orange");
const stale = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1600, crawled_at: "2026-08-01T00:00:00.000Z" })], competitors: [...sports], now: NOW });
assert.equal(stale.light, "unchecked"); assert.equal(stale.reason, "stale");
const unsure = computeScopeLight({ ourUsd: ours, matches: [m({ status: "unsure", normalized_usd: null })], competitors: [...sports], now: NOW });
assert.equal(unsure.light, "unchecked"); assert.equal(unsure.reason, "unsure");

// every competitor carries its OWN verdict, by the same rule as the scope's
const matrix = computeScopeLight({
  ourUsd: ours,
  matches: [
    m({ competitor: "liveevents", normalized_usd: 1100 }),                       // +275 -> red
    m({ competitor: "issta", normalized_usd: 1300 }),                            // +75  -> orange
    m({ competitor: "golasso", normalized_usd: 1600 }),                          // -225 -> green
  ],
  competitors: [...sports], now: NOW,
});
assert.equal(matrix.light, "red");                       // the scope answers to the CHEAPEST
assert.equal(matrix.competitor, "liveevents");
assert.equal(matrix.per_competitor.liveevents?.light, "red");
assert.equal(matrix.per_competitor.liveevents?.diff_usd, 275);
assert.equal(matrix.per_competitor.issta?.light, "orange");
assert.equal(matrix.per_competitor.golasso?.light, "green");
assert.equal(matrix.per_competitor.golasso?.diff_usd, -225);
// a competitor's own doubt widens its own band, not the others'
const mixedDoubt = computeScopeLight({
  ourUsd: ours,
  matches: [m({ competitor: "liveevents", normalized_usd: 1100, uncertainty_usd: 200 }), m({ competitor: "issta", normalized_usd: 1100 })],
  competitors: [...sports], now: NOW,
});
assert.equal(mixedDoubt.per_competitor.liveevents?.light, "orange");  // same gap, doubted
assert.equal(mixedDoubt.per_competitor.issta?.light, "red");          // same gap, measured
// a competitor with no usable price gets no light at all - never a green by omission
const noPrice = computeScopeLight({
  ourUsd: ours,
  matches: [m({ normalized_usd: 1100 }), m({ competitor: "issta", status: "not_selling", normalized_usd: null })],
  competitors: [...sports], now: NOW,
});
assert.equal(noPrice.per_competitor.issta?.light, undefined);
assert.equal(noPrice.per_competitor.issta?.diff_usd, null);

// our own side, described from the pricing rule
const lines = ourOfferLines({
  ...base,
  tickets_and_rates: [
    { price: 300, available: true, category: "CAT3", description: "מאחורי השער טבעת עליונה" },
    { price: 200, available: false, category: "CAT1", description: "לא זמין" },
  ],
});
assert.deepEqual(lines.map((l) => l.key), ["flight", "hotel", "ticket", "markup"]);
assert.ok(lines[0].detail.includes("ישירה"));
assert.equal(lines[0].usd, 400);                       // NET: base 500 minus the rule's +$100
assert.ok(lines[0].detail.includes("ללא תוספת $100"));
assert.ok(lines[0].detail.includes("בסיס פחות תוספת"));
assert.ok(lines[1].detail.includes("3★"));
assert.ok(lines[1].detail.includes("3 לילות"));
assert.equal(lines[1].usd, 280);                       // NET: base 400 minus the rule's +$120
assert.ok(lines[1].detail.includes("ללא תוספת $120"));
assert.equal(lines[3].label, "עמלות לקוח");
assert.equal(lines[3].usd, 175);
// the ticket is NAMED - the one field we really do store - and it is the cheapest AVAILABLE one
assert.ok(lines[2].detail.includes("CAT3"));
assert.ok(lines[2].detail.includes("מאחורי השער"));
assert.equal(lines[2].usd, 300);
assert.equal(cheapestAvailableTicket(base)?.price, 300);
// no travel window -> the nights claim is dropped, not guessed
assert.ok(ourOfferLines({ ...base, def_date_depart: null })[1].detail.includes("לא ידוע"));
// missing components say so instead of showing $0
assert.ok(ourOfferLines({ ...base, base_flight_price: 0 })[0].detail.includes("אין מחיר"));
assert.ok(ourOfferLines({ ...base, tickets_and_rates: [] })[2].detail.includes("אין כרטיס"));

// the light's "from" price: the SITE price minus the rule's margins (Dor, 2026-09-17)
assert.equal(FLIGHT_MARGIN_USD, 100);
assert.equal(HOTEL_MARGIN_USD, 120);
assert.equal(ourFromUsd(base), 400 + 280 + 300 + 175);

// "הוזל" popover preview: same price functions, same band as the engine
const from0 = ourFromUsd(base) as number; // base carries no event_additional_markup
assert.equal(previewMarkupChange(base, "package", 100, null).ourUsd, from0 + 100);
assert.equal(previewMarkupChange(base, "package", null, null).ourUsd, from0);
assert.deepEqual(previewMarkupChange(base, "ticket", null, 200), { ourUsd: null, diffUsd: null, light: null });
assert.equal(previewMarkupChange(base, "ticket", 40, 200).ourUsd, 340);
const justRed = previewMarkupChange(base, "package", 100, from0 + 100 - (LIGHT_RED_USD + 1));
assert.equal(justRed.diffUsd, LIGHT_RED_USD + 1);
assert.equal(justRed.light, "red");
assert.equal(previewMarkupChange(base, "package", 90, from0 + 100 - (LIGHT_RED_USD + 1)).light, "orange");
assert.equal(previewMarkupChange(base, "package", 100, from0 + 100 - (LIGHT_RED_USD + 1), 5).light, "orange"); // doubt widens the band
assert.equal(ourPackageUsd(base), 500 + 400 + 300 + 175);                        // site price unchanged
const searched: PricedEvent = { ...base, light_detail: { ours: { flight: { usd: 380 }, hotel: { usd: 260 } } } };
assert.equal(ourFromUsd(searched), 380 + 260 + 300 + 175);                        // the last search wins
assert.equal(ourPackageUsd(searched), 500 + 400 + 300 + 175);
const zeroFlight: PricedEvent = { ...base, light_detail: { ours: { flight: { usd: 0 }, hotel: { usd: 260 } } } };
assert.equal(ourNetFlightUsd(zeroFlight), 400);                                   // 0 = no search -> base minus margin
assert.equal(ourNetHotelUsd(zeroFlight), 260);
assert.equal(ourFromUsd(zeroFlight), 400 + 260 + 300 + 175);
assert.equal(ourPackageUsd(zeroFlight), 500 + 400 + 300 + 175);
assert.equal(ourNetFlightUsd({ ...base, light_detail: { ours: { flight: { usd: null }, hotel: null } } }), 400);
assert.equal(ourFromUsd({ ...base, base_flight_price: 80 }), 80 + 280 + 300 + 175); // at/below the margin = hand-typed, never carried one
assert.ok(ourOfferLines({ ...base, base_flight_price: 80 })[0].detail.includes("בסיס ידני"));
assert.equal(ourNetHotelUsd({ ...base, base_hotel_price: 120 }), 120);
assert.equal(ourPackageUsd({ ...base, base_flight_price: 80 }), 80 + 400 + 300 + 175);
assert.equal(ourFromUsd({ ...base, base_flight_price: 0, light_detail: { ours: { flight: { usd: 380 } } } }), null); // no site price = no from price
assert.equal(ourFromUsd({ ...base, tickets_and_rates: [] }), null);
for (const e of [base, searched, zeroFlight]) {
  const ls = ourOfferLines(e);
  assert.equal(ls.length, 4);
  assert.ok(Math.abs(ls.reduce((sum, l) => sum + (l.usd ?? 0), 0) - (ourFromUsd(e) ?? NaN)) <= 1);
}
const searchedLines = ourOfferLines(searched);
assert.equal(searchedLines[0].usd, 380);
assert.ok(searchedLines[0].detail.includes("מהחיפוש האחרון"));
assert.equal(searchedLines[1].usd, 260);
assert.ok(searchedLines[1].detail.includes("מהחיפוש האחרון"));

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

// light_changed_at: the stamp behind "השתנה השבוע" - renewed only when the light MOVED
{
  const sd = (over: Partial<LightScopeDetail> = {}): LightScopeDetail => ({
    light: "green", diff_usd: -200, our_usd: 800, competitor: "liveevents", raw: 1000,
    raw_currency: "USD", normalized_usd: 1000, adjustments: [], partial: false,
    uncertainty_usd: 0, nights: null, reason: null, crawled_at: NOW, match_id: 1,
    per_competitor: {}, ...over,
  });
  const STAMP = "2026-09-01T00:00:00.000Z";
  // never had a light -> this IS its first one, so it changed now
  assert.equal(stampLightChange(sd(), "green", null, undefined, NOW).light_changed_at, NOW);
  // unchanged light, previous stamp -> carried, never renewed
  assert.equal(stampLightChange(sd(), "green", "green", sd({ light_changed_at: STAMP }), NOW).light_changed_at, STAMP);
  // unchanged light, no stamp (a row written before this existed) -> stays ABSENT, not "now"
  assert.equal(stampLightChange(sd(), "green", "green", sd(), NOW).light_changed_at, undefined);
  // the light moved -> stamped now, whatever the old stamp said
  assert.equal(stampLightChange(sd(), "red", "green", sd({ light_changed_at: STAMP }), NOW).light_changed_at, NOW);
  // the previous EFFECTIVE light is the COLUMN, not the detail underneath it: an override forces
  // the column, so a detail-first comparison would re-stamp every overridden event nightly.
  assert.equal(
    stampLightChange(sd({ light: "orange" }), "red", "red", sd({ light: "orange", light_changed_at: STAMP }), NOW).light_changed_at,
    STAMP,
  );
  // the detail is only the FALLBACK, for a scope whose column was never written
  assert.equal(stampLightChange(sd(), "green", null, sd({ light_changed_at: STAMP }), NOW).light_changed_at, STAMP);
}

// ---- matching coverage (2026-09-14): real misses from prod, each one a regression guard ----
// geresh is part of the word, competition names and years are noise
assert.deepEqual(nameTokens("ליגת האלופות: מנצ'סטר סיטי - פריז סן ז'רמן 2026-2027"), ["מנצסטר", "סיטי", "פריז", "סן", "זרמן"]);
// one typo on a 5+ letter word is the same name; four letters is not enough to risk it
assert.ok(ruleMatchScore({ names: ["הילרי דאף", "Hilary Duff"] }, { id: 1, title: "הילארי דאף", event_date: null }) >= RULE_MATCH_MIN_SCORE);
assert.ok(ruleMatchScore({ names: ["ריאל מדריד - ויאריאל"] }, { id: 1, title: "ריאל מדריד vs וויאריאל", event_date: null }) >= RULE_MATCH_MIN_SCORE);
assert.ok(ruleMatchScore({ names: ["מנצ'טסר יונייטד - טוטנהאם"] }, { id: 1, title: "מנצ'סטר יונייטד vs טוטנהאם הוטספר", event_date: null }) >= RULE_MATCH_MIN_SCORE);
assert.equal(ruleMatchScore({ names: ["ליון"] }, { id: 1, title: "ליאון", event_date: null }), 0);
// a short, complete competitor title counts both ways...
assert.ok(ruleMatchScore({ names: ["איי סי מילאן - לצ'ה", "AC Milan vs US Lecce"] }, { id: 1, title: "מילאן | לצ'ה", event_date: null }) >= RULE_MATCH_MIN_SCORE);
assert.ok(ruleMatchScore({ names: ["ליגת האלופות: ארסנל - ליל"] }, { id: 1, title: "ארסנל vs ליל", event_date: null }) >= RULE_MATCH_MIN_SCORE);
// ...but a title naming ONE side never claims a fixture by being contained in it (review 2026-09-14:
// Golasso emits a bare club title when a card shows a single team)
assert.ok(ruleMatchScore({ names: ["ריאל מדריד - סביליה"] }, { id: 1, title: "ריאל", event_date: null }) < RULE_MATCH_MIN_SCORE);
assert.ok(ruleMatchScore({ names: ["ריאל מדריד - סביליה"] }, { id: 1, title: "ריאל מדריד", event_date: null }) < RULE_MATCH_MIN_SCORE);
assert.ok(ruleMatchScore({ names: ["ברצלונה - קומו"] }, { id: 1, title: "ברצלונה-קומו", event_date: null }) >= RULE_MATCH_MIN_SCORE);
// a bag the page EXCLUDES is not a bag
assert.equal(bagFrom("הטיסה לא כוללת מזוודה, ניתן להוסיף בתשלום"), "טרולי בלבד");
assert.equal(bagFrom("לא כולל מזוודה"), "טרולי בלבד");
// a different fixture sharing a club word stays a different fixture
assert.ok(ruleMatchScore({ names: ["מנצ'סטר סיטי - ברנטפורד"] }, { id: 1, title: "מנצ'סטר יונייטד vs טוטנהאם", event_date: null }) < RULE_ABSENT_BELOW);

// duplicate listings of one fixture (one per hotel tier) are not ambiguity: the cheaper copy wins
const dupes = [
  { id: 30, title: "ארסנל vs ליל", event_date: "2026-10-13", price_usd: 1686 },
  { id: 31, title: "ארסנל vs ליל", event_date: "2026-10-13", price_usd: 1484 },
  { id: 32, title: "אתלטיקו מדריד vs מנצ'סטר יונייטד", event_date: "2026-10-13", price_usd: 1754 },
];
assert.equal(pickRuleMatch({ names: ["ליגת האלופות: ארסנל - ליל"], date: "2026-10-13" }, dupes)?.candidate.id, 31);
// ...including copies spelled differently (event #724 on Golasso)
assert.equal(pickRuleMatch({ names: ["ברצלונה - ויאריאל"], date: "2026-11-22" }, [
  { id: 68, title: "ברצלונה vs ויאריאל", event_date: "2026-11-22", price_usd: 1520 },
  { id: 61, title: "ברצלונה vs וויאריאל", event_date: "2026-11-22", price_usd: 1052 },
])?.candidate.id, 61);
// a multi-fixture bundle is never the like-for-like offer, and never evidence of absence
const bundle = [{ id: 40, title: "ליברפול-סיטי+יונייטד-טוטנהאם", event_date: null, travel_depart: "2026-10-08", travel_return: "2026-10-12" }];
assert.equal(isMultiMatchTitle(bundle[0].title), true);
assert.equal(pickRuleMatch({ names: ["ליברפול - מנצ'סטר סיטי"], date: "2026-10-11" }, bundle), null);
assert.equal(ruleSaysAbsent({ names: ["ליברפול - מנצ'סטר סיטי"] }, bundle), false);
// ...while a fixture the bundle does NOT contain is absent from it
assert.equal(ruleSaysAbsent({ names: ["ווסטהאם יונייטד - קווינס פארק ריינג'רס", "West Ham United FC vs Queens Park Rangers"] }, bundle), true);
// on-date listings of other artists = they do not sell ours; one strong name a day off = not absence
assert.equal(ruleSaysAbsent({ names: ["הילרי דאף", "Hilary Duff"] }, [{ id: 50, title: "סם סמית'", event_date: "2026-09-15" }]), true);
assert.equal(ruleSaysAbsent({ names: ["ווסטהאם יונייטד - ק.פ.ר"] }, [{ id: 51, title: "ווסטהאם יונייטד vs ק.פ.ר", event_date: "2026-10-09" }]), false);

// quote-only competitors surface on the per-competitor answer
const quoted = computeScopeLight({
  ourUsd: 1500, competitors: ["liveevents", "golasso"], now: "2026-09-14T00:00:00Z",
  matches: [
    { competitor: "liveevents", status: "unsure", normalized_usd: null, raw: null, raw_currency: null, crawled_at: "2026-09-13T00:00:00Z", match_id: 1, quote_only: true },
    { competitor: "golasso", status: "found", normalized_usd: 1400, raw: 1400, raw_currency: "USD", crawled_at: "2026-09-13T00:00:00Z", match_id: 2 },
  ],
});
assert.equal(quoted.per_competitor.liveevents?.quote_only, true);
assert.equal(quoted.per_competitor.golasso?.quote_only, undefined);

// "sells it, publishes no price" is its own reason - not "partial coverage", not "unsure"
const q = (c: "liveevents" | "golasso" | "issta", over: Record<string, unknown>) =>
  ({ competitor: c, status: "not_selling" as const, normalized_usd: null, raw: null, raw_currency: null, crawled_at: "2026-09-13T00:00:00Z", match_id: 9, ...over });
const QNOW = "2026-09-14T00:00:00Z";
const quoteRest = computeScopeLight({ ourUsd: 1500, competitors: ["liveevents", "golasso"], now: QNOW,
  matches: [q("liveevents", { status: "unsure", quote_only: true }), q("golasso", {})] });
assert.equal(quoteRest.light, "unchecked");
assert.equal(quoteRest.reason, "quote_only");
const quoteOnlyAll = computeScopeLight({ ourUsd: 1500, competitors: ["liveevents"], now: QNOW,
  matches: [q("liveevents", { status: "unsure", quote_only: true })] });
assert.equal(quoteOnlyAll.reason, "quote_only");
// a competitor that never answered next to the quote = still a coverage hole
const quoteAndHole = computeScopeLight({ ourUsd: 1500, competitors: ["liveevents", "golasso", "issta"], now: QNOW,
  matches: [q("liveevents", { status: "unsure", quote_only: true }), q("golasso", {})] });
assert.equal(quoteAndHole.reason, "partial_coverage");
// a plain unsure (not a quote) keeps its old answer
const plainUnsure = computeScopeLight({ ourUsd: 1500, competitors: ["liveevents", "golasso"], now: QNOW,
  matches: [q("liveevents", { status: "unsure" }), q("golasso", {})] });
assert.equal(plainUnsure.reason, "partial_coverage");
// a stale quote is stale, not a quote
const staleQuote = computeScopeLight({ ourUsd: 1500, competitors: ["liveevents"], now: "2026-10-30T00:00:00Z",
  matches: [q("liveevents", { status: "unsure", quote_only: true })] });
assert.equal(staleQuote.reason, "stale");

// ---- offer contents (partner format) - shapes copied from stored prod detail pages ----
assert.equal(bagFrom("טיסות אלעל כוללות טרולי עד 8 קילו"), "טרולי בלבד");
assert.equal(bagFrom("טיסה שכר ישירה עם חברת התעופה ארקיע ,כוללת טרולי וכבודה לכל נוסע"), "כולל מזוודה");
assert.equal(bagFrom("כולל כבודה מלאה (תיק גב טרולי ומזוודה עד 23 ק\"ג לאדם)"), "כבודה מלאה");
assert.equal(bagFrom("כבודת יד - כולל תיק קטן וטרולי עד 8 ק\"ג לכל נוסע/ת. ללא מזוודות"), "טרולי בלבד");
assert.equal(bagFrom("כוללת תיק גב לכל נוסע"), "תיק גב בלבד");
assert.equal(bagFrom("טיסה ישירה"), null);
assert.equal(airlineFromCode("LY"), "אל על");
assert.equal(airlineFromCode("ZZ"), "ZZ"); // unknown code stays visible rather than vanishing
const golassoText = "פרטי החבילהחבילת ספורט ל-5 ימים ברומא. החבילה כוללת:1.טיסת שכר ישירה לרומא עם חברת התעופה ישראייר, כוללת תיק גב לכל נוסע2.ארבעה לילות במלון Best Western Ars Hotel ברמת ארבעה כוכבים על בסיס לינה בלבד3.כרטיס כניסה למשחק במסגרת הליגה האיטלקית : רומא - אינטר , בקטגוריה 4 מאחורי השער למעלהפרטי טיסההלוךIsrael- TLVRome- FCO6H383Israir18.09.2616:4019:25חזורRome- FCOIsrael- TLV6H348Israir22.09.2622:0002:20 +1בחירת קטגוריית ישיבהקטגוריה 3 (כלול בחבילה)קטגוריה 2 (€64)";
assert.deepEqual(formatOfferLines(parseOfferDetail("golasso", golassoText, null)), {
  flight: "ישראייר · ישירה · תיק גב בלבד · הלוך 16:40–19:25 · חזור 22:00–02:20",
  hotel: "Best Western Ars Hotel · 4★ · ללא ארוחת בוקר",
  ticket: "קטגוריה 3", // the widget's included seat wins over the prose's category 4
});
const ontourText = "יציאה 13.05.27 המראה בשעה 5:40 ונחיתה בשעה 08:30 חזרה 16.05.27 המראה בשעה 23:55 ונחיתה בשעה 04:25 טיסות ישירות לקראקוב עם חברת לוט כולל כבודה מלאה (תיק גב טרולי ומזוודה עד 23 ק\"ג לאדם). 3 לילות במלון ספא 4* Galaxy Hotel, ע\"ב לינה וארוחת בוקר לאדם בחדר זוגי. ישיבה ביציע התחתון (צהוב במפה). שדרוג לפרקט C בתוספת של 99 אירו לכרטיס ( ירוק במפה)";
assert.deepEqual(formatOfferLines(parseOfferDetail("ontour", ontourText, null)), {
  flight: "LOT · ישירה · כבודה מלאה · הלוך 5:40–08:30 · חזור 23:55–04:25",
  hotel: "Galaxy Hotel · 4★ · כולל ארוחת בוקר",
  ticket: "ישיבה ביציע התחתון",
});
assert.equal(isMultiMatchText("חבילה מרובת משחקים11.09.26 | 14.09.26"), true);
// a page that says nothing falls back to the boolean markers, never to invented words
assert.deepEqual(formatOfferLines(parseOfferDetail("issta", "קלאסיקו עם הפודיום", { direct_flight: true, breakfast: false })), {
  flight: "ישירה", hotel: "ללא ארוחת בוקר", ticket: null,
});

assert.equal(signedUsd(-180), "−$180");
assert.equal(signedUsd(35), "+$35");
assert.equal(signedUsd(0), "$0");

// ---- price advice (agent #2, deterministic half) ----
// red by $300 with no doubt: $150 cut reaches orange, $451 -> ceil5 455 reaches green
const cut = markupCutFacts("package", 300, 0, 175);
assert.equal(cut.length, 1);
assert.equal(cut[0].kind, "markup_cut");
assert.equal(cut[0].saves_usd, 150);
assert.ok(cut[0].text.includes("$150") && cut[0].text.includes("$25")); // 175 - 150 left
assert.ok(cut[0].text.includes("$455"));
// doubt widens the band: the same gap needs a smaller cut
assert.equal(markupCutFacts("package", 300, 40, 175)[0].saves_usd, 110);
// more than the whole markup -> say so, suggest nothing
assert.equal(markupCutFacts("ticket", 400, 0, 200)[0].kind, "no_room");
assert.equal(markupCutFacts("ticket", 400, 0, 200)[0].saves_usd, null);
// not red -> nothing to cut
assert.deepEqual(markupCutFacts("package", 150, 0, 175), []);
assert.deepEqual(cheaperTicketFact(300, 290), []); // under the $20 floor
assert.equal(cheaperTicketFact(300, 169)[0].saves_usd, 131);
assert.deepEqual(cheaperTicketFact(null, 169), []);
assert.deepEqual(nightsFact(base, 3, 3), []);
assert.deepEqual(nightsFact(base, 3, null), []);
const night = nightsFact(base, 4, 3)[0];
assert.equal(night.kind, "nights");
assert.equal(night.saves_usd, Math.round(ourNightRateUsd(base)));
const facts = priceAdviceFacts({ event: base, scope: "package", detail: { diff_usd: 300, uncertainty_usd: 0, nights: { ours: 4, theirs: 3 } }, liveTicketsUsd: 169 });
// base carries no per-event extra markup: nothing editable to cut, and the advice must say so
assert.deepEqual(facts.map((x) => x.kind).sort(), ["cheaper_ticket", "nights", "no_room"]);
const withExtra = priceAdviceFacts({ event: { ...base, event_additional_markup: 200 }, scope: "package", detail: { diff_usd: 300, uncertainty_usd: 0, nights: null }, liveTicketsUsd: null });
assert.equal(withExtra[0].kind, "markup_cut");
assert.equal(withExtra[0].saves_usd, 150);
const ticketAdvice = priceAdviceFacts({ event: base, scope: "ticket", detail: { diff_usd: 170, uncertainty_usd: 0, nights: null }, liveTicketsUsd: null });
assert.equal(ticketAdvice[0].kind, "markup_cut"); // ticket_only_markup 60 covers the $20 cut
assert.equal(ticketAdvice[0].saves_usd, 20);
assert.ok((facts[0].saves_usd ?? 0) >= (facts[1].saves_usd ?? 0)); // biggest saving first
assert.deepEqual(priceAdviceFacts({ event: base, scope: "package", detail: { diff_usd: null, uncertainty_usd: 0, nights: null }, liveTicketsUsd: null }), []);
assert.equal(adviceBlock([]), "");
assert.equal(adviceBlock(facts).split(String.fromCharCode(10)).length, 4);

// ---- other travel days / other suppliers (staff doc note 6) ----
// Event on the 21st, package 19..22: leaving a day later still lands the day before; coming back
// earlier would be the event day itself -> not offered. Shifting later keeps the length.
assert.deepEqual(altDateCandidates("2026-11-21", "2026-11-19", "2026-11-22", "2026-09-18"), [
  { depart: "2026-11-20", return: "2026-11-22" },
  { depart: "2026-11-20", return: "2026-11-23" },
]);
// 17..23 around the 20th: every neighbour is legal, the current window never is.
const wide = altDateCandidates("2026-11-20", "2026-11-17", "2026-11-23", "2026-09-18");
assert.equal(wide.length, 5);
assert.ok(!wide.some((w) => w.depart === "2026-11-17" && w.return === "2026-11-23"));
// nothing leaves before tomorrow
assert.ok(altDateCandidates("2026-09-21", "2026-09-18", "2026-09-23", "2026-09-18").every((w) => w.depart >= "2026-09-19"));

const baseQuote = { depart: "2026-11-19", return: "2026-11-22", nights: 3, flight_usd: 420, airline: "אל על", direct: true };
const rate = Math.round(ourNightRateUsd(base));
const altFacts = altDatesFacts(base, { base: baseQuote, dates: [
  { ...baseQuote, depart: "2026-11-20", nights: 2, flight_usd: 380 },            // $40 flight + one night
  { ...baseQuote, depart: "2026-11-20", return: "2026-11-23", flight_usd: 410 }, // $10 only -> under the floor
  { ...baseQuote, depart: "2026-11-18", return: "2026-11-21", flight_usd: 500 }, // dearer -> never advice
] });
assert.equal(altFacts.length, 1);
assert.equal(altFacts[0].kind, "alt_dates");
assert.equal(altFacts[0].saves_usd, 40 + rate);
assert.ok(altFacts[0].text.includes("$380") && altFacts[0].text.includes("$420") && altFacts[0].text.includes(`$${40 + rate}`));
assert.deepEqual(altDatesFacts(base, { base: null, dates: [] }), []);
assert.deepEqual(altDatesFacts(base, null), []);

const xs2 = { supplier: "xs2event" as const, category: null, cost: 45, currency: "EUR" as const, sell_usd: 103, attachable: false, ref: "x" };
const lt = { supplier: "livetickets" as const, category: "קטגוריה 3", cost: 120, currency: "EUR" as const, sell_usd: 190, attachable: true, ref: "9" };
const swaps = supplierSwapFacts(250, [lt, xs2]);
assert.deepEqual(swaps.map((s) => s.saves_usd), [147, 60]); // biggest saving first
assert.ok(swaps[0].text.includes("XS2Event") && swaps[0].text.includes("מידע בלבד"), "a supplier we cannot attach is said as information");
assert.ok(swaps[1].text.includes("Suppliers & zones") && swaps[1].text.includes("קטגוריה 3"));
assert.deepEqual(supplierSwapFacts(200, [lt]), []); // $10 - under the floor
assert.deepEqual(supplierSwapFacts(null, [lt]), []);
// a quoted LiveTickets alternative replaces the older shelf-price line - one of the two, never both
const both = priceAdviceFacts({ event: base, scope: "ticket", detail: { diff_usd: 170, uncertainty_usd: 0, nights: null }, liveTicketsUsd: 100,
  alt: { at: "2026-09-18T00:00:00Z", base: null, dates: [], suppliers: [{ ...lt, sell_usd: 100 }], errors: [] } });
assert.ok(both.some((x) => x.kind === "supplier_swap") && !both.some((x) => x.kind === "cheaper_ticket"));

// ---- low-cost carrier (staff note 23.09) ----
assert.equal(isLowCostAirline("וויז אייר"), true);
assert.equal(isLowCostAirline("Wizz Air"), true);
assert.equal(isLowCostAirline("ישראייר"), true);
assert.equal(isLowCostAirline("FR"), true);
assert.equal(isLowCostAirline("אל על"), false);
assert.equal(isLowCostAirline("לופטהנזה"), false);
assert.equal(isLowCostAirline(null), null);
const lc = normalize(1000, { ...UNKNOWN_ATTRS }, { nights: 3 }, { ours: "אל על", theirs: "וויז אייר" });
assert.equal(lc.normalizedUsd, 1000 + LOW_COST_USD);
assert.equal(lc.adjustments.find((a) => a.key === "low_cost")?.usd, LOW_COST_USD);
// one direction only, and an unknown airline on either side adjusts nothing
assert.equal(normalize(1000, { ...UNKNOWN_ATTRS }, { nights: 3 }, { ours: "וויז אייר", theirs: "אל על" }).normalizedUsd, 1000);
assert.equal(normalize(1000, { ...UNKNOWN_ATTRS }, { nights: 3 }, { ours: "וויז אייר", theirs: "ריינאייר" }).normalizedUsd, 1000);
assert.equal(normalize(1000, { ...UNKNOWN_ATTRS }, { nights: 3 }, { ours: null, theirs: "וויז אייר" }).normalizedUsd, 1000);
assert.equal(normalize(1000, { ...UNKNOWN_ATTRS }, { nights: 3 }, { ours: "אל על", theirs: null }).normalizedUsd, 1000);

// ---- per-competitor staff call (staff note 23.09) ----
const call = (light: "green" | "orange" | "red") => ({ light, note: "הם לואו קוסט", by: "a@b", at: NOW });
// golasso alone decides red; staff marks it green -> green, and golasso's own verdict says so
const forcedAlone = computeScopeLight({ ourUsd: ours, matches: [m({ competitor: "golasso", normalized_usd: 1100 })], competitors: [...sports], now: NOW,
  forced: { golasso: call("green") } });
assert.equal(forcedAlone.light, "green");
assert.equal(forcedAlone.per_competitor.golasso?.light, "green");
assert.equal(forcedAlone.per_competitor.golasso?.forced?.computed, "red");
// the others keep counting: golasso forced green, issta still makes it orange
const forcedMixed = computeScopeLight({ ourUsd: ours, competitors: [...sports], now: NOW, forced: { golasso: call("green") },
  matches: [m({ competitor: "golasso", normalized_usd: 1100 }), m({ competitor: "issta", normalized_usd: 1300 })] });
assert.equal(forcedMixed.light, "orange"); assert.equal(forcedMixed.competitor, "issta"); assert.equal(forcedMixed.diff_usd, 75);
// a forced verdict WORSE than the rest wins and becomes the named competitor
const forcedWorse = computeScopeLight({ ourUsd: ours, competitors: [...sports], now: NOW, forced: { issta: call("red") },
  matches: [m({ competitor: "golasso", normalized_usd: 1600 }), m({ competitor: "issta", normalized_usd: 1500 })] });
assert.equal(forcedWorse.light, "red"); assert.equal(forcedWorse.competitor, "issta");
// a call on a competitor with no price forces nothing
const forcedNoPrice = computeScopeLight({ ourUsd: ours, competitors: [...sports], now: NOW, forced: { issta: call("green") },
  matches: [m({ competitor: "golasso", normalized_usd: 1100 }), m({ competitor: "issta", status: "not_selling", normalized_usd: null })] });
assert.equal(forcedNoPrice.light, "red");
// the call lapses once that competitor's price drifted past $20
assert.equal(competitorOverrideHolds({ normalized_usd: 1100 }, 1115), true);
assert.equal(competitorOverrideHolds({ normalized_usd: 1100 }, 1125), false);
assert.equal(competitorOverrideHolds({ normalized_usd: 1100 }, null), false);

console.log("price-light selftest: all assertions passed");

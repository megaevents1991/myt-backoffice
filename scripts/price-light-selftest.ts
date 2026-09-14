/**
 * Price-light engine selftest - pure functions only, no DB.
 * Run: node --env-file=.env.local scripts/price-light-selftest.ts
 */
import assert from "node:assert/strict";
import {
  BAG_USD, CONNECTION_USD, STAR_STEP_USD, NIGHT_USD, BREAKFAST_USD, TRANSFER_USD,
  NIGHTS_FALLBACK, NIGHT_RATE_MIN_USD, NIGHT_RATE_MAX_USD,
  ourPackageUsd, ourTicketUsd, ourNights, ourNightRateUsd, listingNights, nightsUncertaintyUsd,
  cheapestAvailableTicket, ourOfferLines,
  kindOf, competitorsFor, normalize,
  computeScopeLight, decidePriceDrop, pickRuleMatch, candidateCoversDate, signedUsd,
  nameTokens, ruleMatchScore, ruleSaysAbsent, isMultiMatchTitle, RULE_MATCH_MIN_SCORE, RULE_ABSENT_BELOW,
  type PricedEvent, type LatestMatch,
} from "../lib/services/price-light.ts";
import { UNKNOWN_ATTRS } from "../types/price-light.types.ts";
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
assert.equal(kindOf({ ...base, type: "tx_event" }), "sports");
assert.deepEqual(competitorsFor("sports", "package", ["liveevents", "livetickets"]), ["liveevents"]);
assert.deepEqual(competitorsFor("music", "package", ["liveevents", "ontour", "issta"]), ["liveevents", "ontour"]);
assert.deepEqual(competitorsFor("sports", "ticket", ["liveevents", "livetickets"]), ["livetickets"]);

// duration: the nights each side actually sells, and what one night is worth on THIS event
assert.equal(ourNights({ ...base, def_date_return: null }), null);        // no window = no guess (was a flat 3)
assert.equal(ourNights({ ...base, def_date_return: "2026-10-24" }), null); // return <= depart
assert.equal(ourNightRateUsd(base), Math.round(400 / 3));                  // our own hotel base, per night
assert.equal(ourNightRateUsd({ ...base, base_hotel_price: 0 }), NIGHT_USD);        // no hotel number = fallback
assert.equal(ourNightRateUsd({ ...base, def_date_depart: null }), NIGHT_USD);      // no window = fallback
assert.equal(ourNightRateUsd({ ...base, base_hotel_price: 30 }), NIGHT_RATE_MIN_USD);      // clamped up
assert.equal(ourNightRateUsd({ ...base, base_hotel_price: 9_000 }), NIGHT_RATE_MAX_USD);   // clamped down
// a detail page that said nothing still leaves the card's travel window to measure
assert.equal(listingNights(null, { travel_depart: "2026-10-24", travel_return: "2026-10-27" }), 3);
assert.equal(listingNights({ nights: 5 }, { travel_depart: "2026-10-24", travel_return: "2026-10-27" }), 5); // page wins
assert.equal(listingNights({ nights: "unknown" }, { travel_depart: null, travel_return: null }), "unknown");
assert.equal(listingNights(null, { travel_depart: "2026-08-01", travel_return: "2027-05-30" }), "unknown");  // a season, not a trip
assert.equal(listingNights(null, { travel_depart: "2026-10-27", travel_return: "2026-10-24" }), "unknown");  // inverted

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
assert.deepEqual(lines.map((l) => l.key), ["flight", "hotel", "ticket"]);
assert.ok(lines[0].detail.includes("ישירה"));
assert.equal(lines[0].usd, 500);
assert.ok(lines[1].detail.includes("3★"));
assert.ok(lines[1].detail.includes("3 לילות"));
assert.equal(lines[1].usd, 400);
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

console.log("price-light selftest: all assertions passed");

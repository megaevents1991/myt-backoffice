// Run: npx tsx scripts/lodging-selftest.ts
import assert from "node:assert/strict";
import {
  allNights, defaultCity, defaultSplit, flipNight, hasEventCity, lodgingLocation, lodgingProblems,
  nightsBetween, offeredCities, refitNights, segmentsFromNights, splitOffered,
} from "../lib/lodging";

const london = { name: "לונדון, בריטניה", latitude: 51.509865, longitude: -0.118092, city_iata: "LON" };
const liverpool = { name: "ליברפול", latitude: 53.4084, longitude: -2.9916, country_code: "GB" };
const base = { date: "2026-10-15", location: london };

// Cities
assert.equal(hasEventCity(base), false);
assert.equal(hasEventCity({ ...base, event_location: liverpool }), true);
assert.equal(hasEventCity({ ...base, event_location: { ...london, name: "London" } }), false, "same point = no event city");
assert.deepEqual(offeredCities(base), ["flight"]);
assert.deepEqual(offeredCities({ ...base, event_location: liverpool, lodging_mode: "choice" }), ["flight", "event"]);
assert.deepEqual(offeredCities({ ...base, event_location: liverpool, lodging_mode: "event_city_only" }), ["event"]);
assert.deepEqual(offeredCities({ ...base, lodging_mode: "choice_split" }), ["flight"], "no event city collapses to flight");
assert.equal(splitOffered({ ...base, event_location: liverpool, lodging_mode: "choice_split" }), true);
assert.equal(splitOffered({ ...base, event_location: liverpool, lodging_mode: "choice" }), false);
assert.equal(defaultCity({ ...base, event_location: liverpool, lodging_mode: "choice", lodging_default: "event" }), "event");
assert.equal(defaultCity({ ...base, event_location: liverpool, lodging_mode: "flight_city", lodging_default: "event" }), "flight", "default not offered → first offered");
assert.equal(lodgingLocation({ ...base, event_location: liverpool }, "event").city_iata, "LON", "event city borrows the flight IATA");
assert.equal(lodgingLocation(base, "event").name, london.name, "no event city → flight location");

// Problems
assert.deepEqual(lodgingProblems(base), []);
assert.equal(lodgingProblems({ ...base, lodging_mode: "choice" }).length, 1);
assert.equal(lodgingProblems({ ...base, event_location: liverpool, lodging_mode: "choice", split_default_nights: 3 }).length, 1);

// Nights
assert.deepEqual(nightsBetween("2026-10-13", "2026-10-17"), ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
assert.deepEqual(nightsBetween("2026-10-13", "2026-10-13"), []);
const split2 = defaultSplit({ ...base, event_location: liverpool, split_default_nights: 2 }, "2026-10-13", "2026-10-17");
assert.deepEqual(split2.map((n) => n.city), ["flight", "event", "event", "flight"]);
const split1 = defaultSplit({ ...base, event_location: liverpool, split_default_nights: 1 }, "2026-10-13", "2026-10-17");
assert.deepEqual(split1.map((n) => n.city), ["flight", "flight", "event", "flight"]);
const late = defaultSplit({ ...base, date: "2026-10-20", event_location: liverpool }, "2026-10-13", "2026-10-17");
assert.deepEqual(late.map((n) => n.city), ["flight", "flight", "event", "event"], "event after the window → last nights");

// Segments
const segs = segmentsFromNights(split2);
assert.equal(segs.length, 3);
assert.deepEqual(segs[1], { city: "event", checkin: "2026-10-14", checkout: "2026-10-16", nights: 2 });
assert.equal(segmentsFromNights(allNights(split2, "event")).length, 1);
assert.equal(flipNight(split2, 0)?.map((n) => n.city).join(), "event,event,event,flight");
const four = [{ date: "2026-10-13", city: "flight" }, { date: "2026-10-14", city: "event" }, { date: "2026-10-15", city: "flight" }, { date: "2026-10-16", city: "flight" }] as const;
assert.equal(flipNight([...four], 3), null, "a 4th segment is refused");
assert.equal(flipNight([...four], 9), null);

// Refit after a flight change
const refit = refitNights(split2, "2026-10-12", "2026-10-18");
assert.deepEqual(refit.map((n) => n.city), ["flight", "flight", "event", "event", "flight", "flight"]);
const shorter = refitNights(split2, "2026-10-14", "2026-10-16");
assert.deepEqual(shorter.map((n) => n.city), ["event", "event"]);

console.log("lodging selftest OK");

// Run: npx tsx scripts/ready-package-selftest.ts
import assert from "node:assert/strict";
import {
  READY_MAX_TRAVELERS_CAP,
  SWAP_ALL,
  SWAP_NONE,
  allowedSizes,
  anySwap,
  canGoLive,
  clampMaxTravelers,
  flightSpecOf,
  hotelSpecOf,
  matchFlight,
  matchHotelOption,
  offlineHotelUnitsFor,
  pairSizes,
  parseSizes,
  parseSpecInput,
  parseSwap,
  pickSuggestedFlight,
  pickSuggestedHotel,
  readyMode,
  readyPreviewUrl,
  specFromComposition,
  summarizeRefresh,
  parseSizeNotes,
  formatSizeNotes,
  roomSplitWithoutTriple,
  swapOf,
  targetSizes,
  variantSizes,
} from "../lib/ready-package";
import type { ReadyVariant } from "../types/ready-package.types";

// ── mode ────────────────────────────────────────────────────────────────────
assert.equal(readyMode("live"), "live");
assert.equal(readyMode("preview"), "preview");
assert.equal(readyMode(null), "off", "a missing column is off");
assert.equal(readyMode("paused"), "off", "an unknown future mode is off");

// No limit of its own: anything unusable, or above the site's cap, is the site's cap (9).
assert.equal(READY_MAX_TRAVELERS_CAP, 9, "the site's own cap on tickets per order");
assert.equal(clampMaxTravelers(undefined), 9);
assert.equal(clampMaxTravelers(12), 9, "capped");
assert.equal(clampMaxTravelers(0), 9);
assert.deepEqual(targetSizes(3), [1, 2, 3]);
assert.equal(targetSizes(READY_MAX_TRAVELERS_CAP).length, 9);

// ── swapping: which pieces the customer may change ──────────────────────────
assert.deepEqual(swapOf(null, true), SWAP_ALL, "an older package: everything follows allow_edit");
assert.deepEqual(swapOf({}, false), SWAP_NONE);
assert.deepEqual(swapOf(undefined, null), SWAP_ALL, "a missing column is editable, as before");
const hotelOnly = { ticket: false, flight: false, hotel: true };
assert.deepEqual(swapOf({ swap: hotelOnly }, false), hotelOnly, "the breakdown wins over allow_edit");
assert.deepEqual(swapOf({ swap: { ticket: true } }, false), SWAP_NONE, "a partial breakdown is no breakdown");
assert.equal(parseSwap({ ticket: "yes", flight: true, hotel: true }), null, "booleans only");
assert.equal(parseSwap([true, true, true]), null);
assert.equal(anySwap(hotelOnly), true);
assert.equal(anySwap(SWAP_NONE), false, "a closed package");

// ── party sizes: which ones staff sell ──────────────────────────────────────
assert.deepEqual(pairSizes(), [2, 4, 6, 8], "sold in pairs");
assert.deepEqual(allowedSizes({ defaultTravelers: 2 }), [1, 2, 3, 4, 5, 6, 7, 8, 9], "nothing chosen = every size");
assert.deepEqual(allowedSizes(null), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert.deepEqual(allowedSizes({ sizes: [4, 2, 2, 8, 6], defaultTravelers: 2 }), [2, 4, 6, 8], "unique, ascending");
assert.deepEqual(allowedSizes({ sizes: [2, 4], defaultTravelers: 3 }), [2, 3, 4], "the built size is always sold");
assert.deepEqual(allowedSizes({ sizes: [2, 12], defaultTravelers: 2 }), [1, 2, 3, 4, 5, 6, 7, 8, 9], "an unsound list is no list");
assert.equal(parseSizes([]), null, "no size at all is not a choice");
assert.equal(parseSizes([2, "4"]), null, "numbers only");
assert.equal(parseSizes([0, 2]), null);
assert.equal(parseSizes("2,4"), null);
assert.equal(
  summarizeRefresh({ defaultTravelers: 2, maxTravelers: 9, sizes: [2, 4], built: [2, 4], failures: [] }).status,
  "ok",
  "every SOLD size priced = ok, whatever the other sizes are",
);
assert.equal(
  summarizeRefresh({ defaultTravelers: 2, maxTravelers: 9, sizes: [2, 4, 6], built: [2, 4], failures: [] }).status,
  "partial",
);

// ── identity ────────────────────────────────────────────────────────────────
const liveFlight = {
  airline: "LY",
  price: 900,
  outbound: { departureTime: "2027-03-11T08:20:00", flightNumber: "LY 315" },
  inbound: { departureTime: "2027-03-15T14:10:00", flightNumber: "LY316" },
  metadata: { iata: "LY", name: "El Al" },
};
assert.deepEqual(flightSpecOf(liveFlight, false), {
  mode: "live",
  airline: "LY",
  outboundFlightNumber: "LY 315",
  outboundDeparture: "2027-03-11T08:20:00",
  inboundFlightNumber: "LY316",
  inboundDeparture: "2027-03-15T14:10:00",
  departureDate: "2027-03-11",
  returnDate: "2027-03-15",
});
assert.deepEqual(flightSpecOf({ isOffline: true, offlineId: 42 }, false), {
  mode: "offline",
  offlineId: 42,
});
assert.deepEqual(flightSpecOf(null, true), { mode: "none" }, "an explicit skip");
assert.equal(flightSpecOf(null, false), null, "left live = no identity");

const liveHotel = {
  id: "hilton_tower_bridge",
  checkin: "2027-03-11",
  checkout: "2027-03-15",
  rate: { room_name: "Double room", meal: "breakfast" },
  hotelInformation: { roomName: "Double room", hotelName: "Hilton", stars: 4 },
};
assert.deepEqual(hotelSpecOf(liveHotel, false), {
  mode: "live",
  hotelId: "hilton_tower_bridge",
  roomName: "Double room",
  meal: "breakfast",
  checkin: "2027-03-11",
  checkout: "2027-03-15",
});
assert.deepEqual(hotelSpecOf({ isOffline: true, offlineIds: [7, 7], id: "offline-9" }, false), {
  mode: "offline",
  rowIds: [7, 7],
});
assert.deepEqual(hotelSpecOf({ isOffline: true, offlineId: 7 }, false), { mode: "offline", rowIds: [7] });
assert.deepEqual(hotelSpecOf(null, true), { mode: "none" });
assert.equal(hotelSpecOf(null, false), null);

const composed = specFromComposition({
  event_order_info: { id: "t1", category: "Category 1" },
  flight_order_info: liveFlight,
  flight_skipped: false,
  hotel_order_info: liveHotel,
  hotel_skipped: false,
  num_travelers: 2,
});
assert.equal(composed.ok, true);
if (composed.ok) {
  assert.equal(composed.spec.defaultTravelers, 2);
  assert.deepEqual(composed.spec.ticket, { id: "t1", category: "Category 1" });
}
const leftLive = specFromComposition({
  event_order_info: { id: "t1", category: "Category 1" },
  flight_order_info: null,
  flight_skipped: false,
  hotel_order_info: liveHotel,
  hotel_skipped: false,
  num_travelers: 2,
});
assert.equal(leftLive.ok, false, "a flight left for the customer cannot be a ready package");
assert.equal(
  specFromComposition({
    event_order_info: null,
    flight_order_info: null,
    flight_skipped: true,
    hotel_order_info: null,
    hotel_skipped: true,
    num_travelers: 2,
  }).ok,
  false,
  "no ticket",
);

// ── flight match ────────────────────────────────────────────────────────────
const spec = flightSpecOf(liveFlight, false)!;
const offers = [
  { ...liveFlight, price: 1400 },
  { ...liveFlight, price: 1320 }, // same flight, cheaper fare
  {
    ...liveFlight,
    price: 800,
    outbound: { departureTime: "2027-03-11T17:05:00", flightNumber: "LY317" },
  },
  { isOffline: true, offlineId: 42, price: 700, outbound: liveFlight.outbound, inbound: liveFlight.inbound },
];
assert.equal(matchFlight(spec, offers)?.price, 1320, "same flight, the cheapest fare of it");
assert.equal(
  matchFlight({ ...spec, mode: "live", outboundDeparture: "2027-03-11T09:00:00" } as typeof spec, offers),
  null,
  "another departure time is another flight",
);
assert.equal(
  matchFlight({ ...spec, outboundFlightNumber: "LY999" } as typeof spec, offers),
  null,
  "a different flight number at the same minute is another flight",
);
assert.equal(
  matchFlight({ ...spec, outboundFlightNumber: null, inboundFlightNumber: null } as typeof spec, offers)?.price,
  1320,
  "an unknown number does not block a match on times",
);
assert.equal(matchFlight({ mode: "offline", offlineId: 42 }, offers)?.price, 700);
assert.equal(matchFlight({ mode: "offline", offlineId: 43 }, offers), null);
assert.equal(matchFlight({ mode: "none" }, offers), null);
assert.equal(
  matchFlight(spec, [offers[3]]),
  null,
  "an inventory row at the same times is not the online flight",
);

// ── hotel match ─────────────────────────────────────────────────────────────
const hotelSpec = hotelSpecOf(liveHotel, false) as Extract<
  NonNullable<ReturnType<typeof hotelSpecOf>>,
  { mode: "live" }
>;
const opt = (room: string, meal: string, price: number, id = "hilton_tower_bridge") => ({
  room_name: room,
  meal,
  price,
  snapshot: { id },
});
assert.equal(
  matchHotelOption(hotelSpec, [opt("Double room", "breakfast", 900), opt("Double room", "nomeal", 700)])?.option.price,
  900,
  "same room, same meal - not the cheaper room-only",
);
const roomChanged = matchHotelOption(hotelSpec, [opt("Superior double", "breakfast", 950), opt("Twin", "nomeal", 600)]);
assert.equal(roomChanged?.option.price, 950);
assert.ok(roomChanged?.note?.includes("room changed"));
const mealChanged = matchHotelOption(hotelSpec, [opt("Double room", "half-board", 1100), opt("Double room", "nomeal", 700)]);
assert.equal(mealChanged?.option.price, 1100, "a promised meal is kept, even as a better plan");
assert.ok(mealChanged?.note?.includes("meal plan changed"));
assert.equal(
  matchHotelOption(hotelSpec, [opt("Double room", "nomeal", 700)]),
  null,
  "a promised breakfast is never dropped",
);
assert.equal(
  matchHotelOption(hotelSpec, [opt("Double room", "breakfast", 900, "another_hotel")]),
  null,
  "another hotel is no match",
);
assert.equal(
  matchHotelOption({ ...hotelSpec, meal: "nomeal" }, [opt("Twin", "breakfast", 800), opt("Twin", "nomeal", 650)])?.option.price,
  650,
  "room-only stays room-only when it can",
);

// ── offline hotel rooms ─────────────────────────────────────────────────────
const cap = () => 2;
assert.deepEqual(offlineHotelUnitsFor([7], cap, 2, 2), [{ rowId: 7, count: 1 }]);
assert.deepEqual(offlineHotelUnitsFor([7], cap, 4, 2), [{ rowId: 7, count: 2 }], "one row scales");
assert.deepEqual(offlineHotelUnitsFor([7], cap, 3, 2), [{ rowId: 7, count: 2 }], "an odd party rounds up");
assert.deepEqual(offlineHotelUnitsFor([7, 7], cap, 4, 4), [{ rowId: 7, count: 2 }], "built size keeps its rooms");
assert.deepEqual(
  offlineHotelUnitsFor([7, 8], cap, 4, 4),
  [
    { rowId: 7, count: 1 },
    { rowId: 8, count: 1 },
  ],
);
assert.equal(offlineHotelUnitsFor([7, 8], cap, 2, 4), null, "a mix of rows keeps its built size only");
assert.equal(offlineHotelUnitsFor([], cap, 2, 2), null);

// ── variants and status ─────────────────────────────────────────────────────
const v = {} as ReadyVariant;
assert.deepEqual(variantSizes({ "2": v, "1": v, "5": v, x: v }, 4), [1, 2], "within the max, ascending");
assert.deepEqual(variantSizes(null, 4), []);
assert.equal(canGoLive({ "2": v }, 2), true);
assert.equal(canGoLive({ "1": v }, 2), false, "no default size, no live");
assert.equal(canGoLive(null, 2), false);

assert.deepEqual(
  summarizeRefresh({ defaultTravelers: 2, maxTravelers: 3, built: [1, 2, 3], failures: [] }),
  { status: "ok", note: null },
);
const partial = summarizeRefresh({
  defaultTravelers: 2,
  maxTravelers: 4,
  built: [1, 2],
  failures: [{ size: 3, reason: "flight not found" }],
});
assert.equal(partial.status, "partial");
assert.ok(partial.note?.includes("3 travellers: flight not found"));
assert.equal(
  summarizeRefresh({
    defaultTravelers: 2,
    maxTravelers: 4,
    built: [1],
    failures: [{ size: 2, reason: "hotel not found" }],
  }).status,
  "broken",
  "the default size missing = the package cannot open",
);

// ── why a size is not offered: one line per size, and it survives the next call ──────
// The card prices ONE size per call. Each call used to rewrite the note with its own
// failures alone, so the last size priced (9) erased what 3, 5, 6, 7 and 8 had said.
assert.deepEqual(parseSizeNotes("3 travellers: no room | 5, 6 travellers: stock"), [
  { size: 3, text: "no room" },
  { size: 5, text: "stock" },
  { size: 6, text: "stock" },
]);
assert.deepEqual(parseSizeNotes(null), []);
assert.deepEqual(parseSizeNotes("the event is gone or has passed"), [], "a line with no size is not a size's line");
assert.equal(
  formatSizeNotes([{ size: 9, text: "stock" }, { size: 5, text: "stock" }, { size: 3, text: "no room" }]),
  "3 travellers: no room | 5, 9 travellers: stock",
  "sizes that share a reason share a line",
);
assert.equal(formatSizeNotes([]), null);
const allNine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const afterNine = summarizeRefresh({
  defaultTravelers: 2,
  maxTravelers: 9,
  sizes: allNine,
  built: [1, 2, 4],
  failures: [{ size: 9, reason: "stock" }],
  handled: [9],
  previousNote: "3 travellers: no room | 5 travellers: stock",
});
assert.equal(afterNine.note, "3 travellers: no room | 5, 9 travellers: stock", "a call about 9 keeps what was said about 3 and 5");
assert.equal(afterNine.status, "partial");
assert.equal(
  summarizeRefresh({
    defaultTravelers: 2,
    maxTravelers: 9,
    sizes: allNine,
    built: [1, 2, 3, 4],
    failures: [],
    notes: [{ size: 3, text: "two rooms" }],
    handled: [3],
    previousNote: "3 travellers: no room | 5 travellers: stock",
  }).note,
  "3 travellers: two rooms | 5 travellers: stock",
  "a size that was visited again says only what this visit found",
);
assert.equal(
  summarizeRefresh({
    defaultTravelers: 2,
    maxTravelers: 9,
    sizes: [2, 4],
    built: [2, 4],
    failures: [],
    handled: [2],
    previousNote: "3 travellers: no room | 5 travellers: stock",
  }).note,
  null,
  "a size that is no longer sold has nothing to say",
);
// a whole-package refresh (no `handled`) starts from a clean page, as before
assert.equal(
  summarizeRefresh({
    defaultTravelers: 2,
    maxTravelers: 4,
    built: [1, 2, 4],
    failures: [{ size: 3, reason: "no room" }],
    previousNote: "4 travellers: old",
  }).note,
  "3 travellers: no room",
);

// ── a hotel with no room for three: the party sleeps in rooms of two and a single ──────
assert.deepEqual(roomSplitWithoutTriple(3), [2, 1]);
assert.deepEqual(roomSplitWithoutTriple(5), [2, 2, 1]);
assert.deepEqual(roomSplitWithoutTriple(7), [2, 2, 2, 1]);
assert.deepEqual(roomSplitWithoutTriple(9), [2, 2, 2, 2, 1]);
for (const even of [1, 2, 4, 6, 8]) {
  assert.equal(roomSplitWithoutTriple(even), null, `${even}: the usual split has no room of three`);
}

assert.equal(
  readyPreviewUrl("https://www.mega-events.co.il/", 812, "abc-123"),
  "https://www.mega-events.co.il/order/812?ready=abc-123",
);

// ── the editor's builder ────────────────────────────────────────────────────
const fl = (direct: boolean, checkedBag: boolean, pricePerPerson: number) => ({ direct, checkedBag, pricePerPerson });
assert.equal(pickSuggestedFlight([fl(true, true, 500), fl(true, true, 450), fl(false, true, 300), fl(true, false, 400)])?.choice.pricePerPerson, 450);
const noBag = pickSuggestedFlight([fl(true, false, 400), fl(false, true, 300)]);
assert.equal(noBag?.choice.pricePerPerson, 400, "a direct flight without a bag beats a cheaper connection");
assert.ok(noBag?.note?.includes("cheapest direct"));
assert.ok(pickSuggestedFlight([fl(false, true, 300)])?.note?.includes("no direct flight"));
assert.equal(pickSuggestedFlight([]), null);

const ho = (stars: number, meal: string, pricePerPerson: number) => ({ stars, meal, pricePerPerson });
assert.equal(pickSuggestedHotel([ho(4, "breakfast", 600), ho(5, "breakfast", 550), ho(4, "nomeal", 300), ho(3, "breakfast", 200)])?.choice.pricePerPerson, 550);
assert.equal(pickSuggestedHotel([ho(4, "nomeal", 300), ho(3, "breakfast", 200)])?.choice.pricePerPerson, 300, "stars before the meal");
assert.ok(pickSuggestedHotel([ho(3, "breakfast", 200)])?.note?.includes("took the cheapest"));
assert.equal(pickSuggestedHotel([ho(3, "nomeal", 200), ho(3, "breakfast", 250)], 3)?.choice.pricePerPerson, 250);
assert.equal(pickSuggestedHotel([]), null);

const goodSpec = {
  ticket: { id: "t1", category: "Category 1" },
  flight: flightSpecOf(liveFlight, false),
  hotel: hotelSpecOf(liveHotel, false),
  defaultTravelers: 2,
};
assert.deepEqual(parseSpecInput(goodSpec), goodSpec, "a sound spec comes back as it went in");
assert.deepEqual(
  parseSpecInput({ ticket: { category: "A" }, flight: { mode: "none" }, hotel: { mode: "offline", rowIds: [7, 7] }, defaultTravelers: 4, extra: "x" }),
  { ticket: { id: null, category: "A" }, flight: { mode: "none" }, hotel: { mode: "offline", rowIds: [7, 7] }, defaultTravelers: 4 },
  "unknown keys are dropped",
);
assert.deepEqual(parseSpecInput({ ...goodSpec, flight: { mode: "offline", offlineId: "42" } })?.flight, { mode: "offline", offlineId: 42 });
assert.equal(parseSpecInput(null), null);
assert.equal(parseSpecInput({ ...goodSpec, ticket: {} }), null, "no ticket");
assert.equal(parseSpecInput({ ...goodSpec, defaultTravelers: 10 }), null, "above the site's cap");
assert.equal(parseSpecInput({ ...goodSpec, defaultTravelers: 9 })?.defaultTravelers, 9);
assert.deepEqual(parseSpecInput({ ...goodSpec, swap: hotelOnly })?.swap, hotelOnly, "the breakdown rides in the spec");
assert.equal(parseSpecInput({ ...goodSpec, swap: { hotel: true } }), null, "a posted breakdown must be whole");
assert.deepEqual(parseSpecInput({ ...goodSpec, sizes: [8, 2, 4, 6] })?.sizes, [2, 4, 6, 8], "the sizes sold ride in the spec");
assert.equal(parseSpecInput({ ...goodSpec, sizes: [2, 10] }), null, "a posted size list must be sound");
assert.equal("swap" in (parseSpecInput(goodSpec) ?? {}), false, "none posted = none stored (the row's is kept)");
assert.equal(parseSpecInput({ ...goodSpec, defaultTravelers: 0 }), null);
assert.equal(parseSpecInput({ ...goodSpec, flight: { mode: "charter" } }), null, "an unknown mode");
assert.equal(parseSpecInput({ ...goodSpec, flight: { ...goodSpec.flight, departureDate: "11/03/2027" } }), null, "a date that is not YYYY-MM-DD");
assert.equal(parseSpecInput({ ...goodSpec, flight: { mode: "offline", offlineId: -3 } }), null);
assert.equal(parseSpecInput({ ...goodSpec, hotel: { ...goodSpec.hotel, checkout: "2027-03-11" } }), null, "no nights");
assert.equal(parseSpecInput({ ...goodSpec, hotel: { mode: "offline", rowIds: [] } }), null);
assert.equal(parseSpecInput({ ...goodSpec, hotel: { mode: "offline", rowIds: [7, "x"] } }), null);

console.log("ready-package selftest OK");

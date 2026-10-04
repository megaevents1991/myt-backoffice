// Run: npx tsx scripts/ready-package-selftest.ts
import assert from "node:assert/strict";
import {
  canGoLive,
  clampMaxTravelers,
  flightSpecOf,
  hotelSpecOf,
  matchFlight,
  matchHotelOption,
  offlineHotelUnitsFor,
  readyMode,
  readyPreviewUrl,
  specFromComposition,
  summarizeRefresh,
  targetSizes,
  variantSizes,
} from "../lib/ready-package";
import type { ReadyVariant } from "../types/ready-package.types";

// ── mode ────────────────────────────────────────────────────────────────────
assert.equal(readyMode("live"), "live");
assert.equal(readyMode("preview"), "preview");
assert.equal(readyMode(null), "off", "a missing column is off");
assert.equal(readyMode("paused"), "off", "an unknown future mode is off");

assert.equal(clampMaxTravelers(undefined), 4);
assert.equal(clampMaxTravelers(9), 6, "capped");
assert.equal(clampMaxTravelers(0), 4);
assert.deepEqual(targetSizes(3), [1, 2, 3]);

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

assert.equal(
  readyPreviewUrl("https://www.mega-events.co.il/", 812, "abc-123"),
  "https://www.mega-events.co.il/order/812?ready=abc-123",
);

console.log("ready-package selftest OK");

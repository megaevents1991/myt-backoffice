/**
 * Tour setup flow - the pure rules behind "a flight series creates the sub-tours"
 * and "a sub-tour follows its flight". No DB, no request context.
 *
 * Run: npx tsx scripts/tour-setup-selftest.ts
 */
import assert from "node:assert/strict";
import { flightMoveDecision, subTourFromFlight, type FlightDates } from "@/lib/tours/sub-tours";

const flight = (over: Partial<FlightDates> = {}): FlightDates => ({
  id: 7,
  outbound_departure_time: "2026-07-03T06:10:00+00:00",
  inbound_departure_time: "2026-07-10T18:40:00+00:00",
  outbound_arrival_airport: "BUD",
  inbound_departure_airport: "VIE",
  initial_quantity: 40,
  season_label: "קיץ 2026",
  ...over,
});

// --- subTourFromFlight ------------------------------------------------------
{
  const d = subTourFromFlight("bbc", flight());
  assert.ok(!("error" in d));
  assert.equal(d.code, "BBC703");
  assert.equal(d.seasonYear, 2026);
  assert.equal(d.start, "2026-07-03");
  assert.equal(d.end, "2026-07-10");
  assert.equal(d.arrival, "BUD");
  assert.equal(d.ret, "VIE");
  assert.equal(d.capacity, 40);
  assert.equal(d.season, "קיץ 2026");
}
{
  const d = subTourFromFlight("FPAR", flight({ outbound_departure_time: "2026-12-24T22:00:00+00:00", inbound_departure_time: "2027-01-02T10:00:00+00:00" }));
  assert.ok(!("error" in d));
  assert.equal(d.code, "FPAR1224");
  assert.equal(d.seasonYear, 2026, "the season year is the year the trip starts");
}
assert.ok("error" in subTourFromFlight("BBC", flight({ inbound_departure_time: null })), "a one-way flight is not a trip");
assert.ok("error" in subTourFromFlight("BBC", flight({ outbound_departure_time: null })));
assert.ok("error" in subTourFromFlight("BBC", flight({ inbound_departure_time: "2026-07-01T10:00:00+00:00" })), "return before departure");
assert.ok("error" in subTourFromFlight("BBC", flight({ inbound_departure_time: "2026-09-30T10:00:00+00:00" })), "more than 60 nights");
{
  const d = subTourFromFlight("BBC", flight({ initial_quantity: -3, season_label: "  " }));
  assert.ok(!("error" in d));
  assert.equal(d.capacity, 0);
  assert.equal(d.season, null);
}

// --- flightMoveDecision -------------------------------------------------------
const dep = { start_date: "2026-07-03", end_date: "2026-07-10", code: "BBC703", season_year: 2026 };
const free = { hasSales: false, codeTaken: () => false };
assert.deepEqual(flightMoveDecision(dep, "BBC", flight(), free), { kind: "none" });
assert.deepEqual(
  flightMoveDecision(dep, "BBC", flight({ outbound_departure_time: "2026-07-05T06:00:00+00:00", inbound_departure_time: "2026-07-12T06:00:00+00:00" }), free),
  { kind: "move", start: "2026-07-05", end: "2026-07-12", code: "BBC705", seasonYear: 2026 },
);
// only the return moved: same code, new end
assert.deepEqual(
  flightMoveDecision(dep, "BBC", flight({ inbound_departure_time: "2026-07-11T06:00:00+00:00" }), free),
  { kind: "move", start: "2026-07-03", end: "2026-07-11", code: "BBC703", seasonYear: 2026 },
);
assert.deepEqual(
  flightMoveDecision(dep, "BBC", flight({ outbound_departure_time: "2026-07-05T06:00:00+00:00" }), { hasSales: true, codeTaken: () => false }),
  { kind: "task", reason: "sales", start: "2026-07-05", end: "2026-07-10", code: "BBC705" },
);
assert.deepEqual(
  flightMoveDecision(dep, "BBC", flight({ outbound_departure_time: "2026-07-05T06:00:00+00:00" }), { hasSales: false, codeTaken: (c, y) => c === "BBC705" && y === 2026 }),
  { kind: "task", reason: "code_taken", start: "2026-07-05", end: "2026-07-10", code: "BBC705" },
);
// the departure's own code is never "taken" by itself
assert.equal(
  flightMoveDecision(dep, "BBC", flight({ inbound_departure_time: "2026-07-11T06:00:00+00:00" }), { hasSales: false, codeTaken: (c) => c === "BBC703" }).kind,
  "move",
);
// a flight that lost its dates (or became one-way) moves nothing
assert.deepEqual(flightMoveDecision(dep, "BBC", flight({ inbound_departure_time: null }), free), { kind: "none" });

console.log("tour-setup selftest: sub-tours OK");

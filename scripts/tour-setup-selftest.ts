/**
 * Tour setup flow - the pure rules behind "a flight series creates the sub-tours"
 * and "a sub-tour follows its flight". No DB, no request context.
 *
 * Run: npx tsx scripts/tour-setup-selftest.ts
 */
import assert from "node:assert/strict";
import { flightMoveDecision, subTourFromFlight, type FlightDates } from "@/lib/tours/sub-tours";
import {
  adjustNumber,
  cellValue,
  columnByKey,
  parseCell,
  pasteBlock,
  rowChanges,
  type SheetRow,
} from "@/components/tours/pricing/sheet-model";

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

// --- the Pricing sheet -----------------------------------------------------------
const col = (key: string) => {
  const c = columnByKey.get(key);
  assert.ok(c, key);
  return c;
};
assert.deepEqual(parseCell(col("price1"), "1,290"), { value: 1290 });
assert.deepEqual(parseCell(col("price1"), " $4290 "), { value: 4290 });
assert.deepEqual(parseCell(col("price1"), ""), { value: null }, "an empty price cell removes the price");
assert.ok("error" in parseCell(col("price1"), "abc"));
assert.ok("error" in parseCell(col("price1"), "-5"));
assert.deepEqual(parseCell(col("isPublished"), "כן"), { value: true });
assert.deepEqual(parseCell(col("isPublished"), "Yes"), { value: true });
assert.deepEqual(parseCell(col("isPublished"), "0"), { value: false });
assert.ok("error" in parseCell(col("isPublished"), "maybe"));
assert.deepEqual(parseCell(col("saleStatus"), "Last places"), { value: "last_places" });
assert.deepEqual(parseCell(col("saleStatus"), "sold_out"), { value: "sold_out" });
assert.ok("error" in parseCell(col("saleStatus"), "soon"));
assert.deepEqual(parseCell(col("currency"), "eur"), { value: "EUR" });
assert.deepEqual(parseCell(col("labels"), "חנוכה, מומלץ ,חנוכה"), { value: ["חנוכה", "מומלץ"] });
assert.deepEqual(parseCell(col("capacity"), "45"), { value: 45 });
assert.ok("error" in parseCell(col("capacity"), "4.5"));
assert.ok("error" in parseCell(col("seniorMinAge"), "20"), "below the lowest senior age");
assert.deepEqual(parseCell(col("childMaxAge"), ""), { value: null }, "empty = inherit from the series");
assert.deepEqual(parseCell(col("notes"), "  "), { value: null });
// Israel summer time is UTC+3
assert.deepEqual(parseCell(col("meetingAt"), "2026-07-03 05:30"), { value: "2026-07-03T02:30:00.000Z" });
assert.deepEqual(parseCell(col("meetingAt"), "03/07/2026 05:30"), { value: "2026-07-03T02:30:00.000Z" });
assert.ok("error" in parseCell(col("meetingAt"), "tomorrow"));
assert.ok("error" in parseCell(col("dates"), "x"), "read-only columns take nothing");

const TAB = String.fromCharCode(9);
const CRLF = String.fromCharCode(13, 10);
assert.deepEqual(pasteBlock(`4290${TAB}3990${CRLF}4190${TAB}3890${CRLF}`), [["4290", "3990"], ["4190", "3890"]]);
assert.deepEqual(pasteBlock("1500"), [["1500"]]);
assert.deepEqual(pasteBlock(`a${TAB}${TAB}b`), [["a", "", "b"]]);

const sheetRow = (over: Partial<SheetRow> = {}): SheetRow => ({
  id: "r1", code: "BBC703", packageId: "p1", seriesCode: "BBC", startDate: "2026-07-03", endDate: "2026-07-10",
  season: null, route: "BUD", isPublished: false, saleStatus: "open", siteStatus: "open", currency: "USD",
  capacity: 40, seats: { allocated: 40, sold: 0, remaining: 40 }, flightCost: null,
  prices: [null, 4290, null, 3990, null, null], labels: [], meetingAt: null, baggage: true, meal: true,
  transfers: false, connectionOut: null, connectionBack: null, childMaxAge: null, seniorMinAge: null,
  seniorDiscount: null, notes: null, originFlightId: 7, ...over,
});
assert.equal(cellValue(sheetRow(), "price1"), 4290);
assert.equal(cellValue(sheetRow(), "price0"), null);
const loaded = new Map([["r1", sheetRow()]]);
assert.deepEqual(rowChanges(loaded, { r1: { price1: 4290, labels: [] } }), [], "edits back to the loaded value send nothing");
assert.deepEqual(rowChanges(loaded, { r1: { price1: 4390, isPublished: true } }), [
  { id: "r1", cells: { price1: { before: 4290, after: 4390 }, isPublished: { before: false, after: true } } },
]);
assert.deepEqual(rowChanges(loaded, { gone: { price1: 1 } }), [], "a row that is not loaded sends nothing");
assert.equal(adjustNumber(4290, "add", 50), 4340);
assert.equal(adjustNumber(4290, "add", -5000), 0);
assert.equal(adjustNumber(1000, "percent", 7.5), 1075);
assert.equal(adjustNumber(null, "add", 50), null, "an empty price stays empty");

console.log("tour-setup selftest: pricing sheet OK");

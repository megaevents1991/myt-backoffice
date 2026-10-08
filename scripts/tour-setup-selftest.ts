/**
 * Tour setup flow - the pure rules behind "a flight series creates the sub-tours"
 * and "a sub-tour follows its flight". No DB, no request context.
 *
 * Run: npx tsx scripts/tour-setup-selftest.ts
 */
import assert from "node:assert/strict";
import { flightMoveDecision, subTourFromFlight, type FlightDates } from "@/lib/tours/sub-tours";
import { discountText, displayText, parseDiscount } from "@/components/tours/sheet/sheet-core";
import {
  cleanPointsHtml,
  filledDays,
  htmlOfPoints,
  isBlankDay,
  pointsFromAnyHtml,
  pointsOfHtml,
  withTourDays,
  type ItineraryDay,
} from "@/components/tours/content/shared";
import {
  adjustNumber,
  BAR_MITZVAH_LABEL,
  cellValue,
  columnByKey,
  columnsFor,
  dateLabelsOf,
  isBarMitzvahLabel,
  parseCell,
  pasteBlock,
  rowChanges,
  rowOptions,
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
  seasonId: null, season: null, itineraryId: null, route: "BUD", isPublished: false, saleStatus: "open", siteStatus: "open",
  currency: "USD", capacity: 40, seats: { allocated: 40, sold: 0, remaining: 40 }, flight: null, flightCost: null,
  prices: [null, 4290, null, 3990, null, null], labels: [], barMitzvah: false, cardBadge: null, discount: null, discountUntil: null, gift: null, giftUntil: null, special: null, specialAmount: null, specialUntil: null,
  morePromotions: [], docket: null, meetingAt: null, transfers: false, childMaxAge: null, seniorMinAge: null,
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

// --- Departures and Pricing are one sheet (Alon, 04.10.2026): the departures columns
assert.deepEqual(
  columnsFor("departures").map((c) => c.key),
  ["isPublished", "dates", "route", "seasonId", "saleStatus", "labels", "barMitzvah", "discount", "discountUntil", "gift", "giftUntil", "special", "specialAmount", "specialUntil", "morePromotions", "flight", "seats", "docket"],
);
assert.ok(!columnByKey.has("baggage") && !columnByKey.has("meal") && !columnByKey.has("connectionOut"), "flight details are the flight's own");
assert.ok("error" in parseCell(col("labels"), "a, b, c, d"), "a date shows up to three labels");
assert.deepEqual(parseCell(col("labels"), "a, b, c"), { value: ["a", "b", "c"] });
// a season / an itinerary is chosen from the row's tour, by name or by id
const tour = { id: "p1", name: "T", slug: "t", codes: ["BBC"], isActive: true, seasons: [{ id: "s1", name: "קיץ" }], itineraries: [{ id: "v1", label: "מסלול הפוך" }] };
assert.deepEqual(parseCell(col("seasonId"), "קיץ", rowOptions(tour, "seasonId")), { value: "s1" });
assert.deepEqual(parseCell(col("seasonId"), "s1", rowOptions(tour, "seasonId")), { value: "s1" });
assert.deepEqual(parseCell(col("seasonId"), "", rowOptions(tour, "seasonId")), { value: null }, "an empty season = not assigned");
assert.ok("error" in parseCell(col("seasonId"), "חורף", rowOptions(tour, "seasonId")), "a season the tour does not have");
assert.deepEqual(parseCell(col("itineraryId"), "מסלול הפוך", rowOptions(tour, "itineraryId")), { value: "v1" });
assert.equal(rowOptions(tour, "price1"), undefined);
// the bar / bat mitzvah mark is one of the date's labels in the database
assert.ok(isBarMitzvahLabel(BAR_MITZVAH_LABEL) && isBarMitzvahLabel("בר/בת מצווה") && !isBarMitzvahLabel("חנוכה"));
assert.deepEqual(dateLabelsOf(["חנוכה", BAR_MITZVAH_LABEL, "מומלץ"], true), ["חנוכה", "מומלץ", BAR_MITZVAH_LABEL]);
assert.deepEqual(dateLabelsOf(["חנוכה", BAR_MITZVAH_LABEL], false), ["חנוכה"]);
assert.deepEqual(dateLabelsOf(["a", "b", "c", "d"], false), ["a", "b", "c"]);
// the discount of a date is a percent of the order or an amount per traveler (Alon, 08.10.2026)
assert.deepEqual(parseCell(col("discount"), ""), { value: null }, "empty removes it");
assert.deepEqual(parseCell(col("discount"), "0"), { value: null });
assert.deepEqual(parseCell(col("discount"), "80"), { value: "80" });
assert.deepEqual(parseCell(col("discount"), "1,200"), { value: "1200" });
assert.deepEqual(parseCell(col("discount"), "10%"), { value: "10%" });
assert.deepEqual(parseCell(col("discount"), "12.5 %"), { value: "12.5%" });
assert.ok("error" in parseCell(col("discount"), "120%"), "a percent is up to 100");
assert.ok("error" in parseCell(col("discount"), "abc"));
assert.deepEqual(parseDiscount("10%"), { percent: 10 });
assert.deepEqual(parseDiscount("80"), { amount: 80 });
assert.equal(discountText({ percent: 10 }), "10%");
assert.equal(discountText({ amount: 1200 }), "1200");
assert.equal(displayText(col("discount"), "1200"), "1,200");
assert.equal(displayText(col("discount"), "10%"), "10%");
assert.deepEqual(parseCell(col("discountUntil"), "15/03/2027"), { value: "2027-03-15" });
assert.ok(!columnsFor("departures").includes(col("price1")) && columnsFor("prices").includes(col("price1")), "the double-room price lives in Prices");
assert.deepEqual(rowChanges(loaded, { r1: { seasonId: "s1", barMitzvah: true, gift: "מזוודה" } }), [
  { id: "r1", cells: { seasonId: { before: null, after: "s1" }, barMitzvah: { before: false, after: true }, gift: { before: null, after: "מזוודה" } } },
]);

console.log("tour-setup selftest: pricing sheet OK");

// ---------------------------------------------------------------- the tour page: days and points (Alon, 07.10.2026)
const day = (n: number, title = ""): ItineraryDay => ({ n, title, subtitle: "", html: "" });
// "6 days" opens six blank days; a filled itinerary gets only the numbers it lacks, in their place
assert.deepEqual(withTourDays([], 6).map((d) => d.n), [1, 2, 3, 4, 5, 6]);
assert.deepEqual(withTourDays([day(1, "a"), day(3, "c")], 4).map((d) => `${d.n}${d.title}`), ["1a", "2", "3c", "4"]);
const whole = [day(1, "a"), day(2, "b")];
assert.equal(withTourDays(whole, 2), whole, "nothing to add: the same array, so the editor does not re-render or turn dirty");
assert.equal(withTourDays(whole, null), whole);
// a shorter tour drops the blank days past its length, never a written one
assert.deepEqual(withTourDays([day(1, "a"), day(2), day(3), day(4, "z")], 2).map((d) => `${d.n}${d.title}`), ["1a", "2", "4z"]);
// a blank day is never saved; a picture alone is content
assert.equal(filledDays([day(1, "a"), day(2), { n: 3, title: "", subtitle: "", html: "<p>&nbsp;</p>" }]).length, 1);
assert.equal(isBlankDay({ n: 1, title: "", subtitle: "", html: "", image: "/media/x.jpg" }), false);
// "Additional info" as points: a plain list both ways, anything else stays HTML
assert.deepEqual(pointsOfHtml(""), []);
assert.deepEqual(pointsOfHtml("<ul><li>a &amp; b</li><li>c</li></ul>"), ["a & b", "c"]);
assert.equal(pointsOfHtml("<p>hello</p>"), null);
assert.equal(pointsOfHtml("<ul><li><strong>a</strong></li></ul>"), null);
assert.equal(pointsOfHtml("<p>x</p><ul><li>a</li></ul>"), null);
assert.deepEqual(pointsOfHtml(htmlOfPoints(["a b ", "", "<x>"])), ["a b ", "", "<x>"], "typing keeps its spaces and an empty new point");
assert.equal(htmlOfPoints([]), "");
assert.deepEqual(pointsOfHtml("<ul><li>a &#8211; b &ndash; c&#x5d0;</li></ul>"), ["a – b – cא"], "WordPress entities are read as text");
assert.equal(pointsOfHtml("<ul><li>a &copy; b</li></ul>"), null, "an entity we cannot write back keeps the HTML editor");
assert.deepEqual(pointsFromAnyHtml("<p>one</p><p>two<br>three</p><ul><li><b>four</b></li></ul>"), ["one", "two", "three", "four"]);
assert.equal(cleanPointsHtml("<ul><li> a </li><li></li></ul>"), "<ul><li>a</li></ul>");
assert.equal(cleanPointsHtml("<ul><li></li></ul>"), "", "a list of empty points is no text at all");
assert.equal(cleanPointsHtml("<p>x</p>"), "<p>x</p>");

console.log("tour-setup selftest: itinerary days and points OK");

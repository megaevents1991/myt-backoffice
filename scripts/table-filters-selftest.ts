// scripts/table-filters-selftest.ts - `npx tsx scripts/table-filters-selftest.ts`
// The pure rules of a table's header filters (lib/table-filters.ts; Alon 28.10: "לפלטר לפי דברים שיש שם, בהקלדה /
// בגלילה, סינון מרובה"). The popover and the chips are checked in the browser.
import assert from "node:assert/strict";
import {
  cleanStoredFilters,
  distinctValues,
  filterSummary,
  isActiveFilter,
  matchesHeaderFilter,
  rowsLeftFilter,
} from "../lib/table-filters";

// values: OR inside the column; an empty value is a value of its own ("Unassigned")
assert.equal(matchesHeaderFilter("new", { kind: "values", values: ["new", "no_answer"] }), true);
assert.equal(matchesHeaderFilter("paid", { kind: "values", values: ["new", "no_answer"] }), false);
assert.equal(matchesHeaderFilter("", { kind: "values", values: [""] }), true, "the empty value can be picked");
assert.equal(matchesHeaderFilter("", { kind: "values", values: ["new"] }), false);
// a remembered value no longer in the rows matches nothing - never everything
assert.equal(matchesHeaderFilter("new", { kind: "values", values: ["gone_status"] }), false);

// text: the board's token search - every word, any order
assert.equal(matchesHeaderFilter("Alon Samnon", { kind: "text", text: "samnon alon" }), true);
assert.equal(matchesHeaderFilter("Alon Samnon", { kind: "text", text: "beverley" }), false);
assert.equal(matchesHeaderFilter("052528966912", { kind: "text", text: "0525" }), true, "a phone by its start");

// date: inclusive, by the day (the first 10 characters); an empty cell is outside any bounded range
assert.equal(matchesHeaderFilter("2026-10-22", { kind: "date", from: "2026-10-22", to: "2026-10-22" }), true);
assert.equal(matchesHeaderFilter("2026-10-21T23:30:00Z", { kind: "date", from: null, to: "2026-10-21" }), true);
assert.equal(matchesHeaderFilter("2026-10-23", { kind: "date", from: null, to: "2026-10-22" }), false);
assert.equal(matchesHeaderFilter("2026-09-30", { kind: "date", from: "2026-10-01", to: null }), false);
assert.equal(matchesHeaderFilter("", { kind: "date", from: "2026-10-01", to: null }), false);

// inactive = no filter at all
assert.equal(isActiveFilter({ kind: "values", values: [] }), false);
assert.equal(isActiveFilter({ kind: "values", values: [""] }), true);
assert.equal(isActiveFilter({ kind: "text", text: "  " }), false);
assert.equal(isActiveFilter({ kind: "text", text: "a" }), true);
assert.equal(isActiveFilter({ kind: "date", from: null, to: null }), false);
assert.equal(isActiveFilter({ kind: "date", from: "2026-10-01", to: null }), true);

// the list a values filter offers: the most common first
assert.deepEqual(distinctValues(["b", "a", "b", ""]), [
  { value: "b", count: 2 },
  { value: "", count: 1 },
  { value: "a", count: 1 },
]);
assert.deepEqual(distinctValues([]), []);

// a remembered filter that lost its column or its shape is dropped, never trusted
const kinds = { status: "values", followUp: "date", who: "text" } as const;
assert.deepEqual(
  cleanStoredFilters(
    [
      { id: "status", value: { kind: "values", values: ["new"] } },
      { id: "gone", value: { kind: "text", text: "x" } },
      { id: "followUp", value: { kind: "date", from: "22/10/2026", to: null } },
      "junk",
    ],
    kinds,
  ),
  [{ id: "status", value: { kind: "values", values: ["new"] } }],
);
assert.deepEqual(cleanStoredFilters({ status: "new" }, kinds), [], "not an array");
assert.deepEqual(cleanStoredFilters(null, kinds), []);
assert.deepEqual(cleanStoredFilters([{ id: "status", value: { kind: "text", text: "new" } }], kinds), [], "the column's kind changed");
assert.deepEqual(cleanStoredFilters([{ id: "status", value: { kind: "values", values: ["new", 3] } }], kinds), [], "a value that is not a string");
assert.deepEqual(cleanStoredFilters([{ id: "who", value: { kind: "text", text: " " } }], kinds), [], "an inactive one");
assert.deepEqual(
  cleanStoredFilters([{ id: "followUp", value: { kind: "date", from: "2026-10-01", to: "2026-10-31" } }], kinds),
  [{ id: "followUp", value: { kind: "date", from: "2026-10-01", to: "2026-10-31" } }],
);
assert.deepEqual(
  cleanStoredFilters(
    [
      { id: "status", value: { kind: "values", values: ["new"] } },
      { id: "status", value: { kind: "values", values: ["paid"] } },
    ],
    kinds,
  ),
  [{ id: "status", value: { kind: "values", values: ["new"] } }],
  "one filter per column",
);

// the chip's words
assert.equal(filterSummary({ kind: "values", values: ["new", "no_answer", "paid", "future"] }, (v) => v.toUpperCase()), "NEW, NO_ANSWER, PAID +1");
assert.equal(filterSummary({ kind: "values", values: ["new"] }), "new");
assert.equal(filterSummary({ kind: "values", values: [""] }), "None", "the empty value without a label");
assert.equal(filterSummary({ kind: "text", text: "samnon" }), "“samnon”");
assert.equal(filterSummary({ kind: "date", from: "2026-10-01", to: "2026-10-31" }), "01.10.2026 – 31.10.2026");
assert.equal(filterSummary({ kind: "date", from: "2026-10-01", to: null }), "from 01.10.2026");
assert.equal(filterSummary({ kind: "date", from: null, to: "2026-10-31" }), "until 31.10.2026");

// a row an edit took out of the filtered list (it is still in the data) - not one that left the data
assert.deepEqual(rowsLeftFilter(["a", "b", "c"], ["a"], ["a", "b"]), ["b"]);
assert.deepEqual(rowsLeftFilter(["a"], ["a", "d"], ["a", "d"]), [], "a row that came in is no news");

console.log("table-filters selftest: ok");

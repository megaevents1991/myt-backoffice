// Run: npx tsx scripts/marketing-range-selftest.ts
import assert from "node:assert/strict";
import { daysBetween, israelDayOf, israelDayStartUtc, israelToday, previousWindow, resolveWindow } from "../lib/marketing/range";

// 2026-10-14 10:00 Israel (IDT, UTC+3)
const NOW = new Date("2026-10-14T07:00:00Z");

assert.equal(israelToday(NOW), "2026-10-14");
// 23:30 UTC on the 13th is already the 14th in Israel.
assert.equal(israelToday(new Date("2026-10-13T23:30:00Z")), "2026-10-14");

assert.deepEqual(resolveWindow({}, NOW), { range: "30d", since: "2026-09-15", until: "2026-10-14" }, "default = 30 days inclusive of today");
assert.deepEqual(resolveWindow({ range: "today" }, NOW), { range: "today", since: "2026-10-14", until: "2026-10-14" });
assert.deepEqual(resolveWindow({ range: "yesterday" }, NOW), { range: "yesterday", since: "2026-10-13", until: "2026-10-13" });
assert.deepEqual(resolveWindow({ range: "7d" }, NOW), { range: "7d", since: "2026-10-08", until: "2026-10-14" });
assert.deepEqual(resolveWindow({ range: "90d" }, NOW), { range: "90d", since: "2026-07-17", until: "2026-10-14" });
assert.deepEqual(resolveWindow({ range: "month" }, NOW), { range: "month", since: "2026-10-01", until: "2026-10-14" });
assert.deepEqual(resolveWindow({ range: "last_month" }, new Date("2026-03-05T10:00:00Z")), { range: "last_month", since: "2026-02-01", until: "2026-02-28" });
assert.deepEqual(resolveWindow({ range: "last_month" }, new Date("2026-01-10T10:00:00Z")), { range: "last_month", since: "2025-12-01", until: "2025-12-31" }, "January -> December of last year");

assert.deepEqual(resolveWindow({ range: "custom", from: "2026-07-01", to: "2026-07-31" }, NOW), { range: "custom", since: "2026-07-01", until: "2026-07-31" });
assert.deepEqual(resolveWindow({ range: "custom", from: "2026-07-31", to: "2026-07-01" }, NOW).range, "30d", "from after to -> default");
assert.deepEqual(resolveWindow({ range: "custom", from: "2026-10-01", to: "2026-10-20" }, NOW).range, "30d", "to in the future -> default");
assert.deepEqual(resolveWindow({ range: "custom", from: "2025-10-01", to: "2026-10-03" }, NOW).range, "30d", "367 days -> default");
assert.deepEqual(resolveWindow({ range: "custom", from: "2025-10-03", to: "2026-10-03" }, NOW).range, "custom", "366 days is allowed");
assert.deepEqual(resolveWindow({ range: "custom", from: "2026-02-30", to: "2026-03-02" }, NOW).range, "30d", "not a real date -> default");
assert.deepEqual(resolveWindow({ range: "custom", from: "garbage", to: "2026-03-02" }, NOW).range, "30d");
assert.deepEqual(resolveWindow({ range: "custom" }, NOW).range, "30d", "custom without dates -> default");
assert.deepEqual(resolveWindow({ range: "nonsense" }, NOW).range, "30d");

assert.equal(israelDayOf("2026-10-13T22:30:00Z"), "2026-10-14", "IDT +3");
assert.equal(israelDayOf("2026-10-13T20:30:00Z"), "2026-10-13");
assert.equal(israelDayOf("2026-12-01T21:59:00Z"), "2026-12-01", "IST +2");
assert.equal(israelDayOf("2026-12-01T22:00:00Z"), "2026-12-02");
assert.equal(israelDayStartUtc("2026-10-14"), "2026-10-13T21:00:00.000Z");
assert.equal(israelDayStartUtc("2026-12-01"), "2026-11-30T22:00:00.000Z");

const days = daysBetween("2026-09-15", "2026-10-14");
assert.equal(days.length, 30);
assert.equal(days[0], "2026-09-15");
assert.equal(days[29], "2026-10-14");
assert.deepEqual(daysBetween("2026-10-14", "2026-10-14"), ["2026-10-14"]);
assert.deepEqual(daysBetween("2026-03-27", "2026-03-30"), ["2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30"], "across the DST switch");

// The previous period: same length, right before (the Sales / Influencers trends).
assert.deepEqual(previousWindow("2026-10-01", "2026-10-30"), { since: "2026-09-01", until: "2026-09-30" });
assert.deepEqual(previousWindow("2026-10-14", "2026-10-14"), { since: "2026-10-13", until: "2026-10-13" }, "one day -> the day before");
assert.deepEqual(previousWindow("2026-03-01", "2026-03-31"), { since: "2026-01-29", until: "2026-02-28" }, "31 days back, across a short month");

console.log("marketing-range selftest: ok");

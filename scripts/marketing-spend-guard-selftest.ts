// Run: npx tsx scripts/marketing-spend-guard-selftest.ts
import assert from "node:assert/strict";
import { dayRangesLabel, dayTotals, keepStoredDays, spendGuardNote } from "../lib/marketing/spend-guard";

const row = (day: string, spend: number, impressions: number, adset = "a", clicks?: number) => ({ day, spend, impressions, clicks, adset_key: adset });

// ---- the 21.10 case: Meta answers 14-19 at zero, 20-21 whole; we hold real spend for 14-19
const stored = [
  ...["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"].flatMap((d) => [row(d, 1200, 30000, "a"), row(d, 900, 25000, "b")]),
  row("2026-10-20", 2099, 53404, "a"),
  row("2026-10-21", 0, 0, "a"), // today's first tick
];
const fetched = [
  ...["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"].flatMap((d) => [row(d, 0, 0, "a"), row(d, 0, 0, "b")]),
  row("2026-10-20", 2150, 54000, "a"),
  row("2026-10-21", 1025, 22873, "a"),
];
const r = keepStoredDays(fetched, stored);
assert.deepEqual(r.kept, ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]);
assert.deepEqual(
  r.rows.map((x) => x.day),
  ["2026-10-20", "2026-10-21"],
  "the six zero days are dropped; 20 (a restatement) and 21 (stored at zero) are written",
);
assert.equal(r.rows[0].spend, 2150, "the restated 20th goes through as fetched");

// ---- a day stored at zero takes whatever comes (today's first tick; the recovery of a day that was zeroed before this guard)
assert.deepEqual(keepStoredDays([row("2026-10-14", 0, 0)], [row("2026-10-14", 0, 0)]).kept, [], "zero over zero is no loss");
assert.deepEqual(keepStoredDays([row("2026-10-14", 1880, 40000)], [row("2026-10-14", 0, 0)]).kept, [], "a good answer over a zeroed day lands");
assert.deepEqual(keepStoredDays([row("2026-10-22", 0, 0)], []).kept, [], "a day never stored is written as answered");

// ---- day level: one ad set at zero beside another with spend is a paused ad set, not a bad answer
const partial = keepStoredDays([row("2026-10-14", 0, 0, "a"), row("2026-10-14", 700, 9000, "b")], [row("2026-10-14", 1200, 30000, "a"), row("2026-10-14", 900, 25000, "b")]);
assert.deepEqual(partial.kept, []);
assert.equal(partial.rows.length, 2, "both rows written - a's zero is real");

// ---- impressions without spend (a free delivery day) count as delivery on both sides
assert.deepEqual(keepStoredDays([row("2026-10-14", 0, 0)], [row("2026-10-14", 0, 150)]).kept, ["2026-10-14"], "stored impressions are delivery");
assert.deepEqual(keepStoredDays([row("2026-10-14", 0, 150)], [row("2026-10-14", 800, 20000)]).kept, [], "fetched impressions are an answer, even at spend 0");
assert.deepEqual(keepStoredDays([row("2026-10-14", 0, 0, "a", 3)], [row("2026-10-14", 800, 20000)]).kept, [], "fetched clicks are an answer");

// ---- a stored day with clicks only is not delivery for the rule (spend / impressions decide) - clicks ride on impressions anyway
assert.deepEqual(keepStoredDays([row("2026-10-14", 0, 0)], [row("2026-10-14", 0, 0, "a", 5)]).kept, []);

// ---- totals tolerate numeric strings (PostgREST numerics) and missing clicks
const t = dayTotals([{ day: "d", spend: "1.5" as unknown as number, impressions: "2" as unknown as number }, { day: "d", spend: 1, impressions: 0, clicks: 4 }]);
assert.deepEqual(t.get("d"), { spend: 2.5, impressions: 2, clicks: 4 });

// ---- labels
assert.equal(dayRangesLabel(["2026-10-16", "2026-10-14", "2026-10-15", "2026-10-19", "2026-10-21", "2026-10-14"]), "2026-10-14..2026-10-16, 2026-10-19, 2026-10-21");
assert.equal(dayRangesLabel(["2026-10-31", "2026-11-01"]), "2026-10-31..2026-11-01", "a range crosses a month");
assert.equal(dayRangesLabel([]), "");
assert.equal(spendGuardNote("Meta", []), "");
assert.equal(spendGuardNote("Meta", ["2026-10-14"]), "kept stored spend for 2026-10-14 (Meta answered no delivery for a day we hold spend for)");
assert.equal(
  spendGuardNote("Meta", r.kept),
  "kept stored spend for 2026-10-14..2026-10-19 (Meta answered no delivery for 6 days we hold spend for)",
);

console.log("marketing-spend-guard selftest: ok");

// Run: npx tsx scripts/itinerary-settings-selftest.ts
// The Euro Trip settings check (lib/itinerary/settings.ts): ranges, the four cross-field rules, jsonb types
// (the reader in myt-main ignores a string / out-of-range row silently), and the reader mirror.
import assert from "node:assert/strict";
import {
  DEFAULT_ITINERARY_SETTINGS,
  ITINERARY_SPECS,
  itineraryErrorsText,
  itineraryRows,
  parseItinerarySettingRows,
  validateItinerarySettings,
  type ItineraryField,
  type ItinerarySettings,
} from "../lib/itinerary/settings";

const D = DEFAULT_ITINERARY_SETTINGS;
const ok = (patch: Record<string, unknown> = {}) => {
  const r = validateItinerarySettings({ ...D, ...patch });
  if (!r.ok) throw new Error(`expected ok, got: ${JSON.stringify(r.errors)}`);
  return r.settings;
};
const bad = (patch: Record<string, unknown>, field: ItineraryField, re: RegExp, why: string) => {
  const r = validateItinerarySettings({ ...D, ...patch });
  assert.equal(r.ok, false, why);
  if (!r.ok) {
    assert.match(r.errors[field] ?? "", re, why);
    assert.deepEqual(Object.keys(r.errors), [field], `${why}: only that field is blamed`);
  }
};

// The defaults are the reader's (myt-main lib/itinerary/settings.ts).
assert.deepEqual(D, {
  enabled: false, paymentsEnabled: false, tier2Pct: 30, tier3Pct: 50, maxEvents: 3,
  maxKm: 1000, bestKm: 600, okGapDays: 5, maxGapDays: 10, maxSpanDays: 21, maxAutoRoutes: 12,
});
assert.deepEqual(ITINERARY_SPECS.map((s) => s.key), [
  "enabled", "payments_enabled", "tier_2_pct", "tier_3_pct", "max_events", "max_km", "best_km",
  "ok_gap_days", "max_gap_days", "max_span_days", "max_auto_routes",
]);
assert.deepEqual(ok(), D, "the defaults are a valid form");

// Ranges are inclusive, per field: [min, max, whole number?].
const RANGES: [ItineraryField, number, number, boolean][] = [
  ["tier2Pct", 0, 90, false], ["tier3Pct", 0, 90, false], ["maxEvents", 2, 3, true],
  ["maxKm", 50, 5000, false], ["bestKm", 50, 5000, false], ["okGapDays", 1, 30, true],
  ["maxGapDays", 1, 30, true], ["maxSpanDays", 1, 30, true], ["maxAutoRoutes", 0, 48, true],
];
for (const [field, min, max, int] of RANGES) {
  // Each edge is tried with a form where the other numbers do not trip a cross-field rule.
  const base: Record<string, unknown> = {
    tier2Pct: 0, tier3Pct: 0, maxKm: 5000, bestKm: 50, okGapDays: 1, maxGapDays: 30, maxSpanDays: 30,
    ...(field === "tier2Pct" ? { tier3Pct: 90 } : {}),
    ...(field === "maxSpanDays" ? { maxGapDays: 1 } : {}),
  };
  const form = (v: unknown) => ({ ...D, ...base, [field]: v });
  const edgeOk = (v: number) => {
    const r = validateItinerarySettings(form(v));
    assert.equal(r.ok, true, `${field}=${v} is inside [${min}, ${max}]: ${r.ok ? "" : JSON.stringify(r.errors)}`);
    if (r.ok) assert.equal(r.settings[field], v);
  };
  const edgeBad = (v: unknown, re: RegExp) => {
    const r = validateItinerarySettings(form(v));
    assert.equal(r.ok, false, `${field}=${String(v)} must be refused`);
    if (!r.ok) assert.match(r.errors[field] ?? "", re, `${field}=${String(v)}`);
  };
  edgeOk(min);
  edgeOk(max);
  edgeBad(min - 1, /בין/);
  edgeBad(max + 1, /בין/);
  edgeBad("5", /יש להזין/);
  edgeBad(null, /יש להזין/);
  edgeBad(undefined, /יש להזין/);
  edgeBad(Number.NaN, /יש להזין/);
  edgeBad(Number.POSITIVE_INFINITY, /יש להזין/);
  if (int) edgeBad(min + 0.5, /שלם/);
  else edgeOk(min + 0.5);
}

// Booleans must be booleans (a string "true" would be ignored by the reader).
bad({ enabled: "true" }, "enabled", /ערך לא תקין/, "a string is not a switch");
bad({ paymentsEnabled: 1 }, "paymentsEnabled", /ערך לא תקין/, "1 is not a switch");
assert.equal(ok({ enabled: true, paymentsEnabled: true }).enabled, true);

// A missing field is an error, not a silent default.
{
  const { maxKm: _drop, ...rest } = D;
  void _drop;
  const r = validateItinerarySettings(rest);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors), ["maxKm"]);
}
// Not an object.
for (const input of [null, undefined, "x", 5, [], [D]]) assert.equal(validateItinerarySettings(input).ok, false, String(input));

// Cross-field rules: best_km <= max_km; ok_gap_days <= max_gap_days; max_gap_days <= max_span_days; tier_3 >= tier_2.
bad({ bestKm: 700, maxKm: 600 }, "bestKm", /לא יכול לעלות על המרחק המקסימלי/, "best km above max km");
assert.equal(ok({ bestKm: 600, maxKm: 600 }).bestKm, 600, "equal is fine");
bad({ okGapDays: 11, maxGapDays: 10 }, "okGapDays", /לא יכולים לעלות על הימים המקסימליים/, "ok gap above max gap");
assert.equal(ok({ okGapDays: 10, maxGapDays: 10 }).okGapDays, 10);
bad({ maxGapDays: 22, maxSpanDays: 21, okGapDays: 5 }, "maxGapDays", /לא יכולים לעלות על אורך הטריפ/, "max gap above the whole trip");
assert.equal(ok({ maxGapDays: 21, maxSpanDays: 21 }).maxGapDays, 21);
bad({ tier2Pct: 40, tier3Pct: 30 }, "tier3Pct", /לא יכולה להיות קטנה/, "3rd event cheaper than the 2nd");
assert.equal(ok({ tier2Pct: 40, tier3Pct: 40 }).tier3Pct, 40);
assert.equal(ok({ tier2Pct: 0, tier3Pct: 0 }).tier2Pct, 0, "no discount at all is allowed");

// A cross rule is judged only between two individually valid fields: one typo is one message.
{
  const r = validateItinerarySettings({ ...D, maxKm: 10, bestKm: 700 });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(Object.keys(r.errors), ["maxKm"], "max km out of range - best km is not also blamed");
  }
  const r2 = validateItinerarySettings({ ...D, bestKm: 700, maxKm: 600, tier2Pct: 60, tier3Pct: 50 });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.deepEqual(Object.keys(r2.errors).sort(), ["bestKm", "tier3Pct"], "two independent rules, two messages");
}

// The rows written to the table: every key, jsonb numbers / booleans - never strings.
{
  const rows = itineraryRows(ok({ enabled: true, tier2Pct: 25.5, maxEvents: 2 }));
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map((r) => r.key), ITINERARY_SPECS.map((s) => s.key));
  for (const r of rows) assert.ok(typeof r.value === "number" || typeof r.value === "boolean", `${r.key} is jsonb number/boolean`);
  assert.deepEqual(rows.find((r) => r.key === "enabled"), { key: "enabled", value: true });
  assert.deepEqual(rows.find((r) => r.key === "tier_2_pct"), { key: "tier_2_pct", value: 25.5 });
  assert.deepEqual(rows.find((r) => r.key === "max_events"), { key: "max_events", value: 2 });
  // What is written is what the reader hands back.
  assert.deepEqual(parseItinerarySettingRows(rows), ok({ enabled: true, tier2Pct: 25.5, maxEvents: 2 }));
}

// The one-line error names the field by its label.
{
  const r = validateItinerarySettings({ ...D, tier3Pct: 95 });
  assert.equal(r.ok, false);
  if (!r.ok) {
    const text = itineraryErrorsText(r.errors);
    assert.match(text, /^ההגדרות לא נשמרו\./);
    assert.match(text, /אירוע שלישי: % הנחה על דמי השירות - חייב להיות בין 0 ל-90/);
  }
}

// The reader mirror: merged over the defaults; unknown key / wrong type / out of range / fractional-where-whole
// are skipped; null and non-arrays read as the defaults.
assert.deepEqual(parseItinerarySettingRows(null), D);
assert.deepEqual(parseItinerarySettingRows(undefined), D);
assert.deepEqual(parseItinerarySettingRows([]), D);
{
  const s: ItinerarySettings = parseItinerarySettingRows([
    { key: "enabled", value: true },
    { key: "payments_enabled", value: "true" }, // a string - ignored
    { key: "tier_2_pct", value: 91 }, // above 90 - ignored
    { key: "tier_3_pct", value: 65 },
    { key: "max_events", value: 2.5 }, // not whole - ignored
    { key: "max_km", value: "900" }, // a string - ignored
    { key: "best_km", value: 49 }, // below 50 - ignored
    { key: "ok_gap_days", value: 4 },
    { key: "mystery", value: 1 }, // unknown key
  ]);
  assert.deepEqual(s, { ...D, enabled: true, tier3Pct: 65, okGapDays: 4 });
}

console.log("itinerary-settings-selftest: all good");

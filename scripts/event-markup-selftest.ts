// Run: npx tsx scripts/event-markup-selftest.ts
import assert from "node:assert/strict";
import { cleanEventIds, MARKUP_MAX_USD, parseBulkMarkup } from "../lib/event-markup";

const ok = (column: string, raw: unknown) => {
  const r = parseBulkMarkup(column, raw);
  assert.equal(r.ok, true, `${column} ${String(raw)} should pass`);
  return r.ok ? r.value : undefined;
};
const bad = (column: string, raw: unknown) =>
  assert.equal(parseBulkMarkup(column, raw).ok, false, `${column} ${String(raw)} should fail`);

// Additional markup: whole dollars, may be negative, bounded.
assert.equal(ok("event_additional_markup", "75"), 75);
assert.equal(ok("event_additional_markup", 0), 0);
assert.equal(ok("event_additional_markup", "-50"), -50);
assert.equal(ok("event_additional_markup", ""), null, "empty = clear");
assert.equal(ok("event_additional_markup", null), null, "null = clear");
assert.equal(ok("event_additional_markup", MARKUP_MAX_USD), MARKUP_MAX_USD);
bad("event_additional_markup", "12.5");
bad("event_additional_markup", "7500");
bad("event_additional_markup", "-7500");
bad("event_additional_markup", "abc");
bad("event_additional_markup", undefined);

// Ticket-only markup: never below 0, cents allowed (numeric column).
assert.equal(ok("ticket_only_markup", "25"), 25);
assert.equal(ok("ticket_only_markup", "12.5"), 12.5);
assert.equal(ok("ticket_only_markup", " "), null);
bad("ticket_only_markup", "-1");
bad("ticket_only_markup", "9999");

// Only the two markup columns - a spread payload can never ride along.
bad("base_flight_price", "100");
bad("is_hidden", "0");

assert.deepEqual(cleanEventIds([650, 142, 650]), [650, 142], "deduped");
assert.equal(cleanEventIds([]), null);
assert.equal(cleanEventIds([1, "2"]), null);
assert.equal(cleanEventIds([0]), null);
assert.equal(cleanEventIds([1.5]), null);
assert.equal(cleanEventIds("650"), null);
assert.equal(cleanEventIds(Array.from({ length: 1001 }, (_, i) => i + 1)), null);

console.log("event-markup selftest OK");

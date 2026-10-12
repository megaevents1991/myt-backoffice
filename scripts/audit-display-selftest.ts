// Self-test for the audit screen's display rules (lib/audit-display.ts). No DB, no network.
//   npx tsx scripts/audit-display-selftest.ts
import assert from "node:assert/strict";
import {
  auditDiffRows,
  auditEntityHref,
  auditHistoryHref,
  auditSearchText,
  changedKeys,
  flightAuditLabel,
  formatAuditTime,
  formatAuditValue,
  humanizeKey,
  isSensitiveKey,
  matchesAuditSearch,
} from "../lib/audit-display";

// ── diff rows ────────────────────────────────────────────────────────────────
const update = {
  outbound_arrival_time: { from: "2027-05-20T14:00:00", to: "2027-07-20T14:00:00" },
  price: { from: 300, to: 350 },
};
assert.deepEqual(auditDiffRows(update), [
  { key: "outbound_arrival_time", from: "2027-05-20T14:00:00", to: "2027-07-20T14:00:00", pair: true },
  { key: "price", from: 300, to: 350, pair: true },
]);
assert.deepEqual(changedKeys(update), ["outbound_arrival_time", "price"]);

const create = { airline_code: "LY", price: 300, event_ids: [12] };
const createRows = auditDiffRows(create);
assert.equal(createRows.length, 3, "a create lists every value");
assert.equal(createRows[0].pair, false);
assert.deepEqual(createRows[2].to, [12]);

assert.deepEqual(auditDiffRows(null), [], "nothing to diff");
assert.deepEqual(auditDiffRows("text"), [], "a string has no rows");
assert.deepEqual(auditDiffRows([1, 2]), [], "an array has no rows");
assert.deepEqual(auditDiffRows({}), [], "an empty change has no rows");

// A value that happens to hold from/to inside a create is still a create when
// a sibling is a plain value - all-or-nothing keeps the two shapes apart.
const mixed = { a: { from: 1, to: 2 }, b: 3 };
assert.equal(auditDiffRows(mixed).every((r) => !r.pair), true);

// ── values ───────────────────────────────────────────────────────────────────
assert.equal(formatAuditValue("2027-07-20T14:00:00"), "20/07/2027 14:00", "a timestamp reads as the form shows it");
assert.equal(formatAuditValue("2027-05-20"), "20/05/2027", "a date reads DD/MM/YYYY");
assert.equal(formatAuditValue(null), "—");
assert.equal(formatAuditValue(""), "—");
assert.equal(formatAuditValue(true), "Yes");
assert.equal(formatAuditValue(false), "No");
assert.equal(formatAuditValue(350), "350");
assert.equal(formatAuditValue([12, 13]), "[12,13]");
assert.equal(formatAuditValue({ a: 1 }), '{"a":1}');
assert.equal(formatAuditValue("x".repeat(200), 20).length, 20, "a long text is cut");
assert.equal(formatAuditValue("LY123"), "LY123");

// ── row time ─────────────────────────────────────────────────────────────────
assert.equal(formatAuditTime("2026-10-12T09:53:08.123+00:00"), "12/10/2026, 12:53", "Israel time (UTC+3 in October)");
assert.equal(formatAuditTime("2026-01-12T09:53:08Z"), "12/01/2026, 11:53", "UTC+2 in January");
assert.equal(formatAuditTime("nope"), "nope", "an unreadable time is shown as it is");

// ── keys ─────────────────────────────────────────────────────────────────────
assert.equal(isSensitiveKey("outbound_arrival_time"), true);
assert.equal(isSensitiveKey("price"), true);
assert.equal(isSensitiveKey("def_date_depart"), false, "not every date-ish key is flagged - the suffix rule is deliberate");
assert.equal(isSensitiveKey("base_flight_price"), true);
assert.equal(isSensitiveKey("event_ids"), true);
assert.equal(isSensitiveKey("metadata_name"), false);
assert.equal(humanizeKey("outbound_arrival_time"), "Outbound arrival time");
assert.equal(humanizeKey(""), "");

// ── search ───────────────────────────────────────────────────────────────────
const row = {
  actor_email: "liz@mega.co.il",
  action: "update",
  entity_type: "offline_flight",
  entity_id: "57",
  entity_label: "LY123 TLV→CDG 20/05/2027",
  changes: update,
  metadata: { impersonated_by: "dor@mega.co.il" },
};
const text = auditSearchText(row);
assert.ok(matchesAuditSearch(text, "20/07"), "the printed date is searchable");
assert.ok(matchesAuditSearch(text, "2027-07-20"), "the raw date is searchable");
assert.ok(matchesAuditSearch(text, "liz arrival"), "words in any order, across fields");
assert.ok(matchesAuditSearch(text, "LY123"), "the entity label is searchable");
assert.ok(matchesAuditSearch(text, "dor@"), "metadata is searchable");
assert.ok(matchesAuditSearch(text, ""), "an empty query matches everything");
assert.equal(matchesAuditSearch(text, "golasso"), false);

// ── links ────────────────────────────────────────────────────────────────────
assert.equal(auditEntityHref("offline_flight", "57"), "/offline-flights/57");
assert.equal(auditEntityHref("flight", "57"), "/offline-flights/57");
assert.equal(auditEntityHref("event", "812"), "/events/812");
assert.equal(auditEntityHref("partner", "AVIRAN"), "/partners/AVIRAN/view");
assert.equal(auditEntityHref("storage", "x"), null, "an entity with no page has no link");
assert.equal(auditEntityHref("event", null), null);
assert.equal(auditHistoryHref("offline_flight", 57), "/audit-log?entity=offline_flight&id=57");

// ── flight label ─────────────────────────────────────────────────────────────
assert.equal(
  flightAuditLabel({
    airline_code: "LY",
    outbound_flight_number: "LY123",
    outbound_departure_airport: "TLV",
    outbound_arrival_airport: "CDG",
    outbound_departure_time: "2027-05-20T10:00:00",
  }),
  "LY123 TLV→CDG 20/05/2027",
);
assert.equal(flightAuditLabel({ airline_code: "LY" }), "LY", "a bare row still names its airline");
assert.equal(flightAuditLabel({}), "");

console.log("audit-display selftest: OK");

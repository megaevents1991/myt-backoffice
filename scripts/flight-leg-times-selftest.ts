// Self-test for the leg-times rule of the offline flight forms and actions
// (lib/flight-leg-times.ts). No DB, no network.
//   npx tsx scripts/flight-leg-times-selftest.ts
import assert from "node:assert/strict";
import { z } from "zod";
import {
  MAX_LEG_HOURS,
  assertLegTimes,
  legTimesProblem,
  legTimesSuperRefine,
} from "../lib/flight-leg-times";

const TAKEOFF = "2027-05-20T10:00:00";

// ── legTimesProblem ──────────────────────────────────────────────────────────
assert.equal(legTimesProblem(TAKEOFF, "2027-05-20T14:00:00"), null, "same-day leg");
assert.equal(legTimesProblem("2027-05-20T23:30:00", "2027-05-21T03:10:00"), null, "overnight leg");
assert.equal(legTimesProblem(TAKEOFF, "2027-05-22T10:00:00"), null, `exactly ${MAX_LEG_HOURS}h is allowed`);
assert.equal(legTimesProblem(TAKEOFF, "2027-05-20T14:00"), null, "a datetime-local value without seconds reads too");

const wrongMonth = legTimesProblem(TAKEOFF, "2027-07-20T14:00:00");
assert.ok(wrongMonth, "a landing two months after the takeoff is refused");
assert.match(wrongMonth ?? "", /61 days/, "the message says how far off the landing is");
assert.match(wrongMonth ?? "", /month/, "and points at the date");

assert.equal(legTimesProblem(TAKEOFF, "2027-05-22T10:01:00") === null, false, "one minute past the window is refused");
assert.equal(legTimesProblem(TAKEOFF, "2027-05-20T09:59:00"), "Landing is before takeoff.");

assert.equal(legTimesProblem(undefined, "2027-05-20T14:00:00"), null, "no takeoff = nothing to compare");
assert.equal(legTimesProblem(TAKEOFF, undefined), null, "no landing = nothing to compare");
assert.equal(legTimesProblem(TAKEOFF, "not a date"), null, "an unreadable value is the schema's business");
assert.equal(legTimesProblem(TAKEOFF, ""), null, "a blank value is the schema's business");

// ── assertLegTimes (server) ──────────────────────────────────────────────────
const goodRow = {
  outbound_departure_time: TAKEOFF,
  outbound_arrival_time: "2027-05-20T14:00:00",
  inbound_departure_time: "2027-05-24T15:00:00",
  inbound_arrival_time: "2027-05-24T19:00:00",
};
assert.doesNotThrow(() => assertLegTimes(goodRow), "a sound row passes");
assert.doesNotThrow(() => assertLegTimes({ price: 300 }), "a patch with no times passes");

assert.throws(
  () => assertLegTimes({ ...goodRow, outbound_arrival_time: "2027-07-20T14:00:00" }),
  /^Error: outbound_arrival_time: Landing is 61 days after takeoff/,
  "the throw names the column",
);
assert.throws(
  () => assertLegTimes({ ...goodRow, inbound_arrival_time: "2027-05-24T14:00:00" }),
  /inbound_arrival_time: Landing is before takeoff/,
  "the inbound leg is checked the same way",
);

// An update merged with a stored row: only the legs the patch names count.
const storedBad = { ...goodRow, outbound_arrival_time: "2027-07-20T14:00:00" };
assert.doesNotThrow(
  () => assertLegTimes({ ...storedBad, price: 350 }, { price: 350 }),
  "a price change never fails over a landing typed wrong long ago",
);
assert.doesNotThrow(
  () => assertLegTimes({ ...storedBad, inbound_arrival_time: "2027-05-24T20:00:00" }, { inbound_arrival_time: "2027-05-24T20:00:00" }),
  "touching the other leg does not check the bad one",
);
assert.throws(
  () => assertLegTimes({ ...storedBad, outbound_arrival_time: "2027-08-20T14:00:00" }, { outbound_arrival_time: "2027-08-20T14:00:00" }),
  /outbound_arrival_time/,
  "an in-place edit of the landing is checked against the stored takeoff",
);
assert.doesNotThrow(
  () => assertLegTimes({ ...storedBad, outbound_arrival_time: "2027-05-20T14:00:00" }, { outbound_arrival_time: "2027-05-20T14:00:00" }),
  "and the fix itself goes through",
);

// ── legTimesSuperRefine (forms) ──────────────────────────────────────────────
const schema = z
  .object({
    outbound_departure_time: z.string(),
    outbound_arrival_time: z.string(),
    inbound_departure_time: z.string(),
    inbound_arrival_time: z.string(),
  })
  .superRefine(legTimesSuperRefine);

assert.ok(schema.safeParse(goodRow).success, "a sound form passes");

const refused = schema.safeParse({ ...goodRow, outbound_arrival_time: "2027-07-20T14:00:00" });
assert.equal(refused.success, false, "the form refuses the wrong-month landing");
if (!refused.success) {
  assert.deepEqual(
    refused.error.issues.map((i) => i.path.join(".")),
    ["outbound_arrival_time"],
    "the issue sits on the leg's arrival field",
  );
  assert.match(refused.error.issues[0].message, /61 days/);
}

const both = schema.safeParse({
  ...goodRow,
  outbound_arrival_time: "2027-05-20T09:00:00",
  inbound_arrival_time: "2027-05-30T19:00:00",
});
assert.equal(both.success, false);
if (!both.success) {
  assert.deepEqual(
    both.error.issues.map((i) => i.path.join(".")).sort(),
    ["inbound_arrival_time", "outbound_arrival_time"],
    "each leg gets its own issue",
  );
}

console.log("flight-leg-times selftest: OK");

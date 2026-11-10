// scripts/tours-case-offers-sql-pglite-test.mjs - `node scripts/tours-case-offers-sql-pglite-test.mjs`
//
// The SQL test of several offers on one card (supabase/migrations/20261110170000_tours_case_offers.sql, Alon 10.11:
// "הלינק הראשון שנרשם מבטל את האחרים אוטומטית"), on an in-process Postgres (PGlite):
//   - the migration runs (twice: create or replace) - tours.booking_create compiles with its one changed line;
//   - tours.case_offers_booked: no offer stays none; one offer object gets the bookingRef (as before 10.11);
//   - an array: the offer of the booked date gets the ref and every other standing offer cancelledAt;
//   - another date of an offered tour books that tour's offer; a date of no offered tour books none and cancels them all;
//   - an offer cancelled before is never the booked one, and keeps its own cancelledAt;
//   - a card already booked through one offer is left as it is by a second booking.
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH at an install
// elsewhere (the package directory). No network, no prod.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite");

const MIGRATION = readFileSync(`${process.cwd()}/supabase/migrations/20261110170000_tours_case_offers.sql`, "utf8");

const db = new PGlite();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema tours;
create table tours.departures(id uuid primary key, package_id uuid);
`);
await db.exec(MIGRATION);
await db.exec(MIGRATION); // create or replace: runs again

const [P1, P2, P3, P9] = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333", "99999999-9999-9999-9999-999999999999"];
const [D1, D2, D3, D2b, D9] = [
  "a1111111-1111-1111-1111-111111111111",
  "a2222222-2222-2222-2222-222222222222",
  "a3333333-3333-3333-3333-333333333333",
  "b2222222-2222-2222-2222-222222222222",
  "a9999999-9999-9999-9999-999999999999",
];
await q(`insert into tours.departures(id, package_id) values ($1,$2),($3,$4),($5,$6),($7,$8),($9,$10)`, [D1, P1, D2, P2, D3, P3, D2b, P2, D9, P9]);

const offer = (id, dep, pkg, extra = {}) => ({ id, departureId: dep, packageId: pkg, url: `https://x/${id}`, rooms: ["double_room"], ...extra });
const booked = async (value, dep, ref = "T20001") =>
  (await q(`select tours.case_offers_booked($1::jsonb, $2::uuid, $3) as v`, [value === null ? null : JSON.stringify(value), dep, ref]))[0].v;

// none stays none
assert.equal(await booked(null, D1), null);

// one offer, as before 10.11
const one = await booked(offer("o0", D1, P1), D9);
assert.equal(one.bookingRef, "T20001", "a single offer gets the ref whatever the date");
assert.equal(one.cancelledAt, undefined);

const three = [offer("a", D1, P1), offer("b", D2, P2), offer("c", D3, P3)];

// the booked date's offer
let out = await booked(three, D2);
assert.deepEqual(
  out.map((o) => [o.id, o.bookingRef ?? null, !!o.cancelledAt]),
  [
    ["a", null, true],
    ["b", "T20001", false],
    ["c", null, true],
  ],
  "the date's offer is booked, the others cancelled",
);
assert.match(out[0].cancelledAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "cancelledAt is an ISO instant");

// another date of an offered tour
out = await booked(three, D2b);
assert.equal(out[1].bookingRef, "T20001", "another date of tour 2 books tour 2's offer");
assert.ok(out[0].cancelledAt && out[2].cancelledAt);

// a date of no offered tour: none is booked (which link was opened is unknown), all standing ones are cancelled
out = await booked(three, D9);
assert.ok(out.every((o) => o.bookingRef === undefined), "no match - no offer is marked booked");
assert.ok(out.every((o) => o.cancelledAt), "...and every standing one is cancelled");

// an offer cancelled before is skipped and keeps its time
const withDead = [offer("a", D1, P1, { cancelledAt: "2026-11-01T10:00:00.000Z" }), offer("b", D2, P2), offer("c", D3, P3)];
out = await booked(withDead, D1);
assert.equal(out[0].bookingRef, undefined, "a cancelled offer is never the booked one");
assert.equal(out[0].cancelledAt, "2026-11-01T10:00:00.000Z", "it keeps its own cancelledAt");
assert.equal(out[1].bookingRef, undefined, "a date no standing offer names books none");
assert.ok(out[1].cancelledAt && out[2].cancelledAt, "...and cancels the standing ones");

// a cancelled offer of the booked date is skipped; another standing offer of the same tour is the booked one
const sameTour = [offer("a", D2, P2, { cancelledAt: "2026-11-01T10:00:00.000Z" }), offer("b", D2b, P2), offer("c", D3, P3)];
out = await booked(sameTour, D2);
assert.equal(out[1].bookingRef, "T20001", "the tour's other standing offer");
assert.equal(out[0].cancelledAt, "2026-11-01T10:00:00.000Z");
assert.ok(out[2].cancelledAt);

// a second booking through the same link changes nothing
const after = await booked(three, D2);
const again = await booked(after, D1, "T20002");
assert.deepEqual(again, after, "the first booking decided");

// the order of the offers is kept
assert.deepEqual(
  (await booked(three, D3)).map((o) => o.id),
  ["a", "b", "c"],
);

console.log("tours-case-offers-sql-pglite-test: all checks passed");

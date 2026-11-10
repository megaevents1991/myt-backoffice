// scripts/tixstock-booking-sql-pglite-test.mjs - `node scripts/tixstock-booking-sql-pglite-test.mjs`
//
// The SQL test of the TixStock ticket booking migration (supabase/migrations/*_tixstock_ticket_booking.sql, spec
// docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.3), on an in-process Postgres (PGlite) over
// stub `reservations`, `events` and `storage.buckets`:
//   - one LIVE booking per reservation (holding / on_hold / ordering / sale_on_hold / approved / commissionable /
//     uncertain), whoever placed it - the site or the office button;
//   - a failed or released booking does not block the next one;
//   - the claim before orders/add (on_hold -> ordering) can be taken once only;
//   - a ticket file is stored once per dedupe key;
//   - events.tixstock_booking exists and is nullable, the private bucket exists once;
//   - RLS is on, and the migration runs twice without an error (idempotent).
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH at an install
// elsewhere (the package directory). No network, no prod.
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite");

const dir = `${process.cwd()}/supabase/migrations`;
const file = readdirSync(dir).find((f) => f.endsWith("_tixstock_ticket_booking.sql"));
assert.ok(file, "the TixStock ticket booking migration file exists");
const MIGRATION = readFileSync(`${dir}/${file}`, "utf8");

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table public.reservations (id bigint primary key);
create table public.events (id bigint primary key, is_test boolean not null default false);
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
insert into public.reservations (id) select generate_series(1, 9);
insert into public.events (id) values (1);
`);

await db.exec(MIGRATION);
await db.exec(MIGRATION); // idempotent

let n = 0;
const booking = (reservationId, status, token = `tok-${++n}`) =>
  db.query(
    `insert into public.ticket_bookings
       (reservation_id, env, source, tixstock_event_id, listing_id, quantity, status, listing, customer_token)
     values ($1, 'sandbox', 'office', 'E1', 'L1', 2, $2, '{}'::jsonb, $3)
     returning id, currency, sent_channels, created_at, updated_at`,
    [reservationId, status, token],
  );
const LIVE_REFUSED = /ticket_bookings_one_live|duplicate|unique/i;

// second live booking is refused
const first = await booking(1, "on_hold");
await assert.rejects(booking(1, "on_hold"), LIVE_REFUSED, "a second on_hold booking of one reservation is refused");
assert.equal(first.rows[0].currency, "USD", "currency defaults to USD");
assert.deepEqual(first.rows[0].sent_channels, [], "sent_channels defaults to an empty list");
assert.ok(first.rows[0].created_at && first.rows[0].updated_at, "created_at / updated_at default to now()");

// failed then new is allowed
await booking(2, "failed");
await booking(2, "on_hold");

// uncertain blocks
await booking(3, "uncertain");
await assert.rejects(booking(3, "holding"), LIVE_REFUSED, "an uncertain booking blocks a new one");

// ordering blocks: a row in the middle of its orders/add call still locks the reservation
await booking(4, "ordering");
await assert.rejects(booking(4, "on_hold"), LIVE_REFUSED, "an ordering booking blocks a new one");

// every other live status blocks too
for (const [reservationId, status] of [[7, "sale_on_hold"], [8, "approved"], [9, "commissionable"]]) {
  await booking(reservationId, status);
  await assert.rejects(booking(reservationId, "holding"), LIVE_REFUSED, `${status} blocks a new booking`);
}

// released then new is allowed
await booking(5, "released");
await booking(5, "on_hold");

// claim is one-way
const claimable = await booking(6, "on_hold");
const claim = () =>
  db.query(
    `update public.ticket_bookings set status = 'ordering', attempt_started_at = now()
      where id = $1 and status = 'on_hold' returning id`,
    [claimable.rows[0].id],
  );
assert.equal((await claim()).rows.length, 1, "the first claim takes the row");
assert.equal((await claim()).rows.length, 0, "the second claim finds nothing to take");

// the customer's token is unique
await assert.rejects(booking(2, "cancelled", "tok-1"), /duplicate|unique/i, "a customer token is never reused");

// a booking belongs to a real reservation
await assert.rejects(booking(999, "on_hold"), /foreign key|violates/i, "an unknown reservation is refused");

// file dedupe
const fileRow = (key) =>
  db.query(
    `insert into public.ticket_booking_files (booking_id, kind, dedupe_key) values ($1, 'pdf', $2) returning id, received_at`,
    [first.rows[0].id, key],
  );
const f = await fileRow("order-1:pdf:A:12:0");
assert.ok(f.rows[0].received_at, "received_at defaults to now()");
await assert.rejects(fileRow("order-1:pdf:A:12:0"), /duplicate|unique/i, "the same file is stored once");
await fileRow("order-1:pdf:A:13:0");

// `row` is a reserved word in Postgres: the column is usable when quoted (PostgREST always quotes)
await db.query(
  `insert into public.ticket_booking_files (booking_id, kind, "row", seat, dedupe_key) values ($1, 'pdf', 'A', '14', 'order-1:pdf:A:14:0')`,
  [first.rows[0].id],
);
const seatRow = await db.query(`select "row", seat from public.ticket_booking_files where dedupe_key = 'order-1:pdf:A:14:0'`);
assert.deepEqual(seatRow.rows[0], { row: "A", seat: "14" }, "row and seat are stored as sent");

// the webhook log takes a row with nothing but its signature verdict
const ev = await db.query(`insert into public.tixstock_webhook_events (signature_valid) values (false) returning id, received_at`);
assert.ok(ev.rows[0].id && ev.rows[0].received_at, "a webhook log row gets an id and a time");

// events.tixstock_booking exists and is nullable; an event without it is untouched
const col = await db.query(
  `select is_nullable, data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'tixstock_booking'`,
);
assert.equal(col.rows[0]?.is_nullable, "YES", "events.tixstock_booking exists and is nullable");
assert.equal(col.rows[0]?.data_type, "text");
const existing = await db.query(`select tixstock_booking from public.events where id = 1`);
assert.equal(existing.rows[0].tixstock_booking, null, "an existing event reads null");

// the private bucket exists once after two runs
const bucket = await db.query(`select public from storage.buckets where id = 'ticket-files'`);
assert.equal(bucket.rows.length, 1, "one ticket-files bucket after two runs");
assert.equal(bucket.rows[0].public, false, "the bucket is private");

// RLS is on for the three tables, and anon / authenticated hold no privilege on them
const rls = await db.query(
  `select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('ticket_bookings', 'ticket_booking_files', 'tixstock_webhook_events') order by relname`,
);
assert.deepEqual(rls.rows.map((r) => [r.relname, r.relrowsecurity]), [
  ["ticket_booking_files", true],
  ["ticket_bookings", true],
  ["tixstock_webhook_events", true],
]);
const grants = await db.query(
  `select count(*)::int as n from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and table_name in ('ticket_bookings', 'ticket_booking_files', 'tixstock_webhook_events')`,
);
assert.equal(grants.rows[0].n, 0, "anon / authenticated have no grant on the booking tables");

// the lock timeout the migration sets for itself does not leak into the session
const lt = await db.query(`show lock_timeout`);
assert.equal(lt.rows[0].lock_timeout, "0", "lock_timeout is back to its default after the migration");

console.log("tixstock-booking-sql-pglite-test: all assertions passed");

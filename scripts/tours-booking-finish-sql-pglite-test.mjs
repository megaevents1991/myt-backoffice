// scripts/tours-booking-finish-sql-pglite-test.mjs - `node scripts/tours-booking-finish-sql-pglite-test.mjs`
//
// The SQL test of migration 20261028142404_tours_booking_unverified_charge.sql, on an in-process Postgres (PGlite):
// stub tables with the columns tours.booking_finish_payment touches, the real tours.booking_key_ok, then the
// function from the migration, called straight - a charge CreditGuard did not tie to the booking's page waits for a
// check (no seats, not paid), a verified charge is paid with one seat row, an older site that sends no flag is paid as
// before, a failed charge is failed, a wrong amount is still kept for a human.
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH at an
// install elsewhere (the package directory). No network, no prod.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite");

const MIG = `${process.cwd()}/supabase/migrations`;
const file = (name) => readFileSync(`${MIG}/${name}`, "utf8");
function extractFn(sql, name) {
  const start = sql.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end + 4);
}

const db = new PGlite();
const exec = (sql) => db.exec(sql);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const KEY = "k".repeat(40);
await exec(`
create schema tours;
create table public.companies(id uuid primary key default gen_random_uuid(), payment_config jsonb default '{}'::jsonb);
create table public.leads(id uuid primary key default gen_random_uuid(), payload jsonb default '{}'::jsonb);
create table tours.bookings(
  id uuid primary key default gen_random_uuid(), company_id uuid, ref text, status text, departure_id uuid, lead_id uuid,
  adults int, children int, customer_name text, customer_phone text, customer_email text, total_ils numeric,
  cg_uniqueid text, cg_tx_id text, cg_auth_number text, cg_card_last4 text, cg_result jsonb, staff_note text,
  paid_at timestamptz, sales_entry_id uuid, is_deleted date);
create table tours.departure_sales_entries(
  id uuid primary key default gen_random_uuid(), company_id uuid, departure_id uuid, pax int, note text,
  customer_name text, customer_phone text, customer_email text, lead_id uuid);
`);
await exec(extractFn(file("20261003100000_tours_online_bookings.sql"), "tours.booking_key_ok"));
await exec(file("20261028142404_tours_booking_unverified_charge.sql"));

const [company] = await q(`insert into public.companies(payment_config) values (jsonb_build_object('site_key_sha256', encode(sha256(convert_to($1, 'UTF8')), 'hex'))) returning id`, [KEY]);
const C = company.id;
let refNo = 1000;
const booking = async () => {
  const ref = `T${++refNo}`;
  const [lead] = await q(`insert into public.leads default values returning id`);
  const [b] = await q(
    `insert into tours.bookings(company_id, ref, status, departure_id, lead_id, adults, children, customer_name, total_ils, cg_uniqueid)
     values ($1, $2, 'pending_payment', gen_random_uuid(), $3, 2, 1, 'Dana Levi', 4200, $4) returning id`,
    [C, ref, lead.id, `uid-${ref}-aaaa`],
  );
  return { id: b.id, ref, uid: `uid-${ref}-aaaa` };
};
const finish = async (args) => (await q(`select tours.booking_finish_payment($1, $2::jsonb) as r`, [C, JSON.stringify({ key: KEY, ...args })]))[0].r;
const row = async (id) => (await q(`select status, staff_note, paid_at, sales_entry_id, cg_tx_id, cg_card_last4 from tours.bookings where id = $1`, [id]))[0];
const seats = async (id) => (await q(`select e.pax from tours.departure_sales_entries e join tours.bookings b on b.lead_id = e.lead_id where b.id = $1`, [id])).length;
const charge = (b, over = {}) => ({ uniqueid: b.uid, ok: true, amount_agorot: "420000", currency: "ILS", tx_id: `tx-${b.ref}`, card_last4: "4242", ...over });

// ---------------------------------------------------------------- the key
let b = await booking();
assert.equal((await q(`select tours.booking_finish_payment($1, $2::jsonb) as r`, [C, JSON.stringify(charge(b))]))[0].r.error, "forbidden", "no key, nothing");

// ---------------------------------------------------------------- a charge CreditGuard did not tie to this page waits for a check
let f = await finish(charge(b, { unverified: true }));
assert.equal(f.status, "review", "a charge with no page named is never paid by itself (shared terminal)");
let r = await row(b.id);
assert.equal(r.status, "review");
assert.match(r.staff_note, /which payment page/);
assert.equal(r.paid_at, null);
assert.equal(r.sales_entry_id, null);
assert.equal(await seats(b.id), 0, "no seats held for it");
assert.equal(r.cg_tx_id, `tx-${b.ref}`, "the transaction is still kept on the booking for the check");
assert.equal(r.cg_card_last4, "4242");

// ---------------------------------------------------------------- a verified charge for the exact amount is paid, once
b = await booking();
f = await finish(charge(b, { unverified: false }));
assert.equal(f.status, "paid");
r = await row(b.id);
assert.equal(r.status, "paid");
assert.ok(r.paid_at);
assert.ok(r.sales_entry_id);
assert.equal(await seats(b.id), 1, "one seat row");
f = await finish(charge(b, { unverified: true }));
assert.equal(f.already, true, "a paid booking stays paid");

// ---------------------------------------------------------------- an older site deploy sends no flag: paid as before
b = await booking();
f = await finish(charge(b));
assert.equal(f.status, "paid");
assert.equal(await seats(b.id), 1);

// ---------------------------------------------------------------- a failed charge is failed, flag or not
b = await booking();
f = await finish(charge(b, { ok: false, unverified: false }));
assert.equal(f.status, "failed");
assert.equal((await row(b.id)).status, "failed");

// ---------------------------------------------------------------- a wrong amount is still kept for a human
b = await booking();
f = await finish(charge(b, { amount_agorot: "100", unverified: false }));
assert.equal(f.status, "review");
assert.match((await row(b.id)).staff_note, /amount or currency/);
assert.equal(await seats(b.id), 0);

console.log("tours booking finish SQL: all scenarios pass");

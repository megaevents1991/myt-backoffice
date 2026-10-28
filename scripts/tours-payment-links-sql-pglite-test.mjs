// scripts/tours-payment-links-sql-pglite-test.mjs - `node scripts/tours-payment-links-sql-pglite-test.mjs`
//
// The SQL test of migration 20261028140806_tours_payment_links.sql, on an in-process Postgres (PGlite): stub
// tables with the columns the link functions touch, the real tours.booking_key_ok, then the migration, then the
// scenarios through tours.site_booking - the page's read, the key, the shekel amount (automatic rate, company
// rate), a paid link writing exactly one payment row and moving the card's follow-up to today, a wrong amount /
// a used transaction / a cancelled link kept for a human, a failed card page reopening the link, a second card
// page of the same link, an expired link.
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
create role anon; create role authenticated; create role service_role;
create schema tours;
create table public.companies(id uuid primary key default gen_random_uuid(), slug text, payment_config jsonb default '{}'::jsonb);
create table public.company_exchange_rates(company_id uuid, currency text, rate_date date, rate_to_ils numeric);
create table public.leads(id uuid primary key default gen_random_uuid(), follow_up_date date);
create table tours.packages(id uuid primary key default gen_random_uuid(), company_id uuid, name text);
create table tours.departures(id uuid primary key default gen_random_uuid(), company_id uuid, package_id uuid, start_date date);
create table tours.bookings(
  id uuid primary key default gen_random_uuid(), company_id uuid, ref text, customer_name text, status text default 'new',
  departure_id uuid, lead_id uuid, total numeric, currency text, cg_tx_id text, is_deleted date);
create table tours.booking_payments(
  id uuid primary key default gen_random_uuid(), company_id uuid not null, booking_id uuid not null references tours.bookings(id),
  kind text, status text, amount numeric(12,2), currency text, amount_ils numeric(12,2), paid_at timestamptz, method text,
  payer_name text, invoice_no text, cg_tx_id text, note text, is_deleted date);
create unique index booking_payments_cg_tx_uniq on tours.booking_payments (booking_id, cg_tx_id)
  where cg_tx_id is not null and is_deleted is null;
`);
await exec(extractFn(file("20261003100000_tours_online_bookings.sql"), "tours.booking_key_ok"));
await exec(file("20261028140806_tours_payment_links.sql"));

const [company] = await q(`insert into public.companies(slug, payment_config) values ('megafamily', jsonb_build_object('site_key_sha256', encode(sha256(convert_to($1, 'UTF8')), 'hex'))) returning id`, [KEY]);
const C = company.id;
const [pkg] = await q(`insert into tours.packages(company_id, name) values ($1, 'Rome for families') returning id`, [C]);
const [dep] = await q(`insert into tours.departures(company_id, package_id, start_date) values ($1, $2, '2027-04-10') returning id`, [C, pkg.id]);
const [lead] = await q(`insert into public.leads(follow_up_date) values ('2027-01-01') returning id`);
const [booking] = await q(
  `insert into tours.bookings(company_id, ref, customer_name, status, departure_id, lead_id, total, currency)
   values ($1, 'T1001', 'Dana Levi', 'pending_payment', $2, $3, 3000, 'USD') returning id`,
  [C, dep.id, lead.id],
);
const B = booking.id;

const call = async (action, args) => (await q(`select tours.site_booking($1, $2, $3::jsonb) as r`, [C, action, JSON.stringify(args)]))[0].r;
let tokenNo = 0;
const link = async (over = {}) => {
  const token = `token-${String(++tokenNo).padStart(3, "0")}-abcdefghijklmnop`;
  await q(
    `insert into tours.payment_links(company_id, booking_id, kind, amount, currency, payments, token, expires_at, status)
     values ($1, $2, $3, $4, 'USD', $5, $6, $7, $8)`,
    [C, B, over.kind ?? "deposit", over.amount ?? 400, over.payments ?? 1, token, over.expires ?? new Date(Date.now() + 86_400_000).toISOString(), over.status ?? "open"],
  );
  return token;
};
const linkOf = async (token) => (await q(`select * from tours.payment_links where token = $1`, [token]))[0];
const paymentsOf = async () => q(`select kind, status, amount::float8 as amount, amount_ils::float8 as amount_ils, method, cg_tx_id, payer_name from tours.booking_payments where booking_id = $1 order by paid_at`, [B]);
const today = (await q(`select (now() at time zone 'Asia/Jerusalem')::date::text as d`))[0].d;
const followUp = async () => (await q(`select follow_up_date::text as d from public.leads where id = $1`, [lead.id]))[0].d;

// ---------------------------------------------------------------- the page's read and the key
const t1 = await link();
assert.equal((await call("pay_link", { token: t1 })).error, "forbidden", "no key, no read");
assert.equal((await call("pay_link", { key: "x".repeat(40), token: t1 })).error, "forbidden", "a wrong key reads nothing");
const info = await call("pay_link", { key: KEY, token: t1 });
assert.equal(info.ok, true);
assert.equal(info.state, "open");
assert.equal(info.ref, "T1001");
assert.equal(info.first_name, "Dana");
assert.equal(info.tour, "Rome for families");
assert.equal(Number(info.amount), 400);
assert.equal(info.phone, undefined, "no phone on the page");
assert.equal((await call("pay_link", { key: KEY, token: "nope" })).error, "not_found");

// ---------------------------------------------------------------- a wrong amount is kept for a human
let s = await call("start_link_payment", { key: KEY, token: t1, uniqueid: "uid-0001-aaaa", rate: "3.7" });
assert.equal(s.ok, true);
assert.equal(Number(s.total_ils), 1480, "ceil(400 x 3.7)");
assert.equal(Number(s.agorot), 148000);
let f = await call("finish_link_payment", { key: KEY, uniqueid: "uid-0001-aaaa", ok: true, amount_agorot: "100", currency: "ILS", tx_id: "tx-1" });
assert.equal(f.status, "review");
assert.equal((await paymentsOf()).length, 0, "no payment row on a mismatch");
assert.equal(await followUp(), today, "the card comes to TODAY");
assert.match((await linkOf(t1)).last_error, /amount or currency/);

// ---------------------------------------------------------------- a failed card page reopens the link; a second page pays it
await q(`update public.leads set follow_up_date = '2027-01-01'`);
const t2 = await link({ kind: "balance", amount: 1000.5, payments: 3 });
s = await call("start_link_payment", { key: KEY, token: t2, uniqueid: "uid-0002-aaaa", rate: "3.7" });
assert.equal(Number(s.payments), 3);
f = await call("finish_link_payment", { key: KEY, uniqueid: "uid-0002-aaaa", ok: false, reason: "cancel" });
assert.equal(f.status, "failed");
let l2 = await linkOf(t2);
assert.equal(l2.status, "open");
assert.equal(l2.attempts, 1);
s = await call("start_link_payment", { key: KEY, token: t2, uniqueid: "uid-0003-aaaa", rate: "3.6" });
assert.equal(Number(s.total_ils), Math.ceil(1000.5 * 3.6));
f = await call("finish_link_payment", { key: KEY, uniqueid: "uid-0003-aaaa", ok: true, amount_agorot: String(Math.ceil(1000.5 * 3.6) * 100), currency: "ILS", tx_id: "tx-2", auth_number: "A1", card_last4: "4242" });
assert.equal(f.status, "paid");
let pays = await paymentsOf();
assert.equal(pays.length, 1, "one payment row");
assert.deepEqual(pays[0], { kind: "balance", status: "paid", amount: 1000.5, amount_ils: Math.ceil(1000.5 * 3.6), method: "site", cg_tx_id: "tx-2", payer_name: "Dana Levi" });
l2 = await linkOf(t2);
assert.equal(l2.status, "paid");
assert.ok(l2.payment_id);
assert.equal(l2.cg_card_last4, "4242");
assert.equal(await followUp(), today);
assert.equal((await call("pay_link", { key: KEY, token: t2 })).state, "paid");

// the same answer again writes nothing; a SECOND successful charge (the first card page, still open) reaches a human
f = await call("finish_link_payment", { key: KEY, uniqueid: "uid-0003-aaaa", ok: true, amount_agorot: "1", currency: "ILS", tx_id: "tx-2" });
assert.equal(f.already, true);
f = await call("finish_link_payment", { key: KEY, uniqueid: "uid-0002-aaaa", ok: true, amount_agorot: "370200", currency: "ILS", tx_id: "tx-3" });
assert.equal(f.status, "review");
assert.equal((await paymentsOf()).length, 1, "still one payment row");
assert.match((await linkOf(t2)).last_error, /second successful charge/);
assert.equal((await call("start_link_payment", { key: KEY, token: t2, uniqueid: "uid-0004-aaaa", rate: "3.7" })).error, "state", "a paid link never starts again");

// ---------------------------------------------------------------- the company's rate of today wins over the site's
await q(`insert into public.company_exchange_rates values ($1, 'USD', (now() at time zone 'Asia/Jerusalem')::date, 3.5)`, [C]);
const t3 = await link({ amount: 200 });
s = await call("start_link_payment", { key: KEY, token: t3, uniqueid: "uid-0005-aaaa", rate: "3.9" });
assert.equal(s.rate_source, "company");
assert.equal(Number(s.total_ils), 700);
// a transaction that already paid something else is kept for a human
f = await call("finish_link_payment", { key: KEY, uniqueid: "uid-0005-aaaa", ok: true, amount_agorot: "70000", currency: "ILS", tx_id: "tx-2" });
assert.equal(f.status, "review");
assert.match((await linkOf(t3)).last_error, /already paid something else/);
// a link that would pay the order past its total (1000.50 paid of 3000) is kept for a human, never recorded
const t8 = await link({ kind: "other", amount: 2500 });
s = await call("start_link_payment", { key: KEY, token: t8, uniqueid: "uid-0011-aaaa", rate: "3.9" });
assert.equal(Number(s.total_ils), 8750);
f = await call("finish_link_payment", { key: KEY, uniqueid: "uid-0011-aaaa", ok: true, amount_agorot: "875000", currency: "ILS", tx_id: "tx-8" });
assert.equal(f.status, "review");
assert.match((await linkOf(t8)).last_error, /more than its total/);
assert.equal((await paymentsOf()).length, 1, "still the one payment row");

// ---------------------------------------------------------------- expired, cancelled, a bad rate, no tx id
const t4 = await link({ expires: new Date(Date.now() - 60_000).toISOString() });
assert.equal((await call("pay_link", { key: KEY, token: t4 })).state, "expired");
assert.equal((await call("start_link_payment", { key: KEY, token: t4, uniqueid: "uid-0006-aaaa", rate: "3.7" })).error, "expired");

const t5 = await link({ amount: 50 });
await q(`delete from public.company_exchange_rates`);
assert.equal((await call("start_link_payment", { key: KEY, token: t5, uniqueid: "uid-0007-aaaa", rate: "9.5" })).error, "rate", "a rate out of bounds is refused");
s = await call("start_link_payment", { key: KEY, token: t5, uniqueid: "uid-0008-aaaa", rate: "3.7" });
assert.equal(s.ok, true);
await q(`update tours.payment_links set status = 'cancelled' where token = $1`, [t5]);
assert.equal((await call("pay_link", { key: KEY, token: t5 })).state, "cancelled");
f = await call("finish_link_payment", { key: KEY, uniqueid: "uid-0008-aaaa", ok: true, amount_agorot: "18500", currency: "ILS", tx_id: "tx-5" });
assert.equal(f.status, "review", "a charge on a cancelled link is never lost");
assert.match((await linkOf(t5)).last_error, /cancelled/);

const t6 = await link({ amount: 10 });
await call("start_link_payment", { key: KEY, token: t6, uniqueid: "uid-0009-aaaa", rate: "3.7" });
f = await call("finish_link_payment", { key: KEY, uniqueid: "uid-0009-aaaa", ok: true, amount_agorot: "3700", currency: "ILS" });
assert.equal(f.status, "review", "a success without a transaction id is not recorded");

// a cancelled order takes no payment
await q(`update tours.bookings set status = 'cancelled'`);
const t7 = await link();
assert.equal((await call("pay_link", { key: KEY, token: t7 })).state, "cancelled");
assert.equal((await call("start_link_payment", { key: KEY, token: t7, uniqueid: "uid-0010-aaaa", rate: "3.7" })).error, "state");

// the old actions are still routed
assert.notEqual((await call("nope", {})).error, undefined);
assert.equal((await call("nope", {})).error, "action");

console.log("tours payment links SQL: all scenarios pass");

// scripts/tours-waitlist-sql-pglite-test.mjs - `node scripts/tours-waitlist-sql-pglite-test.mjs`
//
// The SQL test of migration 20261029102719_tours_waitlist_status.sql (Alon 29.10), on an in-process Postgres (PGlite)
// over stub tables:
//   A. the migration as a whole - the "Waiting list" status lands right after "Future" in each company's own order,
//      once (a re-run changes nothing); the backfill moves ONLY open cards still waiting (opened by a waiting-list /
//      notify-me form, at New, with no order, no seat row, no real inquiry joined, not to file, not a merge target);
//      both functions parse;
//   B. public.leads_fill's routing - a waiting list never folds into a deal (not even one at New), opens its own card in
//      'waitlist' beside it, a second one joins it and changes nothing, any other form goes to the deal, one that lands
//      on the waiting-list card turns it 'returned'.
// TS twin: newCardStatus / isWaitingListCard / routeInquiry / statusOnReturn (scripts/tours-cases-selftest.ts).
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH at an install
// elsewhere (the package directory). No network, no prod.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite");

const MIGRATION = readFileSync(`${process.cwd()}/supabase/migrations/20261029102719_tours_waitlist_status.sql`, "utf8");
const LEADS_FILL = MIGRATION.slice(
  MIGRATION.indexOf("create or replace function public.leads_fill()"),
  MIGRATION.indexOf("create or replace function tours.booking_create"),
);

// ---------------------------------------------------------------- A. the status + the backfill
{
  const db = new PGlite();
  await db.exec(`
create schema tours; create role anon; create role authenticated; create role service_role;
create table public.companies (id uuid primary key, product_types text[]);
create table public.lead_statuses (id uuid primary key default gen_random_uuid(), company_id uuid, key text, label text, color text,
  position int not null default 0, is_closed boolean default false, is_system boolean default false, is_active boolean default true,
  unique (company_id, key));
create table public.leads (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, type text, status text,
  to_file boolean default false, payload jsonb default '{}'::jsonb, is_deleted date, updated_at timestamptz);
create table tours.bookings (id uuid primary key default gen_random_uuid(), lead_id uuid);
create table tours.departure_sales_entries (id uuid primary key default gen_random_uuid(), lead_id uuid);
`);
  const A = "00000000-0000-0000-0000-00000000000a"; // reordered by staff, has a custom status
  const B = "00000000-0000-0000-0000-00000000000b"; // already has it (a re-run)
  const C = "00000000-0000-0000-0000-00000000000c"; // tours, no list of its own (reads the default list)
  const D = "00000000-0000-0000-0000-00000000000d"; // not a tours company
  const E = "00000000-0000-0000-0000-00000000000e"; // a custom status already called "רשימת המתנה"
  await db.exec(`insert into public.companies values ('${A}', '{tours}'), ('${B}', '{tours}'), ('${C}', '{tours}'), ('${D}', '{events}'), ('${E}', '{tours}');`);
  const keys = ["new", "no_answer", "returned", "future", "offer_sent", "pending_payment", "deposit_paid", "paid", "not_relevant", "cancelled", "spam"];
  for (const [i, k] of keys.entries()) await db.query(`insert into public.lead_statuses (company_id, key, label, position, is_system) values ($1, $2, $2, $3, true)`, [A, k, i]);
  await db.query(`insert into public.lead_statuses (company_id, key, label, position) values ($1, 'custom_1', 'VIP', 25)`, [A]);
  await db.query(`insert into public.lead_statuses (company_id, key, label, position) values ($1, 'new', 'new', 0), ($1, 'waitlist', 'mine', 7)`, [B]);
  await db.query(`insert into public.lead_statuses (company_id, key, label, position) values ($1, 'new', 'new', 0)`, [D]);
  await db.query(`insert into public.lead_statuses (company_id, key, label, position) values ($1, 'new', 'new', 0), ($1, 'future', 'future', 1), ($1, 'custom_1', 'רשימת המתנה', 2)`, [E]);

  const lead = async (co, kind, status, over = {}) =>
    (
      await db.query(
        `insert into public.leads (company_id, kind, type, status, to_file, payload, is_deleted) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [co, kind, over.type ?? "potential", status, over.toFile ?? false, JSON.stringify(over.payload ?? {}), over.deleted ?? null],
      )
    ).rows[0].id;
  const waiting = await lead(A, "waitlist", "new");
  const notify = await lead(A, "notify", "new");
  const movedOn = await lead(A, "waitlist", "no_answer");
  const deleted = await lead(A, "waitlist", "new", { deleted: "2026-10-20" });
  const plain = await lead(A, "lead", "new", { type: "lead" });
  const reservation = await lead(A, "waitlist", "new", { type: "reservation" });
  const booked = await lead(A, "waitlist", "new");
  await db.query(`insert into tours.bookings (lead_id) values ($1)`, [booked]);
  const seated = await lead(A, "waitlist", "new");
  await db.query(`insert into tours.departure_sales_entries (lead_id) values ($1)`, [seated]);
  const toFile = await lead(A, "waitlist", "new", { toFile: true });
  const realInquiry = await lead(A, "waitlist", "new", { payload: { inquiries: [{ kind: "waitlist" }, { kind: "lead" }] } });
  const moreWaiting = await lead(A, "waitlist", "new", { payload: { inquiries: [{ kind: "notify" }, { kind: "waitlist" }] } });
  const mergeTarget = await lead(A, "waitlist", "new", { payload: { merged: [{ id: "x", case_no: 1 }] } });
  const noList = await lead(C, "waitlist", "new");

  await db.exec(MIGRATION);

  const order = async (co) => (await db.query(`select key from public.lead_statuses where company_id = $1 order by position, key`, [co])).rows.map((r) => r.key);
  const expectedA = ["new", "no_answer", "returned", "future", "waitlist", "offer_sent", "pending_payment", "deposit_paid", "paid", "not_relevant", "cancelled", "spam", "custom_1"];
  assert.deepEqual(await order(A), expectedA, "right after Future in the company's own order");
  const w = (await db.query(`select label, color, is_closed, is_system, is_active from public.lead_statuses where company_id = $1 and key = 'waitlist'`, [A])).rows[0];
  assert.deepEqual(w, { label: "רשימת המתנה", color: "amber", is_closed: false, is_system: true, is_active: true });
  assert.deepEqual((await db.query(`select label, position from public.lead_statuses where company_id = $1 and key = 'waitlist'`, [B])).rows, [{ label: "mine", position: 7 }], "a company that has it keeps its own");
  assert.deepEqual(await order(C), [], "no list of its own: nothing written (it reads the default list)");
  assert.deepEqual(await order(D), ["new"], "not a tours company");
  const labelsE = (await db.query(`select key, label from public.lead_statuses where company_id = $1 order by position`, [E])).rows;
  assert.equal(new Set(labelsE.map((r) => r.label)).size, labelsE.length, "never two statuses with one name - the Statuses dialog refuses to save that");
  assert.ok(labelsE.some((r) => r.key === "waitlist"), "the system status is there all the same");

  const st = async (id) => (await db.query(`select status from public.leads where id = $1`, [id])).rows[0].status;
  assert.equal(await st(waiting), "waitlist");
  assert.equal(await st(notify), "waitlist", "notify too");
  assert.equal(await st(moreWaiting), "waitlist", "more waiting-list forms joined: still a waiting list");
  assert.equal(await st(movedOn), "no_answer", "a waiting list a rep moved on stays");
  assert.equal(await st(deleted), "new", "a deleted row is left alone");
  assert.equal(await st(plain), "new", "an ordinary New card stays New");
  assert.equal(await st(reservation), "new", "a booking request hangs on it: a deal now");
  assert.equal(await st(booked), "new", "it carries an order");
  assert.equal(await st(seated), "new", "it holds seats");
  assert.equal(await st(toFile), "new", "an inquiry still to file stays where the rep files it");
  assert.equal(await st(realInquiry), "new", "a real inquiry joined it: the customer wants the tour");
  assert.equal(await st(mergeTarget), "new", "another card was merged into it");
  assert.equal(await st(noList), "waitlist", "a company on the default list - the same rule as the trigger");

  await db.exec(MIGRATION);
  assert.deepEqual(await order(A), expectedA, "idempotent");
  console.log("A. status + backfill: ok");
}

// ---------------------------------------------------------------- B. leads_fill routing
{
  const db = new PGlite();
  await db.exec(`
create schema tours; create role anon; create role authenticated; create role service_role;
create table public.customers (id uuid primary key default gen_random_uuid(), company_id uuid, customer_no serial, first_name text, last_name text,
  phones text[] default '{}', phone_keys text[] default '{}', email text, id_number text, acc_num text, is_deleted date,
  wa_consent text default 'none', wa_consent_source text, wa_consent_at timestamptz);
create table public.leads (id uuid primary key default gen_random_uuid(), case_no serial, company_id uuid, customer_id uuid, kind text, type text,
  status text default 'new', first_name text, last_name text, name text, phone text, email text, id_number text, acc_num text,
  assigned_to uuid, payload jsonb, utm jsonb, source_path text, departure_id uuid, package_id uuid, to_file boolean default false,
  is_deleted date, created_at timestamptz default now(), updated_at timestamptz, follow_up_date date, related_lead_id uuid, message text);
create table public.lead_statuses (company_id uuid, key text);
create table tours.departures (id uuid primary key default gen_random_uuid(), company_id uuid, package_id uuid, is_deleted date,
  legacy_product_id bigint, site_id bigint, start_date date);
create table tours.packages (id uuid primary key default gen_random_uuid(), company_id uuid, slug text, is_deleted date);
create function public.clean_utm(u jsonb) returns jsonb language sql as 'select u';
create function public.url_decode(t text) returns text language sql as 'select t';
create function public.phone_key(p text) returns text language sql as $$ select right(regexp_replace(coalesce(p, ''), '\\D', '', 'g'), 9) $$;
create function public.whatsapp_phone(p text) returns text language sql as $$ select regexp_replace(coalesce(p, ''), '\\D', '', 'g') $$;
create function public.lead_status_closed(c uuid, s text) returns boolean language sql as $$ select s in ('not_relevant', 'cancelled', 'spam') $$;
`);
  await db.exec(LEADS_FILL);
  await db.exec(`create trigger leads_fill before insert on public.leads for each row execute function public.leads_fill();`);

  const CO = "00000000-0000-0000-0000-00000000000c";
  const TOUR = "00000000-0000-0000-0000-0000000000a1";
  await db.query(`insert into public.lead_statuses (company_id, key) values ($1, 'returned'), ($1, 'waitlist'), ($1, 'new')`, [CO]);
  const cust = (await db.query(`insert into public.customers (company_id, phones, phone_keys) values ($1, '{0521234567}', '{521234567}') returning id`, [CO])).rows[0].id;
  let n = 0;
  // a card already on the board: inserted as manual (never routed), then given its kind / status / age
  async function card(kind, status, ago) {
    const r = await db.query(
      `insert into public.leads (company_id, customer_id, kind, phone, package_id, name) values ($1, $2, 'manual', '0521234567', $3, 'Dana Levi') returning id, case_no`,
      [CO, cust, TOUR],
    );
    await db.query(`update public.leads set kind = $2, status = $3, created_at = now() - ($4 || ' minutes')::interval where id = $1`, [r.rows[0].id, kind, status, String(ago)]);
    return r.rows[0];
  }
  async function form(kind, company = CO) {
    n++;
    const r = await db.query(
      `insert into public.leads (company_id, kind, phone, package_id, name, message) values ($1, $2, '0521234567', $3, 'Dana Levi', $4) returning id, is_deleted, payload, related_lead_id, status`,
      [company, kind, TOUR, "form " + n],
    );
    return r.rows[0];
  }
  const joinedInto = (row) => row.payload?.joined_into?.id ?? null;
  const reset = () => db.exec(`delete from public.leads`);
  const row = async (id) => (await db.query(`select status, follow_up_date from public.leads where id = $1`, [id])).rows[0];

  for (const status of ["new", "no_answer", "offer_sent", "pending_payment", "future"]) {
    await reset();
    const deal = await card("lead", status, 60);
    const f = await form("waitlist");
    assert.equal(joinedInto(f), null, `waitlist does not join a ${status} card`);
    assert.equal(f.is_deleted, null, "a card of its own");
    assert.equal(f.status, "waitlist", "it waits in Waiting list, not New");
    assert.equal(f.related_lead_id, deal.id, "pointing at the deal beside it");
    assert.equal((await row(deal.id)).status, status, "the deal is untouched");
  }
  await reset();
  let f = await form("notify");
  assert.equal(f.status, "waitlist");
  assert.equal(f.related_lead_id, null);
  const waiting = f;
  f = await form("waitlist");
  assert.equal(joinedInto(f), waiting.id, "a second waitlist joins the first");
  assert.deepEqual(await row(waiting.id), { status: "waitlist", follow_up_date: null }, "still waiting, no follow-up day");
  await reset();
  let deal = await card("lead", "offer_sent", 60);
  const w2 = await card("waitlist", "waitlist", 5);
  f = await form("lead");
  assert.equal(joinedInto(f), deal.id, "a later lead joins the deal, not the newer waiting-list card");
  assert.equal((await row(deal.id)).status, "returned");
  assert.equal((await row(w2.id)).status, "waitlist");
  await reset();
  deal = await card("lead", "new", 60);
  await card("waitlist", "waitlist", 5);
  f = await form("lead");
  assert.equal(joinedInto(f), deal.id, "a deal at New wins over a waiting-list card too");
  await reset();
  const only = await card("waitlist", "waitlist", 5);
  f = await form("lead");
  assert.equal(joinedInto(f), only.id);
  const back = await row(only.id);
  assert.equal(back.status, "returned", "an inquiry on a waiting list: the customer came back");
  assert.ok(back.follow_up_date, "and it is today's call");
  await reset();
  f = await form("lead");
  assert.equal(f.status, "new", "a plain lead with nothing open is New");
  const CO2 = "00000000-0000-0000-0000-00000000002c";
  const CO3 = "00000000-0000-0000-0000-00000000003c";
  await db.query(`insert into public.lead_statuses (company_id, key) values ($1, 'new'), ($1, 'returned')`, [CO2]);
  assert.equal((await form("waitlist", CO2)).status, "new", "no Waiting list in the company's list");
  assert.equal((await form("waitlist", CO3)).status, "waitlist", "no list at all: the default list");
  console.log("B. leads_fill routing: ok");
}

console.log("tours waitlist SQL: all checks pass");

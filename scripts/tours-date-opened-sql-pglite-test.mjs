// scripts/tours-date-opened-sql-pglite-test.mjs - `node scripts/tours-date-opened-sql-pglite-test.mjs`
//
// The SQL test of migration 20261030182000_tours_waitlist_date_opened.sql (Alon 30.10), on an in-process Postgres
// (PGlite) over stub tables:
//   A. the migration as a whole - "נפתח תאריך" lands right after "רשימת המתנה" in each company's own order, once (a re-run
//      changes nothing); what is open now and who waits now are stamped at one instant; a closed or unpublished date is
//      not stamped;
//   B. the trigger - waitlist_since is stamped on every way into the list, stays while the card keeps waiting, and a form
//      opening a waiting-list card (through leads_fill) gets it too;
//   C. public.leads_fill - a form that lands on a 'date_opened' card turns it "returned"; a waiting-list form does not;
//   D. which date a waiting list names - the date of its form, never the page's product_id (the page keeps naming the
//      last date tapped), a second form for another date widens the card to the tour, and the backfill.
// TS twin: statusOnReturn (scripts/tours-cases-selftest.ts); the rules that read these columns are
// scripts/tours-waitlist-dates-selftest.ts.
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH at an install
// elsewhere (the package directory). No network, no prod.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite");

const MIGRATION = readFileSync(`${process.cwd()}/supabase/migrations/20261030182000_tours_waitlist_date_opened.sql`, "utf8");

const STUBS = `
create schema tours; create role anon; create role authenticated; create role service_role;
create table public.companies (id uuid primary key, product_types text[]);
create table public.lead_statuses (id uuid primary key default gen_random_uuid(), company_id uuid, key text, label text, color text,
  position int not null default 0, is_closed boolean default false, is_system boolean default false, is_active boolean default true,
  unique (company_id, key));
create table public.customers (id uuid primary key default gen_random_uuid(), company_id uuid, customer_no serial, first_name text, last_name text,
  phones text[] default '{}', phone_keys text[] default '{}', email text, id_number text, acc_num text, is_deleted date,
  wa_consent text default 'none', wa_consent_source text, wa_consent_at timestamptz);
create table public.leads (id uuid primary key default gen_random_uuid(), case_no serial, company_id uuid, customer_id uuid, kind text, type text,
  status text default 'new', first_name text, last_name text, name text, phone text, email text, id_number text, acc_num text,
  assigned_to uuid, payload jsonb, utm jsonb, source_path text, departure_id uuid, package_id uuid, to_file boolean default false,
  is_deleted date, created_at timestamptz default now(), updated_at timestamptz, follow_up_date date, related_lead_id uuid, message text);
create table tours.departures (id uuid primary key default gen_random_uuid(), company_id uuid, package_id uuid, is_deleted date,
  legacy_product_id bigint, site_id bigint, start_date date, is_published boolean default true, sale_status text default 'open');
create table tours.packages (id uuid primary key default gen_random_uuid(), company_id uuid, slug text, is_deleted date);
create function public.clean_utm(u jsonb) returns jsonb language sql as 'select u';
create function public.url_decode(t text) returns text language sql as 'select t';
create function public.phone_key(p text) returns text language sql as $$ select right(regexp_replace(coalesce(p, ''), '\\D', '', 'g'), 9) $$;
create function public.whatsapp_phone(p text) returns text language sql as $$ select regexp_replace(coalesce(p, ''), '\\D', '', 'g') $$;
create function public.lead_status_closed(c uuid, s text) returns boolean language sql as $$ select s in ('not_relevant', 'cancelled', 'spam') $$;
`;

const A = "00000000-0000-0000-0000-00000000000a"; // reordered by staff
const B = "00000000-0000-0000-0000-00000000000b"; // already has it (a re-run)
const C = "00000000-0000-0000-0000-00000000000c"; // tours, no list of its own (reads the default list)
const D = "00000000-0000-0000-0000-00000000000d"; // not a tours company
const E = "00000000-0000-0000-0000-00000000000e"; // a custom status already called "נפתח תאריך"
const TOUR = "00000000-0000-0000-0000-0000000000a1";

// ---------------------------------------------------------------- A. the status + the stamps
{
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(`insert into public.companies values ('${A}', '{tours}'), ('${B}', '{tours}'), ('${C}', '{tours}'), ('${D}', '{events}'), ('${E}', '{tours}');`);
  const keys = ["new", "no_answer", "returned", "waitlist", "future", "pending_payment", "paid", "not_relevant"];
  for (const co of [A, E]) for (const [i, k] of keys.entries()) await db.query(`insert into public.lead_statuses (company_id, key, label, position, is_system) values ($1, $2, $2, $3, true)`, [co, k, i]);
  await db.query(`insert into public.lead_statuses (company_id, key, label, position) values ($1, 'mine', 'נפתח תאריך', 20)`, [E]);
  for (const [i, k] of ["new", "waitlist", "date_opened"].entries()) await db.query(`insert into public.lead_statuses (company_id, key, label, position, is_system) values ($1, $2, $2, $3, true)`, [B, k, i]);
  await db.query(`insert into public.lead_statuses (company_id, key, label, position) values ($1, 'new', 'new', 0)`, [D]);

  const waiting = (await db.query(`insert into public.leads (company_id, status) values ($1, 'waitlist') returning id`, [A])).rows[0].id;
  const other = (await db.query(`insert into public.leads (company_id, status) values ($1, 'new') returning id`, [A])).rows[0].id;
  const dep = async (over) => (await db.query(
    `insert into tours.departures (company_id, start_date, is_published, sale_status, is_deleted) values ($1, $2, $3, $4, $5) returning id`,
    [A, over.start ?? "2099-01-01", over.published ?? true, over.sale ?? "open", over.deleted ?? null],
  )).rows[0].id;
  const open = await dep({});
  const last = await dep({ sale: "last_places" });
  const soldOut = await dep({ sale: "sold_out" });
  const closed = await dep({ sale: "closed" });
  const draft = await dep({ published: false });
  const past = await dep({ start: "2000-01-01" });
  const gone = await dep({ deleted: "2020-01-01" });

  await db.exec(MIGRATION);

  const order = async (co) => (await db.query(`select key from public.lead_statuses where company_id = $1 and is_active order by position, key`, [co])).rows.map((r) => r.key);
  const expectedA = ["new", "no_answer", "returned", "waitlist", "date_opened", "future", "pending_payment", "paid", "not_relevant"];
  assert.deepEqual(await order(A), expectedA, "right after the waiting list, in the company's own order");
  assert.deepEqual(await order(B), ["new", "waitlist", "date_opened"], "a company that has it is untouched");
  assert.deepEqual(await order(C), [], "a company on the default list gets no rows (DEFAULT_STATUSES has it)");
  assert.deepEqual(await order(D), ["new"], "not a tours company");
  const row = (await db.query(`select label, color, is_closed, is_system from public.lead_statuses where company_id = $1 and key = 'date_opened'`, [A])).rows[0];
  assert.deepEqual(row, { label: "נפתח תאריך", color: "rose", is_closed: false, is_system: true });
  assert.equal((await db.query(`select label from public.lead_statuses where company_id = $1 and key = 'date_opened'`, [E])).rows[0].label, "נפתח תאריך (מערכת)", "two statuses with one name cannot be saved again");

  const watched = new Set((await db.query(`select departure_id from tours.departure_open_watch`)).rows.map((r) => r.departure_id));
  assert.ok(watched.has(open) && watched.has(last), "what is on sale now is stamped");
  for (const id of [soldOut, closed, draft, past, gone]) assert.ok(!watched.has(id), "a date not on sale is not");

  const since = (await db.query(`select waitlist_since, status from public.leads where id = $1`, [waiting])).rows[0];
  const seen = (await db.query(`select open_seen_at from tours.departure_open_watch where departure_id = $1`, [open])).rows[0].open_seen_at;
  assert.equal(since.waitlist_since.getTime(), seen.getTime(), "one instant: a date open now is not 'opened after' a card waiting now (the rule is strictly after)");
  assert.equal((await db.query(`select waitlist_since from public.leads where id = $1`, [other])).rows[0].waitlist_since, null);

  // a re-run changes nothing
  await db.exec(MIGRATION);
  assert.deepEqual(await order(A), expectedA, "idempotent");
  assert.equal((await db.query(`select waitlist_since from public.leads where id = $1`, [waiting])).rows[0].waitlist_since.getTime(), since.waitlist_since.getTime(), "a re-run does not restart a wait");
  console.log("A. status + stamps: ok");
}

// ---------------------------------------------------------------- B + C. the trigger and leads_fill
{
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(`insert into public.companies values ('${C}', '{tours}');`);
  await db.exec(MIGRATION);
  await db.exec(`create trigger leads_fill before insert on public.leads for each row execute function public.leads_fill();`);
  for (const k of ["new", "returned", "waitlist", "date_opened"]) await db.query(`insert into public.lead_statuses (company_id, key, label) values ($1, $2, $2)`, [C, k]);
  const cust = (await db.query(`insert into public.customers (company_id, phones, phone_keys) values ($1, '{0521234567}', '{521234567}') returning id`, [C])).rows[0].id;
  const card = async (status) => {
    const r = await db.query(`insert into public.leads (company_id, customer_id, kind, phone, package_id, name) values ($1, $2, 'manual', '0521234567', $3, 'Dana Levi') returning id`, [C, cust, TOUR]);
    await db.query(`update public.leads set kind = 'lead', status = $2 where id = $1`, [r.rows[0].id, status]);
    return r.rows[0].id;
  };
  const form = async (kind) =>
    (await db.query(`insert into public.leads (company_id, kind, phone, package_id, name, message) values ($1, $2, '0521234567', $3, 'Dana Levi', 'form') returning id, status, waitlist_since, is_deleted`, [C, kind, TOUR])).rows[0];
  const status = async (id) => (await db.query(`select status, waitlist_since from public.leads where id = $1`, [id])).rows[0];

  // B. a form opening a waiting-list card
  const opened = await form("waitlist");
  assert.equal(opened.status, "waitlist");
  assert.ok(opened.waitlist_since instanceof Date, "a form's card is stamped - the trigger runs after leads_fill");
  await db.exec(`delete from public.leads`);

  // B. a rep moving a card in, and moving it on
  const id = await card("new");
  assert.equal((await status(id)).waitlist_since, null, "not waiting: no stamp");
  await db.query(`update public.leads set status = 'waitlist' where id = $1`, [id]);
  const first = (await status(id)).waitlist_since;
  assert.ok(first instanceof Date, "a rep moved it in");
  await db.exec(`select pg_sleep(0.01)`);
  await db.query(`update public.leads set status = 'waitlist' where id = $1`, [id]);
  assert.equal((await status(id)).waitlist_since.getTime(), first.getTime(), "still waiting: the wait does not restart");
  await db.query(`update public.leads set message = 'x' where id = $1`, [id]);
  assert.equal((await status(id)).waitlist_since.getTime(), first.getTime(), "another column: untouched");
  await db.query(`update public.leads set status = 'date_opened' where id = $1`, [id]);
  await db.exec(`select pg_sleep(0.01)`);
  await db.query(`update public.leads set status = 'waitlist' where id = $1`, [id]);
  assert.ok((await status(id)).waitlist_since.getTime() > first.getTime(), "back on the list: a new wait");
  await db.exec(`delete from public.leads`);

  // C. a form on a card whose date opened
  const opened2 = await card("date_opened");
  const joined = await form("lead");
  assert.ok(joined.is_deleted, "it joined the card");
  assert.equal((await status(opened2)).status, "returned", "the customer answered: back on TODAY now");
  await db.exec(`delete from public.leads`);

  // C. another waiting-list form opens its own card and leaves this one alone
  const opened3 = await card("date_opened");
  const again = await form("waitlist");
  assert.equal(again.status, "waitlist");
  assert.equal(again.is_deleted, null, "a card of its own");
  assert.equal((await status(opened3)).status, "date_opened", "another waiting list says nothing about this card");
    await db.exec(`delete from public.leads`);

  // D. which date a waiting list names
  const dep = async (pid) => (await db.query(`insert into tours.departures (company_id, package_id, legacy_product_id, start_date) values ($1, $2, $3, '2099-01-01') returning id`, [C, TOUR, pid])).rows[0].id;
  const dateA = await dep(5001);
  const dateB = await dep(5002);
  const named = async (over) => {
    await db.exec(`delete from public.leads`);
    return (await db.query(
      `insert into public.leads (company_id, kind, phone, package_id, name, message, source_path, payload) values ($1, $2, '0521234567', $3, 'Dana Levi', 'form', $4, $5) returning id, departure_id`,
      [C, over.kind, TOUR, over.path ?? null, JSON.stringify(over.payload ?? {})],
    )).rows[0];
  };
  const pageA = "/package/x/?product_id=5001";
  assert.equal((await named({ kind: "waitlist", path: pageA, payload: { date: { productId: 5002 } } })).departure_id, dateB, "the date of the form, not the date the page last named");
  assert.equal((await named({ kind: "waitlist", path: pageA, payload: { slug: "x" } })).departure_id, null, "a tour's waiting list reached through an old link names no date");
  assert.equal((await named({ kind: "notify", path: pageA })).departure_id, null, "notify-me too");
  assert.equal((await named({ kind: "waitlist", payload: { date: { productId: 5001 } } })).departure_id, dateA);
  assert.equal((await named({ kind: "lead", path: pageA })).departure_id, dateA, "any other form still reads its page");

  // a second form for another date: the customer waits for either, so the card waits for the tour
  const firstForm = await named({ kind: "waitlist", payload: { date: { productId: 5001 } } });
  const second = (await db.query(`insert into public.leads (company_id, kind, phone, package_id, name, message, payload) values ($1, 'waitlist', '0521234567', $2, 'Dana Levi', 'again', $3) returning is_deleted`, [C, TOUR, JSON.stringify({ date: { productId: 5002 } })])).rows[0];
  assert.ok(second.is_deleted, "it joined the card");
  assert.equal((await db.query(`select departure_id from public.leads where id = $1`, [firstForm.id])).rows[0].departure_id, null, "widened");
  const third = await named({ kind: "waitlist", payload: { date: { productId: 5001 } } });
  await db.query(`insert into public.leads (company_id, kind, phone, package_id, name, message, payload) values ($1, 'waitlist', '0521234567', $2, 'Dana Levi', 'same', $3)`, [C, TOUR, JSON.stringify({ date: { productId: 5001 } })]);
  assert.equal((await db.query(`select departure_id from public.leads where id = $1`, [third.id])).rows[0].departure_id, dateA, "the same date again changes nothing");

  // the backfill: a card already waiting takes the date of its form
  await db.exec(`delete from public.leads`);
  await db.exec(`alter table public.leads disable trigger leads_fill`);
  const card3 = async (kind, departure, payload) => (await db.query(
    `insert into public.leads (company_id, kind, status, departure_id, payload) values ($1, $2, 'waitlist', $3, $4) returning id`, [C, kind, departure, JSON.stringify(payload)])).rows[0].id;
  const wrong = await card3("waitlist", dateA, { date: { productId: 5002 } });
  const noDate = await card3("notify", dateA, { slug: "x" });
  const right = await card3("waitlist", dateA, { date: { productId: 5001 } });
  const lead = await card3("lead", dateA, {});
  await db.exec(MIGRATION);
  const dep3 = async (id) => (await db.query(`select departure_id from public.leads where id = $1`, [id])).rows[0].departure_id;
  assert.equal(await dep3(wrong), dateB, "the date of its form");
  assert.equal(await dep3(noDate), null, "a form that named no date");
  assert.equal(await dep3(right), dateA);
  assert.equal(await dep3(lead), dateA, "a card a rep moved there keeps what it has");
  console.log("B + C + D. trigger + leads_fill + dates: ok");
}
console.log("tours-date-opened SQL test: ok");

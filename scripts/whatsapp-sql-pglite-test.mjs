// scripts/whatsapp-sql-pglite-test.mjs - `node scripts/whatsapp-sql-pglite-test.mjs [--baseline]`
//
// The SQL test of migration 20261021172647_whatsapp_phase1.sql, on an in-process Postgres (PGlite):
// stub tables with the columns leads_fill touches, the helper functions and the CURRENT leads_fill
// extracted from their own migration files, then the migration, then the scenarios - a WhatsApp
// message joins the customer's newest open card (by updated_at) and is never filed, a tourless form
// is still filed, a same-tour form still joins, the site's consent checkbox marks the customer, an
// opted-out customer is never overwritten, the three tables and the bucket exist.
// `--baseline` runs WITHOUT the migration (the whatsapp assertion fails - that is the RED).
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH
// at an install elsewhere (the package directory). No network, no prod.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite");

const MIG = `${process.cwd()}/supabase/migrations`;
const withMigration = !process.argv.includes("--baseline");

const file = (name) => readFileSync(`${MIG}/${name}`, "utf8");
function extractFn(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end + 4);
}
const unified = file("20261014220000_tours_unified_cases.sql");
const customersMig = file("20261019180000_tours_customers.sql");

const db = new PGlite();
const exec = (sql) => db.exec(sql);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

await exec(`
create role anon; create role authenticated; create role service_role;
create schema tours; create schema storage;
create table storage.buckets(id text primary key, name text, public boolean);
create table public.companies(id uuid primary key default gen_random_uuid(), slug text);
create table public.user_profiles(id uuid primary key default gen_random_uuid());
create table public.reservations(id bigint primary key);
create table tours.packages(id uuid primary key default gen_random_uuid(), company_id uuid, slug text, name text, is_deleted date);
create table tours.departures(id uuid primary key default gen_random_uuid(), company_id uuid, package_id uuid, start_date date, legacy_product_id bigint, site_id bigint, is_deleted date);
create table public.lead_statuses(id uuid primary key default gen_random_uuid(), company_id uuid, key text, label text, color text default 'gray', position int default 0, is_closed boolean default false, is_system boolean default false, is_active boolean default true, unique(company_id, key));
create sequence public.customers_no_seq start with 1001;
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_no bigint not null default nextval('public.customers_no_seq'),
  first_name text, last_name text,
  phones text[] not null default '{}',
  phone_keys text[] not null default '{}',
  email text, id_number text, acc_num text,
  not_same uuid[] not null default '{}',
  merged_into uuid references public.customers(id) on delete set null,
  is_deleted date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create sequence public.leads_case_no_seq start with 1001;
create table public.leads(
  id uuid primary key default gen_random_uuid(), company_id uuid not null, case_no bigint default nextval('public.leads_case_no_seq'),
  created_at timestamptz default now(), updated_at timestamptz, type text, kind text not null, status text default 'new',
  name text, first_name text, last_name text, phone text, email text, id_number text, acc_num text, notes text, message text,
  assigned_to uuid, follow_up_date date, source text default 'site', utm jsonb default '{}', source_path text,
  departure_id uuid, package_id uuid, link_token text, link_sent_at timestamptz, payload jsonb default '{}', close_reason text,
  related_lead_id uuid, offer jsonb, customer_id uuid, to_file boolean not null default false, season text, is_deleted date, notes_at timestamptz
);
`);
for (const [src, name] of [[unified, "url_decode"], [unified, "clean_utm"], [unified, "lead_status_closed"], [customersMig, "phone_key"], [customersMig, "customers_keys"]]) {
  await exec(extractFn(src, name));
}
await exec(`create trigger customers_keys before insert or update of phones on public.customers for each row execute function public.customers_keys();`);
await exec(extractFn(customersMig, "leads_fill"));
await exec(`create trigger leads_fill before insert on public.leads for each row execute function public.leads_fill();`);

if (withMigration) {
  await exec(file("20261021172647_whatsapp_phase1.sql"));
}

// ---- seed
const [{ id: C }] = await q(`insert into public.companies (slug) values ('mega-family') returning id`);
for (const [key, closed] of [["new", false], ["no_answer", false], ["returned", false], ["offer_sent", false], ["future", false], ["pending_payment", false], ["deposit_paid", false], ["paid", false], ["not_relevant", true], ["cancelled", true], ["spam", true]]) {
  await q(`insert into public.lead_statuses (company_id, key, label, is_closed, is_system) values ($1, $2, $2, $3, true)`, [C, key, closed]);
}
const [{ id: P1 }] = await q(`insert into tours.packages (company_id, slug, name) values ($1, 'rome', 'רומא') returning id`, [C]);
const [{ id: P2 }] = await q(`insert into tours.packages (company_id, slug, name) values ($1, 'paris', 'פריז') returning id`, [C]);
const lead = async (fields) => {
  const cols = Object.keys(fields);
  const [row] = await q(
    `insert into public.leads (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id, case_no, type, status, to_file, is_deleted, customer_id, payload, follow_up_date`,
    cols.map((k) => (k === "payload" || k === "utm" ? JSON.stringify(fields[k]) : fields[k])),
  );
  return row;
};
const today = (await q(`select (now() at time zone 'Asia/Jerusalem')::date::text as d`))[0].d;

// Dana: one open card on Rome (no_answer, touched yesterday), an older one on Paris (offer_sent, touched 5 days ago)
const a = await lead({ company_id: C, kind: "lead", name: "דנה כהן", phone: "054-1234567", package_id: P1 });
await q(`update public.leads set status = 'no_answer', updated_at = now() - interval '1 day' where id = $1`, [a.id]);
const older = await lead({ company_id: C, kind: "lead", name: "דנה כהן", phone: "054-1234567", package_id: P2 });
await q(`update public.leads set status = 'offer_sent', updated_at = now() - interval '5 days', created_at = now() - interval '10 days' where id = $1`, [older.id]);
assert.equal(a.customer_id, older.customer_id, "same customer by phone");

// a WhatsApp message joins the NEWEST open card (by updated_at) whatever its tour, never to_file
const wa = await lead({ company_id: C, kind: "whatsapp", source: "whatsapp", name: "דנה", phone: "0541234567", message: "היי, יש מקום?", payload: { wa_message_id: "wamid.1" } });
assert.equal(wa.type, "lead", "whatsapp type = lead");
assert.equal(wa.to_file, false, "a whatsapp row is never filed");
assert.ok(wa.is_deleted, "joined rows are kept soft-deleted");
assert.equal(wa.payload?.joined_into?.id, a.id, "joined the newest open card (updated_at), not the older one");
const [cardA] = await q(`select status, follow_up_date::text as f, jsonb_array_length(payload->'inquiries') as n from public.leads where id = $1`, [a.id]);
assert.equal(cardA.status, "returned");
assert.equal(cardA.f, today);
assert.equal(cardA.n, 1);

// regression: a site form with no tour while open cards exist is still filed
const contact = await lead({ company_id: C, kind: "contact", name: "דנה", phone: "0541234567", message: "שאלה" });
assert.equal(contact.to_file, true, "a tourless form of a customer with open cards is filed (unchanged)");
assert.equal(contact.is_deleted, null);

// regression: a form on the same tour joins that card
const same = await lead({ company_id: C, kind: "waitlist", name: "דנה", phone: "0541234567", package_id: P2 });
assert.equal(same.payload?.joined_into?.id, older.id, "same-tour form joins that tour's card (unchanged)");

// a customer whose cards are all closed: a whatsapp message opens a new lead case on them
const b = await lead({ company_id: C, kind: "lead", name: "יוסי לוי", phone: "052-9876543", package_id: P1 });
await q(`update public.leads set status = 'not_relevant' where id = $1`, [b.id]);
const wa2 = await lead({ company_id: C, kind: "whatsapp", source: "whatsapp", name: "יוסי", phone: "0529876543", message: "שלום" });
assert.equal(wa2.is_deleted, null, "no open card -> a new case");
assert.equal(wa2.to_file, false);
assert.equal(wa2.customer_id, b.customer_id, "the same customer");
assert.equal(wa2.payload?.joined_into, undefined);

// consent: the site form's checkbox marks a NEW customer as 'form' = claimed, not confirmed (an unauthenticated form is
// a claim; marketing needs opted_in / customer - phase 3 confirms it), with the lead as evidence
const c = await lead({ company_id: C, kind: "contact", name: "רונית", phone: "0501112233", payload: { acceptance: "on", message: "x" } });
const [cust] = await q(`select wa_consent, wa_consent_source from public.customers where id = $1`, [c.customer_id]);
assert.equal(cust.wa_consent, "form");
assert.equal(cust.wa_consent_source, `site_form:${c.id}`);
// a form keyed by a KNOWN customer's phone never flips that customer (anyone can type a phone - security review 21.10)
const known = await lead({ company_id: C, kind: "contact", name: "מישהו", phone: "0541234567", payload: { acceptance: "on", message: "x" } });
assert.equal(known.customer_id, a.customer_id);
assert.equal((await q(`select wa_consent from public.customers where id = $1`, [a.customer_id]))[0].wa_consent, "none", "an existing customer's consent is not set by a form");
// opted_out is never overwritten
await q(`update public.customers set wa_consent = 'opted_out' where id = $1`, [c.customer_id]);
await lead({ company_id: C, kind: "newsletter", name: "רונית", phone: "0501112233" });
assert.equal((await q(`select wa_consent from public.customers where id = $1`, [c.customer_id]))[0].wa_consent, "opted_out", "opted_out is never overwritten");
// a newsletter signup from a new person = the same claim
const nl = await lead({ company_id: C, kind: "newsletter", name: "", phone: "0503334455", email: "a@b.co" });
assert.equal((await q(`select wa_consent from public.customers where id = $1`, [nl.customer_id]))[0].wa_consent, "form");

// the three tables, the new column and the bucket exist
const [{ n }] = await q(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('wa_accounts','wa_messages','wa_templates')`);
assert.equal(n, 3, "wa tables");
assert.equal((await q(`select count(*)::int as n from information_schema.columns where table_name = 'leads' and column_name = 'wa_seen_at'`))[0].n, 1);
assert.equal((await q(`select count(*)::int as n from storage.buckets where id = 'wa-media'`))[0].n, 1);

console.log(`whatsapp sql pglite test ok (${withMigration ? "with migration" : "baseline"})`);

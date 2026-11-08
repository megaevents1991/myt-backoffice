// scripts/whatsapp-events-sql-pglite-test.mjs - `node scripts/whatsapp-events-sql-pglite-test.mjs [--baseline]`
//
// The SQL test of migration 20261108190000_whatsapp_events_phase1.sql (Mega Events WhatsApp, phase E1), on an
// in-process Postgres (PGlite) over stub tables: the reservation's phone key (trigger-kept, so it equals the TS twin
// `phoneKey` whatever spelling the phone was typed in, and a whole-row update can never set it), the backfill, the two
// new tables with their unique keys, RLS on, no grants to anon / authenticated, and a second run of the migration.
// `--baseline` runs WITHOUT the migration (the first assertion fails - that is the RED).
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH at an install
// elsewhere (the package directory). No network, no prod.
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

const db = new PGlite();
const exec = (sql) => db.exec(sql);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

await exec(`
create role anon; create role authenticated; create role service_role;
create table public.companies(id uuid primary key default gen_random_uuid(), slug text);
create table public.user_profiles(id uuid primary key default gen_random_uuid());
create table public.reservations(
  id bigserial primary key, main_contact_phone_number text, status text, created_at timestamptz default now()
);
create table public.wa_messages(id uuid primary key default gen_random_uuid(), company_id uuid, reservation_id bigint);
`);
await exec(extractFn(file("20261019180000_tours_customers.sql"), "phone_key"));
// a row that exists BEFORE the migration: the backfill must give it its key
await exec(`insert into public.reservations(main_contact_phone_number, status) values ('052-528-7144', 'Paid');`);

const MIGRATION = "20261108190000_whatsapp_events_phase1.sql";
if (withMigration) await exec(file(MIGRATION));

const keyOf = async (phone) => {
  const [row] = await q(`insert into public.reservations(main_contact_phone_number, status) values ($1, 'Pending') returning main_contact_phone_key`, [phone]);
  return row?.main_contact_phone_key;
};

// phone key matches the TS twin (phoneKey: the last 9 digits) whatever the spelling
for (const phone of ["054-200-2722", "+972 54 200 2722", "0542002722"]) {
  assert.equal(await keyOf(phone), "542002722", `phone key matches the TS twin: ${phone}`);
}
assert.equal(await keyOf("12345"), "", "a phone with fewer than 9 digits has an empty key");

// a whole-row update cannot set the key: the trigger recomputes it from the phone
await exec(`update public.reservations set main_contact_phone_key = 'x', status = 'Paid' where main_contact_phone_number = '0542002722';`);
const [after] = await q(`select main_contact_phone_key from public.reservations where main_contact_phone_number = '0542002722'`);
assert.equal(after.main_contact_phone_key, "542002722", "a whole-row update cannot set the key");

// the backfill gave the old row its key
const [old] = await q(`select main_contact_phone_key from public.reservations where main_contact_phone_number = '052-528-7144'`);
assert.equal(old.main_contact_phone_key, "525287144", "the backfill keys rows that existed before");

// a writer WITHOUT execute on public.phone_key (any role but the owner / service_role) still saves a reservation
await exec(`grant select, insert, update on public.reservations to authenticated; grant usage, select on sequence public.reservations_id_seq to authenticated;`);
await exec(`revoke all on function public.phone_key(text) from public; revoke execute on function public.phone_key(text) from authenticated;`);
await exec(`set role authenticated;`);
const [asOther] = await q(`insert into public.reservations(main_contact_phone_number, status) values ('054-111-2222', 'Pending') returning main_contact_phone_key`);
await exec(`reset role;`);
assert.equal(asOther.main_contact_phone_key, "541112222", "a role without phone_key still saves, keyed");

// the off switch columns exist and default to null
const [off] = await q(`select whatsapp_off_at, whatsapp_off_by from public.reservations limit 1`);
assert.equal(off.whatsapp_off_at, null);

// wa_chats: one per company + phone key
const [co] = await q(`insert into public.companies(slug) values ('mega-events') returning id`);
await q(`insert into public.wa_chats(company_id, phone, phone_key) values ($1, '972542002722', '542002722')`, [co.id]);
await assert.rejects(q(`insert into public.wa_chats(company_id, phone, phone_key) values ($1, '972542002722', '542002722')`, [co.id]), /duplicate|unique/i);

// the list's filters: is_unseen / is_unanswered are computed by the database (a filter cannot compare two columns)
await q(`update public.wa_chats set last_in_at = '2026-11-08T10:00:00Z', seen_at = '2026-11-08T09:00:00Z', answered_at = null where phone_key = '542002722'`);
let [flags] = await q(`select is_unseen, is_unanswered from public.wa_chats where phone_key = '542002722'`);
assert.deepEqual([flags.is_unseen, flags.is_unanswered], [true, true], "a message after the last look and no answer");
await q(`update public.wa_chats set seen_at = '2026-11-08T10:05:00Z', answered_at = '2026-11-08T10:06:00Z' where phone_key = '542002722'`);
[flags] = await q(`select is_unseen, is_unanswered from public.wa_chats where phone_key = '542002722'`);
assert.deepEqual([flags.is_unseen, flags.is_unanswered], [false, false], "seen and answered");
await q(`insert into public.wa_chats(company_id, phone, phone_key) values ($1, '972500000000', '500000000')`, [co.id]);
[flags] = await q(`select is_unseen, is_unanswered from public.wa_chats where phone_key = '500000000'`);
assert.deepEqual([flags.is_unseen, flags.is_unanswered], [false, false], "a chat with no live inbound message is neither");

// wa_app_auto_texts: one per company + normalized text
await q(`insert into public.wa_app_auto_texts(company_id, text_norm, text, source) values ($1, 'שלום', 'שלום', 'history')`, [co.id]);
await assert.rejects(q(`insert into public.wa_app_auto_texts(company_id, text_norm, text, source) values ($1, 'שלום', 'שלום ', 'staff')`, [co.id]), /duplicate|unique/i);

// RLS on, nothing granted to the public roles
for (const t of ["wa_chats", "wa_app_auto_texts"]) {
  const [rls] = await q(`select relrowsecurity from pg_class where relname = $1`, [t]);
  assert.equal(rls.relrowsecurity, true, `RLS on ${t}`);
  const grants = await q(`select grantee from information_schema.role_table_grants where table_name = $1 and grantee in ('anon','authenticated')`, [t]);
  assert.deepEqual(grants, [], `no grants on ${t}`);
}

// the reservation_id index on wa_messages
const idx = await q(`select indexname from pg_indexes where tablename = 'wa_messages' and indexname = 'wa_messages_reservation_idx'`);
assert.equal(idx.length, 1, "wa_messages_reservation_idx exists");

// idempotent: a second run passes
await exec(file(MIGRATION));

console.log("whatsapp-events SQL: OK");

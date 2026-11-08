// scripts/whatsapp-events-outbox-pglite-test.mjs - `node scripts/whatsapp-events-outbox-pglite-test.mjs [--baseline]`
//
// The SQL test of migration 20261108190100_whatsapp_events_outbox.sql (Mega Events WhatsApp, phase E2) on an in-process
// Postgres (PGlite) over stub tables: the trigger on reservations queues each order update exactly as spec section 9
// says (once per order, the failure once per Israel day and 15 minutes later, a voucher order no phone_order, the
// cancel's from_status), nothing at all while Mega Events has no connected number, and - the anti-goal - a broken
// wa_outbox NEVER fails a reservation write. `--baseline` runs without the migration (the first assertion fails).
//
// Needs @electric-sql/pglite (PGLITE_PATH = the package directory, or `npm i --no-save @electric-sql/pglite`).
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite");

const MIG = `${process.cwd()}/supabase/migrations`;
const withMigration = !process.argv.includes("--baseline");
const MIGRATION = "20261108190100_whatsapp_events_outbox.sql";
const MEGA_EVENTS = "a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601";

const db = new PGlite();
const exec = (sql) => db.exec(sql);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

await exec(`
create role anon; create role authenticated; create role service_role;
create table public.companies(id uuid primary key, slug text);
insert into public.companies(id, slug) values ('${MEGA_EVENTS}', 'mega-events');
create table public.wa_accounts(id uuid primary key default gen_random_uuid(), company_id uuid, is_active boolean default true);
create table public.wa_messages(id uuid primary key default gen_random_uuid());
create table public.reservations(
  id bigserial primary key, status text, payment_info json, confirmation_email_sent boolean default false,
  partner_settlement_method text, travel_materials_sent_at timestamptz, created_at timestamptz default now()
);
`);
if (withMigration) await exec(file(MIGRATION));

function file(name) {
  return readFileSync(`${MIG}/${name}`, "utf8");
}
const rows = () => q(`select kind, dedupe_key, from_status, due_at, status from public.wa_outbox order by created_at, kind`);
const newOrder = async (status = "Pending", extra = {}) => {
  const [r] = await q(
    `insert into public.reservations(status, payment_info, partner_settlement_method) values ($1, $2, $3) returning id`,
    [status, extra.payment_info ?? null, extra.method ?? null],
  );
  return r.id;
};

// no account, no rows: nothing piles up before connect day
{
  const id = await newOrder("Pending", { payment_info: "{}" });
  await q(`update public.reservations set status = 'Paid', payment_info = '{"ok":1}' where id = $1`, [id]);
  assert.deepEqual(withMigration ? await rows() : [], [], "no account, no rows");
}
await exec(`insert into public.wa_accounts(company_id, is_active) values ('${MEGA_EVENTS}', true);`);

// payment_received: once per order
{
  const id = await newOrder("Pending", { payment_info: "{}" });
  await q(`update public.reservations set status = 'Paid', payment_info = '{"ok":1}' where id = $1`, [id]);
  await q(`update public.reservations set status = 'Paid' where id = $1`, [id]);
  const got = (await rows()).filter((r) => r.dedupe_key === `payment_received:${id}`);
  assert.equal(got.length, 1, "payment_received");
  assert.equal(got[0].from_status, "Pending");
  // the same update carried the gateway result: no failure was queued for it
  assert.equal((await rows()).filter((r) => r.dedupe_key.startsWith(`payment_failed:${id}`)).length, 0, "a successful payment is no failure");
}

// payment_failed: a gateway result without Paid, once per Israel day, 15 minutes later
{
  const id = await newOrder("Pending", { payment_info: "{}" });
  await q(`update public.reservations set payment_info = '{"status":"FAILED"}' where id = $1`, [id]);
  await q(`update public.reservations set payment_info = '{"status":"FAILED","again":1}' where id = $1`, [id]);
  const got = (await rows()).filter((r) => r.kind === "payment_failed" && r.dedupe_key.startsWith(`payment_failed:${id}:`));
  assert.equal(got.length, 1, "payment_failed once per day");
  assert.match(got[0].dedupe_key, /^payment_failed:\d+:\d{4}-\d{2}-\d{2}$/);
  const [{ wait }] = await q(`select extract(epoch from (due_at - created_at))::int as wait from public.wa_outbox where dedupe_key = $1`, [got[0].dedupe_key]);
  assert.ok(wait >= 899 && wait <= 901, `payment_failed waits 15 minutes (got ${wait}s)`);
}

// phone_order: the mail flag flips on a Pending order with no payment and no settlement method
{
  const id = await newOrder("Pending");
  await q(`update public.reservations set confirmation_email_sent = true where id = $1`, [id]);
  assert.equal((await rows()).filter((r) => r.dedupe_key === `phone_order:${id}`).length, 1, "phone_order");
  const voucher = await newOrder("Pending", { method: "voucher" });
  await q(`update public.reservations set confirmation_email_sent = true where id = $1`, [voucher]);
  assert.equal((await rows()).filter((r) => r.dedupe_key === `phone_order:${voucher}`).length, 0, "a voucher order gets no phone_order");
}

// materials_sent
{
  const id = await newOrder("Paid");
  await q(`update public.reservations set travel_materials_sent_at = now() where id = $1`, [id]);
  await q(`update public.reservations set travel_materials_sent_at = now() + interval '1 minute' where id = $1`, [id]);
  assert.equal((await rows()).filter((r) => r.dedupe_key === `materials_sent:${id}`).length, 1, "materials_sent once");
}

// order_cancelled, with the status it came from
{
  const id = await newOrder("Pending");
  await q(`update public.reservations set status = 'Paid' where id = $1`, [id]);
  await q(`update public.reservations set status = 'Cancelled' where id = $1`, [id]);
  const [row] = (await rows()).filter((r) => r.dedupe_key === `order_cancelled:${id}`);
  assert.equal(row?.from_status, "Paid", "order_cancelled keeps from_status");
}

// a broken wa_outbox never fails a reservation write
{
  const id = await newOrder("Pending");
  await exec(`alter table public.wa_outbox drop column from_status;`);
  await q(`update public.reservations set status = 'Paid' where id = $1`, [id]);
  const [r] = await q(`select status from public.reservations where id = $1`, [id]);
  assert.equal(r.status, "Paid", "a broken wa_outbox never fails a reservation write");
  await exec(`alter table public.wa_outbox add column from_status text;`);
}

// RLS on, no grants to the public roles; idempotent
{
  const [rls] = await q(`select relrowsecurity from pg_class where relname = 'wa_outbox'`);
  assert.equal(rls.relrowsecurity, true);
  const grants = await q(`select grantee from information_schema.role_table_grants where table_name = 'wa_outbox' and grantee in ('anon','authenticated')`);
  assert.deepEqual(grants, []);
  await exec(file(MIGRATION));
}

console.log("whatsapp-events outbox SQL: OK");

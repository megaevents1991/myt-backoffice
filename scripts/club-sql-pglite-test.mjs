// scripts/club-sql-pglite-test.mjs - `node scripts/club-sql-pglite-test.mjs`
//
// The SQL test of the members club migration (supabase/migrations/*_members_club.sql, spec
// docs/superpowers/specs/2026-11-09-members-club-design.md §7), on an in-process Postgres (PGlite) over a stub `coupons`:
//   - member numbers start at 1001 and count up;
//   - one member per email, whatever its case or surrounding spaces;
//   - club_settings holds the `program` row with today's popup numbers;
//   - coupons.source exists and is nullable, and the coupons CHECK (discount_value > 0) is untouched;
//   - the migration runs twice without an error (idempotent) and the seed is not doubled.
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH at an install
// elsewhere (the package directory). No network, no prod.
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite");

const dir = `${process.cwd()}/supabase/migrations`;
const file = readdirSync(dir).find((f) => f.endsWith("_members_club.sql"));
assert.ok(file, "the members club migration file exists");
const MIGRATION = readFileSync(`${dir}/${file}`, "utf8");

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table public.coupons (
  id bigint generated always as identity primary key,
  code text not null unique,
  discount_type text not null,
  discount_value numeric not null check (discount_value > 0),
  per_person boolean not null default false,
  is_active boolean not null default true,
  event_id bigint, valid_until date, max_uses int, times_used int not null default 0, times_paid int not null default 0
);
`);

await db.exec(MIGRATION);
await db.exec(MIGRATION); // idempotent

const member = (email) =>
  db.query(`insert into public.club_members (email, coupon_code) values ($1, $2) returning member_no`, [email, `MEGA${Math.random().toString(36).slice(2, 8).toUpperCase()}`]);

const a = await member("Dana@x.com");
const b = await member("other@x.com");
assert.equal(a.rows[0].member_no, 1001, "first member is 1001");
assert.equal(b.rows[0].member_no, 1002, "second member is 1002");

await assert.rejects(member(" dana@x.com"), /duplicate|unique/i, "the same email in another case / with spaces is refused");

const s = await db.query(`select value from public.club_settings where key = 'program'`);
assert.equal(s.rows.length, 1, "one program row after two runs");
assert.deepEqual(s.rows[0].value, { enabled: true, discount_per_traveler_usd: 50, popup_delay_seconds: 22 });

const col = await db.query(
  `select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'coupons' and column_name = 'source'`,
);
assert.equal(col.rows[0]?.is_nullable, "YES", "coupons.source exists and is nullable");
await db.query(`insert into public.coupons (code, discount_type, discount_value, per_person, source) values ('MEGATEST01', 'fixed', 50, true, 'club')`);
await assert.rejects(
  db.query(`insert into public.coupons (code, discount_type, discount_value, source) values ('MEGATEST02', 'fixed', 0, 'club')`),
  /check/i,
  "the coupons CHECK still refuses 0",
);

const log = await db.query(
  `insert into public.club_log (action, ip, user_agent, source) values ('lookup_miss', '1.2.3.4', 'ua', 'checkout_row') returning id, at`,
);
assert.ok(log.rows[0].at, "club_log.at defaults to now()");

const tok = await db.query(`select unsubscribe_token, marketing, status from public.club_members where member_no = 1001`);
assert.match(tok.rows[0].unsubscribe_token, /^[0-9a-f]{32}$/, "a 32-hex unsubscribe token by default");
assert.equal(tok.rows[0].marketing, "subscribed");
assert.equal(tok.rows[0].status, "active");

console.log("club-sql-pglite-test: all assertions passed");

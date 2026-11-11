// scripts/forms-company-users-sql-pglite-test.mjs - `node scripts/forms-company-users-sql-pglite-test.mjs`
//
// The SQL test of stage 2 of the forms move to Mega Family (supabase/migrations/*_forms_company_users.sql,
// spec docs/superpowers/specs/2026-11-11-forms-to-mega-family-design.md), on an in-process Postgres (PGlite)
// after stage 1 (*_forms_company.sql) over stub tables:
//   - a form Nir created between the stages (tagged Mega Events by the default) moves to Mega Family;
//     a Mega Events form stays;
//   - Nir ends with ONE membership (Mega Family, admin), Daniel with ONE (Mega Family, forms_operator);
//     nobody else's memberships move;
//   - an account whose role changed since 11.11 is skipped (its memberships untouched);
//   - a missing account is skipped and the rest still applies;
//   - a second run changes nothing; no form, field, invite or answer is lost.
//
// Needs @electric-sql/pglite (`npm i --no-save @electric-sql/pglite`, or PGLITE_PATH). No network, no prod.
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(
  pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite"
);

const dir = `${process.cwd()}/supabase/migrations`;
const read = (suffix) => {
  const file = readdirSync(dir).find((f) => f.endsWith(suffix));
  assert.ok(file, `${suffix} exists`);
  return readFileSync(`${dir}/${file}`, "utf8");
};
const STAGE1 = read("_forms_company.sql");
const STAGE2 = read("_forms_company_users.sql");

const EVENTS = "a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601";
const FAMILY = "b4e2d3c5-6c7f-4a81-9ba2-c3d4e5f6a702";
const NIR = "500278b1-94b6-4634-ac51-050b4347fc52";
const DANIEL = "9858c8fa-2c3c-46da-b8a7-f17b301ffb0f";
const OPS = "12a88037-16db-4964-8b63-bbf46fb5475c";
const MEGAWEB = "06bb805e-6a20-49ae-b026-0f9ee386f706";

const STUB = `
create table public.companies (id uuid primary key, slug text not null unique, name text not null);
create table public.user_profiles (id uuid primary key, email text not null, role text not null);
create table public.company_members (
  user_id uuid not null references public.user_profiles(id),
  company_id uuid not null references public.companies(id),
  role text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
create table public.forms (
  id bigint primary key,
  slug text not null unique,
  title_en text not null,
  created_by text,
  is_deleted text,
  operator_visible boolean not null default false,
  series_id uuid
);
create table public.form_fields (id bigint primary key, form_id bigint not null references public.forms(id) on delete cascade);
create table public.form_invites (id bigint primary key, form_id bigint not null references public.forms(id) on delete cascade);
create table public.form_responses (
  id bigint primary key,
  form_id bigint not null references public.forms(id) on delete cascade,
  invite_id bigint references public.form_invites(id) on delete set null
);
`;

async function world({ nirRole = "admin", withDaniel = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.query(`insert into public.companies values ($1, 'mega-events', 'מגה איבנטס'), ($2, 'mega-family', 'מגה פמילי')`, [EVENTS, FAMILY]);
  await db.query(`insert into public.user_profiles values ($1, 'nir1@megatr.co.il', $2)`, [NIR, nirRole]);
  if (withDaniel) await db.query(`insert into public.user_profiles values ($1, ' Daniel@MegaTR.co.il', 'forms_operator')`, [DANIEL]);
  await db.query(`insert into public.user_profiles values ($1, 'opsgrp1@megatr.co.il', 'admin'), ($2, 'megaweb@megatr.co.il', 'admin')`, [OPS, MEGAWEB]);
  // The memberships as measured on 11.11.
  await db.query(`insert into public.company_members (user_id, company_id, role) values ($1, $2, 'forms_operator')`, [NIR, EVENTS]);
  if (withDaniel) await db.query(`insert into public.company_members (user_id, company_id, role) values ($1, $2, 'forms_operator')`, [DANIEL, EVENTS]);
  await db.query(`insert into public.company_members (user_id, company_id, role) values ($1, $2, 'admin'), ($3, $4, 'admin')`, [OPS, EVENTS, MEGAWEB, FAMILY]);
  // Forms: #5 (Family by stage 1), #9 (Events draft); stage 1 runs; then the OLD code creates two more.
  await db.exec(`
    insert into public.forms (id, slug, title_en, created_by, operator_visible) values
      (5, 'mega-travel-feedback', 'Trip feedback', null, true),
      (9, 'untitled-form-4', 'Untitled form', 'megaevents1991@gmail.com', false);
    insert into public.form_fields values (1, 5), (2, 9);
    insert into public.form_invites values (1, 5);
    insert into public.form_responses values (1, 5, 1), (2, 5, null);
  `);
  await db.exec(STAGE1);
  await db.exec(`
    insert into public.forms (id, slug, title_en, created_by) values
      (20, 'nir-between-stages', 'x', 'nir1@megatr.co.il'),
      (21, 'ops-between-stages', 'x', 'opsgrp1@megatr.co.il');
  `);
  return db;
}

const companyOf = async (db, id) => (await db.query(`select company_id from public.forms where id = $1`, [id])).rows[0].company_id;
const membershipsOf = async (db, user) =>
  (await db.query(`select company_id, role from public.company_members where user_id = $1 order by company_id`, [user])).rows;
const counts = async (db) =>
  (await db.query(`
    select (select count(*) from public.forms)::int f, (select count(*) from public.form_fields)::int ff,
           (select count(*) from public.form_invites)::int fi, (select count(*) from public.form_responses)::int fr,
           (select count(*) from public.form_responses where invite_id is not null)::int linked`)).rows[0];

// 1. The re-tag and the two moves.
{
  const db = await world();
  assert.equal(await companyOf(db, 20), EVENTS, "between the stages the default tags Nir's new form Mega Events");
  const before = await counts(db);
  await db.exec(STAGE2);

  assert.equal(await companyOf(db, 20), FAMILY, "Nir's form made between the stages moves to Mega Family");
  assert.equal(await companyOf(db, 21), EVENTS, "a Mega Events staff form made between the stages stays");
  assert.equal(await companyOf(db, 5), FAMILY, "#5 stays Mega Family");
  assert.equal(await companyOf(db, 9), EVENTS, "#9 stays Mega Events");

  assert.deepEqual(await membershipsOf(db, NIR), [{ company_id: FAMILY, role: "admin" }], "Nir: Mega Family admin only");
  assert.deepEqual(await membershipsOf(db, DANIEL), [{ company_id: FAMILY, role: "forms_operator" }], "Daniel: Mega Family forms operator only");
  assert.deepEqual(await membershipsOf(db, OPS), [{ company_id: EVENTS, role: "admin" }], "another megatr Mega Events admin is untouched");
  assert.deepEqual(await membershipsOf(db, MEGAWEB), [{ company_id: FAMILY, role: "admin" }], "the Family admin is untouched");
  assert.deepEqual(await counts(db), before, "no form, field, invite or answer is lost");

  // 2. Idempotent.
  await db.exec(STAGE2);
  assert.deepEqual(await membershipsOf(db, NIR), [{ company_id: FAMILY, role: "admin" }], "a second run leaves Nir as he is");
  assert.deepEqual(await membershipsOf(db, DANIEL), [{ company_id: FAMILY, role: "forms_operator" }], "a second run leaves Daniel as he is");
  assert.deepEqual(await counts(db), before, "a second run loses nothing");
}

// 3. An account whose role changed since 11.11 is skipped; a missing one too; the rest applies.
{
  const db = await world({ nirRole: "editor", withDaniel: false });
  await db.exec(STAGE2);
  assert.deepEqual(
    await membershipsOf(db, NIR),
    [{ company_id: EVENTS, role: "forms_operator" }],
    "Nir, now an editor, is not moved (no powers by a guess)",
  );
  assert.equal(await companyOf(db, 20), FAMILY, "the re-tag still applies");
}

// 4. A missing company RAISES and writes nothing.
{
  const db = await world();
  await db.exec(`delete from public.company_members where company_id = '${FAMILY}'`);
  await db.exec(`update public.forms set company_id = '${EVENTS}' where company_id = '${FAMILY}'`);
  await db.exec(`delete from public.companies where slug = 'mega-family'`);
  await assert.rejects(db.exec(STAGE2), /mega-family not found/, "a missing company raises");
  assert.deepEqual(
    await membershipsOf(db, NIR),
    [{ company_id: EVENTS, role: "forms_operator" }],
    "nothing moved when the migration failed",
  );
}

console.log("forms-company-users-sql-pglite-test: all assertions passed");

// scripts/forms-company-sql-pglite-test.mjs - `node scripts/forms-company-sql-pglite-test.mjs`
//
// The SQL test of stage 1 of the forms move to Mega Family (supabase/migrations/*_forms_company.sql,
// spec docs/superpowers/specs/2026-11-11-forms-to-mega-family-design.md), on an in-process Postgres
// (PGlite) over stub `companies` / `forms` / `form_fields` / `form_invites` / `form_responses`:
//   - the ten prod forms split 5 / 5 exactly as measured on 11.11 (Family = #5 #6 #7 #8 #10);
//   - a Mega Events form created by a megatr.co.il STAFF account stays Mega Events;
//   - Nir's address in another case / with spaces still counts;
//   - no field, invite or answer row is written or lost;
//   - company_id is NOT NULL, defaults to Mega Events (a form the current code creates), and refuses
//     a company that does not exist;
//   - a second run changes nothing (idempotent);
//   - with a company missing, the migration RAISES and writes nothing.
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH at an
// install elsewhere (the package directory). No network, no prod.
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(
  pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite"
);

const dir = `${process.cwd()}/supabase/migrations`;
const file = readdirSync(dir).find((f) => f.endsWith("_forms_company.sql"));
assert.ok(file, "the forms_company migration file exists");
const MIGRATION = readFileSync(`${dir}/${file}`, "utf8");

const EVENTS = "a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601";
const FAMILY = "b4e2d3c5-6c7f-4a81-9ba2-c3d4e5f6a702";
const SERIES_BA = "b80615e9-2a70-4493-80d5-28dc61f93c07";

const STUB = `
create table public.companies (
  id uuid primary key,
  slug text not null unique,
  name text not null
);
create table public.forms (
  id bigint primary key,
  slug text not null unique,
  title_en text not null,
  status text not null default 'draft',
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

// The ten prod rows of 11.11 (only the columns the rule reads), plus three edge cases.
const FORMS = [
  [1, "test", "megaevents1991@gmail.com", "08-21-2026", false, null],
  [2, "untitled-form", "alonsamnon@gmail.com", "07-31-2026", false, null],
  [3, "untitled-form-2", "alonsamnon@gmail.com", "07-31-2026", false, null],
  [4, "untitled-form-3", "megaevents1991@gmail.com", "08-20-2026", false, null],
  [5, "mega-travel-feedback", null, null, true, null],
  [6, "trip-feedback-copy", "alonsamnon@gmail.com", "08-20-2026", true, null],
  [7, "trip-feedback-copy-2", "daniel@megatr.co.il", "08-20-2026", true, null],
  [8, "trip-feedback-copy-3", "daniel@megatr.co.il", "08-21-2026", true, null],
  [9, "untitled-form-4", "megaevents1991@gmail.com", null, false, null],
  [10, "ba-trip-feedback", "nir1@megatr.co.il", null, true, SERIES_BA],
  // A Mega Events form opened by a Mega Events staff account that carries a megatr address.
  [11, "ops-form", "opsgrp1@megatr.co.il", null, false, null],
  // Nir, in another case and with spaces, on a form not yet opened to operators.
  [12, "nir-draft", "  Nir1@MegaTR.co.il ", null, false, null],
  // A series form nobody opened to operators.
  [13, "series-draft", "megaevents1991@gmail.com", null, false, SERIES_BA],
];
const FAMILY_IDS = [5, 6, 7, 8, 10, 12, 13];
const EVENTS_IDS = [1, 2, 3, 4, 9, 11];

async function seeded({ withFamily = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.query(`insert into public.companies (id, slug, name) values ($1, 'mega-events', 'מגה איבנטס')`, [EVENTS]);
  if (withFamily) {
    await db.query(`insert into public.companies (id, slug, name) values ($1, 'mega-family', 'מגה פמילי')`, [FAMILY]);
  }
  for (const [id, slug, createdBy, deleted, operatorVisible, seriesId] of FORMS) {
    await db.query(
      `insert into public.forms (id, slug, title_en, created_by, is_deleted, operator_visible, series_id)
       values ($1, $2, $2, $3, $4, $5, $6)`,
      [id, slug, createdBy, deleted, operatorVisible, seriesId],
    );
  }
  // Children: a field, a trip link and two answers on #5, a field on #10, an answer on #1.
  await db.exec(`
    insert into public.form_fields (id, form_id) values (1, 5), (2, 5), (3, 10), (4, 1);
    insert into public.form_invites (id, form_id) values (1, 5), (2, 5);
    insert into public.form_responses (id, form_id, invite_id) values (1, 5, 1), (2, 5, 1), (3, 5, null), (4, 1, null);
  `);
  return db;
}

const counts = async (db) => {
  const { rows } = await db.query(`
    select (select count(*) from public.forms)::int as forms,
           (select count(*) from public.form_fields)::int as fields,
           (select count(*) from public.form_invites)::int as invites,
           (select count(*) from public.form_responses)::int as responses,
           (select count(*) from public.form_responses where invite_id is not null)::int as linked`);
  return rows[0];
};

const split = async (db) => {
  const { rows } = await db.query(`select id::int, company_id from public.forms order by id`);
  return {
    family: rows.filter((r) => r.company_id === FAMILY).map((r) => r.id),
    events: rows.filter((r) => r.company_id === EVENTS).map((r) => r.id),
    none: rows.filter((r) => r.company_id === null).map((r) => r.id),
  };
};

// 1. The split, and nothing else touched.
{
  const db = await seeded();
  const before = await counts(db);
  await db.exec(MIGRATION);
  const after = await split(db);
  assert.deepEqual(after.family, FAMILY_IDS, "Family = the operator / series / Nir / Daniel forms");
  assert.deepEqual(after.events, EVENTS_IDS, "Events = the rest, including a megatr Mega Events staff form");
  assert.deepEqual(after.none, [], "no form is left without a company");
  assert.deepEqual(await counts(db), before, "no field, invite or answer row is written or lost");

  // 2. Idempotent: a second run changes nothing.
  await db.exec(MIGRATION);
  assert.deepEqual(await split(db), after, "a second run changes nothing");
  assert.deepEqual(await counts(db), before, "a second run touches no child row");

  // 3. The column: NOT NULL, Mega Events by default, a real company only.
  const col = await db.query(
    `select is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'forms' and column_name = 'company_id'`,
  );
  assert.equal(col.rows[0].is_nullable, "NO", "company_id is NOT NULL");
  assert.match(col.rows[0].column_default, new RegExp(EVENTS), "the default is Mega Events' id");

  await db.query(`insert into public.forms (id, slug, title_en) values (100, 'new-by-old-code', 'x')`);
  const created = await db.query(`select company_id from public.forms where id = 100`);
  assert.equal(created.rows[0].company_id, EVENTS, "a form the current code creates is Mega Events'");

  await assert.rejects(
    db.query(`insert into public.forms (id, slug, title_en, company_id) values (101, 'x2', 'x', gen_random_uuid())`),
    /foreign key/i,
    "a company that does not exist is refused",
  );
  await assert.rejects(
    db.query(`update public.forms set company_id = null where id = 5`),
    /null/i,
    "a form cannot lose its company",
  );

  const idx = await db.query(`select 1 from pg_indexes where schemaname = 'public' and indexname = 'forms_company_id_idx'`);
  assert.equal(idx.rows.length, 1, "the company index exists");
}

// 4. A missing company RAISES and writes nothing.
{
  const db = await seeded({ withFamily: false });
  await assert.rejects(db.exec(MIGRATION), /mega-family not found/, "a missing company raises");
  // PGlite runs a multi-statement exec as one implicit transaction: the ADD COLUMN goes with it.
  const col = await db.query(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = 'forms' and column_name = 'company_id'`,
  );
  assert.equal(col.rows.length, 0, "nothing stays when the migration fails");
}

console.log("forms-company-sql-pglite-test: all assertions passed");

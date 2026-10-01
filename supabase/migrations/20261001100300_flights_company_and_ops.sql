-- flights: which company owns a block + the operations fields of group flights.
-- Spec: mega-family/docs/plans/MEGA-FAMILY-DATA-SPEC.md (section 2.3).
--
-- SAFE FOR MEGA EVENTS BY CONSTRUCTION:
--   * company_id defaults to Mega Events, so every existing row and every insert
--     made by today's code (which does not know the column) lands on Mega Events.
--   * every other new column is nullable with no default - nothing reads it yet.
--   * the block_status allow-list is only widened; the three old values stay valid.
--   * no row of another company exists until the backoffice filters by company.
--     That is a code gate, not a schema one: do not import Mega Family blocks
--     before every flights query is company-scoped.
--
-- myt-main reads flights by event id (`event_ids` contains ...), so blocks of a
-- tours company, which never carry event ids, are invisible to it.
--
-- Rollback: supabase/rollback/20261001_multi_company.sql

-- 1. company_id in three steps (nullable -> backfill -> default + not null).
alter table public.flights add column if not exists company_id uuid references public.companies(id);

update public.flights
set company_id = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601'
where company_id is null;

alter table public.flights alter column company_id set default 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601';
alter table public.flights alter column company_id set not null;

create index if not exists flights_company_id_idx on public.flights (company_id);

-- 2. operations fields (all nullable).
alter table public.flights
  add column if not exists original_quantity int,                -- seats first ordered; initial_quantity = current seats
  add column if not exists cost_child_price numeric(10,2),       -- CHD fare (cost_price = ADT)
  add column if not exists cost_tax numeric(10,2),
  add column if not exists inbound_airline_code varchar(3),      -- open-jaw with two carriers
  add column if not exists contract_id uuid references public.flight_contracts(id) on delete set null,
  add column if not exists season_label text,                    -- pool label before a block is assigned to a departure
  add column if not exists requested_at date,
  add column if not exists first_cancellation_date date,         -- CXX 1; last_cancellation_date (existing) = CXX 2
  add column if not exists names_deadline date,
  add column if not exists reviewed_at timestamptz,              -- "a manager went over this row"
  add column if not exists reviewed_by uuid,
  add column if not exists cancelled_at date,
  add column if not exists cancel_reason text,
  add column if not exists cancellation_fee numeric(10,2),
  add column if not exists import_ref text;                      -- key of the one-time workbook import, makes it re-runnable

create unique index if not exists flights_import_ref_key on public.flights (import_ref) where import_ref is not null;

-- 3. block lifecycle: owner approval -> request -> airline confirmation -> operations.
--    'option' and 'ticketed' are kept for Mega Events.
alter table public.flights drop constraint if exists flights_block_status_check;
alter table public.flights add constraint flights_block_status_check
  check (block_status is null or block_status in
    ('approved','requested','declined','option','confirmed','operational','ticketed','cancelled'));

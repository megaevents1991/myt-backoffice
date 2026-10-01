-- MANUAL ROLLBACK for the multi-company migrations of 2026-10-01:
--   20261001100000_companies_core
--   20261001100100_tours_schema
--   20261001100200_company_support_tables
--   20261001100300_flights_company_and_ops
--   20261001100400_company_site_api
--   20261001100500_tours_views
--   20261001100600_tasks_company_and_tours_agent
--   20261002100000_tours_reservations
--
-- This file lives OUTSIDE supabase/migrations on purpose: the CLI never runs it.
-- Run it by hand (SQL editor or psql) only when the migrations must be undone,
-- then mark the eight versions as reverted so the history matches the schema:
--   npx supabase migration repair --status reverted 20261002100000 20261001100600 20261001100500 20261001100400 20261001100300 20261001100200 20261001100100 20261001100000
-- and remove (or revert the commit of) the eight migration files on master,
-- otherwise the next push applies them again.
--
-- Everything here is new since the migrations: no Mega Events data is deleted.
-- The only pre-existing object touched is public.flights, which gets its
-- original block_status check back.

begin;

-- 8. tours reservations ------------------------------------------------------
-- Undoes 20261002100000 alone too (run just this block): the seats view goes back
-- to counting every sales row, then the reservation columns go. A soft-deleted
-- row would count again, so such rows are reported first and nothing runs while
-- any exist - decide on them (delete for real, or keep) before rolling back.
do $$
begin
  if to_regclass('tours.departure_sales_entries') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'tours' and table_name = 'departure_sales_entries' and column_name = 'is_deleted')
     and exists (select 1 from tours.departure_sales_entries where is_deleted is not null) then
    raise exception 'tours.departure_sales_entries has soft-deleted rows; settle them before rolling back 20261002100000';
  end if;
end $$;
do $$
begin
  if to_regclass('tours.departure_stats') is not null then
    create or replace view tours.departure_stats as
    select
      d.id as departure_id,
      d.company_id,
      least(coalesce(a.outbound_seats, 0), coalesce(a.inbound_seats, 0))::int as allocated_seats,
      coalesce(a.live_blocks, 0)::int as live_blocks,
      coalesce(a.total_blocks, 0)::int as total_blocks,
      coalesce(s.sold, 0)::int as sold,
      (least(coalesce(a.outbound_seats, 0), coalesce(a.inbound_seats, 0)) - coalesce(s.sold, 0))::int as remaining,
      coalesce(a.outbound_seats, 0)::int as outbound_seats,
      coalesce(a.inbound_seats, 0)::int as inbound_seats
    from tours.departures d
    left join lateral (
      select
        sum(fa.seats) filter (where fa.legs <> 'inbound' and f.block_status in ('confirmed', 'operational', 'ticketed') and f.is_deleted is not true) as outbound_seats,
        sum(fa.seats) filter (where fa.legs <> 'outbound' and f.block_status in ('confirmed', 'operational', 'ticketed') and f.is_deleted is not true) as inbound_seats,
        count(*) filter (where f.block_status in ('confirmed', 'operational', 'ticketed') and f.is_deleted is not true) as live_blocks,
        count(*) as total_blocks
      from tours.flight_allocations fa
      join public.flights f on f.id = fa.flight_id
      where fa.departure_id = d.id
    ) a on true
    left join lateral (
      select sum(e.pax) as sold from tours.departure_sales_entries e where e.departure_id = d.id
    ) s on true;
    drop index if exists tours.departure_sales_entries_company_created_idx;
    drop index if exists tours.departure_sales_entries_lead_idx;
    alter table tours.departure_sales_entries
      drop column if exists customer_name,
      drop column if exists customer_phone,
      drop column if exists customer_email,
      drop column if exists lead_id,
      drop column if exists is_deleted;
  end if;
end $$;

-- 7. tasks per company + the tours_agent role ---------------------------------
-- Without company_id the board is one shared list again, so the tasks of any
-- other company are soft-deleted first (deleted_at) - they must not surface on
-- the Mega Events board. Nothing is hard-deleted.
update public.tasks
  set deleted_at = now()
  where company_id is distinct from 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601'
    and deleted_at is null;
drop index if exists public.tasks_company_id_idx;
alter table public.tasks drop column if exists company_id;
-- The old code does not know the tours_agent role: those accounts are switched
-- off, not converted (the nearest old role, `agent`, is a Mega Events partner).
-- The widened role check on user_profiles stays - it is harmless, and narrowing
-- it would fail while such rows exist.
update public.user_profiles set is_active = false where role = 'tours_agent';

-- 5. site API ---------------------------------------------------------------
do $$
declare r record;
begin
  for r in select schema_name from public.companies loop
    execute format('drop schema if exists %I cascade', r.schema_name);
  end loop;
end $$;
drop function if exists public.reprovision_all_companies();
drop function if exists public.provision_company(text);

-- 4. flights -------------------------------------------------------------
-- Blocks owned by another company did not exist before. Refuse to go on while
-- there are any, so they are never silently merged into Mega Events. Checked
-- first, before any row is touched.
do $$
begin
  if exists (select 1 from public.flights where company_id <> 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601') then
    raise exception 'flights rows of another company exist - delete or export them first';
  end if;
end $$;

-- Statuses that did not exist before would violate the old check: fold them back.
update public.flights set block_status = null
where block_status in ('approved','requested','declined','operational','cancelled');

-- The views of the tours schema read the columns dropped below, and the schema
-- itself goes only in section 2: drop the views first.
drop view if exists tours.flight_realization;
drop view if exists tours.departure_stats;

alter table public.flights drop constraint if exists flights_block_status_check;
alter table public.flights add constraint flights_block_status_check
  check (block_status is null or block_status in ('option', 'confirmed', 'ticketed'));

drop index if exists public.flights_company_id_idx;
alter table public.flights
  drop column if exists company_id,
  drop column if exists original_quantity,
  drop column if exists cost_child_price,
  drop column if exists cost_tax,
  drop column if exists inbound_airline_code,
  drop column if exists contract_id,
  drop column if exists season_label,
  drop column if exists requested_at,
  drop column if exists first_cancellation_date,
  drop column if exists names_deadline,
  drop column if exists reviewed_at,
  drop column if exists reviewed_by,
  drop column if exists cancelled_at,
  drop column if exists cancel_reason,
  drop column if exists cancellation_fee,
  drop column if exists import_ref;

-- 2. tours schema (before the support tables: it references flights only) ---
drop schema if exists tours cascade;

-- 3. support tables --------------------------------------------------------
drop table if exists public.leads;
drop table if exists public.company_exchange_rates;
drop table if exists public.calendar_periods;
drop table if exists public.flight_block_events;
drop table if exists public.flight_contract_rules;
drop table if exists public.flight_contracts;

-- 1. core ------------------------------------------------------------------
drop table if exists public.company_members;
drop table if exists public.company_domains;
drop table if exists public.companies;

commit;

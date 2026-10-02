-- MANUAL ROLLBACK for the multi-company migrations of 2026-10-01:
--   20261001100000_companies_core
--   20261001100100_tours_schema
--   20261001100200_company_support_tables
--   20261001100300_flights_company_and_ops
--   20261001100400_company_site_api
--   20261001100500_tours_views
--   20261001100600_tasks_company_and_tours_agent
--   20261002100000_tours_reservations
--   20261002110000_tours_media_bucket
--   20261002120000_tours_group_leaders
--   20261002130000_tours_live_sale_status
--
-- This file lives OUTSIDE supabase/migrations on purpose: the CLI never runs it.
-- Run it by hand (SQL editor or psql) only when the migrations must be undone,
-- then mark the eleven versions as reverted so the history matches the schema:
--   npx supabase migration repair --status reverted 20261002130000 20261002120000 20261002110000 20261002100000 20261001100600 20261001100500 20261001100400 20261001100300 20261001100200 20261001100100 20261001100000
-- and remove (or revert the commit of) the eleven migration files on master,
-- otherwise the next push applies them again.
--
-- Everything here is new since the migrations: no Mega Events data is deleted.
-- The only pre-existing object touched is public.flights, which gets its
-- original block_status check back.

begin;

-- 11. live sale status -----------------------------------------------------
-- Undoes 20261002130000 alone too (run just this block): the site view shows
-- the operator's status only again. The function below is 20261001100400's.
create or replace function public.provision_company(p_slug text)
returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  c public.companies%rowtype;
  s text;
begin
  select * into c from public.companies where slug = p_slug;
  if not found then
    raise exception 'company % not found', p_slug;
  end if;
  s := c.schema_name;

  execute format('create schema if not exists %I', s);
  execute format('grant usage on schema %I to anon, authenticated, service_role', s);

  if 'tours' = any (c.product_types) then
    -- catalog ---------------------------------------------------------------
    execute format('drop view if exists %I.packages cascade', s);
    execute format($v$create view %I.packages with (security_barrier) as
      select * from tours.packages
      where company_id = %L and is_active and is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.package_itineraries cascade', s);
    execute format($v$create view %I.package_itineraries with (security_barrier) as
      select * from tours.package_itineraries where company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.terms cascade', s);
    execute format($v$create view %I.terms with (security_barrier) as
      select * from tours.terms where company_id = %L and is_active$v$, s, c.id);

    execute format('drop view if exists %I.package_terms cascade', s);
    execute format($v$create view %I.package_terms with (security_barrier) as
      select pt.* from tours.package_terms pt
      join tours.packages p on p.id = pt.package_id
      where p.company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.series cascade', s);
    execute format($v$create view %I.series with (security_barrier) as
      select * from tours.series where company_id = %L and is_active$v$, s, c.id);

    execute format('drop view if exists %I.series_terms cascade', s);
    execute format($v$create view %I.series_terms with (security_barrier) as
      select st.* from tours.series_terms st
      join tours.series sr on sr.id = st.series_id
      where sr.company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.hotels cascade', s);
    execute format($v$create view %I.hotels with (security_barrier) as
      select * from tours.hotels where company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.cars cascade', s);
    execute format($v$create view %I.cars with (security_barrier) as
      select * from tours.cars where company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.instructors cascade', s);
    execute format($v$create view %I.instructors with (security_barrier) as
      select * from tours.instructors where company_id = %L and is_active$v$, s, c.id);

    execute format('drop view if exists %I.cms_pages cascade', s);
    execute format($v$create view %I.cms_pages with (security_barrier) as
      select * from tours.cms_pages where company_id = %L and is_active$v$, s, c.id);

    -- departures: published only, internal columns left out -------------------
    execute format('drop view if exists %I.departures cascade', s);
    execute format($v$create view %I.departures with (security_barrier) as
      select id, package_id, series_id, code, season_year, start_date, end_date, season, currency,
             sale_status, card_badge, date_labels, arrival_airport, return_airport, itinerary_id,
             meeting_at, flight_mode, flight_price, baggage_included, meal_included, transfers_included,
             connection_out, connection_back, child_max_age, senior_min_age, senior_discount,
             markup_percent, markup_fixed, legacy_product_id, site_id, data
      from tours.departures
      where company_id = %L and is_published and is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.departure_prices cascade', s);
    execute format($v$create view %I.departure_prices with (security_barrier) as
      select dp.departure_id, dp.pax_type, dp.room_position, dp.price
      from tours.departure_prices dp
      join tours.departures d on d.id = dp.departure_id
      where d.company_id = %L and d.is_published and d.is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.departure_options cascade', s);
    execute format($v$create view %I.departure_options with (security_barrier) as
      select o.id, o.departure_id, o.kind, o.position, o.ref_code, o.label, o.board, o.nights,
             o.stay_order, o.max_people, o.price, o.price_unit, o.room_prices
      from tours.departure_options o
      join tours.departures d on d.id = o.departure_id
      where d.company_id = %L and d.is_published and d.is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.promotions cascade', s);
    execute format($v$create view %I.promotions with (security_barrier) as
      select id, departure_id, series_id, kind, value, label, valid_until, show_on_card
      from tours.promotions
      where company_id = %L and is_active$v$, s, c.id);  -- valid_until is shown, not enforced: the site decides (WordPress never hid an expired discount)

    -- the live flight block(s) of a published departure: schedule only ---------
    execute format('drop view if exists %I.departure_flights cascade', s);
    execute format($v$create view %I.departure_flights with (security_barrier) as
      select fa.departure_id, fa.legs, f.id as flight_id, f.block_status,
             f.airline_code, f.inbound_airline_code, f.metadata_name, f.metadata_logo, f.stops,
             f.outbound_flight_number, f.outbound_departure_airport, f.outbound_arrival_airport,
             f.outbound_departure_time, f.outbound_arrival_time, f.outbound_stop_airport, f.outbound_stop_duration,
             f.outbound_check_bags_included,
             f.inbound_flight_number, f.inbound_departure_airport, f.inbound_arrival_airport,
             f.inbound_departure_time, f.inbound_arrival_time, f.inbound_stop_airport, f.inbound_stop_duration,
             f.inbound_check_bags_included
      from tours.flight_allocations fa
      join public.flights f on f.id = fa.flight_id
      join tours.departures d on d.id = fa.departure_id
      where f.company_id = %L and d.company_id = %L
        and f.is_deleted is not true
        and f.block_status in ('confirmed','operational','ticketed')
        and d.is_published and d.is_deleted is null$v$, s, c.id, c.id);
  end if;

  -- forms ---------------------------------------------------------------------
  execute format($f$create or replace function %I.submit_lead(
      p_kind text, p_name text, p_phone text, p_email text, p_message text,
      p_payload jsonb default '{}'::jsonb, p_source_path text default null, p_utm jsonb default '{}'::jsonb)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $body$
    declare new_id uuid;
    begin
      if coalesce(btrim(p_name), '') = '' and coalesce(btrim(p_phone), '') = '' and coalesce(btrim(p_email), '') = '' then
        raise exception 'empty lead';
      end if;
      if pg_column_size(coalesce(p_payload, '{}'::jsonb)) > 16000 then
        raise exception 'payload too large';
      end if;
      insert into public.leads (company_id, kind, name, phone, email, message, payload, source_path, utm)
      values (%L,
              left(coalesce(nullif(btrim(p_kind), ''), 'lead'), 40),
              left(p_name, 300), left(p_phone, 40), left(p_email, 120), left(p_message, 4000),
              coalesce(p_payload, '{}'::jsonb), left(p_source_path, 300), coalesce(p_utm, '{}'::jsonb))
      returning id into new_id;
      return new_id;
    end
    $body$f$, s, c.id);
  execute format('revoke all on function %I.submit_lead(text, text, text, text, text, jsonb, text, jsonb) from public', s);
  execute format('grant execute on function %I.submit_lead(text, text, text, text, text, jsonb, text, jsonb) to anon, authenticated, service_role', s);

  execute format('grant select on all tables in schema %I to anon, authenticated, service_role', s);
end
$fn$;

select public.reprovision_all_companies();

-- 10. tours group leaders --------------------------------------------------
-- Undoes 20261002120000 alone too (run just this block). The leaders typed in
-- are lost; the site views are re-provisioned without the column.
alter table tours.departures drop column if exists leader_id;
alter table tours.packages drop column if exists instructor_ids cascade;
select public.reprovision_all_companies();

-- 9. tours media bucket ------------------------------------------------------
-- Undoes 20261002110000. Nothing to run in SQL: the bucket media-mega-family
-- holds the pictures staff uploaded from the tours editors, and content rows
-- (tours.* image / gallery / hero_images columns and their `data`) point at
-- them by URL - removing it breaks those pictures on the site at the next
-- publish. Only when that is intended: Supabase dashboard -> Storage ->
-- media-mega-family -> Empty bucket, then Delete bucket (or the Storage API
-- with the service role: emptyBucket, then deleteBucket). Never by SQL on
-- storage.objects / storage.buckets: the files live outside the database and
-- Storage refuses direct deletes. Leaving the bucket in place is harmless.

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

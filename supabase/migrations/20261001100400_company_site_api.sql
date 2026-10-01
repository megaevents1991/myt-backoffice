-- Site-facing read API of a company: schema c_<slug>. ADDITIVE ONLY.
-- Spec: mega-family/docs/plans/BACKOFFICE-INTEGRATION-PLAN.md (section 2.5).
--
-- The customer site of a company reads ONLY from this schema, with the ordinary
-- anon key. It never holds the service-role key, so it cannot reach another
-- company's data or anything internal:
--   * views filter by company_id and show published rows only
--   * cost, docket, notes, PNR and seat counts are not selected
--   * the views are owned by postgres, so anon needs no grant on tours.* itself
--   * forms are written through c_<slug>.submit_lead(), which pins company_id
--
-- provision_company(slug) (re)creates the schema. Call it again after a column
-- is added to a table the views select from: reprovision_all_companies().
--
-- Rollback: supabase/rollback/20261001_multi_company.sql

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
      where company_id = %L and is_active and (valid_until is null or valid_until >= current_date)$v$, s, c.id);

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
    $body$$f$, s, c.id);
  execute format('revoke all on function %I.submit_lead(text, text, text, text, text, jsonb, text, jsonb) from public', s);
  execute format('grant execute on function %I.submit_lead(text, text, text, text, text, jsonb, text, jsonb) to anon, authenticated, service_role', s);

  execute format('grant select on all tables in schema %I to anon, authenticated, service_role', s);
end
$fn$;

create or replace function public.reprovision_all_companies()
returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
declare r record;
begin
  for r in select slug from public.companies where is_active and 'tours' = any (product_types) loop
    perform public.provision_company(r.slug);
  end loop;
end
$fn$;

-- These two are admin tools. `public` functions are auto-granted to anon and
-- authenticated in this project, so take that back explicitly.
revoke all on function public.provision_company(text) from public, anon, authenticated;
revoke all on function public.reprovision_all_companies() from public, anon, authenticated;
grant execute on function public.provision_company(text) to service_role;
grant execute on function public.reprovision_all_companies() to service_role;

select public.provision_company('mega-family');

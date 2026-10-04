-- Seasons of a tour (Alon, 04.10.2026, "העלאת טיול לאתר" 2.ב / 3.3).
--
-- Until now a season was a word on the departure (tours.departures.season) and a
-- list of words on the tour (tours.packages.seasons). A season is now a row of
-- its own under the tour: it can say something else than the tour page for its
-- dates - another itinerary variant, description, attractions, included / not
-- included, images - and it carries free tags for future landing pages. Empty
-- (null) fields mean "the tour's own". Dates are assigned to a season with
-- tours.departures.season_id; a date with none is shown as "no season" in the
-- backoffice before it goes live. tours.departures.season (the word) is kept in
-- step with the season's name, because the site filters its dates by that word.
--
-- Additive only. Mega Events is untouched: nothing in public changes except the
-- body of provision_company(), which only tours companies' views come from.
-- provision_company() is copied verbatim from 20261003100000 with two additions:
-- the <schema>.package_seasons view, and season_id at the end of <schema>.departures.
-- Rollback: section 14 of supabase/rollback/20261001_multi_company.sql.

create table if not exists tours.package_seasons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  package_id uuid not null references tours.packages(id) on delete cascade,
  name text not null,                                   -- 'קיץ', 'פסח' - the word tours.departures.season carries
  position int not null default 0,                      -- order on the tour page; the first one labels the card
  itinerary_id uuid references tours.package_itineraries(id) on delete set null,  -- null = the main itinerary
  -- what this season says instead of the tour page; null = the tour's own
  description_html text,
  attractions text[],
  included text[],
  not_included text[],
  hero_image text,
  gallery text[],
  tags text[] not null default '{}',                    -- free tags, for landing pages built later ("חגים")
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (package_id, name)
);
create index if not exists package_seasons_company_idx on tours.package_seasons (company_id);

alter table tours.package_seasons enable row level security;
grant all on table tours.package_seasons to service_role;

drop trigger if exists package_seasons_set_updated_at on tours.package_seasons;
create trigger package_seasons_set_updated_at before update on tours.package_seasons
  for each row execute function public.update_updated_at_column();

alter table tours.departures
  add column if not exists season_id uuid references tours.package_seasons(id) on delete set null;

create index if not exists departures_season_idx
  on tours.departures (season_id)
  where season_id is not null;

comment on table tours.package_seasons is
  'A season of a tour: the dates assigned to it (tours.departures.season_id) and what it says instead of the tour page. Null content fields inherit from tours.packages.';
comment on column tours.departures.season_id is
  'The season of the tour this date belongs to. Null = not assigned yet (flagged in the backoffice). tours.departures.season keeps the season''s name for the site.';

-- ---------------------------------------------------------------- backfill
-- One season per name already in use on a tour: the names listed on the tour
-- first (in their order), then any other name its dates carry.
insert into tours.package_seasons (company_id, package_id, name, position)
select q.company_id, q.package_id, q.name,
       (row_number() over (partition by q.package_id order by q.src, q.ord, q.name))::int - 1
from (
  select p.company_id, p.id as package_id, x.name, min(x.src) as src, min(x.ord) as ord
  from tours.packages p
  cross join lateral (
    select btrim(s.name) as name, 0 as src, s.ord::int as ord
      from unnest(p.seasons) with ordinality as s(name, ord)
    union all
    select btrim(d.season), 1, 0
      from tours.departures d
     where d.package_id = p.id and d.is_deleted is null and d.season is not null
  ) x
  where p.is_deleted is null and x.name <> ''
  group by p.company_id, p.id, x.name
) q
on conflict (package_id, name) do nothing;

-- Every date that already carries a season word belongs to that season.
update tours.departures d
   set season_id = s.id
  from tours.package_seasons s
 where s.package_id = d.package_id
   and s.name = btrim(d.season)
   and d.season_id is null;

-- ---------------------------------------------------------------- the word follows the season
-- Every screen that writes a date keeps working: the season row decides the word;
-- a date taken off its season loses the word; and where only the word is written
-- (a flight's season label, the old Season field) the date joins the tour's season
-- of that name, or stays unassigned when the tour has none.
create or replace function tours.departure_season_sync()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if new.season_id is not null and (tg_op = 'INSERT' or new.season_id is distinct from old.season_id) then
    select s.name into v_name
      from tours.package_seasons s
     where s.id = new.season_id and s.package_id = new.package_id;
    if v_name is null then
      raise exception 'The season does not belong to the tour of departure %', new.code using errcode = '23514';
    end if;
    new.season := v_name;
  elsif tg_op = 'UPDATE' and new.season_id is null and old.season_id is not null
        and new.season is not distinct from old.season then
    new.season := null;
  elsif tg_op = 'INSERT' or new.season is distinct from old.season then
    new.season_id := (
      select s.id from tours.package_seasons s
       where s.package_id = new.package_id and s.name = btrim(coalesce(new.season, ''))
    );
  end if;
  return new;
end
$$;

drop trigger if exists departures_season_sync on tours.departures;
create trigger departures_season_sync
  before insert or update of season, season_id on tours.departures
  for each row execute function tours.departure_season_sync();

-- ---------------------------------------------------------------- provision_company
-- Copied verbatim from 20261003100000; new: the package_seasons view and departures.season_id.
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

    -- seasons of a tour: what a season says instead of the tour page (null = the tour's own)
    execute format('drop view if exists %I.package_seasons cascade', s);
    execute format($v$create view %I.package_seasons with (security_barrier) as
      select id, package_id, name, position, itinerary_id, description_html, attractions, included, not_included,
             hero_image, gallery, tags
      from tours.package_seasons where company_id = %L$v$, s, c.id);

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
      select d.id, d.package_id, d.series_id, d.code, d.season_year, d.start_date, d.end_date, d.season, d.currency,
             -- the status the site shows: the operator's closed / sold_out win; otherwise the seats decide
             -- (flight seats allocated and none left: sold_out; 5 or fewer: last_places, the backoffice's
             -- LAST_PLACES_THRESHOLD). The seat counts themselves stay internal.
             case
               when d.sale_status in ('closed', 'sold_out') then d.sale_status
               when st.allocated_seats > 0 and st.remaining <= 0 then 'sold_out'
               when st.allocated_seats > 0 and st.remaining <= 5 then 'last_places'
               else d.sale_status
             end as sale_status,
             d.card_badge, d.date_labels, d.arrival_airport, d.return_airport, d.itinerary_id,
             d.meeting_at, d.flight_mode, d.flight_price, d.baggage_included, d.meal_included, d.transfers_included,
             d.connection_out, d.connection_back, d.child_max_age, d.senior_min_age, d.senior_discount,
             d.markup_percent, d.markup_fixed, d.legacy_product_id, d.site_id, d.data, d.season_id
      from tours.departures d
      left join tours.departure_stats st on st.departure_id = d.id
      where d.company_id = %L and d.is_published and d.is_deleted is null$v$, s, c.id);

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

    -- online booking: one entry point for the site (tours.site_booking) ----
    execute format($f$create or replace function %I.site_booking(p_action text, p_args jsonb default '{}'::jsonb)
      returns jsonb
      language sql
      security definer
      set search_path = public, pg_temp
      as $body$ select tours.site_booking(%L::uuid, p_action, p_args) $body$$f$, s, c.id);
    execute format('revoke all on function %I.site_booking(text, jsonb) from public', s);
    execute format('grant execute on function %I.site_booking(text, jsonb) to anon, authenticated, service_role', s);
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

select public.reprovision_all_companies();

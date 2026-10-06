-- Google reviews on the site of a tours company, the way Mega Events has them (Alon's notes, 06.10.2026).
--
-- Mega Events mirrors the reviews of its Google business profile into
-- public.google_reviews / public.google_review_sources (20260909120000): a daily
-- cron reads the profile's public review feed and upserts. Both tables are keyed
-- by the profile's Place ID, so a second profile sits next to the first one
-- without any new column.
--
-- A tours company now names its own profile in its general document
-- (tours.site_content, key 'general', field googlePlaceId - edited in the
-- backoffice under Website > Header & Footer > Contact details). The cron mirrors
-- that profile too, and two views hand the site what it may show:
--   <schema>.google_reviews        - the reviews of that profile, without the hidden ones
--   <schema>.google_review_source  - the profile's name, rating, review count and Maps link
-- The home page's Reviews section chooses between reviews typed by staff and these.
--
-- Mega Family's profile ("מגה תיירות: טיולים מאורגנים לאירופה ולכל העולם") is set here,
-- so the mirror starts on the next cron run. Until a section asks for Google's
-- reviews the site shows the typed ones, as today.
--
-- Additive only. Nothing of Mega Events changes: its tables get one more row in
-- google_review_sources, and its own reviews keep their Place ID. A view only ever
-- shows the profile named in the company's own document.
-- provision_company() is copied verbatim from 20261005180000 with one addition: the two views.
-- Rollback: section 17 of supabase/rollback/20261001_multi_company.sql.

-- ---------------------------------------------------------------- Mega Family's profile
update tours.site_content sc
set data = sc.data || jsonb_build_object('googlePlaceId', 'ChIJyZ2K7pRjVCoRgPJUH9WpRco')
where sc.key = 'general'
  and sc.company_id = (select id from public.companies where slug = 'mega-family')
  and coalesce(sc.data->>'googlePlaceId', '') = '';

-- the source row must exist before a review can reference it
insert into public.google_review_sources (place_id)
select sc.data->>'googlePlaceId'
from tours.site_content sc
where sc.key = 'general'
  and sc.company_id = (select id from public.companies where slug = 'mega-family')
  and coalesce(sc.data->>'googlePlaceId', '') <> ''
on conflict (place_id) do nothing;

-- ---------------------------------------------------------------- provision_company
-- Copied verbatim from 20261005180000; new: the google_reviews and google_review_source views.
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

    -- the site chrome and the home page: one document per key (general, header, footer, home)
    execute format('drop view if exists %I.site_content cascade', s);
    execute format($v$create view %I.site_content with (security_barrier) as
      select key, data, updated_at from tours.site_content where company_id = %L$v$, s, c.id);

    -- the Google reviews of the company's own business profile (its Place ID is in the general document),
    -- as the backoffice mirrors them into public.google_reviews; a review staff hid stays out
    execute format('drop view if exists %I.google_reviews cascade', s);
    execute format($v$create view %I.google_reviews with (security_barrier) as
      select r.review_key, r.author_name, r.rating, r.text, r.published_at, r.review_url
      from public.google_reviews r
      where not r.is_hidden
        and r.place_id = (select sc.data->>'googlePlaceId' from tours.site_content sc where sc.company_id = %L and sc.key = 'general')$v$, s, c.id);

    execute format('drop view if exists %I.google_review_source cascade', s);
    execute format($v$create view %I.google_review_source with (security_barrier) as
      select g.place_id, g.display_name, g.rating, g.review_count, g.maps_url, g.synced_at
      from public.google_review_sources g
      where g.place_id = (select sc.data->>'googlePlaceId' from tours.site_content sc where sc.company_id = %L and sc.key = 'general')$v$, s, c.id);

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

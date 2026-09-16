-- /price-light needs only the NEWEST competitor_matches row per (event, scope) for the events
-- it lists - the listing link, the match method and "changed this week". PostgREST has no
-- DISTINCT ON, so the screen read every match of the last 90 days (6,055 rows in 7 sequential
-- pages, 3.4s measured on 2026-09-16) to keep 852 of them. One stable function returns exactly
-- those rows in a single round trip; the app falls back to the paged read while this is not
-- applied yet (a preview deploy ahead of master).
create or replace function public.price_light_newest_matches(event_ids integer[], since timestamptz)
returns table (
  id bigint,
  event_id integer,
  scope text,
  method text,
  created_at timestamptz,
  url text
)
language sql
stable
as $$
  select distinct on (m.event_id, m.scope)
    m.id, m.event_id, m.scope, m.method, m.created_at, l.url
  from public.competitor_matches m
  left join public.competitor_listings l on l.id = m.listing_id
  where m.event_id = any(event_ids)
    and m.created_at >= since
  order by m.event_id, m.scope, m.created_at desc, m.id desc;
$$;

-- Backoffice-only data: the service-role client is the only caller. The tables carry RLS with
-- no policies, so an anon call would return nothing anyway - but keep the surface closed.
revoke execute on function public.price_light_newest_matches(integer[], timestamptz) from public, anon, authenticated;
grant execute on function public.price_light_newest_matches(integer[], timestamptz) to service_role;

comment on function public.price_light_newest_matches(integer[], timestamptz) is
  'Newest competitor_matches row per (event_id, scope) since a timestamp, with the listing url - the /price-light list read.';

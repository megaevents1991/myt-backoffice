-- An artist's or a team's page under the category tree counts as an ARTIST
-- entry. Partner links to an artist or a team point at the /c/ twin since
-- 2026-09-11 ("/c/music/artists/oasis", "/c/football/teams/liverpool"), and
-- the entry funnels only knew the legacy /artists and /football routes - so
-- that traffic fell into "other", which the screen shows as a footnote. One
-- influencer had 1,366 of 1,927 visitors in 30 days outside all three cards.
--
-- The rule: a LEAF of an `artists` / `teams` hub. The hub itself
-- ("/c/music/artists") is a list and stays a category page, like genres,
-- leagues and destinations. Mirrors classifyEntry in
-- lib/partner-entry-funnels.ts (changed in the same commit).
--
-- Nothing else changes: both functions are otherwise the bodies from
-- 20260805093000_entry_funnel_paid_one_to_one.sql. Idempotent: create or
-- replace, same signatures.

create or replace function "public"."partners_entry_funnels_all"(
  "p_from" timestamptz default null,
  "p_to" timestamptz default null
)
returns table ("entry" text, "stage" text, "visitors" bigint)
language sql
stable
security definer
set search_path = public
as $$
  with windowed as (
    select t.user_id, t.stage, t.created_at, t.affiliate_id,
           t.data->>'path' as path,
           t.data->'data'->>'eventName' as event_name
      from public.affiliates_tracking t
     where t.user_id is not null
       and (p_from is null or t.created_at >= p_from)
       and (p_to is null or t.created_at < p_to)
       -- Refund-credit browsing is not partner traffic (customers get a
       -- personal "ניתן להתעלם" code); keep the funnels marketing-only.
       and not exists (
         select 1
           from public.partners p
          where p.partner_tracking_code = t.affiliate_id
            and (coalesce(p.name_hebrew, '') like '%ניתן להתעלם%'
                 or p.type = 'customer_refund')
       )
  ),
  entries as (
    select distinct on (user_id) user_id, stage, path
      from windowed
     order by user_id, created_at asc
  ),
  classified as (
    select user_id,
           case
             when stage is distinct from 'VISIT' then 'event'
             when path is null or path = '' or path = '/' then 'home'
             when path like '/artists%' or path like '/football%'
               or path ~ '^/c/([^/]+/)*(artists|teams)/[^/]+/?$' then 'artist'
             when path like '/order%' then 'event'
             else 'other'
           end as entry
      from entries
  ),
  stages as (
    select distinct user_id, stage
      from windowed
     where stage is distinct from 'VISIT'
  ),
  -- Reservations carry no tracking user id, so "became paid" is a MATCH, not
  -- proof: a CONFIRMED row against a now-Paid reservation of the same partner
  -- and event name within ±30 minutes. Each reservation is then awarded to
  -- its single closest CONFIRMED row - one sale, one Paid visitor.
  paid_matches as (
    select r.id as reservation_id, w.user_id,
           abs(extract(epoch from (r.created_at - w.created_at))) as gap
      from windowed w
      join public.reservations r
        on r.status = 'Paid'
       and r.aff_partner_tracking_code = w.affiliate_id
       and r.created_at between w.created_at - interval '30 minutes'
                            and w.created_at + interval '30 minutes'
     where w.stage = 'CONFIRMED'
       and w.event_name is not null
       and exists (
         select 1
           from jsonb_array_elements(
                  case when jsonb_typeof(r.event_order_info::jsonb) = 'array'
                       then r.event_order_info::jsonb
                       else jsonb_build_array(r.event_order_info::jsonb) end
                ) e
          where lower(btrim(e->>'name')) = lower(btrim(w.event_name))
       )
  ),
  paid_users as (
    select distinct user_id
      from (
        select distinct on (reservation_id) reservation_id, user_id
          from paid_matches
         order by reservation_id, gap asc
      ) one_per_reservation
  )
  select c.entry, s.stage, count(distinct s.user_id) as visitors
    from classified c
    join stages s using (user_id)
   group by 1, 2
  union all
  select c.entry, 'VISIT'::text, count(*)::bigint
    from classified c
   group by 1
  union all
  select c.entry, 'PAID'::text, count(distinct p.user_id)
    from classified c
    join paid_users p using (user_id)
   group by 1
$$;

comment on function "public"."partners_entry_funnels_all"(timestamptz, timestamptz) is
  'Funnel across ALL partners split by entry page (home / artist / event / other). Entry = first tracking row per user in the window; VISIT per segment counts every classified user; PAID = one user per now-Paid reservation (closest CONFIRMED of same partner + event name within ±30min).';

revoke all on function "public"."partners_entry_funnels_all"(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function "public"."partners_entry_funnels_all"(timestamptz, timestamptz) to service_role;

create or replace function "public"."partner_entry_funnels_range"(
  "p_tracking_code" text,
  "p_from" timestamptz default null,
  "p_to" timestamptz default null
)
returns table ("entry" text, "stage" text, "visitors" bigint)
language sql
stable
security definer
set search_path = public
as $$
  with windowed as (
    select t.user_id, t.stage, t.created_at, t.affiliate_id,
           t.data->>'path' as path,
           t.data->'data'->>'eventName' as event_name
      from public.affiliates_tracking t
     where t.user_id is not null
       and t.affiliate_id = p_tracking_code
       and (p_from is null or t.created_at >= p_from)
       and (p_to is null or t.created_at < p_to)
  ),
  entries as (
    select distinct on (user_id) user_id, stage, path
      from windowed
     order by user_id, created_at asc
  ),
  classified as (
    select user_id,
           case
             when stage is distinct from 'VISIT' then 'event'
             when path is null or path = '' or path = '/' then 'home'
             when path like '/artists%' or path like '/football%'
               or path ~ '^/c/([^/]+/)*(artists|teams)/[^/]+/?$' then 'artist'
             when path like '/order%' then 'event'
             else 'other'
           end as entry
      from entries
  ),
  stages as (
    select distinct user_id, stage
      from windowed
     where stage is distinct from 'VISIT'
  ),
  -- Same one-to-one stance as the cross-partner variant: each Paid
  -- reservation is awarded to its single closest CONFIRMED row.
  paid_matches as (
    select r.id as reservation_id, w.user_id,
           abs(extract(epoch from (r.created_at - w.created_at))) as gap
      from windowed w
      join public.reservations r
        on r.status = 'Paid'
       and r.aff_partner_tracking_code = w.affiliate_id
       and r.created_at between w.created_at - interval '30 minutes'
                            and w.created_at + interval '30 minutes'
     where w.stage = 'CONFIRMED'
       and w.event_name is not null
       and exists (
         select 1
           from jsonb_array_elements(
                  case when jsonb_typeof(r.event_order_info::jsonb) = 'array'
                       then r.event_order_info::jsonb
                       else jsonb_build_array(r.event_order_info::jsonb) end
                ) e
          where lower(btrim(e->>'name')) = lower(btrim(w.event_name))
       )
  ),
  paid_users as (
    select distinct user_id
      from (
        select distinct on (reservation_id) reservation_id, user_id
          from paid_matches
         order by reservation_id, gap asc
      ) one_per_reservation
  )
  select c.entry, s.stage, count(distinct s.user_id) as visitors
    from classified c
    join stages s using (user_id)
   group by 1, 2
  union all
  select c.entry, 'VISIT'::text, count(*)::bigint
    from classified c
   group by 1
  union all
  select c.entry, 'PAID'::text, count(distinct p.user_id)
    from classified c
    join paid_users p using (user_id)
   group by 1
$$;

comment on function "public"."partner_entry_funnels_range"(text, timestamptz, timestamptz) is
  'Entry-segmented funnel (home / artist / event / other) for ONE partner in an optional window. Entry = first tracking row per user; VISIT per segment counts every classified user; PAID = one user per now-Paid reservation (closest CONFIRMED within ±30min).';

revoke all on function "public"."partner_entry_funnels_range"(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function "public"."partner_entry_funnels_range"(text, timestamptz, timestamptz) to service_role;

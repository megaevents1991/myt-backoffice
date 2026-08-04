-- Entry-segmented funnels for the staff Partners Insights tab.
--
-- Splits the cross-partner funnel by WHERE the visitor entered the site:
-- the homepage, an artist/team page, or straight into a specific event
-- (/order/...). Entry = the user's FIRST tracking row inside the window.
--
-- Order pages historically carry no VISIT tracker (ClientTracker is mounted
-- on home/artist/football/category pages only), so a visitor who lands
-- directly on an event deep-link shows up first at a non-VISIT stage. That
-- first-row-is-not-VISIT shape therefore classifies as an 'event' entry —
-- and per-segment "Visited" counts every classified user, not VISIT rows,
-- so those direct landings are not undercounted.

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
    select t.user_id, t.stage, t.created_at, t.data->>'path' as path
      from public.affiliates_tracking t
     where t.user_id is not null
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
             when path like '/artists%' or path like '/football%' then 'artist'
             when path like '/order%' then 'event'
             else 'other'
           end as entry
      from entries
  ),
  stages as (
    select distinct user_id, stage
      from windowed
     where stage is distinct from 'VISIT'
  )
  select c.entry, s.stage, count(distinct s.user_id) as visitors
    from classified c
    join stages s using (user_id)
   group by 1, 2
  union all
  select c.entry, 'VISIT'::text, count(*)::bigint
    from classified c
   group by 1
$$;

comment on function "public"."partners_entry_funnels_all"(timestamptz, timestamptz) is
  'Funnel across ALL partners split by entry page (home / artist / event / other). Entry = first tracking row per user in the window; VISIT per segment counts every classified user.';

-- Service-role only, like the sibling insights RPCs.
revoke all on function "public"."partners_entry_funnels_all"(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function "public"."partners_entry_funnels_all"(timestamptz, timestamptz) to service_role;

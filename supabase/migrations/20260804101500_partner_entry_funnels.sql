-- Entry-segmented funnels for the staff Partners Insights tab.
--
-- Splits the cross-partner funnel by WHERE the visitor entered the site:
-- the homepage, an artist/team page, or straight into a specific event
-- (/order/...). Entry = the user's FIRST tracking row inside the window.
--
-- Order pages historically carry no VISIT tracker (ClientTracker is mounted
-- on home/artist/football/category pages only), so a visitor who lands
-- directly on an event deep-link shows up first at a non-VISIT stage. That
-- first-row-is-not-VISIT shape therefore classifies as an 'event' entry -
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
  ),
  -- Reservations carry no tracking user id, so "became paid" is a MATCH, not
  -- proof (same stance as prepared-package matching): a user's CONFIRMED row
  -- against a now-Paid reservation of the same partner and event name created
  -- within ±30 minutes. Old CONFIRMED rows without an eventName never match -
  -- an undercount, never an overcount.
  paid_users as (
    select distinct w.user_id
      from windowed w
     where w.stage = 'CONFIRMED'
       and w.event_name is not null
       and exists (
         select 1
           from public.reservations r
          where r.status = 'Paid'
            and r.aff_partner_tracking_code = w.affiliate_id
            and r.created_at between w.created_at - interval '30 minutes'
                                 and w.created_at + interval '30 minutes'
            and exists (
              select 1
                from jsonb_array_elements(
                       case when jsonb_typeof(r.event_order_info::jsonb) = 'array'
                            then r.event_order_info::jsonb
                            else jsonb_build_array(r.event_order_info::jsonb) end
                     ) e
               where lower(btrim(e->>'name')) = lower(btrim(w.event_name))
            )
       )
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
  'Funnel across ALL partners split by entry page (home / artist / event / other). Entry = first tracking row per user in the window; VISIT per segment counts every classified user; PAID = users whose CONFIRMED matched a now-Paid reservation (partner + event name + ±30min).';

-- Service-role only, like the sibling insights RPCs.
revoke all on function "public"."partners_entry_funnels_all"(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function "public"."partners_entry_funnels_all"(timestamptz, timestamptz) to service_role;

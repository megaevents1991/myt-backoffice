-- Per-partner entry-segmented funnels for the staff performance view —
-- the partner-scoped twin of partners_entry_funnels_all (same classification,
-- same PAID matching), so "how do MY visitors enter and how far do they get"
-- reads exactly like the cross-partner Insights tab.

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
  -- Same stance as the cross-partner variant: reservations carry no tracking
  -- user id, so "became paid" is a MATCH (partner + event name + ±30min),
  -- never proof; unmatched rows undercount, never overcount.
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

comment on function "public"."partner_entry_funnels_range"(text, timestamptz, timestamptz) is
  'Entry-segmented funnel (home / artist / event / other) for ONE partner in an optional window. Entry = first tracking row per user; VISIT per segment counts every classified user; PAID = users whose CONFIRMED matched a now-Paid reservation.';

revoke all on function "public"."partner_entry_funnels_range"(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function "public"."partner_entry_funnels_range"(text, timestamptz, timestamptz) to service_role;

-- What a partner's audience clicked on, for the portal dashboard.
--
-- The main app writes EVENT_SELECTED rows as
--   data = { "data": { "event": ..., "eventDate": ..., "eventLocation": ... } }
-- (app/hooks/Affiliate.tsx -> components/EventButton.tsx). Every stage nests
-- its payload under a `data` key, hence the double hop.
--
-- Aggregated in the database for the same reason as partner_funnel_counts:
-- affiliates_tracking holds a row per visitor per step, so selecting it into
-- the app would pull the partner's whole history on every dashboard load and
-- silently truncate at PostgREST's max_rows.

create or replace function "public"."partner_clicked_events"(
  "p_tracking_code" text,
  "p_limit" integer default 10
)
returns table (
  "event_name" text,
  "event_date" text,
  "event_location" text,
  "clicks" bigint,
  "visitors" bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select t.data->'data'->>'event'         as event_name,
         t.data->'data'->>'eventDate'     as event_date,
         t.data->'data'->>'eventLocation' as event_location,
         count(*)                         as clicks,
         count(distinct t.user_id)        as visitors
    from public.affiliates_tracking t
   where t.affiliate_id = p_tracking_code
     and t.stage = 'EVENT_SELECTED'
     and t.data->'data'->>'event' is not null
   group by 1, 2, 3
   -- Distinct people first: ten clicks from one person is not demand.
   order by visitors desc, clicks desc
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

comment on function "public"."partner_clicked_events"(text, integer) is
  'Events a partner''s visitors clicked into, ranked by distinct visitors. Reads the EVENT_SELECTED payload the main app writes into affiliates_tracking.data.';

revoke all on function "public"."partner_clicked_events"(text, integer) from public, anon, authenticated;
grant execute on function "public"."partner_clicked_events"(text, integer) to service_role;

-- The funnel and clicked-events queries both filter on affiliate_id + stage.
create index if not exists "affiliates_tracking_affiliate_stage_idx"
  on "public"."affiliates_tracking" ("affiliate_id", "stage");

-- Redundant once the composite above exists: a leading-column prefix serves
-- every query the single-column index did, and this table takes a row per
-- visitor per step, so the write cost is not worth paying twice.
drop index if exists "public"."affiliates_tracking_affiliate_idx";

-- Partner marketing insights: time-windowed funnel + clicked-events.
--
-- affiliates_tracking has carried created_at since day one, but both existing
-- RPCs aggregate the whole history and the column is unindexed — so "this
-- week vs this month" questions were unanswerable. New *_range variants take
-- an optional window; the originals stay untouched (the partner portal keeps
-- calling them), so nothing existing changes behavior.

create index if not exists "affiliates_tracking_affiliate_created_idx"
  on "public"."affiliates_tracking" ("affiliate_id", "created_at");

create or replace function "public"."partner_funnel_counts_range"(
  "p_tracking_code" text,
  "p_from" timestamptz default null,
  "p_to" timestamptz default null
)
returns table ("stage" text, "visitors" bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.stage, count(distinct t.user_id) as visitors
    from public.affiliates_tracking t
   where t.affiliate_id = p_tracking_code
     and (p_from is null or t.created_at >= p_from)
     and (p_to is null or t.created_at < p_to)
   group by t.stage;
$$;

comment on function "public"."partner_funnel_counts_range"(text, timestamptz, timestamptz) is
  'partner_funnel_counts with an optional created_at window. Distinct visitors per stage.';

create or replace function "public"."partner_clicked_events_range"(
  "p_tracking_code" text,
  "p_from" timestamptz default null,
  "p_to" timestamptz default null,
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
     and (p_from is null or t.created_at >= p_from)
     and (p_to is null or t.created_at < p_to)
   group by 1, 2, 3
   order by visitors desc, clicks desc
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

comment on function "public"."partner_clicked_events_range"(text, timestamptz, timestamptz, integer) is
  'partner_clicked_events with an optional created_at window. Groups by event name+date+location (tracking carries no event id).';

-- Service-role only, like the originals — called from backoffice actions.
revoke all on function "public"."partner_funnel_counts_range"(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function "public"."partner_funnel_counts_range"(text, timestamptz, timestamptz) to service_role;
revoke all on function "public"."partner_clicked_events_range"(text, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function "public"."partner_clicked_events_range"(text, timestamptz, timestamptz, integer) to service_role;

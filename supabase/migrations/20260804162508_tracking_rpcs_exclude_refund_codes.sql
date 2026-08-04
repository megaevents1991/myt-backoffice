-- Customer-refund pseudo-partners must not count as partner TRAFFIC either.
--
-- The main app auto-creates a "partner" row (name marked "ניתן להתעלם") for
-- every order, and refunded customers browse with that personal code — so
-- affiliates_tracking carries their sessions. Reservations/commission math
-- already excludes those codes (see CUSTOMER_REFUND_NAME_MARKER); this brings
-- the cross-partner tracking RPCs in line, so funnels, visitor counts and
-- hot-events stop counting refund-credit browsing as partner marketing.
-- (Found 2026-08-04: "9 partners" on a hot event were 6 real + 3 refund codes.)
--
-- The name marker is the source of truth — `type` arrives unset on fresh rows
-- (see types/partner.types.ts) — but a correctly-typed row is excluded too.

create or replace function "public"."tracking_code_is_real_partner"("p_code" text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
      from public.partners p
     where p.partner_tracking_code = p_code
       and (coalesce(p.name_hebrew, '') like '%ניתן להתעלם%'
            or p.type = 'customer_refund')
  )
$$;

revoke all on function "public"."tracking_code_is_real_partner"(text) from public, anon, authenticated;
grant execute on function "public"."tracking_code_is_real_partner"(text) to service_role;

create or replace function "public"."partners_funnel_counts_all"(
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
   where (p_from is null or t.created_at >= p_from)
     and (p_to is null or t.created_at < p_to)
     and public.tracking_code_is_real_partner(t.affiliate_id)
   group by t.stage;
$$;

create or replace function "public"."partners_clicked_events_all"(
  "p_from" timestamptz default null,
  "p_to" timestamptz default null,
  "p_limit" integer default 12
)
returns table (
  "event_name" text,
  "event_date" text,
  "event_location" text,
  "clicks" bigint,
  "visitors" bigint,
  "partners" bigint
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
         count(distinct t.user_id)        as visitors,
         count(distinct t.affiliate_id)   as partners
    from public.affiliates_tracking t
   where t.stage = 'EVENT_SELECTED'
     and t.data->'data'->>'event' is not null
     and (p_from is null or t.created_at >= p_from)
     and (p_to is null or t.created_at < p_to)
     and public.tracking_code_is_real_partner(t.affiliate_id)
   group by 1, 2, 3
   order by visitors desc, clicks desc
   limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

create or replace function "public"."partners_visitors_by_code"(
  "p_from" timestamptz default null,
  "p_to" timestamptz default null
)
returns table ("affiliate_id" text, "visitors" bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.affiliate_id, count(distinct t.user_id) as visitors
    from public.affiliates_tracking t
   where t.stage = 'VISIT'
     and (p_from is null or t.created_at >= p_from)
     and (p_to is null or t.created_at < p_to)
     and public.tracking_code_is_real_partner(t.affiliate_id)
   group by t.affiliate_id;
$$;

comment on function "public"."partners_funnel_counts_all"(timestamptz, timestamptz) is
  'Funnel across ALL real partners (refund pseudo-codes excluded) in an optional created_at window. Distinct visitors per stage.';
comment on function "public"."partners_clicked_events_all"(timestamptz, timestamptz, integer) is
  'Hot events across real-partner traffic (refund pseudo-codes excluded) in an optional window, incl. distinct partners driving clicks.';
comment on function "public"."partners_visitors_by_code"(timestamptz, timestamptz) is
  'Distinct VISIT visitors per real-partner tracking code (refund pseudo-codes excluded) — feeds per-partner conversion on the staff Insights tab.';

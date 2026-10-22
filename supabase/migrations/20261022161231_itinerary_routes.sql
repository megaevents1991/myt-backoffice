-- Build Your Euro Trip, round 2 - staff-built trips (the "Euro Trip" tab of /events). 22.10.2026.
-- Spec: myt-main, branch feat/multi-event-itinerary,
--       docs/superpowers/specs/2026-10-22-euro-trip-round-2-design.md  (section A1)
--
-- (1) itinerary_routes - one row per trip that staff build by hand: a Hebrew title and 2-3 events. The trips
--     lead the public Euro Trip hub (/euro-trip), ahead of the automatic routes.
--     WRITTEN by the backoffice (lib/actions/itinerary-routes-actions.ts, screen /events/trips, service role;
--     create / update / delete, the audit log keeps what was deleted);
--     READ by myt-main server-side (lib/itinerary/routes.server.ts, service role, cached under the
--     `itinerary-routes` tag): active rows ordered by sort_order, id.
--     event_ids is in staff order; the site sorts the events by date anyway. A row is a SUGGESTION, not a
--     promise: myt-main shows it only while every event is still on sale and the events still fit each other
--     (distance, gaps), otherwise the trip silently drops off the hub. The row is never touched for that.
--     is_active = false hides a trip from the site and keeps it in the backoffice. Rows are deleted for real
--     (a trip is not an event).
--     NO ROWS ARE SEEDED ON PURPOSE: an empty table = no staff trips = the hub shows the automatic routes only.
--     Both readers also tolerate the table not existing yet. RLS is on with no policies = service role only
--     (anon and authenticated see nothing); the grants are taken away as well, like itinerary_settings, so a
--     policy added by mistake later cannot open the table.
--
-- Additive only: a new table and one index. Idempotent: safe to re-run.
-- Rollback (by hand, outside the CLI): supabase/rollback/20261022161231_itinerary_routes.sql

-- ---------------------------------------------------------------------------------------------------------
-- (1) Staff trips
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.itinerary_routes (
  id         bigint generated always as identity primary key,
  title      text not null,
  event_ids  bigint[] not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- title: 2..80 characters once trimmed. event_ids: 2 or 3 events (an empty array has no first dimension, so
-- array_length is NULL and a bare CHECK would pass it - hence the coalesce). Guarded so a re-run of this file
-- does not fail on the existing names.
do $$
begin
  alter table public.itinerary_routes
    add constraint itinerary_routes_title_len_chk
    check (char_length(btrim(title)) between 2 and 80);
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.itinerary_routes
    add constraint itinerary_routes_event_ids_len_chk
    check (coalesce(array_length(event_ids, 1), 0) between 2 and 3);
exception
  when duplicate_object then null;
end
$$;

-- The one read: active trips in staff order (is_active, sort_order, id).
create index if not exists itinerary_routes_active_sort_idx
  on public.itinerary_routes (is_active, sort_order, id);

alter table public.itinerary_routes enable row level security;
revoke all on public.itinerary_routes from anon, authenticated;

comment on table public.itinerary_routes is
  'Euro Trip (multi-event itinerary) staff-built trips: a Hebrew title and 2-3 events, shown first on the public hub while every event still fits. Written by the backoffice (/events/trips), read by myt-main (lib/itinerary/routes.server.ts). Service role only (RLS on, no policies).';
comment on column public.itinerary_routes.id is
  'Trip id, generated.';
comment on column public.itinerary_routes.title is
  'Hebrew trip title shown on the hub card instead of the event names. 2..80 characters after trimming (CHECK).';
comment on column public.itinerary_routes.event_ids is
  'events.id of the trip, 2 or 3 of them (CHECK), in staff order - the site sorts by date anyway. No foreign key (arrays cannot have one): the backoffice action validates that every id is an existing non-deleted event, and myt-main skips a trip whose event is gone, sold out or no longer fits.';
comment on column public.itinerary_routes.sort_order is
  'Position on the hub among staff trips, lower first (ties by id).';
comment on column public.itinerary_routes.is_active is
  'false = hidden from the site, kept in the backoffice.';
comment on column public.itinerary_routes.created_at is
  'Creation time.';
comment on column public.itinerary_routes.updated_at is
  'Last save, set by the backoffice action.';
comment on column public.itinerary_routes.updated_by is
  'Staff user (auth user id) who last saved it. No foreign key, like itinerary_settings.';

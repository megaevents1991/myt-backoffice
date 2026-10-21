-- Build Your Euro Trip - multi-event itinerary, core DB objects. 21.10.2026.
-- Spec: myt-main, branch feat/multi-event-itinerary,
--       docs/superpowers/specs/2026-10-21-multi-event-itinerary-design.md  (section 8.1 settings, 8.3 reservations)
--
-- (1) itinerary_settings - the staff switches and numbers of the feature, a key/value table in the shape of
--     marketing_settings. WRITTEN by the backoffice (Templates > routes > settings, service role, a later task);
--     READ by myt-main server-side (lib/itinerary/settings.ts `parseItinerarySettings`, service role, cached
--     under the `itinerary-settings` tag). Keys (snake_case) and the defaults myt-main applies to a missing row:
--       enabled false, payments_enabled false, tier_2_pct 30, tier_3_pct 50, max_events 3, max_km 1000,
--       best_km 600, ok_gap_days 5, max_gap_days 10, max_span_days 21, max_auto_routes 12.
--     NO ROWS ARE SEEDED ON PURPOSE: an empty table = every default above = the feature is OFF. A row exists
--     only once staff save that setting. RLS is on with no policies = service role only (anon and
--     authenticated see nothing); the grants are taken away as well, like uploader_runs, so a policy added
--     by mistake later cannot open the table.
--
-- (2) reservations - three nullable columns that tie the rows of one trip together. WRITTEN by
--     myt-main POST /api/itinerary/confirm (ONE row per event of the trip, one bulk insert, all rows share the group);
--     READ by the backoffice (list chip "route 1/2", detail panel linking the sibling reservations) and by
--     the group payment. A single-event reservation keeps all three NULL, so every existing row and every
--     existing reader is untouched.
--
-- Additive only: a new table and nullable columns with no default (a metadata-only change; the unique index
-- is partial and starts empty). Idempotent: safe to re-run.
-- Rollback (by hand, outside the CLI): supabase/rollback/20261021193309_itinerary_core.sql

-- ---------------------------------------------------------------------------------------------------------
-- (1) Staff settings
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.itinerary_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.itinerary_settings enable row level security;
revoke all on public.itinerary_settings from anon, authenticated;

comment on table public.itinerary_settings is
  'Euro Trip (multi-event itinerary) staff settings, key/value jsonb. Written by the backoffice, read by myt-main (parseItinerarySettings). Empty table = every default = feature off. Service role only (RLS on, no policies).';
comment on column public.itinerary_settings.key is
  'Setting name, snake_case: enabled, payments_enabled, tier_2_pct, tier_3_pct, max_events, max_km, best_km, ok_gap_days, max_gap_days, max_span_days, max_auto_routes.';
comment on column public.itinerary_settings.value is
  'The setting as jsonb (boolean or number). Validated by the reader, which falls back to the default on anything it does not understand.';
comment on column public.itinerary_settings.updated_at is
  'Last save, set by the backoffice action.';
comment on column public.itinerary_settings.updated_by is
  'Staff user (auth user id) who saved it. No foreign key, like marketing_settings.';

-- ---------------------------------------------------------------------------------------------------------
-- (2) Reservation group columns
-- ---------------------------------------------------------------------------------------------------------
alter table public.reservations
  add column if not exists itinerary_group uuid,
  add column if not exists itinerary_seq   smallint,
  add column if not exists itinerary_of    smallint;

comment on column public.reservations.itinerary_group is
  'Euro Trip: uuid shared by every reservation row of one multi-event trip (one row per event). NULL on a single-event reservation. Written by myt-main /api/itinerary/confirm, read by the backoffice and the group payment.';
comment on column public.reservations.itinerary_seq is
  'Euro Trip: this row''s place in the trip, 1-based in date order (seq 1 carries the whole flight). NULL on a single-event reservation. Written by myt-main /api/itinerary/confirm.';
comment on column public.reservations.itinerary_of is
  'Euro Trip: how many events (rows) the trip has, 2 or 3 (the "1/2" in the route chip). NULL on a single-event reservation. Written by myt-main /api/itinerary/confirm.';

-- seq 1..of and of 2..3 - checked only when both are set (a plain CHECK passes a NULL operand anyway, so a
-- single-event row is never touched). Guarded so a re-run of this file does not fail on the existing name.
do $$
begin
  alter table public.reservations
    add constraint reservations_itinerary_seq_of_chk
    check (
      itinerary_seq is null
      or itinerary_of is null
      or (itinerary_of between 2 and 3 and itinerary_seq between 1 and itinerary_of)
    );
exception
  when duplicate_object then null;
end
$$;

-- One row per (trip, place): a retry or a double submit can never write seq 1 of the same group twice.
-- Partial, so the many single-event rows are not indexed; it also serves every lookup by group.
create unique index if not exists reservations_itinerary_group_seq_uidx
  on public.reservations (itinerary_group, itinerary_seq)
  where itinerary_group is not null;

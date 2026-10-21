-- MANUAL ROLLBACK for the migration of 2026-10-21:
--   20261021193309_itinerary_core   (itinerary_settings + reservations.itinerary_group / itinerary_seq / itinerary_of)
--
-- This file lives OUTSIDE supabase/migrations on purpose: the CLI never runs it.
-- Run it by hand (SQL editor or psql) only when the migration must be undone, then mark the version
-- as reverted so the history matches the schema:
--   npx supabase migration repair --status reverted 20261021193309
-- and remove (or revert the commit of) the migration file on master, otherwise the next push applies it again.
--
-- Order matters only for readability: index, constraint, columns, table. Every statement is `if exists`,
-- so a half-applied migration rolls back cleanly and a second run is a no-op.
--
-- WHAT IS LOST: the trip links of every grouped reservation (itinerary_group / _seq / _of) - the reservation
-- rows themselves, their payments and their tickets stay. If trips were already sold, export
-- `select id, itinerary_group, itinerary_seq, itinerary_of from reservations where itinerary_group is not null`
-- first. Also lost: any itinerary_settings rows staff saved (an empty table = defaults, so nothing else breaks).
-- Switch the feature off first (itinerary_settings.enabled = false) so myt-main stops writing the columns;
-- while they are gone, /api/itinerary/confirm fails closed instead of writing an orphan row.

begin;

drop index if exists public.reservations_itinerary_group_seq_uidx;

alter table public.reservations
  drop constraint if exists reservations_itinerary_seq_of_chk;

alter table public.reservations
  drop column if exists itinerary_of,
  drop column if exists itinerary_seq,
  drop column if exists itinerary_group;

drop table if exists public.itinerary_settings;

commit;

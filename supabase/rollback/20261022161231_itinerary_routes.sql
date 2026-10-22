-- MANUAL ROLLBACK for the migration of 2026-10-22:
--   20261022161231_itinerary_routes   (itinerary_routes - the staff-built Euro Trip trips)
--
-- This file lives OUTSIDE supabase/migrations on purpose: the CLI never runs it.
-- Run it by hand (SQL editor or psql) only when the migration must be undone, then mark the version
-- as reverted so the history matches the schema:
--   npx supabase migration repair --status reverted 20261022161231
-- and remove (or revert the commit of) the migration file on master, otherwise the next push applies it again.
--
-- The statement is `if exists`, so a half-applied migration rolls back cleanly and a second run is a no-op.
-- Dropping the table drops its two CHECK constraints, its index and its comments with it.
--
-- WHAT IS LOST: every staff trip (title, events, order). export first if you want them back:
--   select * from public.itinerary_routes order by sort_order, id;
-- Nothing else depends on the table. myt-main (lib/itinerary/routes.server.ts) and the backoffice screen
-- (/events/trips) both treat a missing table as "no staff trips", so the hub falls back to the automatic
-- routes and the trips page shows its info message instead of crashing.

begin;

drop table if exists public.itinerary_routes;

commit;

-- MANUAL ROLLBACK for the migration of 2026-10-24:
--   20261024084720_itinerary_route_requests   (itinerary_route_requests - customers' "suggest my trip" offers)
--
-- This file lives OUTSIDE supabase/migrations on purpose: the CLI never runs it.
-- Run it by hand (SQL editor or psql) only when the migration must be undone, then mark the version
-- as reverted so the history matches the schema:
--   npx supabase migration repair --status reverted 20261024084720
-- and remove (or revert the commit of) the migration file on master, otherwise the next push applies it again.
--
-- The statement is `if exists`, so a half-applied migration rolls back cleanly and a second run is a no-op.
-- Dropping the table drops its CHECK / UNIQUE constraints, its foreign key to itinerary_routes, its index and
-- its comments with it. itinerary_routes itself is not touched.
--
-- WHAT IS LOST: every customer suggestion (name, events, contact, status). Export first if you want them back:
--   select * from public.itinerary_route_requests order by created_at;
-- Nothing else depends on the table. myt-main (app/api/itinerary/confirm) skips the write when the table is
-- missing (the hold is never affected), and the backoffice screen (/events/trips/requests) shows its info
-- message instead of crashing.

begin;

drop table if exists public.itinerary_route_requests;

commit;

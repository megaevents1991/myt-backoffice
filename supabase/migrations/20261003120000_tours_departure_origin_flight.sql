-- A sub-tour (departure) created from a flight block remembers that block.
--
-- Offline Flights > New Series, ticked "Organized tour" with a tour code, creates
-- one departure per flight of the series (lib/actions/tours-flight-series-actions.ts).
-- The link lets the departure follow its flight when the airline moves it, while the
-- departure has no sales (lib/tours/flight-sync.ts), and lets Approvals list the
-- departures whose dates no longer match their flight.
--
-- Additive only: departures created before this, or by hand, keep null. Nothing that
-- Mega Events reads changes; public.flights gets no column and no trigger.
-- Rollback: section 13 of supabase/rollback/20261001_multi_company.sql.

alter table tours.departures
  add column if not exists origin_flight_id bigint references public.flights(id) on delete set null;

create index if not exists departures_origin_flight_idx
  on tours.departures (origin_flight_id)
  where origin_flight_id is not null;

comment on column tours.departures.origin_flight_id is
  'The flight block this departure was created from (Offline Flights > New Series, organized tour). Its dates follow the flight while the departure has no sales.';

-- `flights.stops` counted the stops of the whole round trip, while the stopover
-- itself is stored per direction (`outbound_stop_airport` / `inbound_stop_airport`).
-- Nothing kept the two in step, so a flight could carry a stopover airport and
-- still sell itself as direct, or claim a stop it had no airport for. A
-- direction holds at most one stopover airport, so the count is fully derivable
-- — derive it instead of asking four different write paths to remember.
--
-- A trigger rather than a generated column: `stops` is NOT NULL and is written
-- by every existing insert path (both flight forms, the series builder, bulk
-- edit). A generated column would reject all of them; the trigger simply
-- overwrites whatever they send.

create or replace function public.flights_derive_stops()
returns trigger
language plpgsql
as $$
begin
  new.stops := greatest(
    case when nullif(btrim(new.outbound_stop_airport), '') is null then 0 else 1 end,
    case when nullif(btrim(new.inbound_stop_airport), '') is null then 0 else 1 end
  );
  return new;
end;
$$;

drop trigger if exists flights_derive_stops_trg on public.flights;
create trigger flights_derive_stops_trg
  before insert or update on public.flights
  for each row execute function public.flights_derive_stops();

-- Bring existing rows in line with the rule. A no-op on today's data (no row
-- has a stopover set) but it makes the invariant true rather than assumed.
update public.flights set stops = stops;

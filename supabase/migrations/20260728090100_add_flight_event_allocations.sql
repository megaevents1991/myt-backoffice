-- Offline flights expansion, phase B: per-event seat quotas.
--
-- No backfill: an event with no row here keeps drawing on the flight's global
-- pool, exactly as before. The hard cap applies only where a row exists.

create table if not exists "public"."flight_event_allocations" (
  "id"              bigint generated always as identity primary key,
  "flight_id"       bigint not null references "public"."flights"("id") on delete cascade,
  "event_id"        bigint not null references "public"."events"("id") on delete cascade,
  "allocated_seats" integer not null check ("allocated_seats" >= 0),
  "created_at"      timestamptz not null default now(),
  unique ("flight_id", "event_id")
);

create index if not exists "flight_event_allocations_event_id_idx"
  on "public"."flight_event_allocations" ("event_id");

-- Consumed seats are DERIVED, never stored. flights.consumed_quantity already
-- drifts (hence reconcileFlightInventory); a second counter written from the
-- other repo would be a second source of drift. Reservations are the one truth,
-- so app/api/confirm-order in myt-main needs no change at all.
--
-- The status list mirrors ACTIVE_RESERVATION_STATUSES_FILTER in
-- lib/actions/reservation-actions.ts.
create or replace view "public"."flight_event_consumed" as
select
  "offline_flight_id" as "flight_id",
  "event_id",
  sum(coalesce(("flight_order_info"->>'numOfTravelers')::int, 0))::int as "consumed_seats"
from "public"."reservations"
where "offline_flight_id" is not null
  and "status" not in ('Cancelled', 'Lost')
group by 1, 2;

-- Both apps connect with the service role.
grant select on "public"."flight_event_consumed" to "service_role";
grant select, insert, update, delete on "public"."flight_event_allocations" to "service_role";

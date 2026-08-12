-- Offline flights expansion, phase C: LOCKFLIGHT.
--
-- A locked package sells exactly one offline flight and never queries Amadeus.
-- ON DELETE SET NULL: hard-deleting a flight row must not take the event with
-- it - the event simply reverts to a normal, searchable package.

alter table "public"."events"
  add column "locked_flight_id" bigint
  references "public"."flights"("id") on delete set null;

create index if not exists "events_locked_flight_id_idx"
  on "public"."events" ("locked_flight_id");

comment on column "public"."events"."locked_flight_id" is
  'When set, the main app offers only this offline flight and skips Amadeus. Sold out = no flights, no fallback.';

-- Offline flights expansion, phase A: the fields the operations Excel carries
-- that the `flights` table never had. All nullable — existing rows unaffected.

alter table "public"."flights"
  add column "cost_price"             numeric(10,2),
  add column "cost_currency"          varchar(3),
  add column "supplier"               text,
  add column "pnr"                    text,
  add column "group_code"             text,
  add column "ticketing_deadline"     date,
  add column "last_cancellation_date" date,
  add column "payment_deadline"       date,
  add column "option_expiry"          date,
  add column "checked_bag_kg"         integer,
  add column "cabin_bag_kg"           integer,
  add column "cabin_class"            text,
  add column "aircraft_type"          text,
  add column "block_status"           text,
  add column "notes"                  text,
  add column "handled_by"             text,
  add column "series_id"              uuid,
  add column "series_name"            text,
  add column "outbound_stop_airport"  varchar(3),
  add column "outbound_stop_duration" interval,
  add column "inbound_stop_airport"   varchar(3),
  add column "inbound_stop_duration"  interval;

comment on column "public"."flights"."cost_price" is
  'What we pay the supplier. `price` stays the selling price. Backoffice-only — never part of the customer price chain.';

alter table "public"."flights"
  add constraint "flights_block_status_check"
  check ("block_status" is null or "block_status" in ('option', 'confirmed', 'ticketed'));

-- Connecting flights were impossible to store while this held stops at 0.
alter table "public"."flights" drop constraint if exists "flights_stops_check";
alter table "public"."flights"
  add constraint "flights_stops_check" check ("stops" >= 0);

create index if not exists "flights_series_id_idx" on "public"."flights" ("series_id");

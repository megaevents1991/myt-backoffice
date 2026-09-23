-- Lodging cities (spec docs/superpowers/specs/2026-09-20-lodging-destinations-design.md, parts B-min + C).
-- Flight city = events.location (unchanged). Event city = event_location (null = same city).
-- lodging_mode: flight_city (today) | event_city_only | choice | choice_split. No CHECK - validated in the backoffice.
alter table public.events
  add column if not exists event_location jsonb,
  add column if not exists lodging_mode text not null default 'flight_city',
  add column if not exists lodging_default text not null default 'flight',
  add column if not exists lodging_note text,
  add column if not exists split_default_nights smallint not null default 2;

comment on column public.events.event_location is
  '{name, latitude, longitude, country_code?} - the city of the match/show when it differs from the flight city (events.location). null = same.';
comment on column public.events.lodging_mode is
  'flight_city | event_city_only | choice | choice_split - what the hotel step offers.';
comment on column public.events.lodging_default is
  'flight | event - which city the hotel list opens on.';
comment on column public.events.split_default_nights is
  '1 or 2 - nights in the event city our split proposes (2 = night before + event night).';

-- A split stay = one hotel per city segment. hotel_order_info keeps the FIRST segment (every
-- existing reader stays correct); hotel_segments carries all of them (OrderHotel[] with city).
alter table public.reservations
  add column if not exists hotel_segments jsonb;
comment on column public.reservations.hotel_segments is
  'OrderHotel[] with {city, cityName} per segment for a split stay; null = single hotel (hotel_order_info).';

-- Warm-up bookkeeping for main POST /api/hotels-warm: one row per (rounded point, radius).
-- Backoffice-only: RLS on, no policies, service-role access.
create table if not exists public.hotel_warm_areas (
  id          bigserial primary key,
  name        text,
  latitude    numeric(9,6) not null,
  longitude   numeric(9,6) not null,
  radius      integer not null default 2000,
  found       integer not null default 0,
  existing    integer not null default 0,
  loaded      integer not null default 0,
  remaining   integer not null default 0,
  error       text,
  warmed_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (latitude, longitude, radius)
);
alter table public.hotel_warm_areas enable row level security;

-- A specific ticket+flight+hotel combination an agent/influencer put
-- together for a follower, shared as a link that lands the follower
-- straight on that exact package instead of the empty search page.
--
-- Column shapes deliberately mirror `reservations.event_order_info` /
-- `flight_order_info` / `hotel_order_info` - myt-main already round-trips
-- these exact JSON shapes (Flight / OrderHotel / a flattened ticket object)
-- through a DB column today (confirm-order writes them, find-order reads
-- them back unchanged), so this reuses a shape already proven to survive
-- the trip rather than inventing a new one.
--
-- Never a financial commitment on its own - nothing here is charged. A
-- follower opening the link still goes through the normal confirm-order /
-- payment path, which re-validates everything from trusted, live data the
-- same way it already does for every other order. This table only saves
-- the partner a re-selection step; it does not widen what they can charge.

create table if not exists "public"."prepared_packages" (
  "id" bigint generated always as identity primary key,
  -- Opaque, unguessable - used in the shared link and looked up by
  -- myt-main instead of the sequential "id" above, so a package can't be
  -- enumerated by walking integers.
  "share_token" text not null unique,
  "partner_tracking_code" text not null
    references "public"."partners"("partner_tracking_code") on delete cascade,
  "created_by" uuid,
  "event_id" bigint not null,
  "event_order_info" jsonb not null,
  "flight_order_info" jsonb,
  "flight_skipped" boolean not null default false,
  "hotel_order_info" jsonb,
  "hotel_skipped" boolean not null default false,
  "num_travelers" integer not null default 1,
  "created_at" timestamptz not null default now()
);

create index if not exists "prepared_packages_partner_idx"
  on "public"."prepared_packages" ("partner_tracking_code");

create index if not exists "prepared_packages_event_idx"
  on "public"."prepared_packages" ("event_id");

create index if not exists "prepared_packages_share_token_idx"
  on "public"."prepared_packages" ("share_token");

-- Service-role only, like every other table here.
alter table "public"."prepared_packages" enable row level security;

comment on table "public"."prepared_packages" is
  'A specific ticket+flight+hotel combination an agent/influencer prepared and shared as a link. Read/re-validated (never trusted outright) by myt-main when a follower opens it - see app/api/package/[id]/route.ts.';

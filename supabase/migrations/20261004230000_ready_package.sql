-- Ready package ("חבילה מוכנה", spec docs/superpowers/specs/2026-10-04-ready-package-design.md).
--
-- A prepared package that belongs to the HOUSE instead of a partner, attached
-- to an event: a click on the event card lands the customer on the order
-- summary with this exact ticket + flight + hotel already chosen. It is the
-- prepared-package link feature with three additions - an owner-less row, an
-- event-level switch, and a nightly refresh that keeps it priced.
--
-- Nothing here changes an existing row's behaviour: every package stays
-- `kind = 'partner'`, every event stays `ready_package_mode = 'off'`.

-- 1. prepared_packages ------------------------------------------------------

-- Three steps, per .claude/rules/migrations.md: nullable -> backfill -> default + not null.
alter table "public"."prepared_packages"
  add column if not exists "kind" text;

update "public"."prepared_packages"
  set "kind" = 'partner'
  where "kind" is null;

alter table "public"."prepared_packages"
  alter column "kind" set default 'partner';

alter table "public"."prepared_packages"
  alter column "kind" set not null;

-- A house package has no partner and earns no commission. The FK stays: a
-- partner row's package still dies with its partner.
alter table "public"."prepared_packages"
  alter column "partner_tracking_code" drop not null;

alter table "public"."prepared_packages"
  add column if not exists "spec" jsonb,
  add column if not exists "variants" jsonb,
  add column if not exists "max_travelers" integer,
  add column if not exists "refreshed_at" timestamptz,
  add column if not exists "refresh_status" text,
  add column if not exists "refresh_note" text;

comment on column "public"."prepared_packages"."kind" is
  '''partner'' (default) = a partner''s shared link. ''house'' = a ready package attached to an event (events.ready_package_token); no partner, no commission.';
comment on column "public"."prepared_packages"."spec" is
  'House packages only: the IDENTITY of each piece (ticket id + category, flight numbers + times or offline id, hotel id + room + meal + dates). What a refresh looks for. Shape: types/ready-package.types.ts ReadyPackageSpec.';
comment on column "public"."prepared_packages"."variants" is
  'House packages only: { "<travellers>": { event_order_info, flight_order_info, flight_skipped, hotel_order_info, hotel_skipped, ... } } - one priced composition per party size. The top-level *_order_info columns hold the default size.';
comment on column "public"."prepared_packages"."max_travelers" is
  'House packages only: top of the traveller picker on the site.';
comment on column "public"."prepared_packages"."refresh_status" is
  'House packages only: ok / partial (some sizes missing) / broken (the default size cannot be served).';

create index if not exists "prepared_packages_house_event_idx"
  on "public"."prepared_packages" ("event_id")
  where "kind" = 'house';

-- 2. events -----------------------------------------------------------------

-- A constant default fills existing rows without rewriting them (and without
-- firing a row trigger on every event). No NOT NULL and no CHECK on purpose:
-- readers treat anything but 'preview' / 'live' as off, and a later mode needs
-- no migration.
alter table "public"."events"
  add column if not exists "ready_package_token" text,
  add column if not exists "ready_package_mode" text default 'off',
  add column if not exists "ready_package_price_usd" numeric;

comment on column "public"."events"."ready_package_token" is
  'share_token of the house prepared_packages row this event opens on. Null = none.';
comment on column "public"."events"."ready_package_mode" is
  '''off'' (default) = regular flow. ''preview'' = only the staff link (?ready=<token>) opens the package. ''live'' = a click on the event card opens it.';
comment on column "public"."events"."ready_package_price_usd" is
  'Per-person price of the ready package at its default party size, rewritten by the nightly refresh. In ''live'' the site card shows it instead of the computed "from" price.';

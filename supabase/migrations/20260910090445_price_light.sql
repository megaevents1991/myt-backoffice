-- Price light (רמזור): competitor catalogs we crawl ourselves, the match per
-- event, our daily price snapshots, and the two lights on the event.
-- Spec: docs/superpowers/specs/2026-09-09-price-light-design.md §1.
-- No CHECK constraints (repo rule) - values validated in lib/services/price-light*.ts.

alter table public.events
  add column if not exists light_package        text,
  add column if not exists light_ticket         text,
  add column if not exists light_detail         jsonb,
  add column if not exists light_checked_at     timestamptz,
  add column if not exists light_silenced_until timestamptz,
  add column if not exists price_drop_usd       integer,
  add column if not exists price_drop_from      integer,
  add column if not exists price_drop_until     date;

create index if not exists events_light_package_idx
  on public.events (light_package) where is_deleted is null;

-- One crawl of one competitor site.
create table if not exists public.competitor_crawl_runs (
  id            bigserial primary key,
  competitor    text not null,          -- liveevents|issta|golasso|ontour|livetickets
  status        text not null,          -- running|ok|partial|blocked|error|skipped
  trigger       text not null,          -- schedule|manual|dry_run
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  pages         integer not null default 0,
  listings      integer not null default 0,
  prev_listings integer,
  note          text,
  browser_mode  text                    -- remote|local|fetch|table
);
create index if not exists ccr_comp_idx
  on public.competitor_crawl_runs (competitor, started_at desc);
alter table public.competitor_crawl_runs enable row level security;

-- The competitor's catalog, ours to keep.
create table if not exists public.competitor_listings (
  id              bigserial primary key,
  competitor      text not null,
  external_key    text not null,
  scope           text not null,        -- package|ticket
  title           text not null,
  title_he        text,
  event_date      date,
  city            text,
  venue           text,
  price_from      numeric,
  currency        text,                 -- ILS|USD|EUR|GBP
  price_usd       numeric,
  travel_depart   date,
  travel_return   date,
  attrs           jsonb,
  detail_text     text,
  url             text not null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  run_id          bigint references public.competitor_crawl_runs(id) on delete set null,
  unique (competitor, external_key)
);
create index if not exists cl_date_idx
  on public.competitor_listings (competitor, event_date);
alter table public.competitor_listings enable row level security;

-- Our event <-> their listing. A new row only when something changed.
create table if not exists public.competitor_matches (
  id                 bigserial primary key,
  event_id           integer not null references public.events(id) on delete cascade,
  competitor         text not null,
  scope              text not null,
  listing_id         bigint references public.competitor_listings(id) on delete set null,
  status             text not null,     -- found|not_selling|unsure|na|skipped
  method             text not null,     -- rule|ai|manual|api
  ai_verdict         jsonb,
  raw_price          numeric,
  raw_currency       text,
  price_usd          numeric,
  normalized_usd     numeric,
  adjustments        jsonb,
  attrs              jsonb,
  our_usd            numeric,
  diff_usd           numeric,
  light              text,
  listing_changed_at timestamptz,
  note               text,
  created_at         timestamptz not null default now()
);
create index if not exists cm_event_idx
  on public.competitor_matches (event_id, created_at desc);
create index if not exists cm_listing_idx
  on public.competitor_matches (listing_id);
alter table public.competitor_matches enable row level security;

-- Our own total price, once a day - the proof behind the "price drop" tag.
create table if not exists public.event_price_snapshots (
  event_id     integer not null references public.events(id) on delete cascade,
  day          date not null,
  package_usd  integer,
  ticket_usd   integer,
  min_ticket   integer,
  base_flight  integer,
  base_hotel   integer,
  markup       integer,
  primary key (event_id, day)
);
alter table public.event_price_snapshots enable row level security;

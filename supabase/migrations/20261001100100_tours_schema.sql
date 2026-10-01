-- Product type "tours" (first tenant: Mega Family). ADDITIVE ONLY: a new schema.
-- Spec: mega-family/docs/plans/MEGA-FAMILY-DATA-SPEC.md (section 2).
--
-- Every table carries company_id. Nothing in `public` is altered here.
-- Access: service_role only. The schema is not granted to anon/authenticated,
-- and RLS is enabled with no policies as a second lock.
--
-- Rollback: supabase/rollback/20261001_multi_company.sql

create schema if not exists tours;
grant usage on schema tours to service_role;
alter default privileges in schema tours grant all on tables to service_role;
alter default privileges in schema tours grant all on sequences to service_role;

-- ---------------------------------------------------------------- catalog
create table if not exists tours.terms (              -- destinations|audiences|tags|groups|artists|villages|categories|seasons
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind text not null,
  slug text not null,
  name text not null,
  description_html text,
  hero_images text[] not null default '{}',
  position int not null default 0,
  legacy_id int,                                      -- WordPress term id, kept for the one-time import
  data jsonb not null default '{}'::jsonb,             -- presentational payload the site adapter round-trips
  is_active boolean not null default true,
  unique (company_id, kind, slug)
);

create table if not exists tours.packages (           -- a product page on the site
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  slug text not null,
  name text not null,
  subtitle text,
  kind text not null default 'organized' check (kind in ('organized','vacation','village')),
  brand text not null default 'family',               -- family|events|organized|general (card colour)
  hero_image text,
  card_image text,
  gallery text[] not null default '{}',
  days int,
  nights int,
  countries text,
  seasons text[] not null default '{}',
  attractions text[] not null default '{}',
  description_html text,
  included text[] not null default '{}',
  not_included text[] not null default '{}',
  extra_info_html text,
  terms_html text,
  cancellation_html text,
  extra_sections jsonb not null default '[]'::jsonb,
  hotels jsonb not null default '[]'::jsonb,
  faq jsonb not null default '[]'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  legacy_id int,
  data jsonb not null default '{}'::jsonb,             -- presentational payload the site adapter round-trips
  is_active boolean not null default true,
  is_deleted date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, slug)
);

create table if not exists tours.package_terms (
  package_id uuid not null references tours.packages(id) on delete cascade,
  term_id uuid not null references tours.terms(id) on delete cascade,
  primary key (package_id, term_id)
);

-- A page can describe the route in both directions (open-jaw series that flip).
create table if not exists tours.package_itineraries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  package_id uuid not null references tours.packages(id) on delete cascade,
  key text not null default 'main',                   -- 'main' | 'reverse' | ...
  label text,
  arrival_city varchar(3),                            -- city group code: LON, PAR, AMS
  return_city varchar(3),
  days jsonb not null default '[]'::jsonb,            -- [{n,title,subtitle,html,image}]
  unique (package_id, key)
);

create table if not exists tours.series (             -- pck_code
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  package_id uuid references tours.packages(id),
  code text not null,                                 -- 'BBC' | 'FPAR' | 'RPAR'
  label text,
  arrival_airport varchar(3),
  arrival_weekday smallint,
  return_airport varchar(3),
  return_weekday smallint,
  default_nights int,
  default_capacity int default 45,
  default_currency text not null default 'USD',
  child_max_age int not null default 16,
  senior_min_age int default 65,
  senior_discount numeric default 25,
  is_active boolean not null default true,
  unique (company_id, code)
);

create table if not exists tours.series_terms (
  series_id uuid not null references tours.series(id) on delete cascade,
  term_id uuid not null references tours.terms(id) on delete cascade,
  primary key (series_id, term_id)
);

create table if not exists tours.hotels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,                                 -- the "opaque code" a departure option points at
  slug text not null,
  name text not null,
  city text,
  stars int,
  image text,
  gallery jsonb not null default '[]'::jsonb,
  excerpt text,
  content_html text,
  amenities text[] not null default '{}',
  legacy_id int,
  data jsonb not null default '{}'::jsonb,             -- presentational payload the site adapter round-trips
  unique (company_id, code)
);

create table if not exists tours.cars (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  slug text not null,
  name text not null,
  max_people int,
  image text,
  content_html text,
  legacy_id int,
  data jsonb not null default '{}'::jsonb,             -- presentational payload the site adapter round-trips
  unique (company_id, code)
);

create table if not exists tours.instructors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  slug text not null,
  name text not null,
  image text,
  regions text,
  excerpt text,
  content_html text,
  gallery jsonb not null default '[]'::jsonb,
  position int not null default 0,
  legacy_id int,
  data jsonb not null default '{}'::jsonb,             -- presentational payload the site adapter round-trips
  is_active boolean not null default true,
  unique (company_id, slug)
);

create table if not exists tours.cms_pages (          -- about/*, faq/*, legal, contact, blog
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  path text not null,
  title text not null,
  kind text not null default 'page',
  blocks jsonb not null default '[]'::jsonb,
  content_html text,
  seo jsonb not null default '{}'::jsonb,
  legacy_id int,
  data jsonb not null default '{}'::jsonb,             -- presentational payload the site adapter round-trips
  is_active boolean not null default true,
  unique (company_id, path)
);

-- ---------------------------------------------------------------- departures
create table if not exists tours.departures (         -- one dated instance of a series
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  package_id uuid not null references tours.packages(id),
  series_id uuid not null references tours.series(id),
  code text not null,                                 -- 'BBC703' = series + MMDD
  season_year int not null,
  start_date date not null,
  end_date date not null,
  season text,
  currency text not null default 'USD',
  is_published boolean not null default false,
  sale_status text not null default 'open'
    check (sale_status in ('open','guaranteed','last_places','sold_out','closed')),
  card_badge text,
  date_labels text[] not null default '{}',
  arrival_airport varchar(3),                         -- route of THIS date; null = inherit from series
  return_airport varchar(3),
  itinerary_id uuid references tours.package_itineraries(id),
  capacity int,
  docket_no text,                                     -- accounting number; stored only
  meeting_at timestamptz,
  flight_mode text not null default 'included' check (flight_mode in ('included','priced','none')),
  flight_price numeric not null default 0,
  baggage_included boolean not null default true,
  meal_included boolean not null default true,
  transfers_included boolean not null default false,
  connection_out text,
  connection_back text,
  child_max_age int,                                  -- null = inherit from series
  senior_min_age int,
  senior_discount numeric,
  markup_percent numeric,
  markup_fixed numeric,
  price_source text not null default 'manual' check (price_source in ('manual','calculator')),
  costing_id uuid,
  legacy_product_id int,                              -- WooCommerce product id of the dated product
  site_id bigint generated by default as identity (start with 100000),  -- numeric id the site uses (?product_id=) when there is no legacy one
  data jsonb not null default '{}'::jsonb,             -- presentational payload the site adapter round-trips
  notes text,
  is_deleted date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code, season_year)
);
create index if not exists departures_package_idx on tours.departures (package_id, start_date);
create index if not exists departures_series_idx on tours.departures (series_id, start_date);

create table if not exists tours.departure_prices (   -- occupancy matrix (organized trips)
  departure_id uuid not null references tours.departures(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  pax_type text not null check (pax_type in ('adult','child')),
  room_position smallint not null check (room_position between 1 and 6),
  price numeric not null,
  primary key (departure_id, pax_type, room_position)
);

create table if not exists tours.departure_options (  -- vacation + village: selectable priced parts
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  departure_id uuid not null references tours.departures(id) on delete cascade,
  kind text not null check (kind in ('hotel','ticket','villa','car','extra')),
  position smallint not null default 1,
  ref_code text,
  label text,
  board text,
  nights int,
  stay_order smallint,
  max_people int,
  price numeric,
  price_unit text not null default 'per_person' check (price_unit in ('per_person','per_unit','per_stay')),
  room_prices jsonb,
  cost numeric,
  cost_currency text
);
create index if not exists departure_options_departure_idx on tours.departure_options (departure_id, kind, position);

create table if not exists tours.promotions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  departure_id uuid references tours.departures(id) on delete cascade,
  series_id uuid references tours.series(id) on delete cascade,
  kind text not null check (kind in ('percent_order','fixed_per_pax','fixed_per_order','named_per_pax','gift')),
  value numeric,
  label text,
  valid_until date,
  show_on_card boolean not null default false,
  is_active boolean not null default true,
  check (departure_id is not null or series_id is not null)
);
create index if not exists promotions_departure_idx on tours.promotions (departure_id);
create index if not exists promotions_series_idx on tours.promotions (series_id);

-- Seats sold outside MYT, typed in by operations until reservations move in.
create table if not exists tours.departure_sales_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  departure_id uuid not null references tours.departures(id) on delete cascade,
  flight_id bigint references public.flights(id) on delete set null,
  pax int not null,                                   -- +4 sold, -1 cancelled
  docket_no text,
  note text,
  entered_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists departure_sales_entries_departure_idx on tours.departure_sales_entries (departure_id);

-- Which flight block serves which departure. A block with no row here is "pool".
create table if not exists tours.flight_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  flight_id bigint not null references public.flights(id) on delete cascade,
  departure_id uuid not null references tours.departures(id) on delete cascade,
  seats int not null default 0 check (seats >= 0),
  legs text not null default 'both' check (legs in ('both','outbound','inbound')),
  created_at timestamptz not null default now(),
  unique (flight_id, departure_id, legs)
);
create index if not exists flight_allocations_departure_idx on tours.flight_allocations (departure_id);

-- ---------------------------------------------------------------- pricing calculator (reserved, empty for now)
create table if not exists tours.costings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  series_id uuid references tours.series(id),
  departure_id uuid references tours.departures(id),
  season_year int,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft','approved')),
  assumptions jsonb not null default '{}'::jsonb,
  result jsonb,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists tours.costing_lines (
  id uuid primary key default gen_random_uuid(),
  costing_id uuid not null references tours.costings(id) on delete cascade,
  component text not null check (component in ('flight','hotel','bus','guide','attraction','meal','ticket','transfer','insurance','other')),
  supplier text,
  description text,
  unit text not null check (unit in ('per_pax','per_group','per_room','per_night','per_day')),
  quantity numeric not null default 1,
  unit_cost numeric not null,
  currency text not null,
  pax_type text not null default 'all',
  source_ref text
);

-- ---------------------------------------------------------------- housekeeping
do $$
declare t text;
begin
  for t in select table_name from information_schema.tables where table_schema = 'tours' and table_type = 'BASE TABLE' loop
    execute format('alter table tours.%I enable row level security', t);
    execute format('grant all on table tours.%I to service_role', t);
  end loop;
end $$;

drop trigger if exists packages_set_updated_at on tours.packages;
create trigger packages_set_updated_at before update on tours.packages
  for each row execute function public.update_updated_at_column();

drop trigger if exists departures_set_updated_at on tours.departures;
create trigger departures_set_updated_at before update on tours.departures
  for each row execute function public.update_updated_at_column();

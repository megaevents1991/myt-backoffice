-- Shared support tables for the multi-company platform. ADDITIVE ONLY: new tables,
-- no existing table is altered (the flights columns come in the next migration).
-- Spec: mega-family/docs/plans/MEGA-FAMILY-DATA-SPEC.md (sections 2.3, 2.4).
--
-- All tables: RLS enabled with NO policies - service-role only.
--
-- Rollback: supabase/rollback/20261001_multi_company.sql

-- Airline contracts. The two cancellation deadlines of a flight block are derived
-- from the contract (45 / 31 days before departure are only the usual values).
create table if not exists public.flight_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,                                 -- 'חוזה קיץ אלעל 2026' | 'קבוצה סגורה'
  airline_group text,                                 -- 'LY' | 'LH GROUP' | 'FZ' | 'ITA' | 'BA' | 'AF/KL'
  kind text not null default 'closed_group' check (kind in ('series_contract','closed_group')),
  valid_from date,
  valid_to date,
  cxx1_days_before int not null default 45,
  cxx2_days_before int not null default 31,
  names_days_before int,
  ticketing_days_before int,
  commitment_amount numeric,
  commitment_unit text,                               -- per_group | per_pax | pct_of_fare
  name_change_fee numeric,
  currency text not null default 'USD',
  terms_text text,                                    -- the original wording, kept verbatim
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table public.flight_contracts enable row level security;

-- Fee windows of a contract. Created now; the automatic fee estimate comes later.
create table if not exists public.flight_contract_rules (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.flight_contracts(id) on delete cascade,
  days_before_from int not null,
  days_before_to int not null,
  free_reduction_pct numeric not null default 0,
  fee_kind text check (fee_kind in ('fixed_per_pax','fixed_per_group','pct_of_fare','full_fare')),
  fee_value numeric,
  deposit_per_pax numeric,
  note text
);
alter table public.flight_contract_rules enable row level security;

-- Timeline of a flight block: replaces the free-text seat log, the deposit dates
-- and the remarks columns of the operations workbook.
create table if not exists public.flight_block_events (
  id uuid primary key default gen_random_uuid(),
  flight_id bigint not null references public.flights(id) on delete cascade,
  happened_on date not null default current_date,
  kind text not null check (kind in ('approved','requested','quoted','confirmed','handed_over','reduced','cleaned',
                                     'schedule_change','deposit_paid','names_sent','ticketed','cancelled','note')),
  seats_after int,
  amount numeric,
  currency text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists flight_block_events_flight_idx on public.flight_block_events (flight_id, happened_on);
alter table public.flight_block_events enable row level security;

-- Holidays, fasts, carnivals and school breaks. company_id null = global.
create table if not exists public.calendar_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  year int not null,
  name text not null,
  kind text not null default 'holiday' check (kind in ('holiday','fast','carnival','school_break','other')),
  holiday_date date,
  start_date date,
  end_date date,
  note text
);
create index if not exists calendar_periods_year_idx on public.calendar_periods (year);
alter table public.calendar_periods enable row level security;

-- The daily exchange rate a company types in by hand.
create table if not exists public.company_exchange_rates (
  company_id uuid not null references public.companies(id),
  rate_date date not null,
  currency text not null,                             -- USD | EUR | GBP
  rate_to_ils numeric not null check (rate_to_ils > 0),
  entered_by uuid,
  created_at timestamptz not null default now(),
  primary key (company_id, rate_date, currency)
);
alter table public.company_exchange_rates enable row level security;

-- Every form of every company site lands here (lead form, contact, cancellation,
-- newsletter, advisor request).
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind text not null,
  name text,
  phone text,
  email text,
  message text,
  payload jsonb not null default '{}'::jsonb,
  source_path text,
  utm jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  assigned_to uuid,
  created_at timestamptz not null default now()
);
create index if not exists leads_company_created_idx on public.leads (company_id, created_at desc);
alter table public.leads enable row level security;

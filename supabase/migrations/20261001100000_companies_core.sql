-- Multi-company core. ADDITIVE ONLY: three new tables, no existing table is touched.
-- Spec: mega-family/docs/plans/BACKOFFICE-INTEGRATION-PLAN.md (section 2.1).
--
-- A "company" is a tenant of the platform (Mega Events, Mega Family, later others).
-- Until the company switcher ships, nothing reads these tables: the backoffice
-- keeps behaving exactly as before, and every existing user is a member of
-- Mega Events.
--
-- All three tables are backoffice-only: RLS enabled with NO policies, so only the
-- service-role key can read or write them (same pattern as user_profiles).
--
-- Rollback: supabase/rollback/20261001_multi_company.sql

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                       -- 'mega-events' | 'mega-family'
  schema_name text not null unique,                -- 'c_megaevents' | 'c_megafamily'
  name text not null,
  legal_name text,
  product_types text[] not null default '{}',      -- {'events'} | {'tours'}
  site_url text,
  revalidate_url text,
  default_currency text not null default 'USD',
  locale text not null default 'he-IL',
  brand jsonb not null default '{}'::jsonb,        -- {logo, colors, fonts, favicon}
  contact jsonb not null default '{}'::jsonb,      -- {phone, whatsapp, email, address, hours}
  email_config jsonb not null default '{}'::jsonb, -- {from, replyTo, leadsInbox}
  payment_config jsonb not null default '{}'::jsonb,
  analytics jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.companies enable row level security;

create table if not exists public.company_domains (
  domain text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  is_primary boolean not null default false
);
alter table public.company_domains enable row level security;

-- superadmin stays global on user_profiles.role and needs no row here.
create table if not exists public.company_members (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null check (role in ('admin','editor','office_manager','agent','affiliate','forms_operator')),
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
create index if not exists company_members_company_id_idx on public.company_members (company_id);
alter table public.company_members enable row level security;

-- Fixed ids: later migrations use the Mega Events id as a column default, so it
-- must be the same in every environment.
insert into public.companies (id, slug, schema_name, name, product_types, site_url, default_currency)
values
  ('a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601', 'mega-events', 'c_megaevents', 'מגה איבנטס', '{events}', 'https://www.mega-events.co.il', 'USD'),
  ('b4e2d3c5-6c7f-4a81-9ba2-c3d4e5f6a702', 'mega-family', 'c_megafamily', 'מגה פמילי', '{tours}', 'https://mega-family.vercel.app', 'USD')
on conflict (slug) do nothing;

-- Every existing user belongs to Mega Events, with the role they already have.
insert into public.company_members (user_id, company_id, role)
select p.id, 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601', p.role
from public.user_profiles p
where p.role <> 'superadmin'
on conflict (user_id, company_id) do nothing;

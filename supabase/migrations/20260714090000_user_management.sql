-- User management foundation: profiles, audit log, quotes.
-- All three tables are backoffice-only; RLS enabled with NO policies so only
-- the service-role key (used by the backoffice server) can access them.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null check (role in ('superadmin','admin','editor','agent','affiliate')),
  partner_tracking_code text references public.partners(partner_tracking_code),
  logo_url text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table public.user_profiles enable row level security;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  actor_role text,
  action text not null,
  entity_type text,
  entity_id text,
  changes jsonb,
  metadata jsonb,
  ip text
);

create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);

alter table public.audit_log enable row level security;

create table if not exists public.quotes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  partner_tracking_code text,
  event_id bigint,
  customer_name text,
  title text,
  line_items jsonb not null default '[]'::jsonb,
  currency text not null default 'USD',
  total numeric,
  notes text,
  valid_until date,
  status text not null default 'final',
  pdf_storage_path text
);

create index if not exists quotes_partner_idx on public.quotes (partner_tracking_code);

alter table public.quotes enable row level security;

-- Storage buckets: partner logos are publicly readable (used in rendered quote
-- PDFs and portal header); generated quote PDFs are private (signed URLs only).
insert into storage.buckets (id, name, public)
values ('partner-logos', 'partner-logos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('quotes', 'quotes', false)
on conflict (id) do nothing;

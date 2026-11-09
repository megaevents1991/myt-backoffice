-- Members club at checkout (MEGA CLUB) - spec docs/superpowers/specs/2026-11-09-members-club-design.md §7.
-- The site (myt-main) writes club_members / club_log and coupons rows with source 'club'; this backoffice reads them
-- and owns club_settings. Service role only: RLS on, no policies, anon / authenticated revoked.
-- No CHECK constraints on columns the site writes (repo rule): values are validated in code.
-- Idempotent: safe to run twice.

-- A member's price is an ordinary coupon row; `source` tells them apart (null = a normal coupon).
alter table public.coupons add column if not exists source text;
comment on column public.coupons.source is
  'null = a normal coupon; ''club'' = a MEGA CLUB member code (one per member, per_person, amount pushed from club_settings).';

create sequence if not exists public.club_member_no_seq start 1001;

create table if not exists public.club_members (
  id uuid primary key default gen_random_uuid(),
  member_no integer not null default nextval('public.club_member_no_seq') unique,
  email text not null,
  phone text,
  phone_key text,
  first_name text,
  last_name text,
  coupon_id bigint references public.coupons (id) on delete set null,
  coupon_code text not null unique,
  status text not null default 'active',
  removed_at timestamptz,
  marketing text not null default 'subscribed',
  unsubscribed_at timestamptz,
  unsubscribe_source text,
  unsubscribe_token text not null default replace(gen_random_uuid()::text, '-', '') unique,
  source text,
  source_path text,
  event_id bigint,
  utm jsonb,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  consent_text text,
  consent_version text,
  welcome_sent_at timestamptz,
  welcome_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter sequence public.club_member_no_seq owned by public.club_members.member_no;

comment on table public.club_members is 'MEGA CLUB members - one per email. Written by myt-main (join), managed on /marketing/club.';
comment on column public.club_members.status is 'active | removed (removed = its coupon is switched off).';
comment on column public.club_members.marketing is 'subscribed | unsubscribed - one consent for mail, SMS and WhatsApp (spec D9).';
comment on column public.club_members.unsubscribe_source is 'link | whatsapp | backoffice';
comment on column public.club_members.source is 'checkout_popup | checkout_row';
comment on column public.club_members.phone_key is 'Last 9 digits of the phone.';

create unique index if not exists club_members_email_key on public.club_members (lower(btrim(email)));
create index if not exists club_members_phone_key_idx on public.club_members (phone_key);
create index if not exists club_members_created_at_idx on public.club_members (created_at);

-- Append-only: the consent proof and the rate-limit source of the site's public routes.
create table if not exists public.club_log (
  id bigint generated always as identity primary key,
  member_id uuid references public.club_members (id) on delete set null,
  action text not null,
  consent_text text,
  consent_version text,
  ip text,
  user_agent text,
  source text,
  at timestamptz not null default now()
);
comment on table public.club_log is
  'MEGA CLUB log: join | rejoin | lookup | lookup_miss | unsubscribe | removed | restored. Never updated or deleted.';
create index if not exists club_log_ip_at_idx on public.club_log (ip, at);
create index if not exists club_log_member_idx on public.club_log (member_id, at);

create table if not exists public.club_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.club_settings is 'MEGA CLUB settings. Key program = { enabled, discount_per_traveler_usd, popup_delay_seconds }.';

insert into public.club_settings (key, value)
values ('program', '{"enabled": true, "discount_per_traveler_usd": 50, "popup_delay_seconds": 22}'::jsonb)
on conflict (key) do nothing;

alter table public.club_members enable row level security;
alter table public.club_log enable row level security;
alter table public.club_settings enable row level security;
revoke all on table public.club_members from anon, authenticated;
revoke all on table public.club_log from anon, authenticated;
revoke all on table public.club_settings from anon, authenticated;
revoke all on sequence public.club_member_no_seq from anon, authenticated;

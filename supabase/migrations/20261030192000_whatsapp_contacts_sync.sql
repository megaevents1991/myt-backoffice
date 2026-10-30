-- The phone book of a number on the WhatsApp Business app (Dor 30.10: "תוסיף את סנכרון אנשי הקשר לפני יום החיבור"). Meta
-- wants contacts and history synced within 24 hours of onboarding, each one shot: a sync missed means disconnecting the
-- number and connecting it again. It arrives on the webhook field smb_app_state_sync, then every later change does too.
--
-- wa_contacts holds them as they stand on the phone: nothing is built from them, no customer and no card (a private phone
-- book is not a customer list). A contact removed from the phone is deleted here. RLS on, no policies, service role only.

alter table public.wa_accounts
  add column if not exists contacts_requested_at timestamptz,
  add column if not exists contacts_synced_at timestamptz;

create table if not exists public.wa_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  phone text not null,        -- digits in international form (972541234567)
  phone_key text not null,    -- the last 9 digits (public.phone_key)
  full_name text,
  first_name text,
  contact_at timestamptz,     -- when the business added or edited it, per Meta
  synced_at timestamptz not null default now(),
  unique (company_id, phone)
);
create index if not exists wa_contacts_company_key_idx on public.wa_contacts (company_id, phone_key);
alter table public.wa_contacts enable row level security;
revoke all on table public.wa_contacts from anon, authenticated;

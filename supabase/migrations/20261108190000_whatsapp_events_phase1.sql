-- WhatsApp for Mega Events, phase E1 (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md, section 5).
-- Mega Events has no tours customers / leads: a conversation is one wa_chats row per company + phone, shown on every
-- order of that phone. Backoffice-only tables (RLS on, no policies, service role only); myt-main reads none of this.
-- Idempotent: every statement can run twice. Test: scripts/whatsapp-events-sql-pglite-test.mjs.

-- 1. The reservation's phone key (the last 9 digits, public.phone_key - the TS twin is phoneKey in lib/tours/cases.ts).
--    Kept by a trigger, NOT a generated column: updateReservation spreads the edit form's whole row back into the
--    update, and a generated column in that row would fail the save; the trigger simply overwrites whatever comes.
alter table public.reservations add column if not exists main_contact_phone_key text;
-- 2. The per-order "no WhatsApp" switch (D-6). updateReservation strips both, so a stale edit form never undoes it.
alter table public.reservations add column if not exists whatsapp_off_at timestamptz;
alter table public.reservations add column if not exists whatsapp_off_by uuid;

create or replace function public.reservations_phone_key()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.main_contact_phone_key := public.phone_key(new.main_contact_phone_number);
  return new;
end;
$$;
revoke all on function public.reservations_phone_key() from public;
revoke execute on function public.reservations_phone_key() from anon, authenticated;

drop trigger if exists reservations_phone_key on public.reservations;
create trigger reservations_phone_key
  before insert or update on public.reservations
  for each row execute function public.reservations_phone_key();

update public.reservations
   set main_contact_phone_key = public.phone_key(main_contact_phone_number)
 where main_contact_phone_key is distinct from public.phone_key(main_contact_phone_number);

create index if not exists reservations_phone_key_idx
  on public.reservations (main_contact_phone_key) where main_contact_phone_key <> '';

-- 3. One conversation per company + phone.
create table if not exists public.wa_chats (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  phone text not null,                                  -- digits, international (972541234567)
  phone_key text not null,                              -- last 9 digits
  profile_name text,                                    -- WhatsApp's name for the sender, filled when empty
  last_in_at timestamptz,                               -- newest LIVE inbound message (never history): the 24 h window
  last_out_at timestamptz,                              -- newest outbound message (app echo, api, automation)
  answered_at timestamptz,                              -- newest app echo or api reply; an automation is no answer
  seen_at timestamptz,
  seen_by uuid,
  linked_reservation_id bigint references public.reservations(id) on delete set null,  -- R-3: a companion's phone
  linked_by uuid,
  linked_at timestamptz,
  opted_out_at timestamptz,                             -- "הסר" (reply) or staff - Mega Events only (M-3)
  opted_out_source text,
  alerted_at timestamptz,                               -- the unanswered alert for the current last_in_at went out
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, phone_key)
);
create index if not exists wa_chats_last_in_idx on public.wa_chats (company_id, last_in_at desc);
alter table public.wa_chats enable row level security;
revoke all on table public.wa_chats from anon, authenticated;

-- 4. The WhatsApp Business app's own automatic texts (greeting / away message): an echo of one is not a rep's answer.
create table if not exists public.wa_app_auto_texts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  text_norm text not null,                              -- trimmed, whitespace collapsed (normAutoText)
  text text not null,
  source text not null default 'staff',                 -- history (suggested after the sync) / staff
  created_at timestamptz not null default now(),
  unique (company_id, text_norm)
);
alter table public.wa_app_auto_texts enable row level security;
revoke all on table public.wa_app_auto_texts from anon, authenticated;

-- 5. Outbound messages about an order carry it (wa_messages.reservation_id was reserved since 20261021172647).
create index if not exists wa_messages_reservation_idx
  on public.wa_messages (reservation_id) where reservation_id is not null;

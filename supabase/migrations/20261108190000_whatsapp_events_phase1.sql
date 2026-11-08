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

-- The rule is written out here, NOT a call to public.phone_key: that function's EXECUTE is revoked from the public
-- roles, and a BEFORE trigger that cannot run fails the write - a booking must never fail because of WhatsApp.
create or replace function public.reservations_phone_key()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  digits text := regexp_replace(coalesce(new.main_contact_phone_number, ''), '\D', '', 'g');
begin
  new.main_contact_phone_key := case when length(digits) >= 9 then right(digits, 9) else '' end;
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
  -- the list's filters: a PostgREST filter cannot compare two columns, so the database computes them. wa_chats is
  -- written column by column (never a whole row), so a generated column is safe here - unlike reservations above.
  is_unseen boolean generated always as (last_in_at is not null and (seen_at is null or last_in_at > seen_at)) stored,
  is_unanswered boolean generated always as (last_in_at is not null and (answered_at is null or last_in_at > answered_at)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, phone_key)
);
create index if not exists wa_chats_last_in_idx on public.wa_chats (company_id, last_in_at desc);
create index if not exists wa_chats_unseen_idx on public.wa_chats (company_id) where is_unseen;
create index if not exists wa_chats_unanswered_idx on public.wa_chats (company_id) where is_unanswered;
alter table public.wa_chats enable row level security;
revoke all on table public.wa_chats from anon, authenticated;

-- 3b. One statement that creates a chat or moves its timestamps FORWARD only (greatest), so a webhook delivered out of
--     order, or a staff "seen" landing between a read and a write, is never overwritten with an older value. The
--     profile name is filled only when empty. Called by upsertChat (lib/services/whatsapp-events-db.ts).
create or replace function public.wa_chat_touch(
  p_company uuid, p_phone text, p_key text, p_profile text,
  p_last_in timestamptz, p_last_out timestamptz, p_answered timestamptz, p_seen timestamptz
)
returns setof public.wa_chats
language sql
set search_path = public, pg_temp
as $$
  insert into public.wa_chats as c (company_id, phone, phone_key, profile_name, last_in_at, last_out_at, answered_at, seen_at)
  values (p_company, p_phone, p_key, p_profile, p_last_in, p_last_out, p_answered, p_seen)
  on conflict (company_id, phone_key) do update set
    profile_name = coalesce(nullif(c.profile_name, ''), excluded.profile_name),
    last_in_at = greatest(c.last_in_at, excluded.last_in_at),
    last_out_at = greatest(c.last_out_at, excluded.last_out_at),
    answered_at = greatest(c.answered_at, excluded.answered_at),
    seen_at = greatest(c.seen_at, excluded.seen_at),
    updated_at = now()
  returning c.*;
$$;
revoke all on function public.wa_chat_touch(uuid, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz) from public;
revoke execute on function public.wa_chat_touch(uuid, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz) from anon, authenticated;

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

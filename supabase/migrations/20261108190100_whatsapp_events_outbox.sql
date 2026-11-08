-- WhatsApp for Mega Events, phase E2 (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md, sections
-- 5 and 9): the outbox of order updates. An AFTER trigger on reservations queues each update whatever wrote it -
-- myt-main's checkout and payment callback, a staff edit, a bulk action, SQL - and the backoffice cron waEventsOutbox
-- (every 2 minutes) and the staff actions send it through the Cloud API. case_id is reserved for the tours phase 2.
-- THE RULE: the trigger runs inside myt-main's checkout write, so it can never fail it - its body is wrapped in an
-- exception handler that turns any error into a warning. Idempotent. Test: scripts/whatsapp-events-outbox-pglite-test.mjs.

create table if not exists public.wa_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reservation_id bigint references public.reservations(id) on delete cascade,
  case_id uuid,                                         -- reserved for tours (phase 2 of 2026-10-21)
  kind text not null,                                   -- payment_received / payment_failed / phone_order / ... (no CHECK)
  dedupe_key text not null unique,                      -- payment_received:4821, payment_failed:4821:2026-11-08, ...
  due_at timestamptz not null default now(),
  status text not null default 'pending',               -- pending / sent / skipped / failed
  reason text,                                          -- why skipped / failed, in a sentence (shown on the order)
  wa_message_id uuid references public.wa_messages(id) on delete set null,
  sent_to text,                                         -- the customer's phone, or the trial phone
  requested_by uuid,                                    -- staff, for an on-demand kind
  from_status text,                                     -- the order's status before the change that queued it
  attempts smallint not null default 0,
  claimed_at timestamptz,                               -- pending -> sending (a drain took it); a stale one is closed, never re-sent
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists wa_outbox_pending_idx on public.wa_outbox (status, due_at) where status = 'pending';
alter table public.wa_outbox add column if not exists claimed_at timestamptz;
create index if not exists wa_outbox_reservation_idx on public.wa_outbox (reservation_id) where reservation_id is not null;
alter table public.wa_outbox enable row level security;
revoke all on table public.wa_outbox from anon, authenticated;

create or replace function public.reservations_wa_outbox()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
-- a lock on wa_outbox / wa_accounts (a migration) must never hold a checkout: wait at most this, then 55P03 is caught
set lock_timeout = '500ms'
as $$
declare
  mega_events constant uuid := 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601';  -- MEGA_EVENTS_COMPANY_ID (lib/company-ids.ts)
  today text;
  before_status text;
  new_info text;
  old_info text;
begin
  -- everything, the assignments too, sits inside the guard: nothing here may fail the write that fired it
  begin
    before_status := case when tg_op = 'UPDATE' then old.status end;
    -- a result CLEARED (null / {} / 'null') is no failure: only a real gateway answer is
    new_info := nullif(nullif(nullif(new.payment_info::text, ''), '{}'), 'null');
    old_info := case when tg_op = 'UPDATE' then coalesce(old.payment_info::text, '') else '' end;
    -- nothing piles up before connect day: only while Mega Events has a connected number
    if not exists (select 1 from public.wa_accounts a where a.company_id = mega_events and a.is_active) then
      return null;
    end if;
    today := to_char((now() at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD');

    -- the order became Paid (a card payment, a staff edit, a bulk move)
    if new.status = 'Paid' and (tg_op = 'INSERT' or old.status is distinct from 'Paid') then
      insert into public.wa_outbox (company_id, reservation_id, kind, dedupe_key, from_status)
      values (mega_events, new.id, 'payment_received', 'payment_received:' || new.id, before_status)
      on conflict (dedupe_key) do nothing;
    end if;

    if tg_op = 'UPDATE' then
      -- a gateway result without Paid is a failure (myt-main writes the result and Paid in ONE update on success)
      if new.status is distinct from 'Paid' and new_info is not null and new_info is distinct from old_info then
        insert into public.wa_outbox (company_id, reservation_id, kind, dedupe_key, due_at, from_status)
        values (mega_events, new.id, 'payment_failed', 'payment_failed:' || new.id || ':' || today, now() + interval '15 minutes', before_status)
        on conflict (dedupe_key) do nothing;
      end if;

      -- a phone order: myt-main's phoneOrder mail just went out (Pending, no payment, no agent settlement)
      if coalesce(old.confirmation_email_sent, false) = false and new.confirmation_email_sent is true
         and new.status = 'Pending' and new.payment_info is null and new.partner_settlement_method is null then
        insert into public.wa_outbox (company_id, reservation_id, kind, dedupe_key, from_status)
        values (mega_events, new.id, 'phone_order', 'phone_order:' || new.id, before_status)
        on conflict (dedupe_key) do nothing;
      end if;

      -- staff marked "travel materials sent"
      if old.travel_materials_sent_at is null and new.travel_materials_sent_at is not null then
        insert into public.wa_outbox (company_id, reservation_id, kind, dedupe_key, from_status)
        values (mega_events, new.id, 'materials_sent', 'materials_sent:' || new.id, before_status)
        on conflict (dedupe_key) do nothing;
      end if;

      -- cancelled; the send decision reads from_status (only an order that was paid gets the message)
      if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
        insert into public.wa_outbox (company_id, reservation_id, kind, dedupe_key, from_status)
        values (mega_events, new.id, 'order_cancelled', 'order_cancelled:' || new.id, before_status)
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
  exception when others then
    raise warning 'reservations_wa_outbox: % (reservation %)', sqlerrm, new.id;
  end;
  return null;
end;
$$;
revoke all on function public.reservations_wa_outbox() from public;
revoke execute on function public.reservations_wa_outbox() from anon, authenticated;

drop trigger if exists reservations_wa_outbox on public.reservations;
create trigger reservations_wa_outbox
  after insert or update of status, payment_info, confirmation_email_sent, travel_materials_sent_at on public.reservations
  for each row execute function public.reservations_wa_outbox();

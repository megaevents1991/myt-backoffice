-- Customer cancellation requests submitted from myt-main's /cancel-order page
-- (the "ביטול הזמנה" form linked from the site footer and the terms page).
--
-- myt-main WRITES one row per submission (lib/cancellation-request-actions.ts)
-- and emails ops in the same request; the row is the durable record in case
-- the email is lost. The backoffice is expected to READ this table (a
-- reservations-side queue) - nothing here yet, so `status` is free text:
-- new | in_progress | done | rejected.

create table if not exists public.cancellation_requests (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  first_name   text not null,
  last_name    text not null,
  id_number    text not null,
  phone        text not null,
  order_number text not null,
  email        text not null,
  note         text,
  status       text not null default 'new',
  -- website | phone | email - where the request came in from
  source       text not null default 'website'
);

create index if not exists cancellation_requests_created_at_idx
  on public.cancellation_requests (created_at desc);

create index if not exists cancellation_requests_order_number_idx
  on public.cancellation_requests (order_number);

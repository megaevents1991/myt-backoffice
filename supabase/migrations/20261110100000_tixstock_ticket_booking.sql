-- TixStock ticket booking - spec docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.3,
-- plan docs/superpowers/plans/2026-11-09-tixstock-ticket-booking.md Task 1.
-- Additive only: one nullable column on events, three new tables, one private bucket. Nothing on reservations
-- changes, and no existing query reads anything new.
-- Written by the backoffice (the Book ticket button, the webhook, the sweep) and by myt-main for its hidden
-- sandbox test event only. Service role only: RLS on, no policies, anon / authenticated revoked.
-- No CHECK constraints on columns the site writes (repo rule): values are validated in code.
-- Idempotent: safe to run twice.

-- events is read by every page of the site. If its lock is not free within 5 seconds, fail this migration (the
-- workflow goes red and is run again) rather than queue every reader behind it.
set lock_timeout = '5s';

-- Which TixStock environment an is_test event books in. Honoured ONLY together with is_test = true; on a real
-- event it is ignored (lib/tixstock-booking/rules.ts bookingEnvFor).
alter table public.events add column if not exists tixstock_booking text;
comment on column public.events.tixstock_booking is
  'null = a normal event. ''sandbox_site'' = hidden test event whose site checkout books in the TixStock sandbox; ''sandbox_office'' = hidden test event booked from the backoffice button in the sandbox. Honoured only with is_test = true.';

-- One row per booking attempt of a reservation's tickets at TixStock.
create table if not exists public.ticket_bookings (
  id uuid primary key default gen_random_uuid(),
  reservation_id bigint not null references public.reservations (id),
  env text not null,
  source text not null,
  tixstock_event_id text not null,
  listing_id text not null,
  hold_id text,
  tixstock_order_id text,
  quantity integer not null,
  status text not null,
  attempt_started_at timestamptz,
  listing jsonb not null,
  price_per_ticket numeric(12,2),
  currency text not null default 'USD',
  total numeric(12,2),
  order_currency text,
  order_total numeric(12,2),
  cost_sold_usd numeric(12,2),
  gap_accepted_by text,
  buyer jsonb,
  attendees jsonb,
  shipping_address jsonb,
  prerequisites_ack jsonb,
  uncertain_resolution jsonb,
  last_error text,
  last_refresh_at timestamptz,
  link_email_sent_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  commissionable_at timestamptz,
  checked_by text,
  checked_at timestamptz,
  sent_to_customer_at timestamptz,
  sent_to_customer_by text,
  sent_channels text[] not null default '{}',
  released_to_customer_at timestamptz,
  customer_token text not null unique
);

comment on table public.ticket_bookings is
  'TixStock ticket bookings - one row per attempt. A reservation has at most one LIVE row (ticket_bookings_one_live). The reservation row itself is never altered.';
comment on column public.ticket_bookings.env is 'sandbox | production - decided by the event (is_test + tixstock_booking), never by a global switch.';
comment on column public.ticket_bookings.source is 'office (the backoffice Book ticket button) | site (the sandbox test checkout on myt-main).';
comment on column public.ticket_bookings.status is
  'holding | on_hold | ordering | sale_on_hold | approved | commissionable | failed | released | uncertain | cancelled. ordering = the orders/add call is in flight (claimed by a one-way move from on_hold). uncertain = TixStock may hold an order we got no answer for - never order again until staff settle it.';
comment on column public.ticket_bookings.attempt_started_at is 'Set when the row moves to ordering. A row left in ordering is turned uncertain by the sweep.';
comment on column public.ticket_bookings.listing is 'The listing as booked: category, section, row, ticket type, split type, benefits and restrictions, delivery date, instant download.';
comment on column public.ticket_bookings.price_per_ticket is 'What we sent TixStock per ticket: the feed''s proceed_price in USD, exactly as received.';
comment on column public.ticket_bookings.order_currency is 'The currency TixStock''s orders/add answer registered (with order_total) - kept to catch a difference from what we sent.';
comment on column public.ticket_bookings.cost_sold_usd is 'The ticket cost the site sold at (from the reservation), for the gap line of the booking dialog.';
comment on column public.ticket_bookings.attendees is 'Attendee details as sent to TixStock. Passport numbers live here only - never in reservations.more_pax_info.';
comment on column public.ticket_bookings.sent_channels is 'email | whatsapp - how staff sent the tickets to the customer.';
comment on column public.ticket_bookings.released_to_customer_at is 'From this moment the customer''s ticket page shows the files. Office rows: set by staff on send. Site (test) rows: set when the first file arrives.';
comment on column public.ticket_bookings.customer_token is 'Random, 32 bytes base64url - the only key of the customer''s ticket page.';

create unique index if not exists ticket_bookings_one_live on public.ticket_bookings (reservation_id)
  where status in ('holding', 'on_hold', 'ordering', 'sale_on_hold', 'approved', 'commissionable', 'uncertain');
create index if not exists ticket_bookings_reservation_idx on public.ticket_bookings (reservation_id);
create index if not exists ticket_bookings_order_idx on public.ticket_bookings (tixstock_order_id);
create index if not exists ticket_bookings_status_created_idx on public.ticket_bookings (status, created_at);

-- One row per ticket / link / proof / instruction letter of a booking.
create table if not exists public.ticket_booking_files (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.ticket_bookings (id) on delete cascade,
  kind text not null,
  "row" text,
  seat text,
  storage_path text,
  content_type text,
  url text,
  webhook_event_id uuid,
  dedupe_key text not null unique,
  received_at timestamptz not null default now()
);

comment on table public.ticket_booking_files is 'Files and links TixStock sent for a booking. PDFs live in the private ticket-files bucket (storage_path); links and proofs keep their url.';
comment on column public.ticket_booking_files.kind is 'pdf | mobile_link | proof | additional (the seller''s instruction letter). proof is never shown to the customer.';
comment on column public.ticket_booking_files.dedupe_key is 'order id + kind + row + seat + index. No webhook type in it, so a refresh of the same order stores nothing twice.';

create index if not exists ticket_booking_files_booking_idx on public.ticket_booking_files (booking_id);

-- Raw log of every webhook TixStock sends, valid signature or not.
create table if not exists public.tixstock_webhook_events (
  id uuid primary key default gen_random_uuid(),
  env text,
  type text,
  signature_valid boolean not null,
  tixstock_order_id text,
  payload jsonb,
  result jsonb,
  received_at timestamptz not null default now()
);

comment on table public.tixstock_webhook_events is 'Every TixStock webhook as received. payload holds no file bodies: each base64 body is replaced by its byte count.';
comment on column public.tixstock_webhook_events.env is 'sandbox | production - the URL the webhook arrived on.';

create index if not exists tixstock_webhook_events_received_idx on public.tixstock_webhook_events (received_at);
create index if not exists tixstock_webhook_events_order_idx on public.tixstock_webhook_events (tixstock_order_id);

alter table public.ticket_bookings enable row level security;
alter table public.ticket_booking_files enable row level security;
alter table public.tixstock_webhook_events enable row level security;
revoke all on table public.ticket_bookings from anon, authenticated;
revoke all on table public.ticket_booking_files from anon, authenticated;
revoke all on table public.tixstock_webhook_events from anon, authenticated;

-- Private: tickets are served only through the token route (site) and signed URLs (backoffice).
insert into storage.buckets (id, name, public)
values ('ticket-files', 'ticket-files', false)
on conflict (id) do nothing;

reset lock_timeout;

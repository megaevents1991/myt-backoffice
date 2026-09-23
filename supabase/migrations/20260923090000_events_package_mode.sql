-- Ticket-only events (spec docs/superpowers/specs/2026-09-20-lodging-destinations-design.md, part A).
-- 'package' = today's flow; 'ticket_only' = the site sells the ticket alone (no flight/hotel steps).
-- Text, no CHECK: a later mode (e.g. 'no_hotel') must not need a migration. Validated in the backoffice.
alter table public.events
  add column if not exists package_mode text not null default 'package';

comment on column public.events.package_mode is
  'package | ticket_only. ticket_only: main sells the ticket alone, price = ticket + ticket_only_markup.';

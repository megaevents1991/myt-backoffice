-- Nightly base-price sync audit (spec docs/superpowers/specs/2026-09-02).
-- Every applied change and every frozen ">$400" change lands here so the
-- dashboard's price-changes screen and the daily email have something to show.
-- Backoffice-only; main never reads this.
--
-- No FK to events on purpose: the log must outlive event lifecycle games
-- (soft-delete debates, provider re-imports) - same stance as audit_log.

create table if not exists public.base_price_sync_log (
  id          bigint generated always as identity primary key,
  event_id    bigint not null,
  component   text   not null check (component in ('flight','hotel')),
  old_price   integer,
  new_price   integer,
  live_price  integer,
  -- applied | needs_review | error
  status      text   not null default 'applied',
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists base_price_sync_log_event_idx
  on public.base_price_sync_log (event_id, created_at desc);

-- The review queue is what the screen polls - partial index keeps it cheap.
create index if not exists base_price_sync_log_review_idx
  on public.base_price_sync_log (created_at desc)
  where status = 'needs_review';

-- Service-role only, like tasks / creative_gap_dismissals: RLS on, no policies.
alter table public.base_price_sync_log enable row level security;

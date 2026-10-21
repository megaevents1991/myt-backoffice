-- Tours board, Alon's TODAY round (21.10.2026): when a card's note was last written, and each rep's own order of TODAY.
-- Both backoffice-only: RLS on, no policy, the service role alone
-- (spec docs/superpowers/specs/2026-10-21-tours-board-round-design.md). Idempotent; the reads fall back while it is not applied.

-- 1. notes_at: TODAY prints the first line of a card's notes and highlights a note written today.
alter table public.leads add column if not exists notes_at timestamptz;
comment on column public.leads.notes_at is 'When notes were last written to a non-empty text (updateCase / createCase); null = never since the column exists. TODAY highlights a note written today (Israel day).';

-- 2. The viewer's own order of TODAY: one row per (company, user), replaced whole on every drag, at most 500 ids
--    (lib/tours/board.ts: cleanOrderIds / orderBoard). Ids that left TODAY are simply skipped when the list is drawn.
create table if not exists public.lead_board_orders (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  lead_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
comment on table public.lead_board_orders is 'The order of TODAY one user dragged (Reservations board, 21.10.2026): a private list per user and company. Replaced whole on every drag; at most 500 ids.';
alter table public.lead_board_orders enable row level security;

-- Events-factory work queue (spec docs/superpowers/specs/2026-09-02, section 8).
--
-- Drafts live in their OWN table, never as a status on `events`: main reads
-- `events` directly, so a draft there would need main-side filtering and any
-- miss leaks an unfinished event to customers. Approving a draft calls
-- createEvent from `payload`; the row is the work item, the created event is
-- the record. Rows older than 30 days in a terminal status get purged by the
-- approve action (work table, not history).

create table if not exists public.event_drafts (
  id          uuid primary key default gen_random_uuid(),
  -- tixstock | live | p1 | sports (what built the payload)
  source      text not null,
  -- What was asked for: team / competition / artist / manual selection + filters.
  scope       jsonb not null default '{}',
  -- Full event shape createEvent accepts.
  payload     jsonb not null,
  -- building | ready | needs_input | approved | created | error
  status      text not null default 'building',
  -- Field names automation could not fill: ["city_iata","base_hotel_price",...]
  missing     jsonb not null default '[]',
  error       text,
  created_event_id bigint,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists event_drafts_status_idx
  on public.event_drafts (status, created_at desc);

-- Service-role only, like tasks / base_price_sync_log: RLS on, no policies.
alter table public.event_drafts enable row level security;

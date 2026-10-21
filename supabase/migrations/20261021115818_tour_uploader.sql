-- Tour uploader, agent #3 (spec docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md):
-- a brief ("all Oasis shows in Europe") becomes a RUN of ITEMS - one per show found at the
-- suppliers - each built into a HIDDEN event for a human to review and approve.
--
-- (1) events.is_hidden: an event the uploader built and nobody approved yet. Main lists nothing
--     hidden (listings, search, categories, feeds, direct /order/{id}); `updateEvent` never writes
--     it - only the uploader's approve action flips it. NOT NULL default false is metadata-only
--     on Postgres 11+ (no table rewrite), so every existing event reads as listed.
-- (2) uploader_runs / uploader_items: the work queue. Own tables on purpose (same reason as the
--     old event_drafts): main reads `events` directly, so a half-built row there leaks an
--     unfinished event to customers. The item is the work unit; the hidden event it points at
--     (event_id) is the record.
-- (3) event_drafts is dropped: the uploader replaces the Events Factory's draft grid (the
--     factory screen/actions are removed in a later task of the same plan).
--
-- Status values live in code (types/uploader.types.ts RUN_STATUSES / ITEM_STATUSES), not in a
-- CHECK - a new status then needs no migration, same as event_drafts/tasks.

alter table public.events
  add column if not exists is_hidden boolean not null default false;

create index if not exists events_hidden_idx
  on public.events (id) where is_hidden;

create table if not exists public.uploader_runs (
  id          uuid primary key default gen_random_uuid(),
  -- Staff member who typed the brief, and the one who answers its questions (task assignee).
  created_by  uuid not null,
  asker_id    uuid not null,
  -- The brief exactly as typed.
  brief       text not null,
  -- The plan staff confirmed (UploaderPlan) and, for audit, the plan the model first proposed.
  plan        jsonb not null default '{}',
  plan_ai     jsonb,
  -- planned | building | waiting | review | done | stopped | error
  status      text not null default 'planned',
  -- Items per status, kept by the service: {"found": 4, "ready": 2, ...}
  counts      jsonb not null default '{}',
  ai_cost_usd numeric not null default 0,
  -- A rehearsal run, kept apart from real ones.
  is_test     boolean not null default false,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.uploader_items (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.uploader_runs(id) on delete cascade,
  -- Order inside the run (soonest show first).
  position    integer not null,
  -- ShowIdentity: what the suppliers say the show is.
  show        jsonb not null,
  -- found | building | question | skipped | ready | approved | rejected | error
  status      text not null default 'found',
  -- package | ticket_only | null (not decided yet)
  mode        text,
  -- The Locations row the show was matched to (id, name, city_iata, lat/lon, km away).
  location    jsonb,
  -- What the builder decided by itself / what staff should look at / what stops approval:
  -- [{ code, text, fix_url? }]
  decisions   jsonb not null default '[]',
  warnings    jsonb not null default '[]',
  blockers    jsonb not null default '[]',
  -- The open UploaderQuestion while status = 'question'.
  question    jsonb,
  -- The hidden event built for this item (events.id). No FK: events are soft-deleted, never
  -- removed, and a bad id here must not block a save.
  event_id    bigint,
  -- The full event shape createEvent accepts, kept until approval.
  payload     jsonb,
  skip_reason text,
  error       text,
  approved_by uuid,
  approved_at timestamptz,
  rejected_reason text,
  -- true = the rejection is final for this show (no retry).
  rejected_final boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists uploader_items_run_idx
  on public.uploader_items (run_id, position);

create index if not exists uploader_items_event_idx
  on public.uploader_items (event_id);

-- The review board's "waiting for an answer" list.
create index if not exists uploader_items_question_idx
  on public.uploader_items (run_id) where status = 'question';

-- Service-role only, like tasks / event_drafts / agent_instructions: RLS on, no policies.
-- Every access goes through guarded server actions (requireAdmin).
alter table public.uploader_runs enable row level security;
alter table public.uploader_items enable row level security;

-- Replaced by the uploader (see header).
drop table if exists public.event_drafts;

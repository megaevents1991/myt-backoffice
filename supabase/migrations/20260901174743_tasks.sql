-- Staff task board (Monday/Jira-lite) - backoffice only, the main app never
-- touches this table. Plan: claude artifact 0ea0c526 (01.09.2026).
--
-- status / priority carry NO CHECK constraints on purpose (repo migration
-- rule): values are validated in lib/actions/task-actions.ts, so a bad value
-- can never turn into a failed insert from a screen.

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  status       text not null default 'todo',      -- todo | in_progress | done | cancelled
  priority     text not null default 'medium',    -- urgent | high | medium | low
  assignee_id  uuid references public.user_profiles(id) on delete set null,
  created_by   uuid references public.user_profiles(id) on delete set null,
  due_date     date,
  source       text not null default 'manual',    -- manual | creative_gap
  -- For creative_gap tasks: {kind, table, row_id, label, url} - enough to link
  -- back to the screen that fixes the gap, and to dedupe repeat creation.
  source_ref   jsonb,
  deleted_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The two hot paths: "my open tasks by priority" and "is there already an
-- open task for this gap".
create index if not exists tasks_assignee_open_idx
  on public.tasks (assignee_id)
  where deleted_at is null and status in ('todo', 'in_progress');

create index if not exists tasks_source_ref_idx
  on public.tasks using gin (source_ref)
  where deleted_at is null;

-- Service-role only, like user_profiles / football_logos: RLS on, no
-- policies. Every access goes through guarded server actions.
alter table public.tasks enable row level security;

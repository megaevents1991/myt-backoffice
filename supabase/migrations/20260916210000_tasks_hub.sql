-- Tasks Hub: recurring rule engine, task thread, roadmap fields.
-- Spec: docs/superpowers/specs/2026-09-16-tasks-hub-design.md
-- No CHECK constraints on purpose (repo rule): values are validated in
-- lib/actions/task-actions.ts and lib/actions/task-rule-actions.ts.

alter table public.tasks add column if not exists board    text not null default 'ops';
alter table public.tasks add column if not exists phase    smallint;
alter table public.tasks add column if not exists channel  text;
alter table public.tasks add column if not exists progress smallint;

-- 'paused' counts as OPEN, so the partial index must include it.
drop index if exists tasks_assignee_open_idx;
create index if not exists tasks_assignee_open_idx
  on public.tasks (assignee_id)
  where deleted_at is null and status in ('todo', 'in_progress', 'paused');

-- Since when is this event red? Needed by the price_light rule's min_weeks_red.
alter table public.events add column if not exists light_red_since timestamptz;

create table if not exists public.task_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  domain       text not null,
  mode         text not null default 'weekly_digest',
  match        jsonb not null default '{}'::jsonb,
  assignee_id  uuid references public.user_profiles(id) on delete set null,
  priority     text not null default 'medium',
  due_days     smallint,
  dow          smallint not null default 0,
  board        text not null default 'ops',
  title        text,
  description  text,
  active       boolean not null default true,
  last_run_at  timestamptz,
  created_by   uuid references public.user_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists task_rules_active_idx on public.task_rules (domain) where active;
alter table public.task_rules enable row level security;

create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author_id   uuid references public.user_profiles(id) on delete set null,
  kind        text not null default 'comment',
  body        text,
  activity    jsonb,
  attachments jsonb not null default '[]'::jsonb,
  mentions    uuid[] not null default '{}',
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);
alter table public.task_comments enable row level security;

-- Private: a task screenshot can carry a customer name or a supplier price.
insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

-- One weekly digest per rule per ISO week, even if the cron and a manual
-- "run now" overlap. Only 'recurring' rows are covered - per-item tasks keep
-- the app-level dedupe (existing price_light/creative_gap rows may already
-- repeat, and an index over them could fail to build).
create unique index if not exists tasks_recurring_digest_week_uniq
  on public.tasks ((source_ref->>'row_id'), (source_ref->>'week'))
  where source = 'recurring' and deleted_at is null;

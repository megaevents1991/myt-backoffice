-- Tasks Hub: when each staff member last opened a task's conversation.
-- One row per (task, person), bumped every time the thread is shown to them. The board's
-- "unread" marker is every comment by someone else newer than this (lib/tasks/thread-watch.ts);
-- no row = never opened. Backoffice-only: RLS on, no policies, service-role access.

create table if not exists public.task_reads (
  task_id      uuid not null references public.tasks(id) on delete cascade,
  user_id      uuid not null references public.user_profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists task_reads_user_idx on public.task_reads (user_id);
alter table public.task_reads enable row level security;

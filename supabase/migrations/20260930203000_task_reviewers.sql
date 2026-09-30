-- Reviewers (Dor, 30.09): who a task goes back to when its assignee moves it to "review".
-- null / empty = the default - whoever opened the task, else whoever assigned it
-- (lib/tasks/review.ts reviewersOf). Set from the task form: "Alon opened it, but Tom has
-- to look at it - or both". Values are user_profiles ids, validated in task-actions.ts
-- (no FK on an array column; a deleted profile is simply skipped when mailing).
alter table public.tasks add column if not exists reviewer_ids uuid[];

-- "Tasks waiting for MY review" (dashboard widget) is an array-contains query.
create index if not exists tasks_reviewer_ids_idx
  on public.tasks using gin (reviewer_ids)
  where deleted_at is null;

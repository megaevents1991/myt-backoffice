-- Tasks, doc tab "באגים ושיפורים" section "טסקס" (Alon, 28.09).
--
-- 1. A fourth board, "pricing" (תמחור). Price-light and price-review tasks - and the
--    weekly digests of the price rules - used to land on "ops" (תפעול): 32 of its 37 open
--    tasks on 28.09 were price lights, and the rest of operations drowned under them.
--    `board` is plain text with no check constraint (tasks_hub), so the new value needs no
--    schema change - only the rows move. New price tasks are born on "pricing" in code
--    (lib/task-boards.ts defaultBoardFor). Only rows still on the old default move: a task
--    or rule someone deliberately put elsewhere stays where it is.
update public.tasks
   set board = 'pricing'
 where board = 'ops'
   and source in ('price_light', 'price_review');

update public.tasks t
   set board = 'pricing'
  from public.task_rules r
 where t.board = 'ops'
   and t.source = 'recurring'
   and r.domain in ('price_light', 'price_changes')
   and t.source_ref ->> 'row_id' = r.id::text;

update public.task_rules
   set board = 'pricing'
 where board = 'ops'
   and domain in ('price_light', 'price_changes');

-- 2. Sub-tasks: one general task split between several people, each with their own part.
--    One level only (enforced in createTask). A sub-task is an ordinary task - it has its
--    own assignee, status, thread and mails - that points at its parent. Deleting a task is
--    a soft delete, so the FK's "set null" only matters for a hard delete (none today).
alter table public.tasks
  add column if not exists parent_id uuid references public.tasks(id) on delete set null;

create index if not exists tasks_parent_idx
  on public.tasks (parent_id)
  where parent_id is not null and deleted_at is null;

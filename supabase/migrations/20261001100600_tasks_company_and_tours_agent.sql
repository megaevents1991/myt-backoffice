-- Tasks per company, and a role for the agents of a tours company. ADDITIVE ONLY.
--
-- 1. public.tasks gets company_id. The board was one shared list; a second
--    company needs its own. Same pattern as flights.company_id: every existing
--    task is Mega Events, and the column defaults to Mega Events, so code that
--    does not know the column (the deployed backoffice, the cron task rules)
--    keeps creating Mega Events tasks.
--    task_rules stay as they are: the automatic rules (price light, price
--    changes, weekly tasks) are Mega Events automation and the tasks they
--    create take the default.
--
-- 2. Role `tours_agent`: a sales agent of a tours company (Mega Family).
--    Deliberately NOT the existing `agent` role - that one belongs to the Mega
--    Events partner portal (/portal, partner codes, credit, coupons). A
--    tours_agent sees the departures board read-only today and gets a portal of
--    its own later.
--
-- Rollback: supabase/rollback/20261001_multi_company.sql.

-- 1. tasks.company_id -----------------------------------------------------------
alter table public.tasks
  add column if not exists company_id uuid references public.companies(id);

update public.tasks
  set company_id = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601'
  where company_id is null;

alter table public.tasks
  alter column company_id set default 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601';
alter table public.tasks
  alter column company_id set not null;

create index if not exists tasks_company_id_idx on public.tasks (company_id);

-- 2. role tours_agent -----------------------------------------------------------
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('superadmin', 'admin', 'editor', 'office_manager', 'agent', 'affiliate', 'forms_operator', 'tours_agent'));

alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members add constraint company_members_role_check
  check (role in ('admin', 'editor', 'office_manager', 'agent', 'affiliate', 'forms_operator', 'tours_agent'));

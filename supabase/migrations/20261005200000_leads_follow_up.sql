-- A lead's follow-up day and the staff's own notes (Alon's road map, 05.10.2026:
-- "לידים ... הערות שלהם, סטטוס, פולו אפ").
--
-- Until now a lead had a status and an owner only, so "call back on Sunday" lived
-- in someone's head. Two nullable columns: the day staff plan to get back to the
-- lead, and free notes that the customer never sees. The inbox shows the leads
-- whose day has come ("Follow-up due").
--
-- Additive only. public.leads is written by <schema>.submit_lead (the site's
-- forms), which names its columns, so it is not affected; no view reads the table.
-- Rollback: section 16 of supabase/rollback/20261001_multi_company.sql.

alter table public.leads
  add column if not exists follow_up_date date,
  add column if not exists notes text;

-- "which leads are due today" is asked on every open of the inbox
create index if not exists leads_follow_up_idx
  on public.leads (company_id, follow_up_date)
  where follow_up_date is not null;

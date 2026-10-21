-- Tour uploader (agent #3) - the security review's grants + the run's subject cache. 21.10.2026.
-- Idempotent: safe to re-run (revoke is idempotent, the column is `if not exists`).
--
-- (1) uploader_runs / uploader_items are read and written by the service role only (the backoffice's
--     server actions). RLS is on with no policies, so anon / authenticated already see nothing - but
--     Supabase's default grants still hand those roles table privileges. Taking them away means a
--     policy added by mistake later can never open the work queue (briefs, answers, people's ids) to
--     the public anon key.
revoke all on public.uploader_runs, public.uploader_items from anon, authenticated;

-- (2) The run's resolved subject (`resolveSubject`: the subject, its artist / team rows, every team's
--     Hebrew name, the competition), written by createRun and refreshed hourly by buildNextItem
--     (`freshSubjectCache`, lib/uploader/run-rules.ts). Before it a competition run resolved per ITEM -
--     the whole sliced TixStock read plus `football_teams` for every fixture. Never read by main.
alter table public.uploader_runs add column if not exists subject_cache jsonb;

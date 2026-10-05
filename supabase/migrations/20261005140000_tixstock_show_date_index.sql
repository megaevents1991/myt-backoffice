-- tixstock_events: an index for the way the table is read, and fresh planner statistics.
--
-- The table had ONE index - its key. Everything that reads it goes by show_date: the browse
-- screen (future events, sorted, paged), the purge cron (events that ended), stadium memory
-- and the price advisor (a day or two around a fixture). Each of those was a full scan of
-- 130,000 rows / 113 MB - 594 of them in nine days (measured 2026-10-05).
-- (show_date, event_id) is also the browse screen's exact sort, so a page is an index walk.
--
-- Statistics come FIRST and the index last: creating it blocks writes to the table until this
-- file commits, so nothing slow may follow it.
--
-- The statistics were reset on 2026-09-26, and autovacuum re-analyzes a table only once enough
-- of its rows changed - so every quiet table has had none since. The planner believed
-- p1_events, football_teams, categories and event_tags hold 0 rows and hotels 175 (it holds
-- 107,757). ANALYZE reads a sample, takes no lock a query waits on, and changes no data.
-- Only tables that were never analyzed are touched, so re-running this file does nothing.
set statement_timeout = '300s';

do $$
declare
  t record;
begin
  for t in
    select schemaname, relname
    from pg_stat_user_tables
    where schemaname in ('public', 'tours')
      and last_analyze is null
      and last_autoanalyze is null
  loop
    execute format('analyze %I.%I', t.schemaname, t.relname);
  end loop;
end $$;

reset statement_timeout;

create index if not exists tixstock_events_show_date_idx
  on public.tixstock_events (show_date, event_id);

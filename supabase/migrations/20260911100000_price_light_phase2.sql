-- Price light (רמזור) phase 2.
-- 1) ISSTA/OnTour publish a travel window instead of a match date: the matcher looks up
--    undated listings by window (price-light-match.ts candidatesFor).
-- 2) One OPEN price-light task per event+scope: closes the TOCTOU gap two concurrent
--    "משימה" clicks could slip through (price-light-tasks.ts openPriceLightTask).
-- Idempotent; no CHECK constraints (repo rule).

-- `scope` is the second column because candidatesFor filters competitor AND scope before the
-- window OR-clause (final review, M2).
create index if not exists cl_window_idx
  on public.competitor_listings (competitor, scope, travel_depart, travel_return)
  where event_date is null;

create unique index if not exists tasks_price_light_open_uniq
  on public.tasks ((source_ref->>'row_id'), (source_ref->>'kind'))
  where source = 'price_light'
    and status in ('todo', 'in_progress')
    and deleted_at is null;

-- Portal history cut-off per partner (Dor, 2026-09-16).
--
-- Aviran's tracking code existed since 03/2025; when he got portal access in
-- 09/2026 the portal showed him a 06/2025 booking he did not recognise. The
-- portal lists everything attributed to the code, and a code can be older than
-- the partner's actual start with us (reused, dormant, typed by hand).
--
-- portal_history_from: the portal (reservations, dashboard tiles, activity
--   feed, user log) shows only bookings created on/after this date. NULL =
--   everything, which is every existing partner - nothing changes until staff
--   set it in the partner editor. REPORTING ONLY: the monthly partner report
--   and commission maths never read it - money is money whenever it was earned.

alter table public.partners
  add column if not exists portal_history_from date;

comment on column public.partners.portal_history_from is
  'Portal shows bookings from this date only (null = all). Reporting cut-off, never touches commission/report.';

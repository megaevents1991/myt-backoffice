-- What the 2026-10-07 load check and Supabase's advisor asked for. Nothing here changes a row.
--
-- 1. Four functions without a fixed search_path (advisor: "function_search_path_mutable"),
--    one of them a SECURITY DEFINER trigger anyone could be granted to run.
-- 2. reservations.event_id - a foreign key with no index (own-stock count, sold-out check).
-- 3. tixstock_events - the browse screen and stadium memory read 105,000 rows / 116 MB to
--    find the 8,600 events that have tickets (90,000 future rows hold ZERO tickets). On
--    2026-10-06 the screen's count hit the statement timeout and answered 500.
-- 4. hotels - three identical indexes on `hid`; every cached hotel was written three times.
--
-- ORDER MATTERS. The file commits as one unit, so a lock taken early is held to the end:
-- the instant things first, the index builds after them (they only block WRITES to
-- tixstock_events, which crons alone do), and the hotels drop LAST - it locks the table
-- the site's hotel search reads, so nothing slow may follow it.
--
-- A lock that cannot be had in 8 seconds fails the file instead of queueing the site's
-- reads behind it (a production dump holds hotels for a minute). Re-running is safe.
set lock_timeout = '8s';

-- 1. Functions ---------------------------------------------------------------------------
-- Bodies are unchanged. count_coupon_paid_use reads `coupons` by its bare name, so it needs
-- `public` on the path; the others call built-ins only.
alter function public.count_coupon_paid_use() set search_path = public, pg_temp;
alter function public.flights_derive_stops() set search_path = public, pg_temp;
alter function public.update_updated_at_column() set search_path = public, pg_temp;
alter function public.price_light_newest_matches(integer[], timestamp with time zone)
  set search_path = public, pg_temp;

-- A trigger fires without an EXECUTE check, so the counter keeps working; what goes away is
-- a SECURITY DEFINER function that anon / authenticated were allowed to call.
-- service_role and the owner keep their own grants.
revoke execute on function public.count_coupon_paid_use() from public, anon, authenticated;

-- 2. reservations -------------------------------------------------------------------------
create index if not exists reservations_event_id_idx
  on public.reservations (event_id);

-- 3. tixstock_events ----------------------------------------------------------------------
-- The browse screen's two sets, each in the screen's own sort. Partial on purpose: 8,900
-- and 300 entries instead of 105,000, and a row whose count did not change still takes a
-- cheap (HOT) update. The route reads them as two plain filters (`ticket_count > 0`,
-- `ticket_count is null`) - an OR of the two would not match either index.
create index if not exists tixstock_events_with_tickets_idx
  on public.tixstock_events (show_date, event_id)
  where ticket_count > 0;

create index if not exists tixstock_events_unknown_tickets_idx
  on public.tixstock_events (show_date, event_id)
  where ticket_count is null;

-- Stadium memory asks "which venues is this drawing used for" - a full scan per question.
create index if not exists tixstock_events_venue_map_url_idx
  on public.tixstock_events (venue_map_url);

-- NOT indexed, on purpose: `updated_at` (the "last synced" probe sorts by it). Every sync
-- rewrites that column on every row, so an index on it would turn 295,000 cheap updates
-- per ten days into full ones to speed up a question asked a few times a day.

-- 4. hotels -------------------------------------------------------------------------------
-- hotels_pkey is the same btree(hid) and stays; main's upsert on `hid` keeps resolving to it.
drop index if exists public.idx_hotels_hid;
drop index if exists public.hotels_hid_uidx;

reset lock_timeout;

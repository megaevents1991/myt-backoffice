-- Availability snapshot for the TixStock browser (backoffice-only table).
-- Written by the nightly feed sync (include_listings=true):
--   null = not yet measured, 0 = no listings in feed, >0 = sum of quantity_available.
alter table tixstock_events add column if not exists ticket_count integer;

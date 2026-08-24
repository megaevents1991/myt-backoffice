-- Soft delete for reservations, same convention as events: is_deleted holds
-- a "MM-DD-YYYY" date string (not boolean), null = not deleted. Lets staff
-- remove test/junk reservations from the main list (client-side filter, like
-- events-table.tsx) without a hard DELETE - no FK cascade risk, recoverable.
alter table reservations add column if not exists is_deleted text;

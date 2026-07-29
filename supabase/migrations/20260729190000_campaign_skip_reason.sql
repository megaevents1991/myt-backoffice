-- Why an event has no campaign creative, in the event's own row.
--
-- The generator used to report its skips only in the cron response, which
-- nobody reads — so "why is this product missing from the feed?" had no answer
-- anywhere in the UI. Now the reason is stored, cleared the moment a creative
-- is produced, and shown next to the event.

alter table events add column if not exists campaign_skip_reason text;

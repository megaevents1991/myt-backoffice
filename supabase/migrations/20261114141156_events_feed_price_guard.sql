-- The Meta feed's abnormal-price guard (lib/feed/price-guard.ts, Dor 14.11.2026).
-- Event 918 (Bob Dylan, London 08.12) ran in the catalog at $19,907 a traveller for a day and a half:
-- the only ticket left on sale cost $18,672. An event whose price is abnormal is now held out of the
-- feed (its creative is taken off) and staff are mailed once.
--   { hold: { since, reason: "ceiling" | "jump", card_usd, ticket_usd, baseline_usd, alerted_at } | null,
--     approved: { card_usd, by, at } | null }   - null = nothing held, nothing approved.
-- Backoffice only: written by the guard (feed publish, hourly creative run, push to feed) and the editor's
-- "the price is right"; updateEvent strips it. myt-main never reads it.
alter table public.events add column if not exists feed_price_guard jsonb;

-- The guard reads the held / approved rows on every pass.
create index if not exists events_feed_price_guard_idx on public.events (id) where feed_price_guard is not null;

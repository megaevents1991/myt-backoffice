-- Price light: staff corrections to what a competitor listing says (2026-09-18).
--
-- The detailed comparison on /price-light lets an admin fix a sampled value that is wrong - a
-- price that is absurdly low, a hotel the parser gave the wrong stars, a listing that is not this
-- event at all - with a reason and a note. A correction is an OVERLAY, never a write to
-- competitor_listings: the next crawl would simply overwrite that row. The matcher and the
-- comparison lay the live corrections over the crawled values (staff > page > AI).
--
--   field = 'not_same_event' -> belongs to one (event, listing) PAIR, so event_id is set.
--   every other field        -> belongs to the LISTING (every event matched to it), event_id null.
--
-- A correction is "live" while it is not revoked AND the crawled value still equals `original`:
-- once the source itself changes, the market moved and the correction is stale (same idea as the
-- light override's drift rule). That is computed on read - nothing here expires rows.
--
-- Backoffice-only: RLS on, no policies, service-role access; the main app never reads it.
-- Rows go with their listing (on delete cascade), so the 180-day listing retention covers them.

create table if not exists public.competitor_listing_corrections (
  id          bigint generated always as identity primary key,
  listing_id  bigint not null references public.competitor_listings(id) on delete cascade,
  event_id    integer references public.events(id) on delete cascade,
  competitor  text not null,
  field       text not null,
  original    jsonb,
  value       jsonb,
  reason      text,
  note        text not null,
  source      text,
  created_by  text,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  text
);

alter table public.competitor_listing_corrections enable row level security;

-- One un-revoked correction per field of a listing (per event for the pair-scoped field).
create unique index if not exists competitor_listing_corrections_live_uniq
  on public.competitor_listing_corrections (listing_id, field, coalesce(event_id, 0))
  where revoked_at is null;

create index if not exists competitor_listing_corrections_created_idx
  on public.competitor_listing_corrections (competitor, created_at desc);

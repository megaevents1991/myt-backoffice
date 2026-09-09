-- Google reviews of the Mega Events business profile, mirrored into Supabase so
-- the site renders "לקוחות משתפים" itself instead of the Elfsight widget
-- (2026-09-09 - the Elfsight account belonged to a third party and the free
-- tier hides the widget after 200 views/month).
--
-- Backoffice WRITES (daily cron `googleReviewsSync` via Google Places API, plus
-- a one-time seed of the historical reviews from the retired widget's feed);
-- myt-main READS with its service client (RLS on, no policies, same as every
-- backoffice-owned table). `is_hidden` lets staff pull a review off the site
-- without deleting the mirror row.

create table if not exists public.google_review_sources (
  place_id      text primary key,
  display_name  text,
  rating        numeric(2,1),
  review_count  integer,
  maps_url      text,
  synced_at     timestamptz,
  sync_error    text
);

create table if not exists public.google_reviews (
  -- Google's review id (last segment of the Places API review `name`, or the
  -- id carried in the review's Maps URL for seeded rows).
  review_key        text primary key,
  place_id          text not null references public.google_review_sources(place_id),
  author_name       text not null,
  author_photo_url  text,
  author_url        text,
  rating            smallint not null check (rating between 1 and 5),
  text              text,
  text_html         text,
  language          text,
  published_at      timestamptz not null,
  review_url        text,
  reply_text        text,
  reply_at          timestamptz,
  images            jsonb not null default '[]'::jsonb,
  is_hidden         boolean not null default false,
  first_seen_at     timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists google_reviews_place_published_idx
  on public.google_reviews (place_id, published_at desc);

-- The Places API and the seed encode review ids differently, so the sync also
-- matches on author + publish day to avoid mirroring the same review twice.
create index if not exists google_reviews_author_day_idx
  on public.google_reviews (place_id, author_name, (published_at::date));

alter table public.google_review_sources enable row level security;
alter table public.google_reviews enable row level security;

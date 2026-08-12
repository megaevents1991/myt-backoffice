-- Campaign video for the Meta ACTIVITIES catalog feed (video[0].url).
-- Must be a DIRECT link to a video FILE (e.g. .../ariana-london.mp4) - Meta
-- rejects player pages, so YouTube/Instagram/Vimeo links do NOT work; upload
-- the raw file (max 200 MB) to Supabase Storage and paste its public URL.
-- Optional: events without one simply omit the column from the feed.
-- Set per event in the backoffice event editor (Images card).

alter table events add column if not exists campaign_video_url text;

comment on column events.campaign_video_url is
  'Direct video FILE url (mp4/mov/…) for the Meta activities feed video[0].url. Not a player/YouTube link.';

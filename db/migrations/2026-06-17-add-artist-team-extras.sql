-- Bucket B — artist/team page enrichments (doc items 19b / 20 / 21 / 24).
-- Added to BOTH people tables so artist + team pages share one UI + reader.
-- jsonb arrays default to '[]' so the readers map them with no null checks.
-- Additive only (ADD COLUMN IF NOT EXISTS) → safe for the live site; the main
-- app ignores columns it doesn't read yet.

alter table artists
  add column if not exists hero_video_url text,                  -- #19b: YouTube clip behind the hero circle
  add column if not exists banners  jsonb not null default '[]',  -- #20:  [{ "image_url": "", "link_url": "", "title": "" }]
  add column if not exists gallery  jsonb not null default '[]',  -- #21:  [ "https://…", … ]
  add column if not exists videos   jsonb not null default '[]';  -- #24:  [{ "url": "https://youtu.be/…", "label": "" }]

alter table football_teams
  add column if not exists hero_video_url text,
  add column if not exists banners  jsonb not null default '[]',
  add column if not exists gallery  jsonb not null default '[]',
  add column if not exists videos   jsonb not null default '[]';

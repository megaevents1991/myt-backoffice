-- 2026-07-02 - Card-art zoom controls. art_image_scale zooms the artist
-- cut-out, art_bg_scale zooms the background (blob shape or photo).
-- Floats, 1 = 100%. All nullable: null renders at the default 100%.
alter table public.events
  add column if not exists art_image_scale real,
  add column if not exists art_bg_scale    real;

alter table public.artists
  add column if not exists art_image_scale real,
  add column if not exists art_bg_scale    real;

alter table public.football_teams
  add column if not exists art_image_scale real,
  add column if not exists art_bg_scale    real;

alter table public.categories
  add column if not exists art_image_scale real,
  add column if not exists art_bg_scale    real;

alter table public.blog_posts
  add column if not exists art_image_scale real,
  add column if not exists art_bg_scale    real;

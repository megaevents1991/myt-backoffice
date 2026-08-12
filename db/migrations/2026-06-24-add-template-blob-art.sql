-- 2026-06-24 - Blob card-art for CMS templates (artists, football_teams,
-- categories, blog_posts). Mirrors the events art_* columns. All nullable:
-- when art_image_url is null the site falls back to the plain image_url.
alter table public.artists
  add column if not exists art_image_url   text,
  add column if not exists art_color_index integer,
  add column if not exists art_shape_index integer;

alter table public.football_teams
  add column if not exists art_image_url   text,
  add column if not exists art_color_index integer,
  add column if not exists art_shape_index integer;

alter table public.categories
  add column if not exists art_image_url   text,
  add column if not exists art_color_index integer,
  add column if not exists art_shape_index integer;

alter table public.blog_posts
  add column if not exists art_image_url   text,
  add column if not exists art_color_index integer,
  add column if not exists art_shape_index integer;

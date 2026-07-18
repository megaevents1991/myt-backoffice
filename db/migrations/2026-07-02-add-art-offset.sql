-- 2026-07-02 — Card-art cut-out position. Percent of frame size, 0 = current
-- default placement (bottom-center anchored). X positive = right, Y positive
-- = down. Range used by the picker: -50..50. All nullable: null = 0.
alter table public.events
  add column if not exists art_image_offset_x real,
  add column if not exists art_image_offset_y real;

alter table public.artists
  add column if not exists art_image_offset_x real,
  add column if not exists art_image_offset_y real;

alter table public.football_teams
  add column if not exists art_image_offset_x real,
  add column if not exists art_image_offset_y real;

alter table public.categories
  add column if not exists art_image_offset_x real,
  add column if not exists art_image_offset_y real;

alter table public.blog_posts
  add column if not exists art_image_offset_x real,
  add column if not exists art_image_offset_y real;

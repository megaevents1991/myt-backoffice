-- Homepage layout (עמוד הבית) - 2026-09-16.
-- Backoffice WRITES (the /homepage board), myt-main READS with its service client
-- (app/page.tsx via lib/homepageLayout.ts). RLS on, no policies - same as every
-- backoffice-owned table.
--
-- homepage_sections: order + visibility of the homepage blocks. `hero` is always
-- first (the board pins it). Keys the table lacks are appended by main in the
-- default order, so a new section in code shows before staff touch it.
--
-- homepage_items: the manual order INSIDE a carousel section. ref_id is the
-- events.id as text for events and the row SLUG for artists / football teams
-- (main identifies people by slug). Anything not listed follows the section's
-- automatic rule after the listed items.
--
-- Backfilled from the columns this replaces (`display_order` for the football /
-- artists rows, `featured_order` for the hero ring, interleaved artist/team the
-- way main's buildHeroItems did) so the deploy changes nothing visually. Those
-- columns stay but nothing writes them any more.

create table if not exists public.homepage_sections (
  key         text primary key,
  position    integer not null default 0,
  is_visible  boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists public.homepage_items (
  section     text not null,
  kind        text not null check (kind in ('event', 'artist', 'team')),
  ref_id      text not null,
  position    integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (section, kind, ref_id)
);

create index if not exists homepage_items_section_position_idx
  on public.homepage_items (section, position);

alter table public.homepage_sections enable row level security;
alter table public.homepage_items enable row level security;

comment on table public.homepage_sections is
  'Order + visibility of the myt-main homepage sections. Written by the backoffice /homepage board.';
comment on table public.homepage_items is
  'Manual item order inside a homepage carousel section. ref_id = events.id (text) or the artist/team slug.';

-- Default section order (hero first, reviews after the artists per Dor 2026-09-16).
insert into public.homepage_sections (key, position, is_visible) values
  ('hero', 0, true),
  ('most_wanted', 1, true),
  ('newest', 2, true),
  ('football', 3, true),
  ('artists', 4, true),
  ('reviews', 5, true),
  ('more_events', 6, true)
on conflict (key) do nothing;

-- Backfill the carousel rows from display_order (only rows that had one).
insert into public.homepage_items (section, kind, ref_id, position)
select 'football', 'team', slug, row_number() over (order by display_order, name)
from public.football_teams
where is_deleted = false and is_active = true and display_order is not null
on conflict do nothing;

insert into public.homepage_items (section, kind, ref_id, position)
select 'artists', 'artist', slug, row_number() over (order by display_order, name)
from public.artists
where is_deleted = false and is_active = true and display_order is not null
on conflict do nothing;

-- Backfill the hero ring: featured artists and teams each ranked by
-- featured_order, then interleaved artist, team, artist, team (main's old rule).
insert into public.homepage_items (section, kind, ref_id, position)
select 'hero', kind, slug, position
from (
  select 'artist' as kind, slug,
         (row_number() over (order by featured_order, name)) * 2 - 1 as position
  from public.artists
  where is_deleted = false and is_active = true and featured_order is not null
  union all
  select 'team' as kind, slug,
         (row_number() over (order by featured_order, name)) * 2 as position
  from public.football_teams
  where is_deleted = false and is_active = true and featured_order is not null
) ranked
on conflict do nothing;

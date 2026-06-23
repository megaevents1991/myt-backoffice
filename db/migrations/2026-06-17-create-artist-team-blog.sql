-- Phase 1 of the Contentful → Supabase migration: typed per-type tables for
-- artists, football teams, and blog posts. The data-copy script
-- (myt-main/scripts/migrate-contentful.mjs) fills these from Contentful;
-- the live site keeps reading Contentful until Phase 2 swaps the readers.
--
-- Keys carried over so nothing breaks:
--   slug         = the Contentful entry ID  (→ /artists/[id] + categories.member_ids keep working)
--   name_english = the old nameDBenglish    (→ events match by name_english, unchanged)
-- Richtext (bio / main_content) is stored as the Contentful rich-text JSON doc
-- verbatim, so documentToReactComponents renders it with no changes.

create table if not exists artists (
  id              bigint generated always as identity primary key,
  slug            text not null unique,          -- = Contentful entry id
  name            text not null,
  name_english    text,                          -- = nameDBenglish (events match key)
  preview_text    text,
  image_url       text,                          -- heroBanner, re-hosted in `templates` bucket
  image_width     integer,
  image_height    integer,
  bio             jsonb,                         -- Contentful rich-text document (verbatim)
  seo_title       text,
  meta_description text,
  meta_tags       text,
  featured_order  integer,                       -- non-null = in the hero carousel, in this order
  is_active       boolean not null default true,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_artists_active on artists(is_active) where is_deleted = false;
create index if not exists idx_artists_name_english on artists(name_english);
create index if not exists idx_artists_featured on artists(featured_order);

create table if not exists football_teams (
  id              bigint generated always as identity primary key,
  slug            text not null unique,
  name            text not null,
  name_english    text,
  preview_text    text,
  image_url       text,
  image_width     integer,
  image_height    integer,
  bio             jsonb,
  seo_title       text,
  meta_description text,
  meta_tags       text,
  featured_order  integer,
  is_active       boolean not null default true,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_football_active on football_teams(is_active) where is_deleted = false;
create index if not exists idx_football_name_english on football_teams(name_english);
create index if not exists idx_football_featured on football_teams(featured_order);

create table if not exists blog_posts (
  id              bigint generated always as identity primary key,
  slug            text not null unique,
  name            text not null,
  title           text,
  preview_text    text,
  by_who          text,
  image_url       text,
  image_width     integer,
  image_height    integer,
  main_content    jsonb,                         -- Contentful rich-text document (verbatim)
  seo_title_tag   text,
  meta_description text,
  meta_tags       text,
  display_order   integer not null default 0,
  is_active       boolean not null default true,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_blog_active on blog_posts(is_active) where is_deleted = false;

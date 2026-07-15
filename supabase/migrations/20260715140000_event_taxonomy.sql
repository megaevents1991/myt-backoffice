-- Event taxonomy: hierarchical category tree + curated flat tag pool.
-- Additive. Does NOT touch the legacy events.tags badge or the categories cards.
-- No RLS (matches the categories table; main app reads via anon).

create table if not exists event_categories (
  id             bigint generated always as identity primary key,
  parent_id      bigint references event_categories(id) on delete restrict,
  slug           text not null unique,
  name           text not null,
  name_english   text,
  image_url      text,
  description    text,
  display_order  integer not null default 0,
  is_active      boolean not null default true,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_event_categories_parent on event_categories(parent_id);
create index if not exists idx_event_categories_slug on event_categories(slug);
create index if not exists idx_event_categories_active on event_categories(is_active) where is_deleted = false;
create index if not exists idx_event_categories_order on event_categories(display_order);

create table if not exists event_category_links (
  event_id     bigint not null references events(id) on delete cascade,
  category_id  bigint not null references event_categories(id) on delete cascade,
  primary key (event_id, category_id)
);
create index if not exists idx_ecl_category on event_category_links(category_id);

create table if not exists event_tags (
  id             bigint generated always as identity primary key,
  slug           text not null unique,
  name           text not null,
  name_english   text,
  is_active      boolean not null default true,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_event_tags_slug on event_tags(slug);
create index if not exists idx_event_tags_active on event_tags(is_active) where is_deleted = false;

create table if not exists event_tag_links (
  event_id  bigint not null references events(id) on delete cascade,
  tag_id    bigint not null references event_tags(id) on delete cascade,
  primary key (event_id, tag_id)
);
create index if not exists idx_etl_tag on event_tag_links(tag_id);

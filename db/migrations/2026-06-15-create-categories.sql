-- Categories - first per-type "Template" table of the backoffice CMS that will
-- replace Contentful. Each Contentful content type becomes its own typed table
-- sharing a common base (id, slug, name, name_english, image_url, display_order,
-- is_active, is_deleted, timestamps). New types = a new typed table + a 6-line
-- actions file (see lib/actions/template-crud.ts factory).

create table if not exists categories (
  id             bigint generated always as identity primary key,
  slug           text not null unique,
  name           text not null,
  name_english   text,
  image_url      text,
  -- category-specific
  subtitle       text,            -- e.g. "עונת 2025/26 · אירופה · שלב ההכרעה"
  tag            text,            -- optional badge, e.g. "כרטיסים אחרונים"
  sport          text,            -- grouping label, e.g. "כדורגל"
  member_ids     text[] not null default '{}',  -- artist/team page IDs (Contentful for now)
  link_url       text,            -- optional override; if set the card links here
  -- base
  display_order  integer not null default 0,
  is_active      boolean not null default true,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_categories_slug on categories(slug);
create index if not exists idx_categories_active on categories(is_active) where is_deleted = false;
create index if not exists idx_categories_order on categories(display_order);

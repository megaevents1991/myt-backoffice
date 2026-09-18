-- Homepage free blocks (עמוד הבית) - 2026-09-18.
-- Spec: docs/superpowers/specs/2026-09-18-homepage-blocks-design.md
--
-- homepage_sections stops being a fixed list of seven coded sections: staff can
-- rename a section and add blocks of their own (event slider, banner; text /
-- destinations / gallery follow on the same columns).
--
--   page   - which page the row belongs to. Only 'home' exists today; the column
--            is here so another page (or brand) never needs a rewrite.
--   type   - 'builtin' = one of the seven sections in code, otherwise a block
--            type. NO check constraint on purpose: new types arrive without a
--            migration, and the backoffice validates (lib/homepage/blocks.ts).
--   title  - staff title. Null = the title in code (builtin) / no heading (block).
--   config - per-type settings, validated by the backoffice before every write.
--
-- `key` stays the primary key: builtin keys are the known strings, a block's key
-- is 'blk_' + 8 hex chars. A block's pinned events live in homepage_items with
-- section = that key, exactly like the builtin rows.
--
-- myt-main in production selects only key/position/is_visible and drops keys it
-- does not know, so this migration changes nothing on the site by itself.
--
-- Idempotent; NOT NULL columns go nullable -> backfill -> default + not null.

alter table public.homepage_sections add column if not exists page text;
update public.homepage_sections set page = 'home' where page is null;
alter table public.homepage_sections alter column page set default 'home';
alter table public.homepage_sections alter column page set not null;

alter table public.homepage_sections add column if not exists type text;
update public.homepage_sections set type = 'builtin' where type is null;
alter table public.homepage_sections alter column type set default 'builtin';
alter table public.homepage_sections alter column type set not null;

alter table public.homepage_sections add column if not exists title text;

alter table public.homepage_sections add column if not exists config jsonb;
update public.homepage_sections set config = '{}'::jsonb where config is null;
alter table public.homepage_sections alter column config set default '{}'::jsonb;
alter table public.homepage_sections alter column config set not null;

create index if not exists homepage_sections_page_position_idx
  on public.homepage_sections (page, position);

comment on column public.homepage_sections.type is
  'builtin = a section coded in myt-main; otherwise a staff-added block type (event_slider, banner, ...). Validated in the backoffice, no check constraint.';
comment on column public.homepage_sections.title is
  'Staff title. Null = the default title in code (builtin) or no heading (block).';

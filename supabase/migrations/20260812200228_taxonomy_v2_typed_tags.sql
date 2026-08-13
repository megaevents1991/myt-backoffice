-- Taxonomy v2: typed tags + rules-based auto-tagger config.
-- Spec: docs/superpowers/specs/2026-08-12-taxonomy-shopify-model-design.md
-- Idempotent: the workflow may re-run this file.

alter table event_tags add column if not exists type text not null default 'other';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_event_tags_type'
  ) then
    alter table event_tags add constraint chk_event_tags_type
      check (type in ('vertical','league','team','artist','genre','city','other'));
  end if;
end $$;

create index if not exists idx_event_tags_type on event_tags(type);

-- Auto-tagger rules: pattern -> tag. field 'name' = case-insensitive contains
-- against events.name + name_english; field 'city' = case-insensitive equality
-- against events.location->>'city_iata'. Backoffice-only table (main never reads).
create table if not exists tag_rules (
  id bigint generated always as identity primary key,
  tag_id bigint not null references event_tags(id) on delete cascade,
  field text not null check (field in ('name','city')),
  pattern text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tag_rules_tag on tag_rules(tag_id);

-- Backoffice-only config. RLS on (no policies): the default-privilege grants
-- otherwise leave this anon-writable via PostgREST; service_role bypasses RLS.
alter table tag_rules enable row level security;

grant select, insert, update, delete on tag_rules to service_role;
grant select on event_tags to anon, authenticated;

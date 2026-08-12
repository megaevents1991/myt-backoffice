-- Tags COMPOSE categories - not the other way around.
--
-- Old model: an event was linked to categories AND tagged, by hand, twice
-- (261 of 263 categorised events carried both). New model: you only ever tag
-- an event; a category declares WHICH TAGS make it up, and every event
-- carrying one of those tags is pulled in automatically. An event lands in as
-- many categories as its tags earn it.
--
-- event_category_links stays alive as a VIEW with the exact same shape
-- (event_id, category_id) so the main app keeps reading it untouched - both
-- /c/[...slug] pages and the Meta feed's product_type. The old table is kept
-- as _legacy for one release as a rollback net; nothing reads it.

create table if not exists event_category_tags (
  category_id  bigint not null references event_categories(id) on delete cascade,
  tag_id       bigint not null references event_tags(id) on delete cascade,
  primary key (category_id, tag_id)
);
create index if not exists idx_ect_tag on event_category_tags(tag_id);

alter table if exists event_category_links rename to event_category_links_legacy;

-- Membership = OR over the category's tags (one matching tag is enough).
-- NO tree inheritance: a parent category collects only what ITS OWN tags
-- collect, so "ספורט" must list the tags it wants rather than absorbing
-- "כדורגל" through the tree (main's includeDescendants is switched off to
-- match). distinct because two of a category's tags can hit the same event.
create or replace view event_category_links as
select distinct
  etl.event_id,
  ect.category_id
from event_category_tags ect
join event_tag_links etl on etl.tag_id = ect.tag_id;

-- PostgREST reads as anon (main app) / authenticated; service_role for the
-- backoffice. The view is read-only by construction - writes now go to
-- event_category_tags and event_tag_links.
grant select on event_category_links to anon, authenticated, service_role;

-- One editing surface: the Templates category card is where the team builds a
-- category page, so that is where its tags are chosen too. The card needs to
-- know which taxonomy node holds them - until now the two were paired only by
-- the /c/<slug> link_url the auto-created card carried.
alter table categories
  add column if not exists event_category_id bigint references event_categories(id) on delete set null;

update categories c
set event_category_id = ec.id
from event_categories ec
where c.event_category_id is null
  and c.link_url like '/c/%'
  and ec.is_deleted = false
  and ec.slug = regexp_replace(rtrim(c.link_url, '/'), '^.*/', '');

-- One category table.
--
-- A category lived twice: `categories` (the Templates card the team builds —
-- image, subtitle, blob art, member pages) and `event_categories` (the
-- taxonomy node main read for /c/ pages and the feed's product_type). Every
-- field but `parent_id` was duplicated, and since the Templates form became
-- the single editing surface the node was a shadow record kept in sync by
-- code. The tree moves onto the card and the shadow goes away.
--
-- The two tables map 1:1 by slug (sport, football, music, shows, tennis,
-- festivals, formula-1 — the node spelled "פרומולה 1" while the card spells it
-- "פורמולה 1", but both slug to formula-1).

-- 1. the tree moves onto the card
alter table categories
  add column if not exists parent_id bigint references categories(id) on delete restrict;
create index if not exists idx_categories_parent on categories(parent_id);

update categories c
set parent_id = pc.id
from event_categories n
join event_categories pn on pn.id = n.parent_id and pn.is_deleted = false
join categories pc on pc.slug = pn.slug and pc.is_deleted = false
where c.slug = n.slug
  and c.is_deleted = false
  and n.is_deleted = false
  and c.parent_id is null;

-- 2. tags compose the CARD now
create table if not exists category_tags (
  category_id bigint not null references categories(id) on delete cascade,
  tag_id      bigint not null references event_tags(id) on delete cascade,
  primary key (category_id, tag_id)
);
create index if not exists idx_category_tags_tag on category_tags(tag_id);

insert into category_tags (category_id, tag_id)
select c.id, ect.tag_id
from event_category_tags ect
join event_categories n on n.id = ect.category_id and n.is_deleted = false
join categories c on c.slug = n.slug and c.is_deleted = false
on conflict do nothing;

-- 3. membership stays derived, now over the card's tags. Same view name and
--    shape (event_id, category_id) main already reads — only the id space
--    changes, from node ids to card ids.
drop view if exists event_category_links;
create view event_category_links as
select distinct
  etl.event_id,
  ct.category_id
from category_tags ct
join event_tag_links etl on etl.tag_id = ct.tag_id;

grant select on event_category_links to anon, authenticated, service_role;

-- 4. retire the shadow. Kept as _legacy for one release: nothing reads it, and
--    it is the only copy of the old node ids if a rollback is ever needed.
drop table if exists event_category_tags;
alter table if exists event_categories rename to event_categories_legacy;
alter table categories drop column if exists event_category_id;

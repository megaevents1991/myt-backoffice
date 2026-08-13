-- Taxonomy v2 data reseed. Approved dispositions:
-- docs/superpowers/specs/2026-08-12-taxonomy-shopify-model-design.md
-- Idempotent: keyed by slug; re-running is a no-op.
-- Re-run re-asserts seed state: manual edits to seeded rows (retyping a tag,
-- reactivating tennis, recomposing football's tags) are reverted by a re-run.

-- ===== 1. Retype existing tags (pre- and post-rename slugs both listed) =====
update event_tags set type='vertical' where is_deleted=false
  and slug in ('football','music','tennis');
update event_tags set type='league' where is_deleted=false
  and slug in ('premier-league','la-liga','bundesliga','eredivisie',
               'champions-league','seria-a-itilian-league','serie-a');
update event_tags set type='genre' where is_deleted=false
  and slug in ('hip-hop','electronic-music','punk-rock','rock-roll','rock',
               'clasic-rock','classic-rock','country-rock','country',
               'item-4','pop','classic-2','classical');
update event_tags set type='artist' where is_deleted=false
  and slug in ('item-3','celine-dion');

-- ===== 2. Slug/name fixes (each fires once - the old slug disappears) =====
-- target-collision guard: a row (even soft-deleted) already holding the
-- target slug makes the rename a no-op rather than aborting the pipeline -
-- resolve manually via the Tags UI.
update event_tags set slug='serie-a', name_english='Serie A', updated_at=now()
  where slug='seria-a-itilian-league'
    and not exists (select 1 from event_tags e2 where e2.slug = 'serie-a');
update event_tags set slug='pop', name_english='Pop', updated_at=now()
  where slug='item-4'
    and not exists (select 1 from event_tags e2 where e2.slug = 'pop');
update event_tags set slug='celine-dion', name_english='Celine Dion', updated_at=now()
  where slug='item-3'
    and not exists (select 1 from event_tags e2 where e2.slug = 'celine-dion');
update event_tags set slug='rock', name='רוק', name_english='Rock', updated_at=now()
  where slug='rock-roll'
    and not exists (select 1 from event_tags e2 where e2.slug = 'rock');
update event_tags set slug='classic-rock', name_english='Classic Rock', updated_at=now()
  where slug='clasic-rock'
    and not exists (select 1 from event_tags e2 where e2.slug = 'classic-rock');
update event_tags set slug='country', name_english='Country', updated_at=now()
  where slug='country-rock'
    and not exists (select 1 from event_tags e2 where e2.slug = 'country');

-- ===== 3. Merge classic (0 links) into classic-2, rename to classical =====
insert into event_tag_links (event_id, tag_id)
select l.event_id, t2.id
from event_tag_links l
join event_tags t1 on t1.id = l.tag_id and t1.slug = 'classic'
join event_tags t2 on t2.slug = 'classic-2' and t2.is_deleted = false
on conflict do nothing;
insert into category_tags (category_id, tag_id)
select ct.category_id, t2.id
from category_tags ct
join event_tags t1 on t1.id = ct.tag_id and t1.slug = 'classic'
join event_tags t2 on t2.slug = 'classic-2' and t2.is_deleted = false
on conflict do nothing;
delete from event_tag_links where tag_id in (select id from event_tags where slug='classic');
delete from category_tags   where tag_id in (select id from event_tags where slug='classic');
update event_tags set is_deleted=true, is_active=false, updated_at=now() where slug='classic';
-- target-collision guard: see the note above section 2.
update event_tags set slug='classical', name_english='Classical', updated_at=now()
  where slug='classic-2'
    and not exists (select 1 from event_tags e2 where e2.slug = 'classical');

-- ===== 4. Kill the sport umbrella + wimbledon (links first, like softDeleteTag) =====
delete from event_tag_links where tag_id in
  (select id from event_tags where slug in ('sport','wimbledon') and is_deleted=false);
delete from category_tags where tag_id in
  (select id from event_tags where slug in ('sport','wimbledon') and is_deleted=false);
update event_tags set is_deleted=true, is_active=false, updated_at=now()
  where slug in ('sport','wimbledon') and is_deleted=false;

-- ===== 5. tennis vertical parked until inventory =====
update event_tags set is_active=false, updated_at=now()
  where slug='tennis' and is_deleted=false;

-- ===== 6. New tags: 28 cities + 13 teams =====
insert into event_tags (slug, name, name_english, type, is_active, is_deleted)
select v.slug, v.name, v.name_english, v.type, true, false
from (values
  ('london','לונדון','London','city'),
  ('paris','פריז','Paris','city'),
  ('madrid','מדריד','Madrid','city'),
  ('milan','מילאנו','Milan','city'),
  ('barcelona','ברצלונה','Barcelona','city'),
  ('amsterdam','אמסטרדם','Amsterdam','city'),
  ('berlin','ברלין','Berlin','city'),
  ('munich','מינכן','Munich','city'),
  ('prague','פראג','Prague','city'),
  ('lisbon','ליסבון','Lisbon','city'),
  ('rome','רומא','Rome','city'),
  ('dusseldorf','דיסלדורף','Dusseldorf','city'),
  ('budapest','בודפשט','Budapest','city'),
  ('new-york','ניו יורק','New York','city'),
  ('miami','מיאמי','Miami','city'),
  ('houston','יוסטון','Houston','city'),
  ('athens','אתונה','Athens','city'),
  ('atlanta','אטלנטה','Atlanta','city'),
  ('dallas','דאלאס','Dallas','city'),
  ('warsaw','ורשה','Warsaw','city'),
  ('boston','בוסטון','Boston','city'),
  ('krakow','קרקוב','Krakow','city'),
  ('los-angeles','לוס אנג''לס','Los Angeles','city'),
  ('vienna','וינה','Vienna','city'),
  ('abu-dhabi','אבו דאבי','Abu Dhabi','city'),
  ('philadelphia','פילדלפיה','Philadelphia','city'),
  ('sofia','סופיה','Sofia','city'),
  ('bucharest','בוקרשט','Bucharest','city'),
  ('real-madrid','ריאל מדריד','Real Madrid','team'),
  ('fc-barcelona','FC ברצלונה','FC Barcelona','team'),
  ('arsenal','ארסנל','Arsenal','team'),
  ('chelsea','צ''לסי','Chelsea','team'),
  ('paris-saint-germain','פריז סן ז''רמן','Paris Saint Germain','team'),
  ('inter-milan','אינטר מילאן','Inter Milan','team'),
  ('atletico-madrid','אתלטיקו מדריד','Atletico Madrid','team'),
  ('tottenham','טוטנהאם','Tottenham','team'),
  ('newcastle','ניוקאסל','Newcastle United','team'),
  ('manchester-city','מנצ''סטר סיטי','Manchester City','team'),
  ('manchester-united','מנצ''סטר יונייטד','Manchester United','team'),
  ('liverpool','ליברפול','Liverpool','team'),
  ('bayern-munich','באיירן מינכן','Bayern Munich','team')
) as v(slug, name, name_english, type)
where not exists (select 1 from event_tags t where t.slug = v.slug);

-- ===== 7. Category tree: 3 roots =====
-- Existing: football(4) becomes a root; music(5) activated + renamed;
-- sport(3), shows(6), tennis(7), festivals(8), formula-1(2) retired (bool soft delete).
update categories set parent_id=null, is_active=true, display_order=1, updated_at=now()
  where slug='football' and is_deleted=false;
update categories set parent_id=null, is_active=true, display_order=2,
  name='הופעות מוזיקה', updated_at=now()
  where slug='music' and is_deleted=false;
update categories set is_deleted=true, is_active=false, updated_at=now()
  where slug in ('sport','shows','tennis','festivals','formula-1') and is_deleted=false;

insert into categories (slug, name, name_english, parent_id, display_order, is_active, is_deleted)
select 'destinations','יעדים','Destinations', null, 3, true, false
where not exists (select 1 from categories where slug='destinations');

-- ===== 8. Hub nodes (tag-less; the /c/ page renders child tiles only) =====
insert into categories (slug, name, name_english, parent_id, display_order, is_active, is_deleted)
select v.slug, v.name, v.name_english, p.id, v.ord, true, false
from (values
  ('leagues','ליגות','Leagues','football',1),
  ('teams','קבוצות בולטות','Top Teams','football',2),
  ('genres','ז''אנרים','Genres','music',1),
  ('artists','אומנים','Artists','music',2)
) as v(slug, name, name_english, parent_slug, ord)
join categories p on p.slug = v.parent_slug and p.is_deleted = false
where not exists (select 1 from categories c where c.slug = v.slug);

-- ===== 9. Leaf categories =====
-- champions-league already exists (root today) -> move under leagues.
update categories
set parent_id = (select id from categories where slug='leagues' and is_deleted=false),
    display_order = 1, updated_at = now()
where slug='champions-league' and is_deleted=false;

insert into categories (slug, name, name_english, parent_id, display_order, is_active, is_deleted)
select v.slug, v.name, v.name_english,
       (select id from categories where slug = v.parent_slug and is_deleted = false),
       v.ord, true, false
from (values
  -- leagues
  ('premier-league','פרמייר ליג','Premier League','leagues',2),
  ('la-liga','לה ליגה','La Liga','leagues',3),
  ('serie-a','סריה א','Serie A','leagues',4),
  ('bundesliga','בונדסליגה','Bundesliga','leagues',5),
  ('eredivisie','ארדיוויזיה','Eredivisie','leagues',6),
  -- teams (all 13 seeded; Dor deactivates thin ones from the UI if wanted)
  ('real-madrid','ריאל מדריד','Real Madrid','teams',1),
  ('fc-barcelona','FC ברצלונה','FC Barcelona','teams',2),
  ('arsenal','ארסנל','Arsenal','teams',3),
  ('chelsea','צ''לסי','Chelsea','teams',4),
  ('paris-saint-germain','פריז סן ז''רמן','Paris Saint Germain','teams',5),
  ('inter-milan','אינטר מילאן','Inter Milan','teams',6),
  ('atletico-madrid','אתלטיקו מדריד','Atletico Madrid','teams',7),
  ('tottenham','טוטנהאם','Tottenham','teams',8),
  ('newcastle','ניוקאסל','Newcastle United','teams',9),
  ('manchester-city','מנצ''סטר סיטי','Manchester City','teams',10),
  ('manchester-united','מנצ''סטר יונייטד','Manchester United','teams',11),
  ('liverpool','ליברפול','Liverpool','teams',12),
  ('bayern-munich','באיירן מינכן','Bayern Munich','teams',13),
  -- genres (>=10 tagged events each)
  ('pop','פופ','Pop','genres',1),
  ('rock','רוק','Rock','genres',2),
  ('hip-hop','היפ הופ','Hip Hop','genres',3),
  ('classic-rock','רוק קלאסי','Classic Rock','genres',4),
  ('classical','קלאסי','Classical','genres',5),
  ('country','קאנטרי','Country','genres',6),
  -- artists
  ('celine-dion','סלין דיון','Celine Dion','artists',1),
  -- cities (>=10 live events each)
  ('london','לונדון','London','destinations',1),
  ('paris','פריז','Paris','destinations',2),
  ('madrid','מדריד','Madrid','destinations',3),
  ('milan','מילאנו','Milan','destinations',4),
  ('barcelona','ברצלונה','Barcelona','destinations',5),
  ('amsterdam','אמסטרדם','Amsterdam','destinations',6),
  ('berlin','ברלין','Berlin','destinations',7),
  ('munich','מינכן','Munich','destinations',8),
  ('prague','פראג','Prague','destinations',9),
  ('lisbon','ליסבון','Lisbon','destinations',10),
  ('rome','רומא','Rome','destinations',11),
  ('dusseldorf','דיסלדורף','Dusseldorf','destinations',12)
) as v(slug, name, name_english, parent_slug, ord)
where not exists (select 1 from categories c where c.slug = v.slug);

-- ===== 10. Composition: each leaf/root = exactly its one tag =====
-- Football root loses the old league-tag pile (leagues live in their own leaves
-- now; football events reach the root via the football vertical tag).
delete from category_tags ct
using categories c, event_tags t
where ct.category_id = c.id and ct.tag_id = t.id
  and c.slug = 'football' and t.slug <> 'football';

insert into category_tags (category_id, tag_id)
select c.id, t.id
from (values
  ('football','football'), ('music','music'),
  ('champions-league','champions-league'), ('premier-league','premier-league'),
  ('la-liga','la-liga'), ('serie-a','serie-a'),
  ('bundesliga','bundesliga'), ('eredivisie','eredivisie'),
  ('real-madrid','real-madrid'), ('fc-barcelona','fc-barcelona'),
  ('arsenal','arsenal'), ('chelsea','chelsea'),
  ('paris-saint-germain','paris-saint-germain'), ('inter-milan','inter-milan'),
  ('atletico-madrid','atletico-madrid'), ('tottenham','tottenham'),
  ('newcastle','newcastle'), ('manchester-city','manchester-city'),
  ('manchester-united','manchester-united'), ('liverpool','liverpool'),
  ('bayern-munich','bayern-munich'),
  ('pop','pop'), ('rock','rock'), ('hip-hop','hip-hop'),
  ('classic-rock','classic-rock'), ('classical','classical'), ('country','country'),
  ('celine-dion','celine-dion'),
  ('london','london'), ('paris','paris'), ('madrid','madrid'), ('milan','milan'),
  ('barcelona','barcelona'), ('amsterdam','amsterdam'), ('berlin','berlin'),
  ('munich','munich'), ('prague','prague'), ('lisbon','lisbon'),
  ('rome','rome'), ('dusseldorf','dusseldorf')
) as v(cat_slug, tag_slug)
join categories c on c.slug = v.cat_slug and c.is_deleted = false
join event_tags t on t.slug = v.tag_slug and t.is_deleted = false
on conflict do nothing;

-- ===== 11. link_url -> canonical /c/ path (matches category-actions syncLink) =====
update categories c
set link_url = '/c/' || concat_ws('/', gp.slug, p.slug, c2.slug), updated_at = now()
from categories c2
left join categories p  on p.id  = c2.parent_id
left join categories gp on gp.id = p.parent_id
where c.id = c2.id and c.is_deleted = false
  and (c.link_url is null or c.link_url = ''
       or c.link_url like '/c/%' or c.link_url like '/category/%');

-- ===== 12. Seeded auto-tag rules =====
-- name rules: case-insensitive contains vs event name+name_english.
-- city rules: case-insensitive equality vs location->>'city_iata'
--             (AUE is a live-data typo for AUH - both map to abu-dhabi).
insert into tag_rules (tag_id, field, pattern, is_active)
select t.id, v.field, v.pattern, true
from (values
  ('champions-league','name','Champions League'),
  ('celine-dion','name','Celine Dion'),
  ('real-madrid','name','Real Madrid'),
  ('fc-barcelona','name','Barcelona'),
  ('arsenal','name','Arsenal'),
  ('chelsea','name','Chelsea'),
  ('paris-saint-germain','name','Paris Saint Germain'),
  ('inter-milan','name','Inter Milan'),
  ('atletico-madrid','name','Atletico Madrid'),
  ('tottenham','name','Tottenham'),
  ('newcastle','name','Newcastle United'),
  ('manchester-city','name','Manchester City'),
  ('manchester-united','name','Manchester United'),
  ('liverpool','name','Liverpool'),
  ('bayern-munich','name','Bayern Munich'),
  ('london','city','LON'), ('paris','city','CDG'), ('madrid','city','MAD'),
  ('milan','city','MXP'), ('barcelona','city','BCN'), ('amsterdam','city','AMS'),
  ('berlin','city','BER'), ('munich','city','MUC'), ('prague','city','PRG'),
  ('lisbon','city','LIS'), ('rome','city','ROM'), ('dusseldorf','city','DUS'),
  ('budapest','city','BUD'), ('new-york','city','NYC'), ('miami','city','MIA'),
  ('houston','city','IAH'), ('athens','city','ATH'), ('atlanta','city','ATL'),
  ('dallas','city','DFW'), ('warsaw','city','WAW'), ('boston','city','BOS'),
  ('krakow','city','KRK'), ('los-angeles','city','LAX'), ('vienna','city','VIE'),
  ('abu-dhabi','city','AUH'), ('abu-dhabi','city','AUE'),
  ('philadelphia','city','PHL'), ('sofia','city','SOF'), ('bucharest','city','OTP')
) as v(tag_slug, field, pattern)
join event_tags t on t.slug = v.tag_slug and t.is_deleted = false
where not exists (
  select 1 from tag_rules r
  where r.tag_id = t.id and r.field = v.field and r.pattern = v.pattern
);

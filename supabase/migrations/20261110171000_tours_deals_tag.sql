-- The deals tag "מבצעים" of Mega Family (Alon 10.11, road map tab "בק אופיס לידים והזמנות" note 8: "כל מוצר שיש עליו
-- מבצע / מתנה שיסמן בטאג של מבצעים ואז שהסליידר הזה יהיה בשליטתנו ונוכל להציג כמו שהיינו מעלים טורס של טאג").
--
-- A plain trip-type tag. The site decides who carries it (mega-family lib/sale-tag.ts): every tour while one of its dates
-- on sale has a discount or a gift, plus any tour staff tick it on by hand (Dor's choice: automatic + by hand). Being a
-- tag, it is in every "Tag" list of the backoffice - a tile's "The tours of a tag" row, the trip-type pills - and has its
-- page (/product-tag/מבצעים/). Created only when the company has no tag of that name yet (active or not), so a rename
-- or a switch-off by staff is never undone; running it twice adds nothing.
insert into tours.terms (company_id, kind, slug, name, position, data, is_active)
select c.id, 'tags', 'מבצעים', 'מבצעים', 0, '{}'::jsonb, true
  from public.companies c
 where c.slug = 'mega-family'
   and not exists (
     select 1 from tours.terms t
      where t.company_id = c.id and t.kind = 'tags'
        and (t.slug in ('מבצעים', 'מבצע') or btrim(t.name) in ('מבצעים', 'מבצע'))
   );

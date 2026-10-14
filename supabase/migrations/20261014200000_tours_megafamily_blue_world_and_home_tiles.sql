-- Mega Family: Alon's notes of 14.10.2026 that are data, not code (Dor chose each the same day).
--
-- 1. The world "משפחות" leads with the logo's blue (Alon: "the red looks like a warning"; Dor: "keep red as
--    minimal, no big component"): its colour #ED1C24 -> #0059AA, and its booking button (terms.data.ctaColor,
--    "Booking button color" in Categories & Tags > Worlds) the same blue. The second colour stays #0059AA.
--    Set only while the world still has this morning's red (20261014100000).
-- 2. The home page's tile of that world paints itself in the same blue, if it still has that red.
-- 3. Each world gets its own banners (Alon: "only for 'all', or each world its own"; Dor: each its own): the
--    artists row shows under the tile "כל המבחר" and the tile of sport & music, the "ההזדמנויות שאסור לפספס"
--    banners under "כל המבחר" only. The tile keys are read from the document itself; a section staff already
--    tied to tiles is left alone. Staff add a world's own banners in Website > Homepage ("Show on tiles").
-- 4. The composition "זוג + 3 ילדים" is two rooms at the hotel - a double and a triple (Alon): its summary label
--    (printed on the booking and in the backoffice) says so instead of "חדר חמישייה". Same in
--    lib/tours/pricing.ts and in the site's lib/data/departures.mjs.
--
-- The site reads 1-3 at its next build (c_megafamily views); 4 applies to bookings made from now on.
-- Rollback: 1-2 set the old values back by the same guards reversed; 3 remove the "onlyTabs" this added; 4 the
-- function body of 20261003100000.

-- ---------------------------------------------------------------- 1. the world's colours
update tours.terms
set data = data || jsonb_build_object('color', '#0059AA', 'ctaColor', '#0059AA')
where company_id = (select id from public.companies where slug = 'mega-family')
  and kind = 'audiences'
  and slug = 'משפחות'
  and upper(coalesce(data->>'color', '')) = '#ED1C24'
  and coalesce(data->>'ctaColor', '') = '';

-- ---------------------------------------------------------------- 2 + 3. the home page
do $$
declare
  v_company uuid := (select id from public.companies where slug = 'mega-family');
  v_data jsonb;
  v_all text;
  v_events text;
  v_sections jsonb := '[]'::jsonb;
  v_section jsonb;
  v_tabs jsonb;
begin
  select data into v_data from tours.site_content where company_id = v_company and key = 'home';
  if v_data is null or jsonb_typeof(v_data->'sections') <> 'array' then
    return;
  end if;

  -- the keys of the tiles "כל המבחר" (show all) and sport & music (its world, or a search on Mega Events)
  select t->>'key' into v_all
  from jsonb_array_elements(v_data->'sections') s,
       jsonb_array_elements(case when jsonb_typeof(s->'tabs') = 'array' then s->'tabs' else '[]'::jsonb end) t
  where s->>'type' = 'tours' and t->>'show' = 'all' and coalesce(t->>'key', '') <> ''
  limit 1;
  select t->>'key' into v_events
  from jsonb_array_elements(v_data->'sections') s,
       jsonb_array_elements(case when jsonb_typeof(s->'tabs') = 'array' then s->'tabs' else '[]'::jsonb end) t
  where s->>'type' = 'tours' and coalesce(t->>'key', '') <> ''
    and ((t->>'show' = 'world' and t->>'world' = 'ספורט-ומוזיקה') or coalesce(t->>'searchUrl', '') like '%mega-events.co.il%')
  limit 1;

  for v_section in
    select value from jsonb_array_elements(v_data->'sections') with ordinality as e (value, ord) order by ord
  loop
    -- 2. the family tile in blue
    if v_section->>'type' = 'tours' and jsonb_typeof(v_section->'tabs') = 'array' then
      select coalesce(jsonb_agg(
               case
                 when t->>'show' = 'world' and t->>'world' = 'משפחות' and upper(coalesce(t->>'color', '')) = '#ED1C24'
                   then jsonb_set(t, '{color}', '"#0059AA"')
                 else t
               end
               order by ord
             ), '[]'::jsonb)
        into v_tabs
      from jsonb_array_elements(v_section->'tabs') with ordinality as e (t, ord);
      v_section := jsonb_set(v_section, '{tabs}', v_tabs);
    end if;
    -- 3. the artists and the opportunities on their tiles, unless staff already tied them
    if v_all is not null
       and (jsonb_typeof(v_section->'onlyTabs') is distinct from 'array' or jsonb_array_length(v_section->'onlyTabs') = 0) then
      if v_section->>'type' = 'artists' then
        v_section := v_section || jsonb_build_object(
          'onlyTabs',
          case when v_events is null then jsonb_build_array(v_all) else jsonb_build_array(v_all, v_events) end
        );
      elsif v_section->>'type' = 'banners' and btrim(coalesce(v_section->>'title', '')) = 'ההזדמנויות שאסור לפספס' then
        v_section := v_section || jsonb_build_object('onlyTabs', jsonb_build_array(v_all));
      end if;
    end if;
    v_sections := v_sections || jsonb_build_array(v_section);
  end loop;

  if v_sections is distinct from v_data->'sections' then
    update tours.site_content
    set data = jsonb_set(data, '{sections}', v_sections),
        updated_by = 'migration 20261014200000'
    where company_id = v_company and key = 'home';
  end if;
end
$$;

-- ---------------------------------------------------------------- 4. "זוג + 3 ילדים" is two rooms
create or replace function tours.room_composition(p_key text)
returns table (adults int, children int, title text, summary_label text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select c.adults, c.children, c.title, c.summary_label
  from (values
    ('double_room',      2, 0, 'זוגי',            'חדר זוגי'),
    ('single_room',      1, 0, 'סינגל',           'חדר סינגל'),
    ('adult_kid',        1, 1, 'מבוגר + ילד',     'חדר זוגי'),
    ('three_adults',     3, 0, '3 מבוגרים',       'חדר טריפל'),
    ('couple_kid',       2, 1, 'זוג + ילד',       'חדר טריפל'),
    ('adult_2_kids',     1, 2, 'מבוגר + 2 ילדים', 'חדר טריפל'),
    ('couple_2_kids',    2, 2, 'זוג + 2 ילדים',   'חדר רביעייה'),
    ('adult_3_kids',     1, 3, 'מבוגר + 3 ילדים', 'חדר רביעייה'),
    ('three_adults_kid', 3, 1, '3 מבוגרים + ילד', 'חדר רביעייה'),
    ('couple_3_kids',    2, 3, 'זוג + 3 ילדים',   'חדר זוגי + חדר טריפל')
  ) as c(key, adults, children, title, summary_label)
  where c.key = p_key
$$;

-- Mega Family: the world "ספורט ומוזיקה" wears Mega Events' look (Dor, 15.10.2026). Data only.
--
-- 1. The world of Mega Events' packages - the audience term whose data.worldKey = 'events' - takes the colours of
--    mega-events.co.il: its colour (terms.data.color) Mega Events' green #15C95C (the site darkens it wherever
--    white text sits on it - cardFill in its lib/world-theme.ts), its second colour (data.colorDeep, "Second color
--    (header and footer)" in Categories & Tags > Worlds) Mega Events' deep forest #0A1A14, and its booking button
--    (data.ctaColor, "Booking button color") the same forest, like Mega Events' pay button. Dor chose the look, so
--    it replaces whatever the world wore; the values it replaces are printed as NOTICE lines.
-- 2. The home page's tile of that world (the site's isEventsTile: the tile shows the world, or its search goes to
--    mega-events.co.il) takes the same green when it paints itself in a colour of its own (tabs[].color), so tile
--    and world agree. A tile without a colour of its own already wears the world's and is left alone.
--
-- Mega Family only. Idempotent: a second run finds nothing to change. The site reads both at its next build
-- (c_megafamily views - no view changes).
-- Rollback: put back the values of the NOTICE lines (the world's three colours in Categories & Tags > Worlds, the
-- tile's colour in Website > Homepage).

do $$
declare
  v_company uuid := (select id from public.companies where slug = 'mega-family');
  v_term record;
  v_slugs text[] := '{}';
  v_data jsonb;
  v_sections jsonb := '[]'::jsonb;
  v_section jsonb;
  v_tabs jsonb;
  v_tab jsonb;
begin
  if v_company is null then
    return;
  end if;

  -- ---------------------------------------------------------------- 1. the world's colours
  for v_term in
    select t.id, t.slug, t.data
    from tours.terms t
    where t.company_id = v_company
      and t.kind = 'audiences'
      and t.data->>'worldKey' = 'events'
  loop
    v_slugs := array_append(v_slugs, v_term.slug);
    if v_term.data->>'color' is distinct from '#15C95C'
       or v_term.data->>'colorDeep' is distinct from '#0A1A14'
       or v_term.data->>'ctaColor' is distinct from '#0A1A14' then
      raise notice 'world % before: color %, colorDeep %, ctaColor %',
        v_term.slug,
        coalesce(v_term.data->>'color', '(none)'),
        coalesce(v_term.data->>'colorDeep', '(none)'),
        coalesce(v_term.data->>'ctaColor', '(none)');
      update tours.terms
      set data = data || jsonb_build_object('color', '#15C95C', 'colorDeep', '#0A1A14', 'ctaColor', '#0A1A14')
      where id = v_term.id;
    end if;
  end loop;

  if cardinality(v_slugs) = 0 then
    raise notice 'Mega Family has no world with worldKey ''events'' - nothing changed';
    return;
  end if;

  -- ---------------------------------------------------------------- 2. the world's tile on the home page
  select sc.data into v_data from tours.site_content sc where sc.company_id = v_company and sc.key = 'home';
  if v_data is null or jsonb_typeof(v_data->'sections') is distinct from 'array' then
    return;
  end if;

  for v_section in
    select value from jsonb_array_elements(v_data->'sections') with ordinality as e (value, ord) order by ord
  loop
    if v_section->>'type' = 'tours' and jsonb_typeof(v_section->'tabs') = 'array' then
      for v_tab in
        select t from jsonb_array_elements(v_section->'tabs') as tt (t)
        where coalesce(t->>'color', '') <> ''
          and upper(t->>'color') <> '#15C95C'
          and ((t->>'show' = 'world' and t->>'world' = any (v_slugs))
               or coalesce(t->>'searchUrl', '') ~ 'mega-events\.co\.il')
      loop
        raise notice 'home tile % before: color %', coalesce(v_tab->>'key', '(no key)'), v_tab->>'color';
      end loop;
      select coalesce(jsonb_agg(
               case
                 when coalesce(t->>'color', '') <> ''
                      and upper(t->>'color') <> '#15C95C'
                      and ((t->>'show' = 'world' and t->>'world' = any (v_slugs))
                           or coalesce(t->>'searchUrl', '') ~ 'mega-events\.co\.il')
                   then jsonb_set(t, '{color}', '"#15C95C"')
                 else t
               end
               order by ord
             ), '[]'::jsonb)
        into v_tabs
      from jsonb_array_elements(v_section->'tabs') with ordinality as e (t, ord);
      v_section := jsonb_set(v_section, '{tabs}', v_tabs);
    end if;
    v_sections := v_sections || jsonb_build_array(v_section);
  end loop;

  if v_sections is distinct from v_data->'sections' then
    update tours.site_content
    set data = jsonb_set(data, '{sections}', v_sections),
        updated_by = 'migration 20261015180000'
    where company_id = v_company and key = 'home';
  end if;
end
$$;

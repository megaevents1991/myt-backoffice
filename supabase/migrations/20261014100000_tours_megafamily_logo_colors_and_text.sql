-- Mega Family: the logo's own colours and two fixes of text (Dor, 14.10.2026).
--
-- 1. The world "משפחות" wears the logo: red #ED1C24 (the red of "פמילי") and, as its second colour
--    (terms.data.colorDeep, "Second color" in Categories & Tags > Worlds), blue #0059AA (the blue of "מגה").
--    Both sampled from the logo file Dor gave (MegaFemLogo2). Until now the world had no colour and wore its
--    home tile's #A61C14, whose darker shades the site paints the header and the footer with read as brown
--    ("זה עדיין לא האדום של מגה"). Set only while staff have not chosen another colour.
-- 2. The home page's tile of that world ("מאורגנים למשפחות") paints itself in the same red, if it still has
--    the #A61C14 the site content was seeded with (20261005180000).
-- 3. "תננאי ביטול" -> "תנאי ביטול": a typo in the title of an info section of the Andre Rieu packages,
--    carried from WordPress.
-- 4. The footer columns "מגה Family" / "מגה Events" are named in Hebrew, as the worlds are: "מגה פמילי" /
--    "מגה איבנטס".
--
-- The site reads all of it at its next build (c_megafamily views); nothing else changes.

-- ---------------------------------------------------------------- 1. the world's colours
update tours.terms
set data = data || jsonb_build_object('color', '#ED1C24', 'colorDeep', '#0059AA')
where company_id = (select id from public.companies where slug = 'mega-family')
  and kind = 'audiences'
  and slug = 'משפחות'
  and upper(coalesce(data->>'color', '')) in ('', '#A61C14')
  and coalesce(data->>'colorDeep', '') = '';

-- ---------------------------------------------------------------- 2. the world's tile on the home page
update tours.site_content sc
set data = jsonb_set(
      sc.data,
      '{sections}',
      (
        select jsonb_agg(
          case
            when s->>'type' = 'tours' and jsonb_typeof(s->'tabs') = 'array' then jsonb_set(
              s,
              '{tabs}',
              (
                select coalesce(jsonb_agg(
                  case
                    when t->>'show' = 'world' and t->>'world' = 'משפחות' and upper(coalesce(t->>'color', '')) = '#A61C14'
                      then jsonb_set(t, '{color}', '"#ED1C24"')
                    else t
                  end
                  order by tord
                ), '[]'::jsonb)
                from jsonb_array_elements(s->'tabs') with ordinality as tt (t, tord)
              )
            )
            else s
          end
          order by sord
        )
        from jsonb_array_elements(sc.data->'sections') with ordinality as ss (s, sord)
      )
    ),
    updated_by = 'migration 20261014100000'
where sc.company_id = (select id from public.companies where slug = 'mega-family')
  and sc.key = 'home'
  and jsonb_typeof(sc.data->'sections') = 'array'
  and jsonb_array_length(sc.data->'sections') > 0
  and upper(sc.data::text) like '%#A61C14%';

-- ---------------------------------------------------------------- 3. "תננאי ביטול"
update tours.packages
set extra_sections = replace(extra_sections::text, 'תננאי ביטול', 'תנאי ביטול')::jsonb,
    data = replace(data::text, 'תננאי ביטול', 'תנאי ביטול')::jsonb
where company_id = (select id from public.companies where slug = 'mega-family')
  and (extra_sections::text like '%תננאי ביטול%' or data::text like '%תננאי ביטול%');

-- ---------------------------------------------------------------- 4. the footer's world columns in Hebrew
update tours.site_content
set data = replace(replace(data::text, '"מגה Family"', '"מגה פמילי"'), '"מגה Events"', '"מגה איבנטס"')::jsonb,
    updated_by = 'migration 20261014100000'
where company_id = (select id from public.companies where slug = 'mega-family')
  and key = 'footer'
  and (data::text like '%"מגה Family"%' or data::text like '%"מגה Events"%');

-- The worlds' logos on the branded Meta pictures (mega-family docs/plans/PRODUCT-FEED-PLAN.md, Dor 08.11.2026:
-- "לפי עולמות - מגה איבנטס מגה פמילי", "תשים לב ללוגואים של העולמות"). Categories & Tags > Worlds > Logo
-- (terms.data.logo) is new; the picture of a tour carries its world's logo, with the group's "מגה תיירות" small in the
-- corner. Mega Family's two worlds get the logos they already have - only where staff set none:
--  - the family world: the swoosh badge the company site serves (/brand/mega-family-logo.jpg, a path on its site);
--  - the sport & music world: Mega Events' wordmark (light letters, mint dot), as www.mega-events.co.il serves it.
-- Data only; the site reads the key through the sync (terms.data passes through).

update tours.terms t
set data = coalesce(t.data, '{}'::jsonb) || jsonb_build_object('logo', '/brand/mega-family-logo.jpg')
from public.companies c
where c.id = t.company_id
  and c.slug = 'mega-family'
  and t.kind = 'audiences'
  and t.data->>'worldKey' = 'family'
  and coalesce(t.data->>'logo', '') = '';

update tours.terms t
set data = coalesce(t.data, '{}'::jsonb) || jsonb_build_object('logo', 'https://www.mega-events.co.il/brand/logo-wordmark.svg')
from public.companies c
where c.id = t.company_id
  and c.slug = 'mega-family'
  and t.kind = 'audiences'
  and t.data->>'worldKey' = 'events'
  and coalesce(t.data->>'logo', '') = '';

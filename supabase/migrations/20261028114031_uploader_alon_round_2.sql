-- Tour uploader - Alon's round 2 (28.10.2026; spec docs/superpowers/specs/2026-10-28-uploader-alon-round-2-design.md,
-- section 3.1 + 10). Idempotent: safe to re-run.
--
-- (1) locations.aliases = other spellings of the city (English, local, common supplier forms). The uploader
--     matches a supplier's city ("Roma", "Muenchen", "Hanover") to our Hebrew-named rows through it. Backoffice-only:
--     main never reads `locations`. Seeded by Hebrew city (the part of `name` before the first comma), only on a row
--     that has none yet - a hand edit is never overwritten.
-- (2) Two coordinate fixes found on prod, each guarded by its current WRONG value so a re-run or a hand fix stands.
-- (3) uploader_aliases = what a person confirmed once ("Roma = רומא", a team spelling) and the code reuses on every
--     later run. RLS on, no policies, service role only.
-- (4) venue_maps.name_he = the hall's Hebrew name (the Craven Cottage -> "קרייבן קוטג'" line of the classify dialog).
-- (5) The two standing description templates (football / artist), so the first run of the round prints the agreed
--     Hebrew line. `on conflict do nothing`: a template staff already saved is never replaced.

-- (1) ---------------------------------------------------------------------------------------------------------
alter table public.locations add column if not exists aliases text[] not null default '{}';

-- The match key folds the geresh / curly apostrophe to ' and the maqaf / en dash to - (a hand-typed name may carry
-- either); `aliases = '{}'` keeps the seed to rows nobody edited.
update public.locations l
set aliases = s.aliases::text[]
from (values
  ('מדריד', array['Madrid']),
  ('מילאנו', array['Milan', 'Milano']),
  ('אבו דאבי', array['Abu Dhabi']),
  ('לונדון', array['London']),
  ('ברצלונה', array['Barcelona']),
  ('פריז', array['Paris']),
  ('קרקוב', array['Krakow', 'Kraków', 'Cracow']),
  ('ברלין', array['Berlin']),
  ('ורשה', array['Warsaw', 'Warszawa']),
  ('אמסטרדם', array['Amsterdam']),
  ('מינכן', array['Munich', 'München', 'Muenchen']),
  ('וינה', array['Vienna', 'Wien']),
  ('לימסול', array['Limassol', 'Lemesos']),
  ('בודפשט', array['Budapest']),
  ('פראג', array['Prague', 'Praha']),
  ('בוקרסט', array['Bucharest', 'București', 'Bucuresti']),
  ('רומא', array['Rome', 'Roma']),
  ('ליסבון', array['Lisbon', 'Lisboa']),
  ('ניו יורק', array['New York', 'New York City']),
  ('מיאמי', array['Miami', 'Miami Gardens']),
  ('אטלנטה', array['Atlanta']),
  ('לוס אנגלס', array['Los Angeles']),
  ('דיסלדורף', array['Düsseldorf', 'Dusseldorf', 'Duesseldorf']),
  ('אתונה', array['Athens', 'Athina']),
  ('בוסטון', array['Boston']),
  ('פילדלפיה', array['Philadelphia']),
  ('ארלינגטון-דאלאס', array['Arlington', 'Dallas']),
  ('יוסטון', array['Houston']),
  ('קנזס סיטי', array['Kansas City']),
  ('ליברפול', array['Liverpool']),
  ('מנצ''סטר', array['Manchester']),
  ('האנובר', array['Hannover', 'Hanover'])
) as s(city, aliases)
where translate(btrim(split_part(l.name, ',', 1)), '׳’־–', '''''--') = s.city
  and l.aliases = '{}';

-- (2) ---------------------------------------------------------------------------------------------------------
-- Philadelphia was stored at +75.16 (the east of Asia) instead of -75.16; Arlington-Dallas at 32.19, 34.87 (Israel).
-- The guard compares rounded values, so it holds whatever the column type (numeric / float4 / float8).
update public.locations
set latitude = 39.9526, longitude = -75.1652
where translate(btrim(split_part(name, ',', 1)), '׳’־–', '''''--') = 'פילדלפיה'
  and round(latitude::numeric, 2) = 39.95
  and round(longitude::numeric, 2) = 75.16;

update public.locations
set latitude = 32.7357, longitude = -97.1081
where translate(btrim(split_part(name, ',', 1)), '׳’־–', '''''--') = 'ארלינגטון-דאלאס'
  and round(latitude::numeric, 2) = 32.19
  and round(longitude::numeric, 2) = 34.87;

-- (3) ---------------------------------------------------------------------------------------------------------
-- kind = 'city' | 'team' (no CHECK - a later kind needs no migration). from_key / to_key = normalizeName(name)
-- (lib/on-tour.ts), what the lookups compare; team_id = the football_teams row a team alias points at.
create table if not exists public.uploader_aliases (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  from_name text not null,
  from_key text not null,
  to_name text not null,
  to_key text not null,
  team_id int,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (kind, from_key)
);

alter table public.uploader_aliases enable row level security;
revoke all on public.uploader_aliases from anon, authenticated;

-- (4) ---------------------------------------------------------------------------------------------------------
alter table public.venue_maps add column if not exists name_he text;

-- (5) ---------------------------------------------------------------------------------------------------------
-- Tokens: football {בית} {חוץ} {מפעל} {אירוע} {אולם} {עיר} {תאריך}; artist {אמן} {אירוע} {אולם} {עיר} {תאריך}
-- (lib/uploader/description.ts). value = { "template": "..." }, as the settings dialog writes it.
insert into public.uploader_settings (key, value)
values
  ('description_template:football', '{"template":"{בית} נגד {חוץ} ב{אולם}, במסגרת {מפעל}."}'::jsonb),
  ('description_template:artist', '{"template":"{אמן} יוצא לסיבוב הופעות שחובה לראות! כרטיסים להופעה שלו ב{עיר}."}'::jsonb)
on conflict (key) do nothing;

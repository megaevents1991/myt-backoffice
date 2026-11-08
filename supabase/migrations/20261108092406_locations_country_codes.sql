-- Every location row gets its ISO-2 country code (08.11.2026, Dor: "לא זיהה שיש מיקום").
--
-- The AI Uploader matches a show to a location by its CITY when the venue's coordinates are wrong (TixStock gave
-- Estadio Olimpic Lluis Companys 40, -4 - the middle of Spain, 53 km from Madrid). A same-named location more than
-- FAR_VENUE_KM (300 km) from those coordinates counts only when BOTH country codes are known and equal (final fix
-- wave A5, lib/uploader/place.ts) - and 23 of the 35 rows, every European city among them, had no code. So Barcelona
-- (#5, BCN, alias "Barcelona") was passed by and the show asked "אין לנו מיקום ל-Barcelona".
--
-- The code is read from the country in the row's own Hebrew name ("ברצלונה, ספרד" -> ES). Only rows with no code are
-- touched, so a code typed on the Locations screen stays and the migration can run again. myt-main never reads this
-- table (an event keeps its own copy of the location), and it branches on country_code only for "US", which the
-- American rows already carry.

update public.locations as l
set country_code = m.code
from (
  values
    ('ספרד', 'ES'),
    ('איטליה', 'IT'),
    ('איחוד האמירויות', 'AE'),
    ('בריטניה', 'GB'),
    ('אנגליה', 'GB'),
    ('סקוטלנד', 'GB'),
    ('צרפת', 'FR'),
    ('פולין', 'PL'),
    ('גרמניה', 'DE'),
    ('הולנד', 'NL'),
    ('אוסטריה', 'AT'),
    ('קפריסין', 'CY'),
    ('הונגריה', 'HU'),
    ('צ''כיה', 'CZ'),
    ('רומניה', 'RO'),
    ('פורטוגל', 'PT'),
    ('יוון', 'GR'),
    ('בלגיה', 'BE'),
    ('שווייץ', 'CH'),
    ('שוויץ', 'CH'),
    ('דנמרק', 'DK'),
    ('שוודיה', 'SE'),
    ('נורווגיה', 'NO'),
    ('אירלנד', 'IE'),
    ('קרואטיה', 'HR'),
    ('טורקיה', 'TR'),
    ('ארה"ב', 'US'),
    ('קנדה', 'CA'),
    ('מקסיקו', 'MX')
) as m(country, code)
where l.country_code is null
  and btrim(split_part(l.name, ',', 2)) = m.country;

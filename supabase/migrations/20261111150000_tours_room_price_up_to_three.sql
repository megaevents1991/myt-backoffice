-- Mega Family: a date priced with neither a third adult nor a fourth child sells rooms of up to three people alone
-- (Daniel, 11.11.2026, road map tab "הערות דניאל 1": "איפה שאין במחירון של הבק אופיס מחיר של מבוגר שלישי בחדר וילד
-- רביעי בחדר האתר צריך לתת מחיר רק לסוגי הרכבים הבאים: 1 מבוגר, 1 מבוגר + 1 ילד, 2 מבוגרים, 2 מבוגרים + ילד, 2 ילדים +
-- מבוגר (מבוגר*2 + ילד שלישי בחדר)" - the ATP tour today).
--
-- Until now such a date also priced couple + 2 kids, adult + 3 kids and couple + 3 kids, the fourth person paying
-- adult-in-double (the fallback of 20261014230000). On such a date those three now have no price, so the site does not
-- offer them and tours.booking_quote refuses them; 3 adults and 3 adults + kid already needed the third-adult price.
-- A date with either of the two prices prices exactly as before, and so does every composition of up to three.
--
-- The same table lives in the backoffice (lib/tours/pricing.ts) and the site (mega-family
-- lib/data/departures.mjs) - all three change together. tours.booking_quote calls this function by name.
--
-- Rollback: re-create the function from 20261108180000.

create or replace function tours.room_price(p_key text, m jsonb)
returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  single numeric := (m->>'adult:1')::numeric;
  dbl numeric := (m->>'adult:2')::numeric;
  third_adult numeric := (m->>'adult:3')::numeric;
  second_kid numeric := (m->>'child:2')::numeric;
  third_kid numeric := (m->>'child:3')::numeric;
  fourth_kid numeric := (m->>'child:4')::numeric;
  extra numeric := coalesce((m->>'child:4')::numeric, (m->>'adult:2')::numeric);
begin
  -- the rooms of four people and more (the two rooms of couple + 3 kids too)
  if third_adult is null and fourth_kid is null
     and p_key in ('couple_2_kids', 'adult_3_kids', 'three_adults_kid', 'couple_3_kids') then
    return null;
  end if;
  return case p_key
    when 'single_room' then single
    when 'double_room' then 2 * dbl
    when 'adult_kid' then dbl + second_kid
    when 'three_adults' then 2 * dbl + third_adult
    when 'couple_kid' then 2 * dbl + third_kid
    when 'adult_2_kids' then 2 * dbl + third_kid
    when 'couple_2_kids' then 2 * dbl + third_kid + extra
    when 'adult_3_kids' then 2 * dbl + third_kid + extra
    when 'three_adults_kid' then 2 * dbl + third_adult + extra
    when 'couple_3_kids' then 4 * dbl + third_kid
    else null
  end;
end
$$;

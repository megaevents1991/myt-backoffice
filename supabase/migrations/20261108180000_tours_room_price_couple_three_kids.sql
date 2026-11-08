-- Mega Family: "זוג + 3 ילדים" is priced as the two rooms it is (Daniel, 08.11.2026: "מחירון - 2 מבוגרים + 3
-- ילדים. לוקח במחירון מחיר מבוגר בחדר זוגי*2 + ילד שלישי בחדר*3. צריך להיות: מבוגר בחדר זוגי*4 + ילד שלישי
-- בחדר*1").
--
-- The composition is a double room and a triple room at the hotel (Alon, 14.10). Until now it cost
--   2 x adult-in-double + third-kid + 2 x (fourth-kid, else adult-in-double)
-- which, on a date whose fourth-kid price equals its third-kid price, read as 2 x double + 3 x third-kid.
-- Now: the double room = 2 x adult-in-double, the triple = 2 x adult-in-double + third-kid:
--   couple + 3 kids = 4 x adult-in-double + third-kid
-- It no longer reads fourth-kid. Every other composition prices exactly as before.
--
-- The same table lives in the backoffice (lib/tours/pricing.ts) and the site (mega-family
-- lib/data/departures.mjs) - all three change together. tours.booking_quote calls this function by name,
-- so the online booking follows without a change of its own.
--
-- Rollback: re-create the function from 20261014230000.

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
  extra numeric := coalesce((m->>'child:4')::numeric, (m->>'adult:2')::numeric);
begin
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

-- Mega Family: "3 מבוגרים + ילד" and "מבוגר + 3 ילדים" open on every date that prices a third adult /
-- a third child (Alon, 14.10.2026: "לא נותן 3 מבוגרים וילד"; Dor chose "same fallback" the same night).
--
-- Until now both compositions needed the fourth-kid price itself (child:4), as on the WordPress site, and
-- most dates leave it empty - so the site never offered them and a family of three adults and a child had
-- no room to pick. "זוג + 2 ילדים" and "זוג + 3 ילדים" already charge the fourth person the adult-in-double
-- price when child:4 is empty (`extra`); the two compositions now do the same:
--   adult + 3 kids = 2 x adult-in-double + third-kid   + (fourth-kid, else adult-in-double)
--   3 adults + kid = 2 x adult-in-double + third-adult + (fourth-kid, else adult-in-double)
-- A date that sets child:4 prices exactly as before.
--
-- The same table lives in the backoffice (lib/tours/pricing.ts) and the site (mega-family
-- lib/data/departures.mjs) - all three change together. tours.booking_quote (20261008100000) calls this
-- function by name, so the online booking follows without a change of its own.
--
-- Rollback: re-create the function from 20261003100000 (fourth instead of extra in the two lines).

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
    when 'couple_3_kids' then 2 * dbl + third_kid + 2 * extra
    else null
  end;
end
$$;

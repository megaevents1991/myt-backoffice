-- A percent discount of a date is applied by the booking price (Alon, 08.10.2026: the discount of
-- a date is a percent or an amount, with an end day). Until now booking_quote applied only the
-- amount per traveler (fixed_per_pax); the site already showed a percent (percent_order) on the
-- room prices, so the customer saw a price the quote did not give. Per room: the amount times
-- the travelers, plus the percent of the room price, rounded to whole units. The two kinds are
-- either/or on a date (promotionConflict in the backoffice), so at most one of them is non-zero.
-- The function is the one of 20261003100000 with the four lines marked "v_pct"; nothing else
-- changes. Rollback: re-run the quote block of 20261003100000.

-- ---------------------------------------------------------------- quote
-- args: product_id (the site's ?product_id=), rooms (array of composition
-- keys), adult_dobs (array of yyyy-mm-dd, optional). Returns the price lines
-- and whether the date can be paid online now. Seat counts stay internal.
create or replace function tours.booking_quote(p_company uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_pid bigint;
  d record;
  dep jsonb;
  m jsonb;
  v_fixed numeric;
  v_pct numeric;
  v_disc numeric;
  v_key text;
  v_comp record;
  v_price numeric;
  v_pax int;
  v_lines jsonb := '[]'::jsonb;
  v_adults int := 0;
  v_children int := 0;
  v_subtotal numeric := 0;
  v_room_discount numeric := 0;
  v_senior_each numeric;
  v_senior_age int;
  v_seniors int := 0;
  v_dob_text text;
  v_dob date;
  v_flight_each numeric := 0;
  v_total numeric;
  v_alloc int;
  v_remaining int;
  v_reason text;
begin
  if coalesce(p_args->>'product_id', '') !~ '^[0-9]{1,12}$' then
    return jsonb_build_object('ok', false, 'error', 'departure_not_found');
  end if;
  v_pid := (p_args->>'product_id')::bigint;

  select x.*, s.senior_discount as series_senior_discount, s.senior_min_age as series_senior_min_age
    into d
    from tours.departures x
    join tours.series s on s.id = x.series_id
   where x.company_id = p_company and x.is_published and x.is_deleted is null
     and (x.legacy_product_id = v_pid or x.site_id = v_pid)
   order by (x.legacy_product_id is not distinct from v_pid) desc
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'departure_not_found');
  end if;
  dep := jsonb_build_object('code', d.code, 'start_date', d.start_date, 'end_date', d.end_date, 'currency', d.currency);

  if jsonb_typeof(p_args->'rooms') is distinct from 'array'
     or jsonb_array_length(p_args->'rooms') not between 1 and 9 then
    return jsonb_build_object('ok', false, 'error', 'rooms', 'departure_id', d.id, 'departure', dep);
  end if;

  select jsonb_object_agg(pax_type || ':' || room_position, price) into m
    from tours.departure_prices where departure_id = d.id;
  if m is null or not (m ? 'adult:2') then
    return jsonb_build_object('ok', false, 'error', 'not_priced', 'departure_id', d.id, 'departure', dep);
  end if;

  -- the discount the site shows on the date (valid_until is shown, not enforced - as on WordPress):
  -- an amount per traveler, or a percent of the room price (the two are either/or on a date)
  select coalesce(max(value), 0) into v_fixed
    from tours.promotions
   where departure_id = d.id and kind = 'fixed_per_pax' and is_active;
  select coalesce(max(value), 0) into v_pct
    from tours.promotions
   where departure_id = d.id and kind = 'percent_order' and is_active;

  for v_key in select jsonb_array_elements_text(p_args->'rooms') loop
    select * into v_comp from tours.room_composition(v_key);
    if not found then
      return jsonb_build_object('ok', false, 'error', 'room', 'room', left(v_key, 40), 'departure_id', d.id, 'departure', dep);
    end if;
    v_price := tours.room_price(v_key, m);
    if v_price is null then
      return jsonb_build_object('ok', false, 'error', 'room', 'room', v_key, 'departure_id', d.id, 'departure', dep);
    end if;
    v_pax := v_comp.adults + v_comp.children;
    v_disc := v_fixed * v_pax + round(v_price * v_pct / 100);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'key', v_key, 'title', v_comp.title, 'summary_label', v_comp.summary_label,
      'adults', v_comp.adults, 'children', v_comp.children,
      'price', v_price, 'discount', v_disc, 'net', v_price - v_disc));
    v_adults := v_adults + v_comp.adults;
    v_children := v_children + v_comp.children;
    v_subtotal := v_subtotal + v_price;
    v_room_discount := v_room_discount + v_disc;
  end loop;

  -- senior discount: per adult of senior age on the departure day (departure value, else the series')
  v_senior_each := coalesce(d.senior_discount, d.series_senior_discount, 0);
  v_senior_age := coalesce(d.senior_min_age, d.series_senior_min_age, 65);
  if v_senior_each > 0 and jsonb_typeof(p_args->'adult_dobs') = 'array' then
    for v_dob_text in select jsonb_array_elements_text(p_args->'adult_dobs') loop
      v_dob := null;
      if v_dob_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        begin
          v_dob := v_dob_text::date;
        exception when others then
          v_dob := null;
        end;
      end if;
      if v_dob is not null and v_dob <= (d.start_date - make_interval(years => v_senior_age))::date then
        v_seniors := v_seniors + 1;
      end if;
    end loop;
    v_seniors := least(v_seniors, v_adults);
  end if;

  if d.flight_mode = 'priced' then
    v_flight_each := coalesce(d.flight_price, 0);
  end if;

  v_total := greatest(0, v_subtotal - v_room_discount - v_seniors * v_senior_each + v_flight_each * (v_adults + v_children));

  select st.allocated_seats, st.remaining into v_alloc, v_remaining
    from tours.departure_stats st where st.departure_id = d.id;
  v_reason := case
    when d.start_date <= current_date then 'departed'
    when d.sale_status = 'closed' then 'closed'
    when d.sale_status = 'sold_out' or (coalesce(v_alloc, 0) > 0 and v_remaining <= 0) then 'sold_out'
    when coalesce(v_alloc, 0) > 0 and v_remaining < v_adults + v_children then 'not_enough_seats'
    else null
  end;

  return jsonb_build_object(
    'ok', true, 'departure_id', d.id, 'departure', dep, 'currency', d.currency,
    'lines', v_lines, 'adults', v_adults, 'children', v_children,
    'seniors', v_seniors, 'senior_discount_each', v_senior_each, 'senior_min_age', v_senior_age,
    'flight_each', v_flight_each,
    'subtotal', v_subtotal, 'room_discount', v_room_discount,
    'senior_discount', v_seniors * v_senior_each,
    'flight_total', v_flight_each * (v_adults + v_children),
    'discount', v_room_discount + v_seniors * v_senior_each,
    'total', v_total,
    'bookable', v_reason is null, 'reason', v_reason);
end
$$;


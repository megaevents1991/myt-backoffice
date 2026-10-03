-- Online bookings for a tours company. ADDITIVE ONLY.
--
-- The site of a tours company (Mega Family) now books through the database
-- instead of only sending a lead:
--   * "request" - the customer sends the trip, rooms and passengers and a rep
--     calls back (the WordPress site's "order without payment");
--   * "card"    - the customer pays by card on the CreditGuard hosted page.
-- Both create a row in tours.bookings and a lead in the inbox. A paid booking
-- also adds its passengers to the departure's sold seats
-- (tours.departure_sales_entries), so "last places" / "sold out" follow it.
--
-- The PRICE is computed here, never taken from the browser: rooms from the
-- departure's occupancy matrix (same formulas as lib/tours/pricing.ts and the
-- site's lib/data/departures.mjs), minus the departure's fixed per-passenger
-- discount (what the site shows), minus the senior discount per passenger of
-- senior age on the departure day, plus the flight when it is priced.
-- Departures without a matrix cannot be paid online; a request for them keeps
-- what the customer saw, marked as an estimate.
--
-- Starting and finishing a payment needs the site's payment key: its sha256
-- sits in public.companies.payment_config->>'site_key_sha256'. Until it is set,
-- card payments are off and only requests work.
--
-- The site calls one function, c_<slug>.site_booking(action, args), which
-- provision_company() now creates for tours companies (copied verbatim from
-- 20261002130000 with that block added).
-- Mega Events is untouched: public.reservations is not read or changed.
-- Rollback: section 12 of supabase/rollback/20261001_multi_company.sql.

create sequence if not exists tours.booking_ref_seq start with 10001;

create table if not exists tours.bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  ref text not null unique,                                    -- 'T10001', shown to the customer
  departure_id uuid not null references tours.departures(id),
  lead_id uuid references public.leads(id) on delete set null,
  kind text not null check (kind in ('request','card')),
  status text not null default 'new'
    check (status in ('new','in_progress','pending_payment','paid','review','failed','cancelled','done')),
  price_basis text not null check (price_basis in ('server','estimate')),
  currency text not null,
  rooms jsonb not null default '[]'::jsonb,                    -- quote lines: key, title, adults, children, price, discount, net
  passengers jsonb not null default '[]'::jsonb,
  adults int not null default 0,
  children int not null default 0,
  seniors int not null default 0,
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  total numeric not null default 0,                            -- in the trip currency
  breakdown jsonb not null default '{}'::jsonb,
  customer_name text,
  customer_phone text,
  customer_email text,
  note text,
  source_path text,
  -- payment (card only)
  rate numeric,                                                -- trip currency -> ILS, margin included
  rate_source text check (rate_source in ('company','auto')), -- the day's rate typed in on the Rates screen, or the automatic one
  total_ils numeric,                                           -- what CreditGuard charges, whole shekels
  payments int,
  cg_uniqueid text unique,
  cg_tx_id text,
  cg_auth_number text,
  cg_card_last4 text,
  cg_result jsonb,
  payment_started_at timestamptz,
  paid_at timestamptz,
  sales_entry_id uuid references tours.departure_sales_entries(id) on delete set null,
  -- back office
  receipt_no text,
  confirmation_sent_at timestamptz,
  staff_note text,
  is_deleted date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bookings_company_created_idx on tours.bookings (company_id, created_at desc);
create index if not exists bookings_departure_idx on tours.bookings (departure_id);
create index if not exists bookings_lead_idx on tours.bookings (lead_id) where lead_id is not null;

alter table tours.bookings enable row level security;
grant all on table tours.bookings to service_role;
grant usage, select on sequence tours.booking_ref_seq to service_role;

drop trigger if exists bookings_set_updated_at on tours.bookings;
create trigger bookings_set_updated_at before update on tours.bookings
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------- room compositions
-- Same table as lib/tours/pricing.ts and mega-family lib/data/departures.mjs - change all three together.
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
    ('couple_3_kids',    2, 3, 'זוג + 3 ילדים',   'חדר חמישייה')
  ) as c(key, adults, children, title, summary_label)
  where c.key = p_key
$$;

-- Price of the whole room, null when the matrix cannot price it (a missing
-- price makes the sum null). adult_3_kids and three_adults_kid need the
-- fourth-kid price itself, as on the WordPress site.
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
  fourth numeric := (m->>'child:4')::numeric;
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
    when 'adult_3_kids' then 2 * dbl + third_kid + fourth
    when 'three_adults_kid' then 2 * dbl + third_adult + fourth
    when 'couple_3_kids' then 2 * dbl + third_kid + 2 * extra
    else null
  end;
end
$$;

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

  -- the discount the site shows on the date (valid_until is shown, not enforced - as on WordPress)
  select coalesce(max(value), 0) into v_fixed
    from tours.promotions
   where departure_id = d.id and kind = 'fixed_per_pax' and is_active;

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
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'key', v_key, 'title', v_comp.title, 'summary_label', v_comp.summary_label,
      'adults', v_comp.adults, 'children', v_comp.children,
      'price', v_price, 'discount', v_fixed * v_pax, 'net', v_price - v_fixed * v_pax));
    v_adults := v_adults + v_comp.adults;
    v_children := v_children + v_comp.children;
    v_subtotal := v_subtotal + v_price;
    v_room_discount := v_room_discount + v_fixed * v_pax;
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

-- passengers as the site sends them, trimmed to known fields and sizes
create or replace function tours.booking_passengers(p jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'room', left(e->>'room', 40),
           'type', case when e->>'type' = 'child' then 'child' else 'adult' end,
           'first', left(btrim(coalesce(e->>'first', '')), 80),
           'last', left(btrim(coalesce(e->>'last', '')), 80),
           'gender', left(e->>'gender', 10),
           'dob', case when e->>'dob' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then e->>'dob' end,
           'email', left(btrim(e->>'email'), 120),
           'phone', left(btrim(e->>'phone'), 40))), '[]'::jsonb)
  from (select e from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e limit 60) x
$$;

-- the site's payment key against the hash in companies.payment_config
create or replace function tours.booking_key_ok(p_company uuid, p_key text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    length(p_key) >= 32
    and encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
        = (select payment_config->>'site_key_sha256' from public.companies where id = p_company),
    false)
$$;

-- ---------------------------------------------------------------- create (request / card)
-- args: product_id, rooms, adult_dobs, passengers, customer {first, last, phone, email},
-- note, source_path, and for a request on a date the server cannot price:
-- estimate {total, currency, rooms: [{key, title, adults, children}]} (what the customer saw).
create or replace function tours.booking_create(p_company uuid, p_kind text, p_args jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  q jsonb;
  v_first text := left(btrim(coalesce(p_args#>>'{customer,first}', '')), 80);
  v_last text := left(btrim(coalesce(p_args#>>'{customer,last}', '')), 80);
  v_phone text := left(btrim(coalesce(p_args#>>'{customer,phone}', '')), 40);
  v_email text := left(lower(btrim(coalesce(p_args#>>'{customer,email}', ''))), 120);
  v_name text;
  v_pass jsonb;
  v_basis text;
  v_dep_id uuid;
  v_dep jsonb;
  v_currency text;
  v_rooms jsonb;
  v_adults int;
  v_children int;
  v_total numeric;
  v_ref text;
  v_lead_id uuid;
  v_id uuid;
  v_status text;
begin
  if pg_column_size(p_args) > 32000 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  v_name := btrim(v_first || ' ' || v_last);
  if v_name = '' or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 then
    return jsonb_build_object('ok', false, 'error', 'customer');
  end if;
  if p_kind = 'card' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'error', 'email');
  end if;
  v_pass := tours.booking_passengers(p_args->'passengers');
  q := tours.booking_quote(p_company, p_args);

  if p_kind = 'card' then
    if not coalesce((q->>'ok')::boolean, false) then
      return q - 'departure_id';
    end if;
    if not coalesce((q->>'bookable')::boolean, false) then
      return jsonb_build_object('ok', false, 'error', 'not_bookable', 'reason', q->>'reason');
    end if;
    if (select payment_config->>'site_key_sha256' from public.companies where id = p_company) is null then
      return jsonb_build_object('ok', false, 'error', 'payments_off');
    end if;
    if jsonb_array_length(v_pass) < (q->>'adults')::int + (q->>'children')::int
       or exists (select 1 from jsonb_array_elements(v_pass) e where e->>'first' = '' or e->>'last' = '') then
      return jsonb_build_object('ok', false, 'error', 'passengers');
    end if;
  end if;

  if coalesce((q->>'ok')::boolean, false) then
    v_basis := 'server';
    v_dep_id := (q->>'departure_id')::uuid;
    v_dep := q->'departure';
    v_currency := q->>'currency';
    v_rooms := q->'lines';
    v_adults := (q->>'adults')::int;
    v_children := (q->>'children')::int;
    v_total := (q->>'total')::numeric;
  elsif q ? 'departure_id' and p_kind = 'request' then
    -- the server cannot price this date or room: keep what the customer saw, marked as an estimate
    v_basis := 'estimate';
    v_dep_id := (q->>'departure_id')::uuid;
    v_dep := q->'departure';
    v_currency := case when p_args#>>'{estimate,currency}' in ('USD','EUR','GBP','ILS')
                       then p_args#>>'{estimate,currency}' else q#>>'{departure,currency}' end;
    v_total := case when p_args#>>'{estimate,total}' ~ '^[0-9]{1,9}([.][0-9]{1,2})?$'
                    then (p_args#>>'{estimate,total}')::numeric end;
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', left(e->>'key', 40), 'title', left(e->>'title', 80),
             'adults', case when e->>'adults' ~ '^[0-9]$' then (e->>'adults')::int else 0 end,
             'children', case when e->>'children' ~ '^[0-9]$' then (e->>'children')::int else 0 end)), '[]'::jsonb)
      into v_rooms
      from (select e from jsonb_array_elements(case when jsonb_typeof(p_args#>'{estimate,rooms}') = 'array'
                                                    then p_args#>'{estimate,rooms}' else '[]'::jsonb end) e limit 9) x;
    select coalesce(sum((e->>'adults')::int), 0), coalesce(sum((e->>'children')::int), 0)
      into v_adults, v_children
      from jsonb_array_elements(v_rooms) e;
  else
    return q - 'departure_id';
  end if;

  v_ref := 'T' || nextval('tours.booking_ref_seq');
  v_status := case p_kind when 'card' then 'pending_payment' else 'new' end;

  insert into public.leads (company_id, kind, name, phone, email, message, payload, source_path)
  values (p_company, case p_kind when 'card' then 'booking' else 'advisor' end,
          v_name, v_phone, nullif(v_email, ''), left(p_args->>'note', 2000),
          jsonb_build_object(
            'booking', v_ref,
            'departure', v_dep->>'code',
            'start_date', v_dep->>'start_date',
            'rooms', (select string_agg(e->>'title', ', ') from jsonb_array_elements(v_rooms) e),
            'passengers', v_adults + v_children,
            'total', v_total,
            'currency', v_currency,
            'payment', case p_kind when 'card' then 'card, waiting for payment' else 'request, no payment' end),
          left(p_args->>'source_path', 300))
  returning id into v_lead_id;

  insert into tours.bookings (company_id, ref, departure_id, lead_id, kind, status, price_basis, currency,
                              rooms, passengers, adults, children, seniors, subtotal, discount, total, breakdown,
                              customer_name, customer_phone, customer_email, note, source_path)
  values (p_company, v_ref, v_dep_id, v_lead_id, p_kind, v_status, v_basis, v_currency,
          coalesce(v_rooms, '[]'::jsonb), v_pass, coalesce(v_adults, 0), coalesce(v_children, 0),
          coalesce((q->>'seniors')::int, 0),
          coalesce((q->>'subtotal')::numeric, v_total, 0), coalesce((q->>'discount')::numeric, 0), coalesce(v_total, 0),
          case when v_basis = 'server' then q - 'departure_id' - 'departure'
               else jsonb_build_object('estimate', p_args->'estimate') end,
          v_name, v_phone, nullif(v_email, ''), left(p_args->>'note', 2000), left(p_args->>'source_path', 300))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref, 'kind', p_kind, 'status', v_status,
                            'total', v_total, 'currency', v_currency, 'price_basis', v_basis,
                            'email', nullif(v_email, ''));
end
$$;

-- ---------------------------------------------------------------- payment
-- start: the site's server fixed the uniqueid it sends to CreditGuard and an
-- automatic rate (trip currency -> ILS, margin included). When the company typed
-- in today's rate on the Rates screen (public.company_exchange_rates), that rate
-- is used instead. The charge is computed here.
create or replace function tours.booking_start_payment(p_company uuid, p_args jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  b tours.bookings%rowtype;
  v_uid text := p_args->>'uniqueid';
  v_rate numeric;
  v_company_rate numeric;
  v_source text;
  v_ils numeric;
  v_payments int;
begin
  if not tours.booking_key_ok(p_company, p_args->>'key') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if coalesce(p_args->>'booking_id', '') !~ '^[0-9a-f-]{36}$' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into b from tours.bookings
   where id = (p_args->>'booking_id')::uuid and company_id = p_company and is_deleted is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.kind <> 'card' or b.status not in ('pending_payment', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'state', 'status', b.status);
  end if;
  if coalesce(v_uid, '') !~ '^[A-Za-z0-9-]{8,64}$' then
    return jsonb_build_object('ok', false, 'error', 'uniqueid');
  end if;
  select r.rate_to_ils into v_company_rate
    from public.company_exchange_rates r
   where r.company_id = p_company and r.currency = b.currency
     and r.rate_date = (now() at time zone 'Asia/Jerusalem')::date;
  if b.currency = 'ILS' then
    v_rate := 1;
    v_source := 'auto';
  elsif v_company_rate is not null then
    v_rate := v_company_rate;
    v_source := 'company';
  else
    if coalesce(p_args->>'rate', '') !~ '^[0-9]{1,2}([.][0-9]{1,6})?$' then
      return jsonb_build_object('ok', false, 'error', 'rate');
    end if;
    v_rate := (p_args->>'rate')::numeric;
    v_source := 'auto';
  end if;
  if not (case b.currency
            when 'ILS' then v_rate = 1
            when 'USD' then v_rate between 2.5 and 5
            when 'EUR' then v_rate between 2.7 and 5.6
            when 'GBP' then v_rate between 3.2 and 6.6
            else false end) then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;
  v_ils := ceil(b.total * v_rate);
  if v_ils <= 0 then
    return jsonb_build_object('ok', false, 'error', 'amount');
  end if;
  v_payments := case when coalesce(p_args->>'payments', '') ~ '^[0-9]{1,2}$'
                     then least(greatest((p_args->>'payments')::int, 1), 12) else 1 end;

  update tours.bookings
     set rate = v_rate, rate_source = v_source, total_ils = v_ils, payments = v_payments, cg_uniqueid = v_uid,
         status = 'pending_payment', payment_started_at = now()
   where id = b.id;

  return jsonb_build_object('ok', true, 'ref', b.ref, 'rate', v_rate, 'rate_source', v_source, 'total_ils', v_ils, 'agorot', (v_ils * 100)::bigint,
                            'payments', v_payments, 'email', b.customer_email, 'name', b.customer_name);
end
$$;

-- finish: the site's server asked CreditGuard (inquireTransactions) what
-- happened to the transaction and passes the answer. A booking becomes paid
-- only when CreditGuard says it succeeded AND charged exactly total_ils;
-- a success with another amount or currency is kept for a human ("review").
create or replace function tours.booking_finish_payment(p_company uuid, p_args jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  b tours.bookings%rowtype;
  v_ok boolean := (p_args->'ok') = 'true'::jsonb;
  v_amount bigint;
  v_cur text := upper(coalesce(p_args->>'currency', ''));
  v_result jsonb := case when jsonb_typeof(p_args->'result') = 'object' and pg_column_size(p_args->'result') < 20000
                         then p_args->'result' end;
  v_entry uuid;
begin
  if not tours.booking_key_ok(p_company, p_args->>'key') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if coalesce(p_args->>'uniqueid', '') !~ '^[A-Za-z0-9-]{8,64}$' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into b from tours.bookings
   where company_id = p_company and cg_uniqueid = p_args->>'uniqueid' and is_deleted is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status = 'paid' then
    return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'paid', 'already', true);
  end if;
  v_amount := case when coalesce(p_args->>'amount_agorot', '') ~ '^[0-9]{1,12}$'
                   then (p_args->>'amount_agorot')::bigint end;

  update tours.bookings
     set cg_tx_id = coalesce(left(p_args->>'tx_id', 80), cg_tx_id),
         cg_auth_number = coalesce(left(p_args->>'auth_number', 40), cg_auth_number),
         cg_card_last4 = coalesce(case when p_args->>'card_last4' ~ '^[0-9]{4}$' then p_args->>'card_last4' end, cg_card_last4),
         cg_result = coalesce(v_result, cg_result)
   where id = b.id;

  if not v_ok then
    update tours.bookings set status = 'failed' where id = b.id;
    return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'failed');
  end if;

  if v_amount is distinct from (b.total_ils * 100)::bigint or v_cur not in ('', 'ILS', '1', '376')
     or exists (select 1 from tours.bookings o where o.company_id = p_company and o.id <> b.id and o.cg_tx_id = p_args->>'tx_id') then
    update tours.bookings
       set status = 'review',
           staff_note = concat_ws(chr(10), staff_note,
             'CreditGuard reported a successful charge, but its amount or currency does not match this booking, or the transaction already paid another booking. Check it in CreditGuard before confirming.')
     where id = b.id;
    return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'review');
  end if;

  insert into tours.departure_sales_entries (company_id, departure_id, pax, note,
                                             customer_name, customer_phone, customer_email, lead_id)
  values (p_company, b.departure_id, b.adults + b.children, 'Online booking ' || b.ref || ', paid by card',
          b.customer_name, b.customer_phone, b.customer_email, b.lead_id)
  returning id into v_entry;

  update tours.bookings set status = 'paid', paid_at = now(), sales_entry_id = v_entry where id = b.id;
  update public.leads
     set status = case when status = 'spam' then status else 'done' end,
         payload = payload || jsonb_build_object('payment', 'card, paid')
   where id = b.lead_id;

  return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'paid');
end
$$;

-- ---------------------------------------------------------------- the one entry point
create or replace function tours.site_booking(p_company uuid, p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'args');
  end if;
  case p_action
    when 'quote' then return tours.booking_quote(p_company, p_args) - 'departure_id';
    when 'request' then return tours.booking_create(p_company, 'request', p_args);
    when 'checkout' then return tours.booking_create(p_company, 'card', p_args);
    when 'start_payment' then return tours.booking_start_payment(p_company, p_args);
    when 'finish_payment' then return tours.booking_finish_payment(p_company, p_args);
    else return jsonb_build_object('ok', false, 'error', 'action');
  end case;
end
$$;

revoke all on function tours.room_composition(text) from public;
revoke all on function tours.room_price(text, jsonb) from public;
revoke all on function tours.booking_quote(uuid, jsonb) from public;
revoke all on function tours.booking_passengers(jsonb) from public;
revoke all on function tours.booking_key_ok(uuid, text) from public;
revoke all on function tours.booking_create(uuid, text, jsonb) from public;
revoke all on function tours.booking_start_payment(uuid, jsonb) from public;
revoke all on function tours.booking_finish_payment(uuid, jsonb) from public;
revoke all on function tours.site_booking(uuid, text, jsonb) from public;
grant execute on function tours.room_composition(text) to service_role;
grant execute on function tours.room_price(text, jsonb) to service_role;
grant execute on function tours.booking_quote(uuid, jsonb) to service_role;
grant execute on function tours.site_booking(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------- provision_company
-- Copied verbatim from 20261002130000; only the site_booking block (end of the tours branch) is new.
create or replace function public.provision_company(p_slug text)
returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  c public.companies%rowtype;
  s text;
begin
  select * into c from public.companies where slug = p_slug;
  if not found then
    raise exception 'company % not found', p_slug;
  end if;
  s := c.schema_name;

  execute format('create schema if not exists %I', s);
  execute format('grant usage on schema %I to anon, authenticated, service_role', s);

  if 'tours' = any (c.product_types) then
    -- catalog ---------------------------------------------------------------
    execute format('drop view if exists %I.packages cascade', s);
    execute format($v$create view %I.packages with (security_barrier) as
      select * from tours.packages
      where company_id = %L and is_active and is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.package_itineraries cascade', s);
    execute format($v$create view %I.package_itineraries with (security_barrier) as
      select * from tours.package_itineraries where company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.terms cascade', s);
    execute format($v$create view %I.terms with (security_barrier) as
      select * from tours.terms where company_id = %L and is_active$v$, s, c.id);

    execute format('drop view if exists %I.package_terms cascade', s);
    execute format($v$create view %I.package_terms with (security_barrier) as
      select pt.* from tours.package_terms pt
      join tours.packages p on p.id = pt.package_id
      where p.company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.series cascade', s);
    execute format($v$create view %I.series with (security_barrier) as
      select * from tours.series where company_id = %L and is_active$v$, s, c.id);

    execute format('drop view if exists %I.series_terms cascade', s);
    execute format($v$create view %I.series_terms with (security_barrier) as
      select st.* from tours.series_terms st
      join tours.series sr on sr.id = st.series_id
      where sr.company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.hotels cascade', s);
    execute format($v$create view %I.hotels with (security_barrier) as
      select * from tours.hotels where company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.cars cascade', s);
    execute format($v$create view %I.cars with (security_barrier) as
      select * from tours.cars where company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.instructors cascade', s);
    execute format($v$create view %I.instructors with (security_barrier) as
      select * from tours.instructors where company_id = %L and is_active$v$, s, c.id);

    execute format('drop view if exists %I.cms_pages cascade', s);
    execute format($v$create view %I.cms_pages with (security_barrier) as
      select * from tours.cms_pages where company_id = %L and is_active$v$, s, c.id);

    -- departures: published only, internal columns left out -------------------
    execute format('drop view if exists %I.departures cascade', s);
    execute format($v$create view %I.departures with (security_barrier) as
      select d.id, d.package_id, d.series_id, d.code, d.season_year, d.start_date, d.end_date, d.season, d.currency,
             -- the status the site shows: the operator's closed / sold_out win; otherwise the seats decide
             -- (flight seats allocated and none left: sold_out; 5 or fewer: last_places, the backoffice's
             -- LAST_PLACES_THRESHOLD). The seat counts themselves stay internal.
             case
               when d.sale_status in ('closed', 'sold_out') then d.sale_status
               when st.allocated_seats > 0 and st.remaining <= 0 then 'sold_out'
               when st.allocated_seats > 0 and st.remaining <= 5 then 'last_places'
               else d.sale_status
             end as sale_status,
             d.card_badge, d.date_labels, d.arrival_airport, d.return_airport, d.itinerary_id,
             d.meeting_at, d.flight_mode, d.flight_price, d.baggage_included, d.meal_included, d.transfers_included,
             d.connection_out, d.connection_back, d.child_max_age, d.senior_min_age, d.senior_discount,
             d.markup_percent, d.markup_fixed, d.legacy_product_id, d.site_id, d.data
      from tours.departures d
      left join tours.departure_stats st on st.departure_id = d.id
      where d.company_id = %L and d.is_published and d.is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.departure_prices cascade', s);
    execute format($v$create view %I.departure_prices with (security_barrier) as
      select dp.departure_id, dp.pax_type, dp.room_position, dp.price
      from tours.departure_prices dp
      join tours.departures d on d.id = dp.departure_id
      where d.company_id = %L and d.is_published and d.is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.departure_options cascade', s);
    execute format($v$create view %I.departure_options with (security_barrier) as
      select o.id, o.departure_id, o.kind, o.position, o.ref_code, o.label, o.board, o.nights,
             o.stay_order, o.max_people, o.price, o.price_unit, o.room_prices
      from tours.departure_options o
      join tours.departures d on d.id = o.departure_id
      where d.company_id = %L and d.is_published and d.is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.promotions cascade', s);
    execute format($v$create view %I.promotions with (security_barrier) as
      select id, departure_id, series_id, kind, value, label, valid_until, show_on_card
      from tours.promotions
      where company_id = %L and is_active$v$, s, c.id);  -- valid_until is shown, not enforced: the site decides (WordPress never hid an expired discount)

    -- the live flight block(s) of a published departure: schedule only ---------
    execute format('drop view if exists %I.departure_flights cascade', s);
    execute format($v$create view %I.departure_flights with (security_barrier) as
      select fa.departure_id, fa.legs, f.id as flight_id, f.block_status,
             f.airline_code, f.inbound_airline_code, f.metadata_name, f.metadata_logo, f.stops,
             f.outbound_flight_number, f.outbound_departure_airport, f.outbound_arrival_airport,
             f.outbound_departure_time, f.outbound_arrival_time, f.outbound_stop_airport, f.outbound_stop_duration,
             f.outbound_check_bags_included,
             f.inbound_flight_number, f.inbound_departure_airport, f.inbound_arrival_airport,
             f.inbound_departure_time, f.inbound_arrival_time, f.inbound_stop_airport, f.inbound_stop_duration,
             f.inbound_check_bags_included
      from tours.flight_allocations fa
      join public.flights f on f.id = fa.flight_id
      join tours.departures d on d.id = fa.departure_id
      where f.company_id = %L and d.company_id = %L
        and f.is_deleted is not true
        and f.block_status in ('confirmed','operational','ticketed')
        and d.is_published and d.is_deleted is null$v$, s, c.id, c.id);

    -- online booking: one entry point for the site (tours.site_booking) ----
    execute format($f$create or replace function %I.site_booking(p_action text, p_args jsonb default '{}'::jsonb)
      returns jsonb
      language sql
      security definer
      set search_path = public, pg_temp
      as $body$ select tours.site_booking(%L::uuid, p_action, p_args) $body$$f$, s, c.id);
    execute format('revoke all on function %I.site_booking(text, jsonb) from public', s);
    execute format('grant execute on function %I.site_booking(text, jsonb) to anon, authenticated, service_role', s);
  end if;

  -- forms ---------------------------------------------------------------------
  execute format($f$create or replace function %I.submit_lead(
      p_kind text, p_name text, p_phone text, p_email text, p_message text,
      p_payload jsonb default '{}'::jsonb, p_source_path text default null, p_utm jsonb default '{}'::jsonb)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $body$
    declare new_id uuid;
    begin
      if coalesce(btrim(p_name), '') = '' and coalesce(btrim(p_phone), '') = '' and coalesce(btrim(p_email), '') = '' then
        raise exception 'empty lead';
      end if;
      if pg_column_size(coalesce(p_payload, '{}'::jsonb)) > 16000 then
        raise exception 'payload too large';
      end if;
      insert into public.leads (company_id, kind, name, phone, email, message, payload, source_path, utm)
      values (%L,
              left(coalesce(nullif(btrim(p_kind), ''), 'lead'), 40),
              left(p_name, 300), left(p_phone, 40), left(p_email, 120), left(p_message, 4000),
              coalesce(p_payload, '{}'::jsonb), left(p_source_path, 300), coalesce(p_utm, '{}'::jsonb))
      returning id into new_id;
      return new_id;
    end
    $body$$f$, s, c.id);
  execute format('revoke all on function %I.submit_lead(text, text, text, text, text, jsonb, text, jsonb) from public', s);
  execute format('grant execute on function %I.submit_lead(text, text, text, text, text, jsonb, text, jsonb) to anon, authenticated, service_role', s);

  execute format('grant select on all tables in schema %I to anon, authenticated, service_role', s);
end
$fn$;

select public.reprovision_all_companies();

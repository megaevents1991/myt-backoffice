-- Tours cases - Alon's QA of the rejects round (18.10).
--
-- 1. leads.offer: the booking link the rep prepared - date, rooms, the site's price, the link, the
--    follow-up day, when and how it was SENT (WhatsApp / e-mail; a copied link is not sent). Written by the
--    backoffice only (mintBookingLink / markOfferSent / withdrawOffer); the site never writes it.
-- 2. booking_create: a booking from the site sets the case's follow-up day to today (Israel) - "a new
--    booking the customer sent is today's call", Alon on A3 - on the case it hangs on and on a new one; a
--    booking that came through the link marks the offer with its ref (offer.bookingRef).
--    Same as 20261015172708 otherwise.

alter table public.leads add column if not exists offer jsonb;

-- ---------------------------------------------------------------- booking_create
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
  -- the case
  v_token text := case when coalesce(p_args->>'lead_ref', '') ~ '^[A-Za-z0-9_-]{16,64}$' then p_args->>'lead_ref' end;
  v_utm jsonb := public.clean_utm(p_args->'utm');
  v_phone_key text;
  v_payload jsonb;
  v_case uuid;
  v_match text;
  -- the customer's earlier case, when the booking cannot hang on it
  v_rel_id uuid;
  v_rel_rep uuid;
  -- a site booking is today's call (Alon 18.10)
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
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
  v_phone_key := right(regexp_replace(v_phone, '\D', '', 'g'), 9);
  v_payload := jsonb_build_object(
    'booking', v_ref,
    'departure', v_dep->>'code',
    'start_date', v_dep->>'start_date',
    'rooms', (select string_agg(e->>'title', ', ') from jsonb_array_elements(v_rooms) e),
    'passengers', v_adults + v_children,
    'total', v_total,
    'currency', v_currency,
    'payment', case p_kind when 'card' then 'card, waiting for payment' else 'request, no payment' end);

  -- the customer's case: the booking link's token, else an open lead with the same phone / e-mail
  if v_token is not null then
    select l.id into v_case
      from public.leads l
     where l.company_id = p_company and l.link_token = v_token and l.is_deleted is null;
    if v_case is not null then
      v_match := 'token';
    end if;
  end if;
  if v_case is null then
    select l.id into v_case
      from public.leads l
     where l.company_id = p_company and l.is_deleted is null
       and l.type in ('lead', 'potential')
       and l.created_at > now() - interval '90 days'
       and not public.lead_status_closed(p_company, l.status)
       and not exists (select 1 from tours.bookings b where b.lead_id = l.id)
       and ((length(v_phone_key) = 9 and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9) = v_phone_key)
            or (v_email <> '' and lower(l.email) = v_email))
     order by l.created_at desc
     limit 1;
    if v_case is not null then
      v_match := 'contact';
    end if;
  end if;

  if v_case is not null then
    -- The token is a secret the rep sent this customer: the booking may complete the case.
    -- A phone / e-mail match is only what an anonymous visitor typed: the booking hangs on the
    -- case and makes it a new reservation, but never writes the case's names, contact or UTM,
    -- and the case says how it was matched so staff can check the order's own customer.
    update public.leads l
       set type = 'reservation',
           status = v_status,
           departure_id = v_dep_id,
           package_id = coalesce((select d.package_id from tours.departures d where d.id = v_dep_id), l.package_id),
           first_name = case when v_match = 'token' then coalesce(nullif(l.first_name, ''), nullif(v_first, '')) else l.first_name end,
           last_name = case when v_match = 'token' then coalesce(nullif(l.last_name, ''), nullif(v_last, '')) else l.last_name end,
           name = case when v_match = 'token' then coalesce(nullif(l.name, ''), v_name) else l.name end,
           phone = case when v_match = 'token' then coalesce(nullif(l.phone, ''), v_phone) else l.phone end,
           email = case when v_match = 'token' then coalesce(nullif(l.email, ''), nullif(v_email, '')) else l.email end,
           utm = case when v_match = 'token' and l.utm = '{}'::jsonb then v_utm else l.utm end,
           payload = l.payload || v_payload || jsonb_build_object('matched_by', v_match),
           follow_up_date = v_today,
           -- the offer this link carried: the booking that came through it
           offer = case when v_match = 'token' and jsonb_typeof(l.offer) = 'object'
                        then l.offer || jsonb_build_object('bookingRef', v_ref) else l.offer end
     where l.id = v_case;
    v_lead_id := v_case;
  else
    -- a known customer (a case with a booking already, a closed one, an older one): the new case goes
    -- to the same rep and names the earlier one, which staff may merge it into
    select l.id, l.assigned_to into v_rel_id, v_rel_rep
      from public.leads l
     where l.company_id = p_company and l.is_deleted is null
       and ((length(v_phone_key) = 9 and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9) = v_phone_key)
            or (v_email <> '' and lower(l.email) = v_email))
     order by l.created_at desc
     limit 1;
    insert into public.leads (company_id, kind, type, status, name, first_name, last_name, phone, email,
                              message, payload, source_path, utm, departure_id, assigned_to, related_lead_id, follow_up_date)
    values (p_company, case p_kind when 'card' then 'booking' else 'advisor' end, 'reservation', v_status,
            v_name, nullif(v_first, ''), nullif(v_last, ''), v_phone, nullif(v_email, ''),
            left(p_args->>'note', 2000), v_payload, left(p_args->>'source_path', 300), v_utm, v_dep_id, v_rel_rep, v_rel_id, v_today)
    returning id into v_lead_id;
  end if;

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
revoke all on function tours.booking_create(uuid, text, jsonb) from public;

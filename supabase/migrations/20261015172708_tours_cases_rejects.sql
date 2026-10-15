-- Tours cases - Alon's rejects round (road-map tab "חיבור למקום אחד שהוא בעצם לידים והזמנות", 15.10).
--
-- 1. "Offer sent": a system status the booking link sets (with the follow-up day the rep must pick).
-- 2. leads.close_reason: why a case was closed as not relevant / cancelled (the rep must write it).
-- 3. booking_create: a site booking that cannot hang on an open lead but whose customer is already
--    known (same phone / e-mail) opens its case on that customer's rep and names the earlier case -
--    the rep finds it in their queue and the case page offers to merge the two.
-- 4. leads_fill: a waiting-list form names its date in payload.date.productId - the case gets the departure.
-- 5. public.merge_lead_cases: staff link a booking to the customer's lead (a booking sent with another
--    phone) - the source case's bookings and seats move to the target in one transaction.

-- ---------------------------------------------------------------- 1. "Offer sent"
-- Inserted right after "Follow-up" in each tours company's list (the list's order is `position`).
do $$
declare
  c record;
  v_pos int;
begin
  for c in select id from public.companies where 'tours' = any(product_types) loop
    if exists (select 1 from public.lead_statuses where company_id = c.id and key = 'offer_sent') then
      continue;
    end if;
    select position + 1 into v_pos from public.lead_statuses where company_id = c.id and key = 'follow_up';
    if v_pos is null then
      select coalesce(max(position), -1) + 1 into v_pos from public.lead_statuses where company_id = c.id;
    end if;
    update public.lead_statuses set position = position + 1 where company_id = c.id and position >= v_pos;
    insert into public.lead_statuses (company_id, key, label, color, position, is_closed, is_system)
    values (c.id, 'offer_sent', 'הצעה נשלחה', 'indigo', v_pos, false, true);
  end loop;
end
$$;

-- ---------------------------------------------------------------- 2. close reason
alter table public.leads add column if not exists close_reason text;

-- ---------------------------------------------------------------- 4. waiting-list date -> departure
-- Same as 20261014220000 except the product id: the page's ?product_id=, else the waiting-list
-- form's own date (payload.date.productId).
create or replace function public.leads_fill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pid bigint;
  v_slug text;
  v_dep record;
begin
  if new.type is null or new.type = '' then
    new.type := case when new.kind in ('notify', 'waitlist', 'newsletter') then 'potential'
                     when new.kind in ('booking', 'advisor') then 'reservation'
                     else 'lead' end;
  end if;
  if coalesce(new.first_name, '') = '' and coalesce(new.last_name, '') = '' and coalesce(btrim(new.name), '') <> '' then
    new.first_name := split_part(btrim(new.name), ' ', 1);
    new.last_name := nullif(btrim(substr(btrim(new.name), length(new.first_name) + 1)), '');
  elsif coalesce(btrim(new.name), '') = '' and (coalesce(new.first_name, '') <> '' or coalesce(new.last_name, '') <> '') then
    new.name := btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
  end if;
  new.utm := public.clean_utm(new.utm);
  if new.departure_id is null then
    v_pid := coalesce(
      nullif(substring(coalesce(new.source_path, '') from '[?&]product_id=([0-9]{1,12})(?:[&#]|$)'), '')::bigint,
      case when jsonb_typeof(new.payload->'date') = 'object' and coalesce(new.payload#>>'{date,productId}', '') ~ '^[0-9]{1,12}$'
           then (new.payload#>>'{date,productId}')::bigint end);
    if v_pid is not null then
      select d.id, d.package_id into v_dep
        from tours.departures d
       where d.company_id = new.company_id and d.is_deleted is null
         and (d.legacy_product_id = v_pid or d.site_id = v_pid)
       order by (d.legacy_product_id is not distinct from v_pid) desc
       limit 1;
      if found then
        new.departure_id := v_dep.id;
        new.package_id := coalesce(new.package_id, v_dep.package_id);
      end if;
    end if;
  end if;
  if new.package_id is null then
    v_slug := coalesce(nullif(new.payload->>'slug', ''),
                       public.url_decode(substring(coalesce(new.source_path, '') from '^/package/([^/?#]+)')));
    if v_slug is not null then
      select p.id into new.package_id
        from tours.packages p
       where p.company_id = new.company_id and p.slug = v_slug and p.is_deleted is null
       limit 1;
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.leads_fill() from public;
revoke execute on function public.leads_fill() from anon, authenticated;

-- ---------------------------------------------------------------- 3. booking_create
-- Same as 20261014220000 except the last branch: a booking that opens a new case first looks for
-- the customer's newest case of any kind (same phone, last 9 digits, or e-mail). When one exists the
-- new case is given that case's rep and names it in payload.related_case - never its names, contact
-- or UTM, and nothing on the old case changes (an anonymous visitor typed that phone).
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
  v_rel_no bigint;
  v_rel_rep uuid;
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
           payload = l.payload || v_payload || jsonb_build_object('matched_by', v_match)
     where l.id = v_case;
    v_lead_id := v_case;
  else
    -- a known customer (a case with a booking already, a closed one, an older one): the new case goes
    -- to the same rep and names the earlier one, which staff may merge it into
    select l.id, l.case_no, l.assigned_to into v_rel_id, v_rel_no, v_rel_rep
      from public.leads l
     where l.company_id = p_company and l.is_deleted is null
       and ((length(v_phone_key) = 9 and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9) = v_phone_key)
            or (v_email <> '' and lower(l.email) = v_email))
     order by l.created_at desc
     limit 1;
    if v_rel_id is not null then
      v_payload := v_payload || jsonb_build_object('related_case', jsonb_build_object('id', v_rel_id, 'case_no', v_rel_no));
    end if;
    insert into public.leads (company_id, kind, type, status, name, first_name, last_name, phone, email,
                              message, payload, source_path, utm, departure_id, assigned_to)
    values (p_company, case p_kind when 'card' then 'booking' else 'advisor' end, 'reservation', v_status,
            v_name, nullif(v_first, ''), nullif(v_last, ''), v_phone, nullif(v_email, ''),
            left(p_args->>'note', 2000), v_payload, left(p_args->>'source_path', 300), v_utm, v_dep_id, v_rel_rep)
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

-- ---------------------------------------------------------------- 5. merge two cases
-- Staff link a site booking to the customer's lead (the customer typed another phone, or the
-- automatic match did not apply): every booking and seat row of the source case moves to the
-- target, the target fills what it lacks from the source, the source is marked deleted and
-- names the target. One transaction - a half-moved customer is never left behind. Called only by
-- the backoffice (service role), which checked the company and wrote the audit.
create or replace function public.merge_lead_cases(p_company uuid, p_source uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.leads%rowtype;
  t public.leads%rowtype;
  v_target_had boolean;
  v_bookings int;
  v_seats int;
  v_token text;
begin
  if p_source = p_target then
    return jsonb_build_object('ok', false, 'error', 'same');
  end if;
  -- lock both rows in a fixed order, so two merges of the same pair cannot deadlock
  perform 1 from public.leads where id in (p_source, p_target) and company_id = p_company order by id for update;
  select * into s from public.leads where id = p_source and company_id = p_company and is_deleted is null;
  select * into t from public.leads where id = p_target and company_id = p_company and is_deleted is null;
  if s.id is null or t.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_target_had := exists (select 1 from tours.bookings b where b.company_id = p_company and b.lead_id = t.id and b.is_deleted is null);
  update tours.bookings set lead_id = t.id where company_id = p_company and lead_id = s.id;
  get diagnostics v_bookings = row_count;
  update tours.departure_sales_entries set lead_id = t.id where company_id = p_company and lead_id = s.id;
  get diagnostics v_seats = row_count;

  -- the token is unique: free it on the source before the target may take it
  v_token := s.link_token;
  update public.leads
     set link_token = null,
         is_deleted = current_date,
         payload = payload || jsonb_build_object('merged_into', jsonb_build_object('id', t.id, 'case_no', t.case_no))
   where id = s.id;

  update public.leads l
     set type = case when v_bookings > 0 or s.type = 'reservation' or t.type = 'reservation' then 'reservation'
                     when t.type = 'lead' or s.type = 'lead' then 'lead'
                     else t.type end,
         -- the bookings' payment state comes with them when the target had none of its own
         status = case when v_bookings > 0 and not v_target_had then s.status else t.status end,
         first_name = coalesce(nullif(t.first_name, ''), s.first_name),
         last_name = coalesce(nullif(t.last_name, ''), s.last_name),
         name = coalesce(nullif(t.name, ''), s.name),
         phone = coalesce(nullif(t.phone, ''), s.phone),
         email = coalesce(nullif(t.email, ''), s.email),
         id_number = coalesce(nullif(t.id_number, ''), s.id_number),
         acc_num = coalesce(nullif(t.acc_num, ''), s.acc_num),
         message = coalesce(nullif(t.message, ''), s.message),
         source_path = coalesce(t.source_path, s.source_path),
         departure_id = case when v_bookings > 0 and not v_target_had then coalesce(s.departure_id, t.departure_id)
                             else coalesce(t.departure_id, s.departure_id) end,
         package_id = case when v_bookings > 0 and not v_target_had then coalesce(s.package_id, t.package_id)
                           else coalesce(t.package_id, s.package_id) end,
         assigned_to = coalesce(t.assigned_to, s.assigned_to),
         follow_up_date = coalesce(t.follow_up_date, s.follow_up_date),
         utm = case when coalesce(t.utm, '{}'::jsonb) = '{}'::jsonb then s.utm else t.utm end,
         notes = nullif(concat_ws(E'\n\n', nullif(t.notes, ''),
                                  case when coalesce(s.notes, '') <> '' then 'From case #' || s.case_no || ': ' || s.notes end), ''),
         link_token = coalesce(t.link_token, v_token),
         link_sent_at = greatest(t.link_sent_at, s.link_sent_at),
         payload = (t.payload - 'related_case')
                   || jsonb_build_object('merged',
                        coalesce(t.payload->'merged', '[]'::jsonb)
                        || jsonb_build_array(jsonb_build_object('id', s.id, 'case_no', s.case_no, 'at', now())))
   where l.id = t.id;

  return jsonb_build_object('ok', true, 'bookings', v_bookings, 'seats', v_seats,
                            'source_no', s.case_no, 'target_no', t.case_no);
end
$$;
revoke all on function public.merge_lead_cases(uuid, uuid, uuid) from public;
revoke execute on function public.merge_lead_cases(uuid, uuid, uuid) from anon, authenticated;
grant execute on function public.merge_lead_cases(uuid, uuid, uuid) to service_role;

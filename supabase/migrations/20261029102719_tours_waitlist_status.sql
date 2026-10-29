-- Tours board round 5 (Alon 29.10 on the round 4 report, https://claude.ai/artifact/EMdcn6UVQZfnmK2zbQSShe card
-- "tours-waitlist": "הסטטוס לא צריך להיות חדש. והוא גם לא צריך להיכנס ל-TODAY, רק ל-WAITING LIST"; Dor 29.10 took
-- every recommended answer).
--
-- (1) A system status "Waiting list" (key 'waitlist', open) for every tours company, right after "Future" in the
--     company's own order (the statuses after it move down one; a company's reordering is kept).
-- (2) public.leads_fill: a waiting-list / notify-me form never folds into a deal, not even one at New - it joins the
--     tour's waiting-list card, else opens its own card in 'waitlist', with leads.related_lead_id = the tour's newest
--     open card (the "↔ #" chip). Every other form of the tour passes over a waiting-list card while the tour has another
--     open card; one that lands on it (the only card open) turns it "returned". A second waiting-list form keeps the
--     card where it is (no status, no follow-up day).
-- (3) tours.booking_create: a booking matched by phone / e-mail takes a waiting-list card only when no other card fits.
-- (4) Backfill: open cards opened by a waiting-list / notify-me form and STILL WAITING move to 'waitlist' (Dor 29.10) -
--     at New, no order (no booking, not a reservation), no seat row, no inquiry of another kind joined, not to file,
--     not a merge target. A card that became a deal keeps New (review 29.10).
--
-- Both functions are copied verbatim from 20261028123147_tours_waitlist_routing.sql (their latest definitions) and only
-- the lines marked (29.10) differ. TS twin: newCardStatus / isWaitingListCard / routeInquiry / statusOnReturn in
-- lib/tours/cases.ts (scripts/tours-cases-selftest.ts). create or replace keeps the trigger and the grants.

-- ---------------------------------------------------------------- 1. the status
do $$
declare
  c record;
  v_after int;
  v_label text;
begin
  for c in select id from public.companies where 'tours' = any(product_types) loop
    -- a company still on the default list (no rows) reads DEFAULT_STATUSES, which has it
    continue when not exists (select 1 from public.lead_statuses s where s.company_id = c.id);
    continue when exists (select 1 from public.lead_statuses s where s.company_id = c.id and s.key = 'waitlist');
    select s.position into v_after from public.lead_statuses s where s.company_id = c.id and s.key = 'future';
    if v_after is null then
      select coalesce(max(s.position), -1) into v_after from public.lead_statuses s where s.company_id = c.id and s.is_active;
    end if;
    update public.lead_statuses s set position = s.position + 1 where s.company_id = c.id and s.position > v_after;
    -- a status of the company's own may already carry the name: two statuses with one name cannot be saved again
    v_label := case when exists (select 1 from public.lead_statuses s where s.company_id = c.id and s.label = 'רשימת המתנה')
                    then 'רשימת המתנה (מערכת)' else 'רשימת המתנה' end;
    insert into public.lead_statuses (company_id, key, label, color, position, is_closed, is_system, is_active)
    values (c.id, 'waitlist', v_label, 'amber', v_after + 1, false, true, true);
  end loop;
end
$$;

-- ---------------------------------------------------------------- 4. the waiting lists already at New
update public.leads l
   set status = 'waitlist', updated_at = now()
 where l.is_deleted is null
   and l.kind in ('waitlist', 'notify')
   and l.status = 'new'
   -- still waiting: no order, no seats, nothing but waiting-list forms joined, not to file, nothing merged into it
   and coalesce(l.type, '') <> 'reservation'
   and not coalesce(l.to_file, false)
   and not exists (select 1 from tours.bookings b where b.lead_id = l.id)
   and not exists (select 1 from tours.departure_sales_entries e where e.lead_id = l.id)
   and not (coalesce(l.payload, '{}'::jsonb) ? 'merged')
   and not exists (
     select 1
       from jsonb_array_elements(case when jsonb_typeof(l.payload->'inquiries') = 'array' then l.payload->'inquiries' else '[]'::jsonb end) i
      where coalesce(i->>'kind', '') not in ('waitlist', 'notify'))
   -- the trigger's rule: the company has the status, or reads the default list (which has it)
   and (exists (select 1 from public.lead_statuses s where s.company_id = l.company_id and s.key = 'waitlist')
        or not exists (select 1 from public.lead_statuses s where s.company_id = l.company_id));

-- ---------------------------------------------------------------- 2 + 3. the functions
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
  v_key text;
  v_cust uuid;
  v_rep uuid;
  v_target record;
  v_joined boolean := false;
  v_new_customer boolean := false;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  new.payload := coalesce(new.payload, '{}'::jsonb) - 'matched_by' - 'related_case' - 'merged' - 'merged_into' - 'joined_into' - 'inquiries';
  if new.type is null or new.type = '' then
    -- a 'whatsapp' row (an inbound message, 2026-10-21) takes the 'lead' arm
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

  -- the customer: the one the backoffice named (of this company), else the phone's, else a new one. A form
  -- never writes over a known customer - a visitor typed it.
  if new.customer_id is not null then
    select c.id into v_cust from public.customers c where c.id = new.customer_id and c.company_id = new.company_id;
  end if;
  v_key := public.phone_key(new.phone);
  if v_cust is null and v_key <> '' then
    select c.id into v_cust from public.customers c
     where c.company_id = new.company_id and c.is_deleted is null and c.phone_keys @> array[v_key]
       -- (c) a WhatsApp row binds only to a customer whose stored phone normalises to the same full number
       and (new.kind <> 'whatsapp'
            or exists (select 1 from unnest(c.phones) ph where public.whatsapp_phone(ph) = public.whatsapp_phone(new.phone)))
     order by c.customer_no limit 1;
  end if;
  if v_cust is null then
    insert into public.customers (company_id, first_name, last_name, phones, email, id_number, acc_num)
    values (new.company_id, nullif(btrim(new.first_name), ''), nullif(btrim(new.last_name), ''),
            case when coalesce(btrim(new.phone), '') <> '' then array[btrim(new.phone)] else '{}'::text[] end,
            nullif(lower(btrim(new.email)), ''), nullif(btrim(new.id_number), ''), nullif(btrim(new.acc_num), ''))
    returning id into v_cust;
    v_new_customer := true;
  end if;
  new.customer_id := v_cust;

  -- (b) the site's marketing checkbox / a newsletter signup (2026-10-21, spec section 9) is a CLAIM, not consent:
  -- wa_consent = 'form' (claimed, unconfirmed - marketing needs opted_in / customer; a later round confirms it by a
  -- reply), ONLY on a customer this very form created, with the lead's id as the evidence. A form is unauthenticated
  -- and keyed by a phone anyone can type, so a known customer is never touched (security review 21.10).
  if v_new_customer and (new.kind = 'newsletter' or coalesce(new.payload->>'acceptance', '') in ('on', 'true', '1')) then
    update public.customers c
       set wa_consent = 'form', wa_consent_source = 'site_form:' || new.id::text, wa_consent_at = now()
     where c.id = v_cust and c.wa_consent = 'none';
  end if;

  -- a known customer goes back to whoever handled them last (a card staff type keeps the rep they chose, "Unassigned" too)
  if new.assigned_to is null and new.kind <> 'manual' then
    select l.assigned_to into v_rep
      from public.leads l
     where l.customer_id = v_cust and l.assigned_to is not null and l.is_deleted is null
     order by l.created_at desc
     limit 1;
    new.assigned_to := v_rep;
  end if;

  -- a SITE FORM (a booking routes itself; staff choose by hand). Open card = not closed, not waiting to be
  -- filed, not a paid trip that already left. Twin: routeInquiry / isOpenCard in lib/tours/cases.ts.
  if new.kind not in ('booking', 'advisor', 'manual', 'newsletter') and not coalesce(new.to_file, false) then
    v_joined := false;
    if new.kind = 'whatsapp' then
      -- (a) a WhatsApp message (2026-10-21): the continuation of a conversation, not a form about a tour - it joins
      -- the customer's NEWEST open card whatever its tour, and is never filed
      select l.id, l.case_no into v_target
        from public.leads l
        left join tours.departures d on d.id = l.departure_id
       where l.company_id = new.company_id and l.customer_id = v_cust and l.is_deleted is null
         and not l.to_file
         and not public.lead_status_closed(new.company_id, l.status)
         and not (l.status in ('paid', 'deposit_paid') and coalesce(d.start_date < v_today, false))
       order by coalesce(l.updated_at, l.created_at) desc
       limit 1;
      v_joined := found;
    elsif new.package_id is not null then
      -- (28.10) a WAITING LIST joins only a card of its tour still at New; any other form passes over a waiting-list
      -- card (opened by a waitlist / notify form, still at New) while the tour has another open card - the deal wins
      -- (29.10) a waiting-list card IS its status 'waitlist': a waiting list joins only that card, never a deal (not one
      -- at New either), and every other form passes over it while the tour has another open card
      select l.id, l.case_no into v_target
        from public.leads l
        left join tours.departures d on d.id = l.departure_id
       where l.company_id = new.company_id and l.customer_id = v_cust and l.is_deleted is null
         and not l.to_file and l.package_id = new.package_id
         and not public.lead_status_closed(new.company_id, l.status)
         and not (l.status in ('paid', 'deposit_paid') and coalesce(d.start_date < v_today, false))
         and (new.kind not in ('waitlist', 'notify') or l.status = 'waitlist') -- (29.10)
       order by (new.kind not in ('waitlist', 'notify') and l.status = 'waitlist') asc, -- (29.10)
                l.created_at desc
       limit 1;
      v_joined := found;
      if not v_joined and new.kind in ('waitlist', 'notify') and new.related_lead_id is null then
        -- its own card, beside the deal it did not join: the board prints "↔ #<case>" on it
        select l.id into new.related_lead_id
          from public.leads l
          left join tours.departures d on d.id = l.departure_id
         where l.company_id = new.company_id and l.customer_id = v_cust and l.is_deleted is null
           and not l.to_file and l.package_id = new.package_id
           and not public.lead_status_closed(new.company_id, l.status)
           and not (l.status in ('paid', 'deposit_paid') and coalesce(d.start_date < v_today, false))
         order by l.created_at desc
         limit 1;
      end if;
    end if;
    if v_joined then
      -- the same tour again (or the customer's conversation): it joins that card, which says the customer came back
      new.is_deleted := v_today;
      new.payload := new.payload || jsonb_build_object('joined_into', jsonb_build_object('id', v_target.id, 'case_no', v_target.case_no));
      update public.leads l
         set status = case when l.status in ('no_answer', 'offer_sent', 'future', 'waitlist') -- (29.10) + waitlist
                            and new.kind not in ('waitlist', 'notify') -- (29.10) another waiting list is no return
                            and exists (select 1 from public.lead_statuses s where s.company_id = l.company_id and s.key = 'returned')
                           then 'returned' else l.status end,
             -- (29.10) a second waiting-list form keeps the card off TODAY: no follow-up day of its own
             follow_up_date = case when new.kind in ('waitlist', 'notify') then l.follow_up_date else v_today end,
             payload = l.payload || jsonb_build_object('inquiries',
               coalesce(case when jsonb_typeof(l.payload->'inquiries') = 'array' then l.payload->'inquiries' end, '[]'::jsonb)
               || jsonb_build_array(jsonb_build_object(
                    'id', new.id, 'case_no', new.case_no, 'at', now(), 'kind', new.kind,
                    'message', left(new.message, 500), 'source_path', left(new.source_path, 300), 'utm', new.utm,
                    -- what the form was SENT AS: it joined by the phone alone, which anyone can type. The card's
                    -- name / contact are never written from it; the card page warns when these are not the
                    -- card's person (senderDiffers in lib/tours/cases.ts).
                    'name', left(nullif(btrim(new.name), ''), 120), 'phone', left(nullif(btrim(new.phone), ''), 40),
                    'email', left(nullif(lower(btrim(new.email)), ''), 200),
                    -- the form's other fields (a waiting list's date...), unless they are unusually big
                    'fields', case when pg_column_size(new.payload) < 4000 then new.payload - 'joined_into' else '{}'::jsonb end)))
       where l.id = v_target.id;
    elsif new.kind <> 'whatsapp' and new.package_id is null and exists (
      select 1
        from public.leads l
        left join tours.departures d on d.id = l.departure_id
       where l.company_id = new.company_id and l.customer_id = v_cust and l.is_deleted is null
         and not l.to_file
         and not public.lead_status_closed(new.company_id, l.status)
         and not (l.status in ('paid', 'deposit_paid') and coalesce(d.start_date < v_today, false))
    ) then
      -- no tour named and the customer has open cards: the rep decides where it goes
      new.to_file := true;
    end if;
  end if;
  -- (29.10) the card a waiting list opens waits in "Waiting list", not New - off TODAY and LEADS (Alon: "הסטטוס לא צריך
  -- להיות חדש"). A company with no list of its own reads the default list, which has it. TS twin: newCardStatus.
  if not v_joined and new.kind in ('waitlist', 'notify') and coalesce(new.status, 'new') = 'new'
     and (exists (select 1 from public.lead_statuses s where s.company_id = new.company_id and s.key = 'waitlist')
          or not exists (select 1 from public.lead_statuses s where s.company_id = new.company_id)) then
    new.status := 'waitlist';
  end if;
  return new;
end
$$;
revoke all on function public.leads_fill() from public;
revoke execute on function public.leads_fill() from anon, authenticated;

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
       -- another tour is another card (Nir 19.10): a card of the booking's own tour, or one with no tour yet
       and (l.package_id is null or l.package_id = (select d.package_id from tours.departures d where d.id = v_dep_id))
       and ((length(v_phone_key) = 9 and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9) = v_phone_key)
            or (v_email <> '' and lower(l.email) = v_email))
     -- (28.10) a waiting-list card (waitlist / notify form, still at New) only when no other card fits: the deal wins
     -- (29.10) a waiting-list card is the status 'waitlist'
     order by (l.status = 'waitlist') asc, (l.package_id is not null) desc, l.created_at desc
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
           to_file = false,
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

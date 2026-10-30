-- A limit on the waiting-list forms, before any WhatsApp can go out from the list (Dor 30.10: "תבנה את ההגבלה על הטופס
-- לפי ההצעה, עם אפשרות א: כולם חוץ ממי שהוסר, ותקרה יומית להודעות למספרים חדשים"). The form is public and takes any phone,
-- and when a date opens our verified number writes to that phone (cron toursWaitlistDates).
--
-- (1) leads.no_auto_message: past 20 waiting-list / notify-me forms an hour, per company, a new card is kept but marked. It
--     moves when a date opens and the rep calls; no message goes out by itself. A real customer is never lost, and the
--     busiest hour on record is 3 forms of any kind. Counted over every form that arrived, joined ones too. A column, not
--     `payload`: site forms write `payload` freely.
-- (2) A rep who moves a card onto the list has looked at it: that clears the mark. The trigger of 20261030182000 + one line.
-- (3) public.leads_fill, copied verbatim from 20261030182000_tours_waitlist_date_opened.sql; only the lines marked (30.10b)
--     differ. create or replace keeps the trigger and the grants.
-- The other limits live elsewhere: per address on the site (mega-family lib/form-limit.ts), and the day's cap on messages to
-- new numbers in the check itself (FIRST_CONTACT_MAX_PER_DAY in lib/tours/waitlist-dates.ts).

-- ---------------------------------------------------------------- 1. the mark
alter table public.leads add column if not exists no_auto_message boolean;
update public.leads set no_auto_message = false where no_auto_message is null;
alter table public.leads alter column no_auto_message set default false;
alter table public.leads alter column no_auto_message set not null;

-- ---------------------------------------------------------------- 2. a rep's move clears it
create or replace function public.leads_stamp_waitlist_since()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'waitlist' and (tg_op = 'INSERT' or old.status is distinct from 'waitlist') then
    new.waitlist_since := now();
    if tg_op = 'UPDATE' then
      new.no_auto_message := false;
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------- 3. the function
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
      -- (30.10) a waiting list names the date of its form, never the date the page last named
      case when new.kind not in ('waitlist', 'notify')
           then nullif(substring(coalesce(new.source_path, '') from '[?&]product_id=([0-9]{1,12})(?:[&#]|$)'), '')::bigint end,
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
         set status = case when l.status in ('no_answer', 'offer_sent', 'future', 'waitlist', 'date_opened') -- (29.10) + waitlist, (30.10) + date_opened
                            and new.kind not in ('waitlist', 'notify') -- (29.10) another waiting list is no return
                            and exists (select 1 from public.lead_statuses s where s.company_id = l.company_id and s.key = 'returned')
                           then 'returned' else l.status end,
             -- (30.10) a waiting list for another date (or for the whole tour): the card waits for the tour
             departure_id = case when new.kind in ('waitlist', 'notify') and l.departure_id is distinct from new.departure_id
                                 then null else l.departure_id end,
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
  -- (30.10b) a flood of waiting-list forms: the card is kept, a rep sees it, and nothing goes out to that phone by itself
  if not v_joined and new.kind in ('waitlist', 'notify')
     and (select count(*) from public.leads l
           where l.company_id = new.company_id and l.kind in ('waitlist', 'notify')
             and l.created_at > now() - interval '1 hour') >= 20 then
    new.no_auto_message := true;
  end if;
  return new;
end
$$;
revoke all on function public.leads_fill() from public;
revoke execute on function public.leads_fill() from anon, authenticated;

-- A date opens on a tour a card waits for (Alon 30.10, card "tours-waitlist" of the 29.10 brief,
-- https://claude.ai/artifact/W9jQQtADcSgRMPVvFJ5xRw: "שיפתח תאריך אני רוצה אוטמציה ששולחת ואטסאפ עדכון ללקוח ... וזה מעביר
-- אותו לטודיי טסקט למחרת שנציג יחייג"; Dor 30.10 took every recommended answer). The rules are pure in
-- lib/tours/waitlist-dates.ts, the hourly check is the cron toursWaitlistDates.
--
-- (1) A system status "נפתח תאריך" (key 'date_opened', open) for every tours company, right after "רשימת המתנה" in the
--     company's own order. True whether or not the WhatsApp went out.
-- (2) leads.waitlist_since = when the card started waiting, stamped by a trigger on every way in (a form, a rep, a bulk
--     change, a merge); a date counts only if first seen open AFTER it, so moving a card to the list sends nothing.
--     leads.date_opened = what happened when its date opened (a column: site forms write `payload` freely).
-- (3) tours.departure_open_watch = when each date was first seen open (its own table, not a column on departures: a
--     copied date must not inherit the stamp, and the check must not touch departures.updated_at). A date that stops
--     being open loses its row, so reopening starts the clock anew.
-- (4) Everything open now is stamped now, in the same instant as the cards already waiting, so nothing already open
--     counts as "opened" on the first tick.
-- (5) public.leads_fill, copied verbatim from 20261029102719_tours_waitlist_status.sql; only the lines marked (30.10)
--     differ. TS twin: statusOnReturn. create or replace keeps the trigger and the grants.
--     (a) a form that lands on a 'date_opened' card turns it "returned", as on any card waiting for an answer;
--     (b) a waiting list names the date of its FORM (payload.date), never the page's product_id: the site's list button
--         does not select the date, so the address still names the last date tapped, and an old link names a past one.
--         Harmless until a message depended on it;
--     (c) a second waiting-list form for another date widens the card to the tour: the customer waits for either.
-- (6) Cards already waiting take the date of their form, by the same rule.

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
    continue when exists (select 1 from public.lead_statuses s where s.company_id = c.id and s.key = 'date_opened');
    select s.position into v_after from public.lead_statuses s where s.company_id = c.id and s.key = 'waitlist';
    if v_after is null then
      select coalesce(max(s.position), -1) into v_after from public.lead_statuses s where s.company_id = c.id and s.is_active;
    end if;
    update public.lead_statuses s set position = s.position + 1 where s.company_id = c.id and s.position > v_after;
    -- a status of the company's own may already carry the name: two statuses with one name cannot be saved again
    v_label := case when exists (select 1 from public.lead_statuses s where s.company_id = c.id and s.label = 'נפתח תאריך')
                    then 'נפתח תאריך (מערכת)' else 'נפתח תאריך' end;
    insert into public.lead_statuses (company_id, key, label, color, position, is_closed, is_system, is_active)
    values (c.id, 'date_opened', v_label, 'rose', v_after + 1, false, true, true);
  end loop;
end
$$;

-- ---------------------------------------------------------------- 2. the card's two columns
alter table public.leads
  add column if not exists waitlist_since timestamptz,
  add column if not exists date_opened jsonb;

-- fires after leads_fill (BEFORE triggers run by name), so a form's own status is already set
create or replace function public.leads_stamp_waitlist_since()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'waitlist' and (tg_op = 'INSERT' or old.status is distinct from 'waitlist') then
    new.waitlist_since := now();
  end if;
  return new;
end
$$;
revoke all on function public.leads_stamp_waitlist_since() from public;
revoke execute on function public.leads_stamp_waitlist_since() from anon, authenticated;
drop trigger if exists leads_waitlist_since on public.leads;
create trigger leads_waitlist_since before insert or update of status on public.leads
  for each row execute function public.leads_stamp_waitlist_since();

-- ---------------------------------------------------------------- 3. the watch
create table if not exists tours.departure_open_watch (
  departure_id uuid primary key references tours.departures(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  open_seen_at timestamptz not null default now()
);
create index if not exists departure_open_watch_company_idx on tours.departure_open_watch (company_id);
alter table tours.departure_open_watch enable row level security;
grant all on table tours.departure_open_watch to service_role;
revoke all on table tours.departure_open_watch from anon, authenticated;

-- ---------------------------------------------------------------- 4. what is open now, and who waits now
-- the dates first: run statement by statement, a card's later now() is still not "before" a date already open
insert into tours.departure_open_watch (departure_id, company_id, open_seen_at)
select d.id, d.company_id, now()
  from tours.departures d
 where d.is_published and d.is_deleted is null and d.start_date >= current_date and d.sale_status not in ('sold_out', 'closed')
on conflict (departure_id) do nothing;
update public.leads set waitlist_since = now() where status = 'waitlist' and waitlist_since is null;

-- ---------------------------------------------------------------- 5. the function
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
  return new;
end
$$;
revoke all on function public.leads_fill() from public;
revoke execute on function public.leads_fill() from anon, authenticated;

-- ---------------------------------------------------------------- 6. the cards already waiting
with wanted as (
  select l.id,
         (select d.id
            from tours.departures d
           where d.company_id = l.company_id and d.is_deleted is null
             and (d.legacy_product_id = p.pid or d.site_id = p.pid)
           order by (d.legacy_product_id is not distinct from p.pid) desc
           limit 1) as departure_id
    from public.leads l
   cross join lateral (
     select case when jsonb_typeof(l.payload->'date') = 'object' and coalesce(l.payload#>>'{date,productId}', '') ~ '^[0-9]{1,12}$'
                 then (l.payload#>>'{date,productId}')::bigint end as pid
   ) p
   where l.status = 'waitlist' and l.kind in ('waitlist', 'notify') and l.is_deleted is null
)
update public.leads l
   set departure_id = w.departure_id
  from wanted w
 where l.id = w.id and l.departure_id is distinct from w.departure_id;

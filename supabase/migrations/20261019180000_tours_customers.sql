-- Tours: one customer, deal cards under it (Nir Azulay, 19.10.2026).
-- Spec: docs/superpowers/specs/2026-10-19-tours-customer-cards-design.md
-- Mockup Dor approved: https://claude.ai/artifact/6CXvKBuoCd3np4RiD9GPG1
--
-- 1. public.customers - one per phone (last 9 digits), numbered C-1001...; every case (public.leads) is a CARD
--    of a customer (leads.customer_id). Backfilled from the cases there are.
-- 2. public.leads_fill (BEFORE INSERT) finds or makes the customer, gives a known customer's new card to their
--    rep, and routes a SITE FORM: a tour the customer has an open card for -> it joins that card (the card says
--    "came back"); no tour while the customer has open cards -> an inquiry to file (leads.to_file).
-- 3. Statuses = Nir's list. New: חזר (returned), ליד עתידי (future), שולם מקדמה (deposit_paid). Switched off
--    (nothing deleted): in_progress, follow_up, done, payment_failed, payment_review - their cases move.
-- 4. A site payment no longer sets the card paid: the gateway's answer leaves it "pending payment" for the rep
--    to confirm. A payment staff checked (booking review -> paid) still does.
-- 5. A T number for every order: a staff-typed seat row of a case gets one (departure_sales_entries.ref).
-- 6. leads.season - a future lead's season ("פסח 2027").
-- 7. tours.booking_create: a booking without the link hangs only on an open lead of its own tour (or one with no
--    tour yet) - another tour is another card.
-- The TS twins (routeInquiry, isOpenCard, the status list) live in lib/tours/cases.ts - change both together.

-- ---------------------------------------------------------------- helpers
-- The key a customer is found by: the last 9 digits ('' when there are fewer). Twin: phoneKey().
create or replace function public.phone_key(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 9
              then right(regexp_replace(p, '\D', '', 'g'), 9) else '' end
$$;

-- ---------------------------------------------------------------- 1. customers
create sequence if not exists public.customers_no_seq start with 1001;
grant usage, select on sequence public.customers_no_seq to service_role;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_no bigint not null default nextval('public.customers_no_seq'),
  first_name text,
  last_name text,
  -- as typed; the first one is the main phone
  phones text[] not null default '{}',
  -- the last 9 digits of each phone, kept by customers_keys
  phone_keys text[] not null default '{}',
  email text,
  id_number text,
  acc_num text,
  -- customers staff said are other people ("not the same" on a same-e-mail suggestion)
  not_same uuid[] not null default '{}',
  merged_into uuid references public.customers(id) on delete set null,
  is_deleted date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customers_no_uidx on public.customers (customer_no);
create index if not exists customers_company_idx on public.customers (company_id) where is_deleted is null;
create index if not exists customers_phone_keys_idx on public.customers using gin (phone_keys);
create index if not exists customers_email_idx on public.customers (company_id, lower(email)) where email is not null;
alter table public.customers enable row level security;
revoke all on table public.customers from anon, authenticated;
grant all on table public.customers to service_role;

create or replace function public.customers_keys()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.phones := coalesce(array(select left(btrim(x), 40) from unnest(new.phones) x where btrim(coalesce(x, '')) <> ''), '{}');
  new.phone_keys := coalesce(array(select distinct public.phone_key(x) from unnest(new.phones) x where public.phone_key(x) <> ''), '{}');
  return new;
end
$$;
drop trigger if exists customers_keys on public.customers;
create trigger customers_keys before insert or update of phones on public.customers
  for each row execute function public.customers_keys();
drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------- leads: the card's columns
alter table public.leads
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists to_file boolean not null default false,
  add column if not exists season text;
create index if not exists leads_customer_idx on public.leads (customer_id) where is_deleted is null;

-- ---------------------------------------------------------------- backfill: a customer per phone
-- In creation order, so the customer numbers follow the first contact. A case merged into another, or naming
-- the customer's earlier case, belongs to that case's customer; else the phone; else a customer of its own.
do $$
declare
  r record;
  v_key text;
  v_cust uuid;
begin
  for r in select * from public.leads where customer_id is null order by created_at, id loop
    v_cust := null;
    v_key := public.phone_key(r.phone);
    if jsonb_typeof(r.payload->'merged_into') = 'object' and coalesce(r.payload#>>'{merged_into,id}', '') ~ '^[0-9a-f-]{36}$' then
      select l.customer_id into v_cust from public.leads l where l.id = (r.payload#>>'{merged_into,id}')::uuid;
    end if;
    if v_cust is null and r.related_lead_id is not null then
      select l.customer_id into v_cust from public.leads l where l.id = r.related_lead_id;
    end if;
    if v_cust is null and v_key <> '' then
      select c.id into v_cust from public.customers c
       where c.company_id = r.company_id and c.is_deleted is null and c.phone_keys @> array[v_key]
       order by c.customer_no limit 1;
    end if;
    if v_cust is null then
      insert into public.customers (company_id, first_name, last_name, phones, email, id_number, acc_num, created_at)
      values (r.company_id,
              nullif(btrim(coalesce(r.first_name, split_part(btrim(coalesce(r.name, '')), ' ', 1))), ''),
              nullif(btrim(r.last_name), ''),
              case when coalesce(btrim(r.phone), '') <> '' then array[btrim(r.phone)] else '{}'::text[] end,
              nullif(lower(btrim(r.email)), ''), nullif(btrim(r.id_number), ''), nullif(btrim(r.acc_num), ''), r.created_at)
      returning id into v_cust;
    elsif v_key <> '' then
      -- joined by a merge or a related case with another phone: the customer has that phone too
      update public.customers c set phones = c.phones || btrim(r.phone)
       where c.id = v_cust and not (c.phone_keys @> array[v_key]);
    end if;
    update public.leads set customer_id = v_cust where id = r.id;
  end loop;
end
$$;

-- ---------------------------------------------------------------- 3. statuses: Nir's list
do $$
declare
  c record;
begin
  for c in select id from public.companies where 'tours' = any(product_types) loop
    insert into public.lead_statuses (company_id, key, label, color, position, is_closed, is_system)
    values (c.id, 'returned', 'חזר', 'violet', 2, false, true),
           (c.id, 'future', 'ליד עתידי', 'cyan', 4, false, true),
           (c.id, 'deposit_paid', 'שולם מקדמה', 'teal', 6, false, true)
    on conflict (company_id, key) do nothing;
    -- the order Nir reads them in; the retired ones switched off at the end (a case may still carry one)
    update public.lead_statuses s
       set position = o.pos, is_active = o.active, is_system = o.sys
      from (values ('new', 0, true, true), ('no_answer', 1, true, true), ('returned', 2, true, true),
                   ('offer_sent', 3, true, true), ('future', 4, true, true), ('pending_payment', 5, true, true),
                   ('deposit_paid', 6, true, true), ('paid', 7, true, true), ('not_relevant', 8, true, true),
                   ('cancelled', 9, true, true), ('spam', 10, true, true),
                   ('in_progress', 50, false, false), ('follow_up', 51, false, false), ('done', 52, false, false),
                   ('payment_failed', 53, false, false), ('payment_review', 54, false, false)) as o(key, pos, active, sys)
     where s.company_id = c.id and s.key = o.key;
    -- a company's own statuses keep their order, after the system ones
    update public.lead_statuses set position = 20 + position where company_id = c.id and key like 'custom\_%' and position < 20;
    -- paid reads green, a deposit teal
    update public.lead_statuses set color = 'green' where company_id = c.id and key = 'paid' and color = 'teal';
  end loop;
end
$$;

-- the cases in a retired status move to the status that means the same now
update public.leads l
   set status = case
         when l.status = 'done' then 'paid'
         when l.status in ('payment_failed', 'payment_review') then 'pending_payment'
         when jsonb_typeof(l.offer) = 'object' then 'offer_sent'
         else 'no_answer' end
 where l.status in ('done', 'payment_failed', 'payment_review', 'in_progress', 'follow_up');

-- ---------------------------------------------------------------- 2. every insert: customer, rep, routing
-- Same as 20261015172708 (type, names, UTM, departure, tour) plus the customer, the rep and the routing of a
-- site form. The system keys of `payload` (joined_into, inquiries too now) are dropped from every new row.
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
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  new.payload := coalesce(new.payload, '{}'::jsonb) - 'matched_by' - 'related_case' - 'merged' - 'merged_into' - 'joined_into' - 'inquiries';
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

  -- the customer: the one the backoffice named (of this company), else the phone's, else a new one. A form
  -- never writes over a known customer - a visitor typed it.
  if new.customer_id is not null then
    select c.id into v_cust from public.customers c where c.id = new.customer_id and c.company_id = new.company_id;
  end if;
  v_key := public.phone_key(new.phone);
  if v_cust is null and v_key <> '' then
    select c.id into v_cust from public.customers c
     where c.company_id = new.company_id and c.is_deleted is null and c.phone_keys @> array[v_key]
     order by c.customer_no limit 1;
  end if;
  if v_cust is null then
    insert into public.customers (company_id, first_name, last_name, phones, email, id_number, acc_num)
    values (new.company_id, nullif(btrim(new.first_name), ''), nullif(btrim(new.last_name), ''),
            case when coalesce(btrim(new.phone), '') <> '' then array[btrim(new.phone)] else '{}'::text[] end,
            nullif(lower(btrim(new.email)), ''), nullif(btrim(new.id_number), ''), nullif(btrim(new.acc_num), ''))
    returning id into v_cust;
  end if;
  new.customer_id := v_cust;

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
    if new.package_id is not null then
      select l.id, l.case_no into v_target
        from public.leads l
        left join tours.departures d on d.id = l.departure_id
       where l.company_id = new.company_id and l.customer_id = v_cust and l.is_deleted is null
         and not l.to_file and l.package_id = new.package_id
         and not public.lead_status_closed(new.company_id, l.status)
         and not (l.status in ('paid', 'deposit_paid') and coalesce(d.start_date < v_today, false))
       order by l.created_at desc
       limit 1;
      if found then
        -- the same tour again: it joins that card, which says the customer came back
        new.is_deleted := v_today;
        new.payload := new.payload || jsonb_build_object('joined_into', jsonb_build_object('id', v_target.id, 'case_no', v_target.case_no));
        update public.leads l
           set status = case when l.status in ('no_answer', 'offer_sent', 'future')
                              and exists (select 1 from public.lead_statuses s where s.company_id = l.company_id and s.key = 'returned')
                             then 'returned' else l.status end,
               follow_up_date = v_today,
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
      end if;
    elsif exists (
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
  return new;
end
$$;
revoke all on function public.leads_fill() from public;
revoke execute on function public.leads_fill() from anon, authenticated;

-- ---------------------------------------------------------------- 4. payment state -> card
-- The gateway's answer (paid, failed, a check) leaves the card "pending payment": the rep looks at the booking
-- and confirms (Nir 19.10 - "it comes in pending, the rep changes it once paid or dropped"). A payment staff
-- checked on the booking (review -> paid) is the confirmation itself. A paid card is never moved back.
create or replace function tours.bookings_status_to_case()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if new.lead_id is null or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'paid' and old.status = 'review' then
    v_status := 'paid';
  elsif new.status in ('pending_payment', 'failed', 'review', 'paid') then
    v_status := 'pending_payment';
  end if;
  if v_status is not null then
    -- money arrived or needs a check on a card staff deleted: it comes back, or nobody would see it
    update public.leads
       set status = case when v_status = 'pending_payment' and status in ('paid', 'deposit_paid') then status else v_status end,
           is_deleted = case when new.status in ('paid', 'review') then null else is_deleted end
     where id = new.lead_id and company_id = new.company_id;
  end if;
  return new;
end
$$;
revoke all on function tours.bookings_status_to_case() from public;
revoke execute on function tours.bookings_status_to_case() from anon, authenticated;

-- ---------------------------------------------------------------- 5. a T number for a staff order
alter table tours.departure_sales_entries add column if not exists ref text;
create unique index if not exists departure_sales_entries_ref_uidx on tours.departure_sales_entries (ref) where ref is not null;

-- A seat row a rep typed for a case (travelers added, a phone or office order) is an order: it takes the next
-- T number. An online booking's own row (paid by card / closed by hand - its note says so) does not: the
-- booking already has one. A cancellation (negative pax) does not either.
create or replace function tours.sales_entry_ref()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.ref is null and new.lead_id is not null and new.pax > 0 and coalesce(new.note, '') not like 'Online booking %' then
    new.ref := 'T' || nextval('tours.booking_ref_seq');
  end if;
  return new;
end
$$;
revoke all on function tours.sales_entry_ref() from public;
revoke execute on function tours.sales_entry_ref() from anon, authenticated;
drop trigger if exists sales_entry_ref on tours.departure_sales_entries;
create trigger sales_entry_ref before insert on tours.departure_sales_entries
  for each row execute function tours.sales_entry_ref();

-- the staff orders there are already
do $$
declare
  r record;
begin
  for r in
    select e.id
      from tours.departure_sales_entries e
     where e.ref is null and e.lead_id is not null and e.pax > 0 and e.is_deleted is null
       and coalesce(e.note, '') not like 'Online booking %'
       and not exists (select 1 from tours.bookings b where b.sales_entry_id = e.id)
     order by e.created_at, e.id
  loop
    update tours.departure_sales_entries set ref = 'T' || nextval('tours.booking_ref_seq') where id = r.id;
  end loop;
end
$$;

-- ---------------------------------------------------------------- 7. booking_create: a card per tour
-- Same as 20261018110900 except: a booking that comes without the link hangs only on an open lead of ITS tour, or
-- one that names no tour yet (with several cards per customer, a tour-B booking must not turn the tour-A card into
-- an order), preferring the one of its tour; and a card it hangs on is no longer an inquiry waiting to be filed.
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
     order by (l.package_id is not null) desc, l.created_at desc
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

revoke all on function public.phone_key(text) from public;
revoke execute on function public.phone_key(text) from anon, authenticated;
grant execute on function public.phone_key(text) to service_role;
revoke all on function public.customers_keys() from public;
revoke execute on function public.customers_keys() from anon, authenticated;

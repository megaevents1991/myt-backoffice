-- One table for a tours company's leads and reservations: public.leads is the case.
-- Spec: docs/superpowers/specs/2026-10-14-tours-unified-reservations-design.md
-- (Alon's road map, 14.10.2026: Online Bookings and Leads fold into Reservations.)
--
-- ADDITIVE ONLY.
--   * public.leads gains the case columns (case number, TYPE, names, national id,
--     ACC NUM, product, source, task override, booking link token, soft delete).
--   * public.leads_fill (BEFORE INSERT) fills TYPE / names / product / clean UTM on
--     every insert - the site's submit_lead functions are not touched.
--   * public.lead_statuses: each company's own status list (seeded).
--   * tours.booking_create attaches a site booking to the customer's open case
--     (the booking link token, else the same phone / e-mail) instead of always
--     opening a new lead, and stores the visit's UTM.
--   * The case follows its booking's payment state (trigger), and
--     booking_finish_payment no longer forces the case to "done": a paid card
--     booking reads "paid" until staff close it.
-- The TS twins of the rules live in lib/tours/cases.ts - change both together.
-- Mega Events is untouched: public.reservations is not read or changed.

-- ---------------------------------------------------------------- helpers
-- The campaign keys the site sends, strings only, 300 characters each.
create or replace function public.clean_utm(p jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(x.k, left(x.v, 300)), '{}'::jsonb)
    from (
      select e.key as k, btrim(e.value #>> '{}') as v
        from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) e
       where e.key in ('source', 'medium', 'campaign', 'term', 'content', 'gclid', 'fbclid', 'landing', 'referrer', 'at')
         and jsonb_typeof(e.value) = 'string'
         and btrim(e.value #>> '{}') <> ''
    ) x
$$;

-- '%D7%98%D7%99' -> 'טי'; a broken escape keeps the raw text.
create or replace function public.url_decode(p text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v bytea := ''::bytea;
  m text[];
begin
  if p is null then
    return null;
  end if;
  for m in select regexp_matches(p, '%([0-9A-Fa-f]{2})|([^%]+|%)', 'g') loop
    if m[1] is not null then
      v := v || decode(m[1], 'hex');
    else
      v := v || convert_to(m[2], 'UTF8');
    end if;
  end loop;
  return convert_from(v, 'UTF8');
exception when others then
  return p;
end
$$;

-- ---------------------------------------------------------------- statuses
create table if not exists public.lead_statuses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  key text not null,
  label text not null,
  color text not null default 'gray',
  position int not null default 0,
  is_closed boolean not null default false,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, key)
);
alter table public.lead_statuses enable row level security;
revoke all on table public.lead_statuses from anon, authenticated;
grant all on table public.lead_statuses to service_role;

-- The same list as DEFAULT_STATUSES in lib/tours/cases.ts.
insert into public.lead_statuses (company_id, key, label, color, position, is_closed, is_system)
select c.id, s.key, s.label, s.color, s.position, s.is_closed, s.is_system
  from public.companies c
 cross join (values
   ('new',             'חדש',           'blue',    0, false, true),
   ('no_answer',       'אין מענה',      'slate',   1, false, false),
   ('in_progress',     'בטיפול',        'amber',   2, false, false),
   ('follow_up',       'פולו אפ',       'violet',  3, false, false),
   ('pending_payment', 'ממתין לתשלום',  'orange',  4, false, true),
   ('payment_failed',  'תשלום נכשל',    'red',     5, false, true),
   ('payment_review',  'בדיקת תשלום',   'rose',    6, false, true),
   ('paid',            'שולם',          'teal',    7, false, true),
   ('done',            'נסגר',          'green',   8, true,  false),
   ('not_relevant',    'לא רלוונטי',    'gray',    9, true,  false),
   ('cancelled',       'בוטל',          'gray',   10, true,  true),
   ('spam',            'ספאם',          'gray',   11, true,  true)
 ) as s(key, label, color, position, is_closed, is_system)
 where 'tours' = any(c.product_types)
on conflict (company_id, key) do nothing;

-- Closed: the company's own flag, else the default closed keys (twin: isClosedStatus).
create or replace function public.lead_status_closed(p_company uuid, p_key text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.is_closed from public.lead_statuses s where s.company_id = p_company and s.key = p_key),
    p_key in ('done', 'not_relevant', 'cancelled', 'spam'))
$$;

-- ---------------------------------------------------------------- case columns
create sequence if not exists public.leads_case_no_seq start with 1001;
grant usage, select on sequence public.leads_case_no_seq to service_role;

alter table public.leads
  add column if not exists case_no bigint,
  add column if not exists type text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists id_number text,
  add column if not exists acc_num text,
  add column if not exists departure_id uuid references tours.departures(id) on delete set null,
  add column if not exists package_id uuid references tours.packages(id) on delete set null,
  add column if not exists source text,
  add column if not exists task_override text,
  add column if not exists link_token text,
  add column if not exists link_sent_at timestamptz,
  add column if not exists is_deleted date,
  add column if not exists updated_at timestamptz;

-- Backfill (three test rows on 14.10): numbered in creation order, TYPE from the
-- form, names split, the site as source.
with numbered as (
  select l.id,
         coalesce((select max(case_no) from public.leads where case_no is not null), 1000)
           + row_number() over (order by l.created_at, l.id) as n
    from public.leads l
   where l.case_no is null
)
update public.leads l set case_no = numbered.n from numbered where l.id = numbered.id;
select setval('public.leads_case_no_seq', greatest(coalesce((select max(case_no) from public.leads), 1000), 1000));

update public.leads
   set type = case when kind in ('notify', 'waitlist', 'newsletter') then 'potential'
                   when kind in ('booking', 'advisor') then 'reservation'
                   else 'lead' end
 where type is null;
update public.leads
   set first_name = split_part(btrim(name), ' ', 1),
       last_name = nullif(btrim(substr(btrim(name), length(split_part(btrim(name), ' ', 1)) + 1)), '')
 where first_name is null and last_name is null and coalesce(btrim(name), '') <> '';
update public.leads set source = 'site' where source is null;
update public.leads set updated_at = created_at where updated_at is null;
-- the old inbox closed a lead as "done" when its card booking was paid: it reads "paid" now
update public.leads l set status = 'paid'
 where l.status = 'done'
   and exists (select 1 from tours.bookings b where b.lead_id = l.id and b.status = 'paid');

alter table public.leads alter column case_no set default nextval('public.leads_case_no_seq');
alter table public.leads alter column case_no set not null;
alter table public.leads alter column type set not null;
alter table public.leads alter column source set default 'site';
alter table public.leads alter column source set not null;
alter table public.leads alter column updated_at set default now();

create unique index if not exists leads_case_no_uidx on public.leads (case_no);
create unique index if not exists leads_link_token_uidx on public.leads (link_token) where link_token is not null;
create index if not exists leads_company_type_idx on public.leads (company_id, type);
create index if not exists leads_company_assigned_idx on public.leads (company_id, assigned_to);
create index if not exists leads_company_departure_idx on public.leads (company_id, departure_id) where departure_id is not null;
create index if not exists leads_phone_key_idx
  on public.leads (company_id, right(regexp_replace(phone, '\D', '', 'g'), 9)) where phone is not null;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at before update on public.leads
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------- fill on insert
-- Every insert passes here: the site's forms (c_<slug>.submit_lead), booking_create
-- and the backoffice. TYPE from the form, names split, the departure from the
-- page's ?product_id= (same rule as booking_quote), the tour from the departure,
-- the waiting list's slug or the /package/<slug>/ page, the UTM cleaned.
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
    v_pid := nullif(substring(coalesce(new.source_path, '') from '[?&]product_id=([0-9]{1,12})(?:[&#]|$)'), '')::bigint;
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

drop trigger if exists leads_fill on public.leads;
create trigger leads_fill before insert on public.leads
  for each row execute function public.leads_fill();

-- ---------------------------------------------------------------- payment state -> case
-- The booking keeps its own status (the payment truth); its case follows the payment.
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
  v_status := case new.status
    when 'pending_payment' then 'pending_payment'
    when 'failed' then 'payment_failed'
    when 'review' then 'payment_review'
    when 'paid' then 'paid'
  end;
  if v_status is not null then
    update public.leads set status = v_status where id = new.lead_id and company_id = new.company_id;
  end if;
  return new;
end
$$;
revoke all on function tours.bookings_status_to_case() from public;

drop trigger if exists bookings_status_to_case on tours.bookings;
create trigger bookings_status_to_case after update of status on tours.bookings
  for each row execute function tours.bookings_status_to_case();

-- ---------------------------------------------------------------- booking_create
-- Same as 20261003100000 except the case: before opening a lead it looks for the
-- customer's case - the booking link's token (args.lead_ref) first, else the
-- newest open lead / potential of the last 90 days with no booking yet whose phone
-- (last 9 digits) or e-mail is the customer's - and attaches the booking to it,
-- turning it into a reservation. args.utm is kept on the case.
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
  end if;

  if v_case is not null then
    update public.leads l
       set type = 'reservation',
           status = v_status,
           departure_id = v_dep_id,
           package_id = coalesce((select d.package_id from tours.departures d where d.id = v_dep_id), l.package_id),
           first_name = coalesce(nullif(l.first_name, ''), nullif(v_first, '')),
           last_name = coalesce(nullif(l.last_name, ''), nullif(v_last, '')),
           name = coalesce(nullif(l.name, ''), v_name),
           phone = coalesce(nullif(l.phone, ''), v_phone),
           email = coalesce(nullif(l.email, ''), nullif(v_email, '')),
           utm = case when l.utm = '{}'::jsonb then v_utm else l.utm end,
           payload = l.payload || v_payload
     where l.id = v_case;
    v_lead_id := v_case;
  else
    insert into public.leads (company_id, kind, type, status, name, first_name, last_name, phone, email,
                              message, payload, source_path, utm, departure_id)
    values (p_company, case p_kind when 'card' then 'booking' else 'advisor' end, 'reservation', v_status,
            v_name, nullif(v_first, ''), nullif(v_last, ''), v_phone, nullif(v_email, ''),
            left(p_args->>'note', 2000), v_payload, left(p_args->>'source_path', 300), v_utm, v_dep_id)
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

-- ---------------------------------------------------------------- booking_finish_payment
-- Same as 20261003100000 except the last step: the case is no longer forced to
-- "done" - the bookings_status_to_case trigger sets it to "paid", which keeps
-- "send the confirmation" on the rep's list until staff close the case.
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
     set payload = payload || jsonb_build_object('payment', 'card, paid')
   where id = b.lead_id;

  return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'paid');
end
$$;

revoke all on function tours.booking_create(uuid, text, jsonb) from public;
revoke all on function tours.booking_finish_payment(uuid, jsonb) from public;
revoke all on function public.clean_utm(jsonb) from public;
revoke all on function public.url_decode(text) from public;
revoke all on function public.lead_status_closed(uuid, text) from public;
grant execute on function public.clean_utm(jsonb) to service_role;
grant execute on function public.lead_status_closed(uuid, text) to service_role;

-- The site mails the customer of an order by itself (Dor 30.10.2026: "סיכום הזמנה יפה כמו באיבנט").
--
-- Until now a Mega Family customer got no mail from the site: a rep sent the confirmation by hand and switched on
-- "Confirmation sent". That switch stays the rep's - it says the ORDER WAS CONFIRMED. These mails say "it is in":
-- the request reached a rep (the "split the payment" button is such a request), a card payment went through, is
-- being checked or failed, a payment link was paid.
--
-- tours.bookings.customer_mails = which of them went out, { <slot>: <when> }. Mega Events keeps one flag per order
-- (reservations.confirmation_email_sent); here an order can earn several (a failed card page, then a paid one; a
-- deposit link, then a balance link), so the slot is the mail, or `link:<id>` for a payment link.
--
-- The price, the rooms and the travelers of a mail come from here, never from the browser. One action, one claim:
-- `customer_mail` marks the slot in the same statement that checks it is free, so two calls (a customer reloading the
-- CreditGuard return address) never mail twice, and answers what to print. `customer_mail_release` frees the slot
-- when the mail server refused. Both need the site's key, like the payment actions: the answer holds names.
--
-- Anyone can make the site mail an address they typed, and these mails leave from the address Mega Events sends from:
-- a request and the cancellation form are public, and a card checkout that fails needs no money at all. So the caps
-- live here, where every server instance and every sender counts the same rows: per mailbox and per company, per hour
-- of when the mail went out, not of when the order was made (or checkouts stocked up for an hour would all count zero).
-- `request`, `failed` and `review` share one count, taken under a lock so a burst cannot pass it together; the
-- cancellation form has `cancellation_mail_ok`. Over a cap only the mail stays out; the order or the request is
-- already in. Only `paid` and `link_paid` go uncounted: the database saw exactly the amount of that very deal.
--
-- site_booking is copied from 20261028140806; only the three mail actions are new. An older site deploy never calls
-- them and a newer site on an older database gets `error: action` and sends nothing to the customer, so the order of
-- the two deploys does not matter.

alter table tours.bookings add column if not exists customer_mails jsonb not null default '{}'::jsonb;
comment on column tours.bookings.customer_mails is
  'The site''s automatic mails to the customer: { request | paid | review | failed | link:<id> : when }. Not the rep''s "Confirmation sent" (confirmation_sent_at).';

-- One mailbox under its many spellings, for counting only: mailboxKey in mega-family lib/customer-mail.ts, change both together.
create or replace function tours.mailbox_key(p_email text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(regexp_replace(split_part(e, '@', 1), '[+].*$', ''), '[.]', '', 'g')
         || '@' || regexp_replace(split_part(e, '@', 2), '^googlemail[.]com$', 'gmail.com')
    from (select lower(btrim(coalesce(p_email, ''))) as e) x
$$;

create or replace function tours.booking_customer_mail(p_company uuid, p_args jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  b tours.bookings%rowtype;
  l tours.payment_links%rowtype;
  d tours.departures%rowtype;
  p tours.packages%rowtype;
  v_mail text := coalesce(p_args->>'mail', '');
  v_slot text;
  v_claimed uuid;
  v_same bigint;
  v_all bigint;
begin
  if not tours.booking_key_ok(p_company, p_args->>'key') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_mail = 'link_paid' then
    if coalesce(p_args->>'uniqueid', '') !~ '^[A-Za-z0-9-]{8,64}$' then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into l from tours.payment_links
     where company_id = p_company and cg_uniqueids @> array[p_args->>'uniqueid'];
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if l.status <> 'paid' then
      return jsonb_build_object('ok', false, 'error', 'state');
    end if;
    select * into b from tours.bookings where id = l.booking_id and is_deleted is null;
    v_slot := 'link:' || l.id;
  elsif v_mail in ('request', 'paid', 'review', 'failed') then
    if coalesce(p_args->>'ref', '') !~ '^T[0-9]{1,10}$' then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    select * into b from tours.bookings
     where company_id = p_company and ref = p_args->>'ref' and is_deleted is null;
    v_slot := v_mail;
  else
    return jsonb_build_object('ok', false, 'error', 'mail');
  end if;
  if b.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  -- the mail must say what is true of the order right now
  if v_mail <> 'link_paid'
     and not (case v_mail when 'request' then b.kind = 'request' else b.kind = 'card' and b.status = v_mail end) then
    return jsonb_build_object('ok', false, 'error', 'state');
  end if;
  -- one plain address: isMailAddress in mega-family lib/customer-mail.ts, change both together
  if coalesce(b.customer_email, '') !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$' then
    return jsonb_build_object('ok', true, 'skip', 'no_email');
  end if;
  -- the lock ends with this call: the count and the claim below are one step for the whole company
  if v_mail in ('request', 'failed', 'review') then
    perform pg_advisory_xact_lock(hashtextextended('tours.customer_mail:' || p_company::text, 0));
    select count(*) filter (where tours.mailbox_key(o.customer_email) = tours.mailbox_key(b.customer_email)), count(*)
      into v_same, v_all
      from tours.bookings o
     where o.company_id = p_company
       and greatest((o.customer_mails->>'request')::timestamptz,
                    (o.customer_mails->>'failed')::timestamptz,
                    (o.customer_mails->>'review')::timestamptz) > now() - interval '1 hour';
    if v_same >= 5 or v_all >= 60 then
      return jsonb_build_object('ok', true, 'skip', 'limit');
    end if;
  end if;

  update tours.bookings
     set customer_mails = customer_mails || jsonb_build_object(v_slot, now())
   where id = b.id and not (customer_mails ? v_slot)
  returning id into v_claimed;
  if v_claimed is null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select * into d from tours.departures where id = b.departure_id;
  select * into p from tours.packages where id = d.package_id;
  return jsonb_build_object(
    'ok', true, 'slot', v_slot, 'ref', b.ref, 'kind', b.kind, 'price_basis', b.price_basis,
    'to', b.customer_email, 'name', b.customer_name,
    'currency', b.currency, 'total', b.total, 'discount', b.discount,
    'rooms', b.rooms, 'adults', b.adults, 'children', b.children,
    -- names alone: a birth date or a passport never goes in a mail
    'passengers', (select coalesce(jsonb_agg(btrim(concat(e->>'first', ' ', e->>'last'))), '[]'::jsonb)
                     from jsonb_array_elements(b.passengers) e),
    'total_ils', b.total_ils, 'payments', b.payments, 'card_last4', b.cg_card_last4,
    'departure', jsonb_build_object('code', d.code, 'start_date', d.start_date, 'end_date', d.end_date),
    'tour', jsonb_build_object('slug', p.slug, 'name', p.name,
                               'path', p.data->>'path',
                               'image', coalesce(nullif(p.hero_image, ''), nullif(p.card_image, ''),
                                                 nullif(p.data->>'heroImage', ''), nullif(p.data->>'cardImage', ''))),
    'link', case when l.id is not null then jsonb_build_object(
      'kind', l.kind, 'amount', l.amount, 'currency', l.currency, 'amount_ils', l.amount_ils,
      'payments', l.payments, 'card_last4', l.cg_card_last4) end);
end
$$;

create or replace function tours.booking_customer_mail_release(p_company uuid, p_args jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not tours.booking_key_ok(p_company, p_args->>'key') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if coalesce(p_args->>'ref', '') !~ '^T[0-9]{1,10}$'
     or coalesce(p_args->>'slot', '') !~ '^(request|paid|review|failed|link:[0-9a-f-]{36})$' then
    return jsonb_build_object('ok', false, 'error', 'args');
  end if;
  update tours.bookings
     set customer_mails = customer_mails - (p_args->>'slot')
   where company_id = p_company and ref = p_args->>'ref';
  return jsonb_build_object('ok', true);
end
$$;

-- The cancellation form has no order to claim a slot on: its requests are leads, stored before the site asks, so the
-- count includes the one being answered and needs no lock - of a burst, the request stored fourth always counts four.
create or replace function tours.booking_cancellation_mail_ok(p_company uuid, p_args jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_args->>'email', '')));
begin
  if not tours.booking_key_ok(p_company, p_args->>'key') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}$' then
    return jsonb_build_object('ok', true, 'allowed', false);
  end if;
  return jsonb_build_object('ok', true, 'allowed',
    (select count(*) from public.leads l
      where l.company_id = p_company and l.kind = 'cancellation' and tours.mailbox_key(l.email) = tours.mailbox_key(v_email)
        and l.created_at > now() - interval '1 hour') <= 3
    and (select count(*) from public.leads l
          where l.company_id = p_company and l.kind = 'cancellation'
            and l.created_at > now() - interval '1 hour') <= 30);
end
$$;

-- ---------------------------------------------------------------- the one entry point
-- Copied from 20261028140806; only the three mail actions are new.
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
    when 'pay_link' then return tours.link_pay_info(p_company, p_args);
    when 'start_link_payment' then return tours.link_start_payment(p_company, p_args);
    when 'finish_link_payment' then return tours.link_finish_payment(p_company, p_args);
    when 'customer_mail' then return tours.booking_customer_mail(p_company, p_args);
    when 'customer_mail_release' then return tours.booking_customer_mail_release(p_company, p_args);
    when 'cancellation_mail_ok' then return tours.booking_cancellation_mail_ok(p_company, p_args);
    else return jsonb_build_object('ok', false, 'error', 'action');
  end case;
end
$$;
revoke all on function tours.mailbox_key(text) from public;
revoke all on function tours.booking_customer_mail(uuid, jsonb) from public;
revoke all on function tours.booking_customer_mail_release(uuid, jsonb) from public;
revoke all on function tours.booking_cancellation_mail_ok(uuid, jsonb) from public;
revoke all on function tours.site_booking(uuid, text, jsonb) from public;
grant execute on function tours.site_booking(uuid, text, jsonb) to service_role;

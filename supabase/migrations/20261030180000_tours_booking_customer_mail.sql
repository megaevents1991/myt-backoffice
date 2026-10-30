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
-- site_booking is copied from 20261028140806; only the two customer_mail actions are new. An older site deploy never
-- calls them and a newer site on an older database gets `error: action` and sends nothing, so the order of the two
-- deploys does not matter.

alter table tours.bookings add column if not exists customer_mails jsonb not null default '{}'::jsonb;
comment on column tours.bookings.customer_mails is
  'The site''s automatic mails to the customer: { request | paid | review | failed | link:<id> : when }. Not the rep''s "Confirmation sent" (confirmation_sent_at).';

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
  if coalesce(b.customer_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    return jsonb_build_object('ok', true, 'skip', 'no_email');
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

-- ---------------------------------------------------------------- the one entry point
-- Copied from 20261028140806; only the two customer_mail actions are new.
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
    else return jsonb_build_object('ok', false, 'error', 'action');
  end case;
end
$$;
revoke all on function tours.booking_customer_mail(uuid, jsonb) from public;
revoke all on function tours.booking_customer_mail_release(uuid, jsonb) from public;
revoke all on function tours.site_booking(uuid, text, jsonb) from public;
grant execute on function tours.site_booking(uuid, text, jsonb) to service_role;

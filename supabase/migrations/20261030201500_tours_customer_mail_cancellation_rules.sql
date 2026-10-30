-- The customer's mail prints the tour's cancellation fees (Alon's note on the first mail, 30.10.2026).
--
-- tours.cancellation_rules is not in the company's views, so the answer of `customer_mail` carries the rules of the
-- order's tour: the mail lays them out from today on (cancellationPlan in mega-family lib/customer-mail.ts).
--
-- booking_customer_mail is copied verbatim from 20261030180000_tours_booking_customer_mail.sql; only the `(30.10)`
-- field is new. A site deploy that does not read the field ignores it, and a newer site on an older database prints
-- the link to the full terms instead, so the order of the two deploys does not matter.

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
    -- (30.10) the tour's fee rules, for the mail's "דמי ביטול"
    'cancellation_rules', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'component', r.component, 'until_days_before', r.until_days_before,
                                    'fee_kind', r.fee_kind, 'fee_value', r.fee_value) order by r.position), '[]'::jsonb)
                             from tours.cancellation_rules r where r.package_id = p.id),
    'tour', jsonb_build_object('slug', p.slug, 'name', p.name,
                               'path', p.data->>'path',
                               'image', coalesce(nullif(p.hero_image, ''), nullif(p.card_image, ''),
                                                 nullif(p.data->>'heroImage', ''), nullif(p.data->>'cardImage', ''))),
    'link', case when l.id is not null then jsonb_build_object(
      'kind', l.kind, 'amount', l.amount, 'currency', l.currency, 'amount_ils', l.amount_ils,
      'payments', l.payments, 'card_last4', l.cg_card_last4) end);
end
$$;
revoke all on function tours.booking_customer_mail(uuid, jsonb) from public;

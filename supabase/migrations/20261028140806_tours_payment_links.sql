-- Tours: card payment links from the order (spec docs/superpowers/specs/2026-10-28-tours-card-payments-design.md;
-- Alon's note "סליקה אשראי לחבר", 28.10.2026). A rep makes a link for a deposit, the balance or another amount of
-- an order; the customer pays it on the company site through CreditGuard's hosted page (the terminal the site
-- already uses); the payment writes itself into tours.booking_payments.
--
-- 1. tours.payment_links - one row per link. Backoffice-only: RLS on, no policy, the service role alone; the site
--    reaches it only through tours.site_booking (security definer) and only with the site key.
-- 2. Three site actions on the one entry point (tours.site_booking is re-created with them; c_<slug>.site_booking
--    is a thin wrapper around it, so provision_company is untouched):
--    pay_link            - what the payment page shows (no phone, no e-mail).
--    start_link_payment  - fixes the shekel amount (today's company rate, else the site's automatic rate) and
--                          the uniqueid sent to CreditGuard.
--    finish_link_payment - the site's server asked CreditGuard (inquireTransactions) first; a success of
--                          exactly the shekel amount writes the payment row, anything else is kept for a human.
-- kind / status have no CHECK - validated in lib/tours/payment-links.ts.

-- ---------------------------------------------------------------- 1. the links
create table if not exists tours.payment_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  booking_id uuid not null references tours.bookings(id) on delete cascade,
  kind text not null,                          -- deposit / balance / other
  amount numeric(12, 2) not null,              -- in the booking's currency
  currency text not null,
  payments smallint not null default 1,        -- installments, 1..12
  token text not null,                         -- 24 random bytes, base64url - the link's only key
  expires_at timestamptz not null,
  status text not null default 'open',         -- open / started / paid / review / cancelled
  rate numeric,                                -- of the last start: currency -> ILS
  rate_source text,                            -- company / auto
  amount_ils numeric(12, 2),                   -- of the last start: what CreditGuard is asked to charge
  cg_uniqueids text[] not null default '{}',   -- every start's uniqueid (a customer may open the card page twice)
  cg_tx_id text,
  cg_auth_number text,
  cg_card_last4 text,
  cg_result jsonb,
  payment_id uuid references tours.booking_payments(id) on delete set null,
  attempts integer not null default 0,         -- failed / cancelled card pages
  last_error text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  started_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz
);
create unique index if not exists payment_links_token_uniq on tours.payment_links (token);
create index if not exists payment_links_booking_idx on tours.payment_links (booking_id, created_at desc);
create index if not exists payment_links_uniqueids_idx on tours.payment_links using gin (cg_uniqueids);
alter table tours.payment_links enable row level security;
grant all on table tours.payment_links to service_role;
revoke all on table tours.payment_links from anon, authenticated;

-- ---------------------------------------------------------------- 2. the site's side
-- the card a payment belongs to moves to TODAY: its follow-up day becomes today (never a later day over an
-- earlier one). The status is left to the rep - a gateway payment never closes a deal by itself (Nir, 19.10).
create or replace function tours.payment_link_follow_up(p_lead uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.leads
     set follow_up_date = (now() at time zone 'Asia/Jerusalem')::date
   where id = p_lead
     and (follow_up_date is null or follow_up_date > (now() at time zone 'Asia/Jerusalem')::date)
$$;

-- what the payment page shows
create or replace function tours.link_pay_info(p_company uuid, p_args jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  l tours.payment_links%rowtype;
  b tours.bookings%rowtype;
  v_tour text;
  v_start date;
  v_state text;
begin
  if not tours.booking_key_ok(p_company, p_args->>'key') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if coalesce(p_args->>'token', '') !~ '^[A-Za-z0-9_-]{20,64}$' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into l from tours.payment_links where company_id = p_company and token = p_args->>'token';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into b from tours.bookings where id = l.booking_id and is_deleted is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select p.name, d.start_date into v_tour, v_start
    from tours.departures d left join tours.packages p on p.id = d.package_id
   where d.id = b.departure_id;
  v_state := case
    when l.status = 'paid' then 'paid'
    when l.status = 'review' then 'review'
    when l.status = 'cancelled' or b.status in ('cancelled', 'failed') then 'cancelled'
    when l.expires_at <= now() then 'expired'
    else 'open' end;
  return jsonb_build_object('ok', true, 'state', v_state, 'kind', l.kind, 'amount', l.amount, 'currency', l.currency,
                            'payments', l.payments, 'ref', b.ref, 'expires_at', l.expires_at,
                            'first_name', nullif(split_part(btrim(coalesce(b.customer_name, '')), ' ', 1), ''),
                            'tour', v_tour, 'start_date', v_start);
end
$$;

-- start: like tours.booking_start_payment, for the link's own amount
create or replace function tours.link_start_payment(p_company uuid, p_args jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  l tours.payment_links%rowtype;
  b tours.bookings%rowtype;
  v_uid text := p_args->>'uniqueid';
  v_rate numeric;
  v_company_rate numeric;
  v_source text;
  v_ils numeric;
begin
  if not tours.booking_key_ok(p_company, p_args->>'key') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if coalesce(p_args->>'token', '') !~ '^[A-Za-z0-9_-]{20,64}$' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if coalesce(v_uid, '') !~ '^[A-Za-z0-9-]{8,64}$' then
    return jsonb_build_object('ok', false, 'error', 'uniqueid');
  end if;
  select * into l from tours.payment_links where company_id = p_company and token = p_args->>'token' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into b from tours.bookings where id = l.booking_id and is_deleted is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if l.status not in ('open', 'started') or b.status in ('cancelled', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'state', 'status', l.status);
  end if;
  if l.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if coalesce(array_length(l.cg_uniqueids, 1), 0) >= 20 then
    return jsonb_build_object('ok', false, 'error', 'attempts');
  end if;
  select r.rate_to_ils into v_company_rate
    from public.company_exchange_rates r
   where r.company_id = p_company and r.currency = l.currency
     and r.rate_date = (now() at time zone 'Asia/Jerusalem')::date;
  if l.currency = 'ILS' then
    v_rate := 1;
    v_source := 'auto';
  elsif v_company_rate is not null then
    v_rate := v_company_rate;
    v_source := 'company';
  else
    if coalesce(p_args->>'rate', '') !~ '^[0-9]{1,2}([.][0-9]{1,6})?$' then
      return jsonb_build_object('ok', false, 'error', 'rate');
    end if;
    v_rate := (p_args->>'rate')::numeric;
    v_source := 'auto';
  end if;
  if not (case l.currency
            when 'ILS' then v_rate = 1
            when 'USD' then v_rate between 2.5 and 5
            when 'EUR' then v_rate between 2.7 and 5.6
            when 'GBP' then v_rate between 3.2 and 6.6
            else false end) then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;
  v_ils := ceil(l.amount * v_rate);
  if v_ils <= 0 then
    return jsonb_build_object('ok', false, 'error', 'amount');
  end if;

  update tours.payment_links
     set rate = v_rate, rate_source = v_source, amount_ils = v_ils, cg_uniqueids = cg_uniqueids || v_uid,
         status = 'started', started_at = now(), updated_at = now()
   where id = l.id;

  return jsonb_build_object('ok', true, 'ref', b.ref, 'rate', v_rate, 'rate_source', v_source, 'total_ils', v_ils,
                            'agorot', (v_ils * 100)::bigint, 'payments', l.payments);
end
$$;

-- finish: the site's server asked CreditGuard what happened; the browser is never trusted
create or replace function tours.link_finish_payment(p_company uuid, p_args jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  l tours.payment_links%rowtype;
  b tours.bookings%rowtype;
  v_uid text := p_args->>'uniqueid';
  v_ok boolean := (p_args->'ok') = 'true'::jsonb;
  v_amount bigint;
  v_cur text := upper(coalesce(p_args->>'currency', ''));
  v_tx text := nullif(left(coalesce(p_args->>'tx_id', ''), 80), '');
  v_result jsonb := case when jsonb_typeof(p_args->'result') = 'object' and pg_column_size(p_args->'result') < 20000
                         then p_args->'result' end;
  v_pay uuid;
  v_note text;
begin
  if not tours.booking_key_ok(p_company, p_args->>'key') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if coalesce(v_uid, '') !~ '^[A-Za-z0-9-]{8,64}$' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into l from tours.payment_links where company_id = p_company and cg_uniqueids @> array[v_uid] for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into b from tours.bookings where id = l.booking_id;
  v_amount := case when coalesce(p_args->>'amount_agorot', '') ~ '^[0-9]{1,12}$'
                   then (p_args->>'amount_agorot')::bigint end;

  -- already paid: the same answer again is nothing; a SECOND successful charge must reach a human
  if l.status = 'paid' then
    if v_ok and v_tx is not null and v_tx is distinct from l.cg_tx_id then
      update tours.payment_links
         set last_error = concat_ws(chr(10), last_error,
               'A second successful charge (transaction ' || v_tx || ') arrived after this link was paid. Check CreditGuard and refund one.'),
             updated_at = now()
       where id = l.id;
      perform tours.payment_link_follow_up(b.lead_id);
      return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'review');
    end if;
    return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'paid', 'already', true);
  end if;

  if not v_ok then
    update tours.payment_links
       set status = case when status = 'started' then 'open' else status end,
           attempts = attempts + 1,
           last_error = left(coalesce(nullif(p_args->>'reason', ''), 'failed'), 200),
           cg_result = coalesce(v_result, cg_result),
           updated_at = now()
     where id = l.id;
    return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'failed');
  end if;

  update tours.payment_links
     set cg_tx_id = coalesce(v_tx, cg_tx_id),
         cg_auth_number = coalesce(left(p_args->>'auth_number', 40), cg_auth_number),
         cg_card_last4 = coalesce(case when p_args->>'card_last4' ~ '^[0-9]{4}$' then p_args->>'card_last4' end, cg_card_last4),
         cg_result = coalesce(v_result, cg_result),
         updated_at = now()
   where id = l.id;

  v_note := case
    when l.status = 'review' then 'Another successful charge arrived on a link already waiting for a check.'
    when l.status = 'cancelled' then 'CreditGuard reported a successful charge on a link that was cancelled. Check it in CreditGuard and record it by hand, or refund it.'
    when v_tx is null then 'CreditGuard reported a successful charge without a transaction id. Check it in CreditGuard before recording it.'
    when v_amount is distinct from (l.amount_ils * 100)::bigint or v_cur not in ('', 'ILS', '1', '376') then
      'CreditGuard reported a successful charge, but its amount or currency is not what this link asked. Check it in CreditGuard and record it by hand.'
    when exists (select 1 from tours.bookings o where o.cg_tx_id = v_tx)
      or exists (select 1 from tours.booking_payments o where o.cg_tx_id = v_tx and o.is_deleted is null)
      or exists (select 1 from tours.payment_links o where o.id <> l.id and o.cg_tx_id = v_tx) then
      'CreditGuard reported a successful charge whose transaction already paid something else. Check it in CreditGuard.'
    end;
  if v_note is not null then
    update tours.payment_links
       set status = 'review', last_error = concat_ws(chr(10), last_error, v_note), updated_at = now()
     where id = l.id;
    perform tours.payment_link_follow_up(b.lead_id);
    return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'review');
  end if;

  insert into tours.booking_payments (company_id, booking_id, kind, status, amount, currency, amount_ils, paid_at, method,
                                      payer_name, cg_tx_id, note)
  values (l.company_id, l.booking_id, l.kind, 'paid', l.amount, l.currency, l.amount_ils, now(), 'site',
          b.customer_name, v_tx,
          'Payment link' || case when l.payments > 1 then ' (' || l.payments || ' payments)' else '' end)
  on conflict (booking_id, cg_tx_id) where cg_tx_id is not null and is_deleted is null do nothing
  returning id into v_pay;

  update tours.payment_links
     set status = 'paid', paid_at = now(), payment_id = v_pay, updated_at = now()
   where id = l.id;
  perform tours.payment_link_follow_up(b.lead_id);

  return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'paid');
end
$$;

-- ---------------------------------------------------------------- the one entry point
-- Copied from 20261003100000; only the three link actions are new.
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
    else return jsonb_build_object('ok', false, 'error', 'action');
  end case;
end
$$;

revoke all on function tours.payment_link_follow_up(uuid) from public;
revoke all on function tours.link_pay_info(uuid, jsonb) from public;
revoke all on function tours.link_start_payment(uuid, jsonb) from public;
revoke all on function tours.link_finish_payment(uuid, jsonb) from public;
revoke all on function tours.site_booking(uuid, text, jsonb) from public;
grant execute on function tours.site_booking(uuid, text, jsonb) to service_role;

-- A card checkout whose charge CreditGuard did not tie to the booking's payment page waits for a check (28.10.2026).
--
-- The site's return route (mega-family app/api/booking/return/[uid]/[result]) asks CreditGuard what happened and
-- passed a success as `ok: true` even when the inquire answer named NO uniqueid, i.e. no page the charge came from.
-- The terminal is shared with Mega Events, so such a charge is never marked paid by itself: the site now sends
-- `unverified: true` for it and the booking goes to "review" with a note, like a wrong amount does. The same rule
-- as tours.link_finish_payment (20261028140806).
--
-- booking_finish_payment is copied verbatim from 20261014220000_tours_unified_cases.sql; only the `(28.10)` block
-- is new. A call without `unverified` (an older site deploy) behaves exactly as before, so the order of the two
-- deploys does not matter.

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

  -- (28.10) the terminal is shared with Mega Events: a charge CreditGuard did not tie to this booking's page is
  -- never marked paid by itself
  if (p_args->'unverified') = 'true'::jsonb then
    update tours.bookings
       set status = 'review',
           staff_note = concat_ws(chr(10), staff_note,
             'CreditGuard did not say which payment page this charge came from. Check it in CreditGuard before confirming.')
     where id = b.id;
    return jsonb_build_object('ok', true, 'ref', b.ref, 'status', 'review');
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

revoke all on function tours.booking_finish_payment(uuid, jsonb) from public;

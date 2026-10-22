-- Tours board, Alon's round 3 (22.10.2026): a PAID card has nothing left to follow up, a DEPOSIT must name the day
-- its balance is chased, ACC NUM belongs to the card (spec docs/superpowers/specs/2026-10-22-tours-board-round-3-design.md).
-- The code applies the rules (lib/tours/cases.ts followUpAfterStatus); this migration (1) clears the stale days
-- Alon saw on cards already paid, (2) makes the booking trigger clear the day when IT moves a card to paid, and
-- (3) copies a customer-header ACC NUM onto the cards that never got it. Idempotent; nothing here is read by code.

-- 1. one-time: a follow-up day already past on a card that is paid is the stale noise on TODAY (Israel calendar).
--    A day still ahead on a paid card stays - it may be the rep's own plan.
update public.leads
   set follow_up_date = null
 where status = 'paid'
   and follow_up_date is not null
   and is_deleted is null
   and follow_up_date < (now() at time zone 'Asia/Jerusalem')::date;

-- 2. payment state -> card (20261019180000, section 4), re-created whole: a booking staff moved review -> paid sets
--    the card paid and now drops its follow-up day too - only when the card was not paid already (a second booking
--    confirmed on a paid card must not wipe the day the rep set for themself). The trigger binding is untouched.
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
           is_deleted = case when new.status in ('paid', 'review') then null else is_deleted end,
           -- paid has nothing left to follow up (Alon 22.10); a card already paid keeps the day its rep set
           follow_up_date = case when v_status = 'paid' and status <> 'paid' then null else follow_up_date end
     where id = new.lead_id and company_id = new.company_id;
  end if;
  return new;
end
$$;
revoke all on function tours.bookings_status_to_case() from public;
revoke execute on function tours.bookings_status_to_case() from anon, authenticated;

-- 3. one-time: an ACC NUM typed on the customer header before this round was copied to the cards that existed
--    then; a card born later (a site form, a WhatsApp message) never got it. Copy it where the card has none, so
--    nothing typed goes out of view - a wrong one is cleared on the card. The header field is gone from the screen;
--    customers.acc_num stays a column the backoffice no longer writes.
update public.leads l
   set acc_num = c.acc_num
  from public.customers c
 where c.id = l.customer_id
   and c.company_id = l.company_id
   and l.acc_num is null
   and nullif(btrim(c.acc_num), '') is not null
   and l.is_deleted is null;

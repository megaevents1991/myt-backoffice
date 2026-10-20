-- Tours orders: a payments log, the passengers a gift went to, and cancellation fee rules
-- (Alon's drawing of an opened order, 20.10.2026; Dor chose all three).
--
-- 1. tours.booking_payments - one row per payment of an order: a deposit, the balance, a refund; paid or scheduled.
--    A rep types them; a site card payment adds itself (trigger below), so the balance of an order is
--    total - paid on every screen. Amounts are in the booking's currency (the trip currency); amount_ils keeps what
--    was charged in shekels when it was.
-- 2. tours.bookings.gift_passengers - the indexes (0-based, in passengers order) of the travelers the departure's
--    gift went to. The rep marks them on the order.
-- 3. tours.cancellation_rules - a tour's fee per part (hotel / flight / land / other) by how many days are left
--    before the departure: a rule holds while at least until_days_before days are left (null = the last window,
--    up to the departure). The order adds the parts up as of today (lib/tours/cancellation.ts).
-- All three are backoffice-only: RLS on, no policy, the service role alone. kind / status / component / fee_kind
-- have no CHECK - the values are validated in lib/tours/payments.ts and lib/tours/cancellation.ts.

-- ---------------------------------------------------------------- 1. payments
create table if not exists tours.booking_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  booking_id uuid not null references tours.bookings(id) on delete cascade,
  kind text not null default 'deposit',          -- deposit / balance / full / refund / other
  status text not null default 'paid',           -- paid / scheduled / failed
  amount numeric(12, 2) not null,                -- in the booking's currency; a refund is positive, its kind says it goes back
  currency text not null,
  amount_ils numeric(12, 2),                     -- what was charged in shekels, when known
  paid_at timestamptz,                           -- paid: when
  due_date date,                                 -- scheduled: when it is due
  method text,                                   -- site / card / transfer / cash / check / other
  payer_name text,
  invoice_no text,
  cg_tx_id text,                                 -- a site card payment's CreditGuard transaction
  note text,
  entered_by uuid,                               -- the staff user; null = the site
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted date
);
create index if not exists booking_payments_booking_idx on tours.booking_payments (booking_id) where is_deleted is null;
create index if not exists booking_payments_company_idx on tours.booking_payments (company_id, created_at desc);
-- one row per CreditGuard transaction: the trigger may fire again on the same booking
create unique index if not exists booking_payments_cg_tx_uniq on tours.booking_payments (booking_id, cg_tx_id)
  where cg_tx_id is not null and is_deleted is null;
alter table tours.booking_payments enable row level security;
grant all on table tours.booking_payments to service_role;

-- a site card payment is a payment of the order: written when the booking is paid (the gateway's paid, or staff
-- confirming a "check payment" as Paid - then the amount is the booking's total)
create or replace function tours.booking_payment_from_card()
returns trigger
language plpgsql
security definer
set search_path = tours, public, pg_temp
as $$
begin
  if new.cg_tx_id is not null and new.status in ('paid', 'done')
     and (tg_op = 'INSERT' or old.status not in ('paid', 'done') or old.cg_tx_id is distinct from new.cg_tx_id) then
    insert into tours.booking_payments (company_id, booking_id, kind, status, amount, currency, amount_ils, paid_at, method,
                                        payer_name, invoice_no, cg_tx_id, note)
    values (new.company_id, new.id, 'full', 'paid', new.total, new.currency, new.total_ils, coalesce(new.paid_at, now()), 'site',
            new.customer_name, new.receipt_no, new.cg_tx_id, 'Card payment on the site')
    on conflict (booking_id, cg_tx_id) where cg_tx_id is not null and is_deleted is null do nothing;
  end if;
  return new;
end
$$;
revoke all on function tours.booking_payment_from_card() from public;
revoke execute on function tours.booking_payment_from_card() from anon, authenticated;
drop trigger if exists bookings_payment_from_card on tours.bookings;
create trigger bookings_payment_from_card
  after insert or update of status, cg_tx_id on tours.bookings
  for each row execute function tours.booking_payment_from_card();

-- the card payments already made
insert into tours.booking_payments (company_id, booking_id, kind, status, amount, currency, amount_ils, paid_at, method,
                                    payer_name, invoice_no, cg_tx_id, note)
select b.company_id, b.id, 'full', 'paid', b.total, b.currency, b.total_ils, coalesce(b.paid_at, b.created_at), 'site',
       b.customer_name, b.receipt_no, b.cg_tx_id, 'Card payment on the site'
  from tours.bookings b
 where b.cg_tx_id is not null and b.status in ('paid', 'done')
on conflict (booking_id, cg_tx_id) where cg_tx_id is not null and is_deleted is null do nothing;

-- ---------------------------------------------------------------- 2. the gift's passengers
alter table tours.bookings add column if not exists gift_passengers smallint[] default '{}'::smallint[];

-- ---------------------------------------------------------------- 3. cancellation fee rules
create table if not exists tours.cancellation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  package_id uuid not null references tours.packages(id) on delete cascade,
  component text not null,                       -- hotel / flight / land / other
  until_days_before integer,                     -- holds while >= N days are left; null = the last window
  fee_kind text not null,                        -- per_pax / per_order / percent
  fee_value numeric(12, 2) not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cancellation_rules_package_idx on tours.cancellation_rules (package_id, position);
alter table tours.cancellation_rules enable row level security;
grant all on table tours.cancellation_rules to service_role;

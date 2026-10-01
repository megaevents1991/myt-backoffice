-- Reservations of a tours company. ADDITIVE ONLY.
--
-- A tours company has no online booking yet: operations type in what was sold
-- (tours.departure_sales_entries, +pax sold / -pax cancelled). Those rows are
-- now the company's Reservations screen, so a row may carry the customer it
-- was sold to and the site lead it came from, and it is soft-deleted (a
-- mistaken row is marked, never removed). The seats view stops counting a
-- deleted row.
--
-- Mega Events is untouched: public.reservations is not read or changed here.
-- Rollback: section 8 of supabase/rollback/20261001_multi_company.sql.

alter table tours.departure_sales_entries
  add column if not exists customer_name text,
  add column if not exists customer_phone text,
  add column if not exists customer_email text,
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists is_deleted date;

create index if not exists departure_sales_entries_company_created_idx
  on tours.departure_sales_entries (company_id, created_at desc);
create index if not exists departure_sales_entries_lead_idx
  on tours.departure_sales_entries (lead_id) where lead_id is not null;

-- Same view as 20261001100500, except that a deleted sales row no longer counts as sold.
create or replace view tours.departure_stats as
select
  d.id as departure_id,
  d.company_id,
  least(coalesce(a.outbound_seats, 0), coalesce(a.inbound_seats, 0))::int as allocated_seats,
  coalesce(a.live_blocks, 0)::int as live_blocks,
  coalesce(a.total_blocks, 0)::int as total_blocks,
  coalesce(s.sold, 0)::int as sold,
  (least(coalesce(a.outbound_seats, 0), coalesce(a.inbound_seats, 0)) - coalesce(s.sold, 0))::int as remaining,
  coalesce(a.outbound_seats, 0)::int as outbound_seats,
  coalesce(a.inbound_seats, 0)::int as inbound_seats
from tours.departures d
left join lateral (
  select
    sum(fa.seats) filter (where fa.legs <> 'inbound' and f.block_status in ('confirmed', 'operational', 'ticketed') and f.is_deleted is not true) as outbound_seats,
    sum(fa.seats) filter (where fa.legs <> 'outbound' and f.block_status in ('confirmed', 'operational', 'ticketed') and f.is_deleted is not true) as inbound_seats,
    count(*) filter (where f.block_status in ('confirmed', 'operational', 'ticketed') and f.is_deleted is not true) as live_blocks,
    count(*) as total_blocks
  from tours.flight_allocations fa
  join public.flights f on f.id = fa.flight_id
  where fa.departure_id = d.id
) a on true
left join lateral (
  select sum(e.pax) as sold
  from tours.departure_sales_entries e
  where e.departure_id = d.id and e.is_deleted is null
) s on true;

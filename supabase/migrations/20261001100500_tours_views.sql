-- Read-only views of the tours product. ADDITIVE ONLY.
-- Both live in `tours` (not `public`): that schema is granted to service_role
-- only, so anon can never reach them. Callers filter by company_id.
--
-- Rollback: supabase/rollback/20261001_multi_company.sql (dropping schema tours removes them).

-- Seats of a departure: what its live flight blocks hold, what was sold, what is left.
-- A departure may take its two directions from different blocks (legs = outbound /
-- inbound), so each direction is summed apart and the smaller one is what can be
-- sold: 40 seats out and 20 seats back carry 20 passengers. With the usual
-- legs = both the two sums are equal.
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
  select sum(e.pax) as sold from tours.departure_sales_entries e where e.departure_id = d.id
) s on true;

-- Ordered vs realised flight groups per month and airline (the "airlines summary" sheet).
create or replace view tours.flight_realization as
select
  f.company_id,
  date_trunc('month', f.outbound_departure_time)::date as month,
  f.airline_code,
  count(*)::int as groups_ordered,
  coalesce(sum(coalesce(f.original_quantity, f.initial_quantity)), 0)::int as pax_ordered,
  count(*) filter (where f.block_status in ('confirmed', 'operational', 'ticketed'))::int as groups_realized,
  coalesce(sum(f.initial_quantity) filter (where f.block_status in ('confirmed', 'operational', 'ticketed')), 0)::int as seats_realized,
  count(*) filter (where f.block_status = 'cancelled')::int as groups_cancelled,
  coalesce(sum(f.cancellation_fee), 0) as fees_paid,
  coalesce(sum(coalesce(f.original_quantity, f.initial_quantity) * (coalesce(f.cost_price, 0) + coalesce(f.cost_tax, 0))), 0) as potential_cost,
  coalesce(sum(f.initial_quantity * (coalesce(f.cost_price, 0) + coalesce(f.cost_tax, 0)))
           filter (where f.block_status in ('confirmed', 'operational', 'ticketed')), 0) as actual_cost
from public.flights f
where f.is_deleted is not true
group by 1, 2, 3;

grant select on tours.departure_stats to service_role;
grant select on tours.flight_realization to service_role;

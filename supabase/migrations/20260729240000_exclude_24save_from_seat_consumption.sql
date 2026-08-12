-- A 24-hour price hold must not consume a flight's per-event allocation.
--
-- `24Save` is a saved basket: the customer has paid nothing and reserved
-- nothing. The main app no longer consumes offline inventory for it at
-- checkout, and the backoffice reconcilers were updated to match - but this
-- view derives consumption independently, straight from reservations, and is
-- what the customer-facing flight search reads to decide a locked package is
-- sold out.
--
-- Left as it was, one abandoned hold could mark a package unsellable for
-- everyone, and the three counters would disagree with each other.

create or replace view "public"."flight_event_consumed" as
  select "offline_flight_id" as "flight_id",
         "event_id",
         sum(coalesce(("flight_order_info"->>'numOfTravelers')::int, 0))::int as "consumed_seats"
    from "public"."reservations"
   where "offline_flight_id" is not null
     and "status" not in ('Cancelled', 'Lost', '24Save')
   group by "offline_flight_id", "event_id";

grant select on "public"."flight_event_consumed" to "service_role";

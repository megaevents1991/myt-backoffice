-- Coupon usage lookup for partner credit.
--
-- The backoffice needs, per coupon code, how much of it was actually applied
-- (`reservations.coupon_discount_usd`) so the unspent remainder can go back to
-- the partner's balance. Doing that from the app meant one `ILIKE` term per
-- redemption in the query string: unindexable, and long enough to blow the
-- request-line limit once a partner has a few hundred conversions.
--
-- Case folding is not optional here. `reservations.coupon_code` stores whatever
-- the customer typed, which is why `count_coupon_paid_use` compares
-- `upper(code) = upper(new.coupon_code)`. This matches that exactly.

create index if not exists "reservations_coupon_code_upper_idx"
  on "public"."reservations" (upper("coupon_code"))
  where "coupon_code" is not null;

create or replace function "public"."partner_coupon_usage"("p_codes" text[])
returns table ("code" text, "used_usd" numeric, "paid_uses" bigint)
language sql
stable
security definer
set search_path = public
as $$
  select upper(r.coupon_code) as code,
         coalesce(sum(r.coupon_discount_usd), 0) as used_usd,
         count(*) as paid_uses
    from public.reservations r
   where r.coupon_code is not null
     and upper(r.coupon_code) = any (
           select upper(c) from unnest(p_codes) as c
         )
     and r.status = 'Paid'
   group by upper(r.coupon_code);
$$;

comment on function "public"."partner_coupon_usage"(text[]) is
  'Per coupon code: total discount actually applied on Paid reservations, and how many. Used to return the unspent part of a partner-credit coupon to the balance.';

-- Called only through the service-role key from the backoffice. The grant is
-- explicit rather than relying on schema default privileges - the caller treats
-- a failure as "no usage", so a silent permission error would look like
-- "nothing was ever spent".
revoke all on function "public"."partner_coupon_usage"(text[]) from public, anon, authenticated;
grant execute on function "public"."partner_coupon_usage"(text[]) to service_role;

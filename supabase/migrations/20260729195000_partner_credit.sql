-- Site credit for partners, alongside (not instead of) cash commission.
--
-- A partner accrues a fixed USD amount for every ticket on a reservation that
-- reached status 'Paid'. To use it they convert the whole balance into a
-- single-use coupon; the balance then reads as zero and only the coupon lives on.
--
-- The balance is never stored as a counter. It is always
--   accrued (from paid reservations) - redeemed (sum of the rows below)
-- so it cannot drift from the reservations it is derived from, and a failed or
-- double-submitted conversion can never silently inflate it.

alter table "public"."partners"
  add column if not exists "credit_per_ticket" numeric;

update "public"."partners"
   set "credit_per_ticket" = 0
 where "credit_per_ticket" is null;

alter table "public"."partners"
  alter column "credit_per_ticket" set default 0;

alter table "public"."partners"
  alter column "credit_per_ticket" set not null;

comment on column "public"."partners"."credit_per_ticket" is
  'USD of site credit the partner accrues per ticket on a Paid reservation. 0 = not on the credit agreement. Separate from `commission`, which is still paid in cash.';

-- One row per conversion. Never updated; deleted only to roll back a conversion
-- whose coupon was never activated.
create table if not exists "public"."partner_credit_redemptions" (
  "id" bigint generated always as identity primary key,
  "partner_tracking_code" text not null
    references "public"."partners"("partner_tracking_code") on delete cascade,
  -- The credit consumed by this conversion, i.e. the balance at that moment.
  "amount_usd" numeric not null check ("amount_usd" > 0),
  -- The coupon minted from it. Kept if the coupon is later deleted: the credit
  -- was still spent, so the row must keep suppressing it from the balance.
  "coupon_id" bigint references "public"."coupons"("id") on delete set null,
  "coupon_code" text not null,
  "created_at" timestamptz not null default now(),
  -- Who pressed the button: the partner's own user, or a staff member.
  "created_by" uuid
);

create index if not exists "partner_credit_redemptions_partner_idx"
  on "public"."partner_credit_redemptions" ("partner_tracking_code");

-- Service-role only, like every other table here.
alter table "public"."partner_credit_redemptions" enable row level security;

comment on table "public"."partner_credit_redemptions" is
  'Append-only ledger of partner credit converted to coupons. Balance = accrued from paid reservations - sum(amount_usd) here.';

-- Funnel counts for the partner performance screen.
--
-- `affiliates_tracking` gets a row per visitor per step, so it is the largest
-- table in this feature. Selecting it into the app to count would pull the whole
-- history on every page view AND silently truncate at PostgREST's max_rows,
-- understating the numbers with no error. Aggregate in the database instead.
create or replace function "public"."partner_funnel_counts"("p_tracking_code" text)
returns table ("stage" text, "visitors" bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.stage, count(distinct t.user_id) as visitors
    from public.affiliates_tracking t
   where t.affiliate_id = p_tracking_code
   group by t.stage;
$$;

comment on function "public"."partner_funnel_counts"(text) is
  'Distinct visitors per funnel stage for one partner. Used by the staff performance screen.';

-- Called only through the service-role key from the backoffice. The grant is
-- explicit rather than relying on the schema's default privileges: the app
-- swallows a traffic error into an empty funnel, so a silent permission failure
-- would look like "this partner has no visitors".
revoke all on function "public"."partner_funnel_counts"(text) from public, anon, authenticated;
grant execute on function "public"."partner_funnel_counts"(text) to service_role;

create index if not exists "affiliates_tracking_affiliate_idx"
  on "public"."affiliates_tracking" ("affiliate_id");

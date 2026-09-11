-- Influencer coupons (Tom, 2026-09-10): one coupon per משפיען, code = tracking
-- code + discount ("AVIRAN30"), and its fixed discount is PER PERSON like the
-- follower discount on the tracking link - not once per order.
--
-- per_person: myt-main multiplies a fixed discount by the ticket count when
--   true. Default false keeps every existing coupon (credit vouchers,
--   commission-funded coupons, campaign codes) per-order as before.
-- influencer_partner_code: the partner this coupon IS (one per partner);
--   partner_tracking_code stays the attribution column main already reads.

alter table public.coupons
  add column if not exists per_person boolean not null default false;

alter table public.coupons
  add column if not exists influencer_partner_code text;

create unique index if not exists coupons_influencer_partner_code_key
  on public.coupons (influencer_partner_code)
  where influencer_partner_code is not null;

comment on column public.coupons.per_person is
  'Fixed discount applies per ticket/person (influencer coupons). false = once per order.';
comment on column public.coupons.influencer_partner_code is
  'Set on the one auto-built coupon of an affiliate partner (partners.partner_tracking_code).';

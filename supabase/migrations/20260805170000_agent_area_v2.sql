-- Agent-area v2 (portal workplan, 2026-08-05):
--
-- 1. Order source attribution — the portal's "how did this order arrive"
--    labels (שובר / לינק אישי / הצעת מחיר / לינק). The main app's
--    confirm-order writes both, best-effort (42703-tolerant until this lands):
--      * source_share_token — the prepared_packages.share_token of the ?pkg=
--        link the customer booked through, null for plain tracking links.
--      * quote_id — the signed quote (?quote=&qsig=) the order priced by.
--        No FK: quotes can be deleted by their agent, and losing the label
--        must never block or cascade into a customer reservation.
--
-- 2. Partner payout details — self-service profile (bank transfer details and
--    a MASKED payment card). payment_card holds last-4 + brand + holder ONLY;
--    the portal action rejects anything that looks like a full card number.

alter table public.reservations
  add column if not exists source_share_token text;

alter table public.reservations
  add column if not exists quote_id bigint;

alter table public.partners
  add column if not exists bank_details jsonb;

alter table public.partners
  add column if not exists payment_card jsonb;

-- 3. Commission-funded coupons — a partner may create a coupon capped at (and
--    deducted from) their own commission. Only coupons carrying this flag ever
--    deduct; every pre-existing coupon (including credit-conversion vouchers)
--    keeps its current payout behavior.
alter table public.coupons
  add column if not exists funded_by_commission boolean default false not null;

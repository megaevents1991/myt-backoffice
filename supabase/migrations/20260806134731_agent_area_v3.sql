-- Agent area round 3 (באגים/תיקונים — אלון ודור, 2026-08-06).
--
-- 1. reservations.voucher_state — the voucher's own lifecycle, SEPARATE from
--    reservations.status on purpose: the main app writes status and treats
--    'Paid' as "money collected"; the voucher chain (sent → received →
--    collected) is a backoffice-only fact. Values: 'sent' | 'received' |
--    'collected' (validated in the backoffice; no CHECK constraint — the main
--    app writes this table).
-- 2. partners.coupon_cap — manual per-partner ceiling for commission-funded
--    coupons, in the partner's commission unit (percent partners: %, fixed
--    partners: $ per ticket). Semantics: discount+commission from the
--    agreement, e.g. 70 for Sagi. NULL falls back to the commission rate.
-- 3. reservations.travel_materials_sent_at — staff stamp "travel material sent
--    to customer"; the portal's חומר ללקוח column reads this (falls back to
--    confirmation_email_sent when null).

alter table reservations add column if not exists voucher_state text;
alter table partners add column if not exists coupon_cap numeric;
alter table reservations add column if not exists travel_materials_sent_at timestamptz;

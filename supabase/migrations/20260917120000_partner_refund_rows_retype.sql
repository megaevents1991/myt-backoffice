-- Retype the customer-referral rows the main app created since the last backfill.
--
-- 20260729160000 moved every "החזר ללקוח ניתן להתעלם" row to type
-- 'customer_refund' and noted that the main app still inserted new ones without
-- a type, so they kept landing on the column DEFAULT 'affiliate'. 197 did
-- (2026-07-29 .. 2026-09-17) - they showed up as influencers, and one was
-- cloned into a real-looking partner (aviran_1908).
--
-- myt-main now writes type = 'customer_refund' itself (confirm-order) AND
-- honours that type as a discount link (useFetchAffiliate / partnerLinkCode /
-- middleware). ORDER MATTERS: deploy myt-main FIRST. Until main honours the
-- type, a row retyped here stops giving the friend discount - that is exactly
-- what the July backfill did to the 1,289 older codes (referral orders went
-- 13 in June -> 0 in July).
--
-- Same signature as the first backfill: the Hebrew name marker the main app
-- writes, never the `_NNN` code suffix. Idempotent.

update "public"."partners"
   set "type" = 'customer_refund'
 where "type" is distinct from 'customer_refund'
   and "name_hebrew" like '%ניתן להתעלם%';

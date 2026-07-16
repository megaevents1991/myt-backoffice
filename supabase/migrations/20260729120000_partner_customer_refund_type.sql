-- Partner types: separate the auto-created customer-refund rows from real
-- partner marketing.
--
-- The main app opens a `partners` row for every customer who books, named
-- "החזר ללקוח ניתן להתעלם". They defaulted to type 'affiliate', so ~1235 of the
-- ~1312 rows were classified as influencers (משפיען) and swamped every partner
-- list. They get their own type; `agent`/`affiliate` now mean marketing only.

-- 1. Backfill on the Hebrew name marker — the definitive signature the main app
--    writes. Deliberately NOT matching on the `_NNN` tracking-code suffix: that
--    was only ever a heuristic, and a real influencer whose code happens to end
--    in _001 must not be reclassified and hidden from the partner lists.
update "public"."partners"
   set "type" = 'customer_refund'
 where "type" is distinct from 'customer_refund'
   and "name_hebrew" like '%ניתן להתעלם%';

-- 2. Anything still untyped is a real affiliate (the column's original default).
update "public"."partners"
   set "type" = 'affiliate'
 where "type" is null;

-- 3. Constrain the column now that every row holds a known value. Kept
--    nullable so an insert that omits `type` still lands on the DB default
--    rather than failing.
alter table "public"."partners" drop constraint if exists "partners_type_check";
alter table "public"."partners"
  add constraint "partners_type_check"
  check ("type" is null or "type" in ('agent', 'affiliate', 'customer_refund'));

comment on column "public"."partners"."type" is
  'agent = סוכן, affiliate = משפיען (both partner marketing, managed by staff); customer_refund = החזר ללקוח, opened automatically per booking by the main app — excluded from partner lists and dashboard counts.';

-- Every partner-facing query filters on this.
create index if not exists "partners_type_idx" on "public"."partners" ("type");

-- The portal, the staff performance view and the monthly report cron all filter
-- reservations by this column; it had no index.
create index if not exists "reservations_aff_partner_tracking_code_idx"
  on "public"."reservations" ("aff_partner_tracking_code");

-- Freeze partner commission terms per reservation, so changing a partner's
-- commission applies FROM NOW ON instead of retroactively repricing every
-- open (un-billed) reservation.
--
-- NULL commission_rate = "no snapshot, use the partner's current rate" - the
-- behavior every existing row keeps until the partner's rate next changes.
-- At that moment the backoffice stamps the OLD rate onto all of the partner's
-- rows that have no snapshot yet (lib/partner-commission-freeze.ts), and the
-- new rate only affects reservations created afterwards.
--
-- Columns are nullable, no CHECK: the main app writes `reservations` and must
-- never fail a customer booking over a label mismatch (migrations rule).
alter table "public"."reservations"
  add column if not exists "commission_type" text,
  add column if not exists "commission_rate" numeric;

comment on column "public"."reservations"."commission_rate" is
  'Commission rate frozen for this reservation (unit per commission_type). NULL = use the partner''s current rate. Stamped by the backoffice when the partner''s rate changes.';
comment on column "public"."reservations"."commission_type" is
  'fixed_per_ticket | percent_of_sale - the unit commission_rate is read in. Only meaningful when commission_rate is set.';

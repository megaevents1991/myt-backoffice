-- Partners can be paid a flat amount per ticket OR a percentage of the package
-- price the customer paid. Until now the column carried no unit, and the portal
-- read it as a percentage while the monthly report cron paid it as $/ticket —
-- the same partner saw two different payouts for the same month.

alter table "public"."partners"
  add column if not exists "commission_type" text;

-- Set separately from ADD COLUMN so the migration also repairs a column added
-- by hand in the dashboard, where `if not exists` would skip the constraints.
-- Every existing partner keeps being paid exactly as the cron already pays them.
update "public"."partners"
   set "commission_type" = 'fixed_per_ticket'
 where "commission_type" is null
    or "commission_type" not in ('fixed_per_ticket', 'percent_of_sale');

alter table "public"."partners"
  alter column "commission_type" set default 'fixed_per_ticket';

-- NOT NULL last: the backfill above guarantees no row can violate it, and the
-- DEFAULT covers new rows, including the ones the main app inserts per booking.
alter table "public"."partners"
  alter column "commission_type" set not null;

comment on column "public"."partners"."commission_type" is
  'fixed_per_ticket = `commission` is USD per paid ticket; percent_of_sale = `commission` is a percentage of the package price the customer paid (reservations.user_shown_price). Validated in lib/actions/partner-actions.ts.';

comment on column "public"."partners"."supplier_number" is
  'The partner''s company/VAT number (ח.פ). Printed on the monthly invoice-style report.';

-- Deliberately NO check constraint, for the same reason as `type`: the main app
-- inserts into this table on every customer booking, and a value outside an
-- allow-list would turn a data-hygiene rule into a failed booking.

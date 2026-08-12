-- Whether an agent may settle a booking with a voucher instead of a card.
--
-- This is per agreement, not a global capability: an agent who has it sends us
-- a voucher for the booking, and one who does not pays by card - their own or
-- the customer's. Default false so an existing agent gains nothing until the
-- agreement is recorded here.

alter table "public"."partners"
  add column if not exists "voucher_payment_allowed" boolean;

update "public"."partners"
   set "voucher_payment_allowed" = false
 where "voucher_payment_allowed" is null;

alter table "public"."partners"
  alter column "voucher_payment_allowed" set default false;

alter table "public"."partners"
  alter column "voucher_payment_allowed" set not null;

comment on column "public"."partners"."voucher_payment_allowed" is
  'Agent may pay for a booking with a voucher sent to us, per their agreement. Influencers never book, so this is only meaningful for type = agent.';

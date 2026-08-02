-- How an agent-entered reservation is actually being settled with us.
--
-- Written by the main app only for bookings an agent enters on a customer's
-- behalf (`is_agent_booking`) — every other reservation leaves this null. Lets
-- staff tell, at a glance, a Pending reservation that's genuinely awaiting a
-- voucher from a named partner apart from an ordinary uncalled phone lead.
-- Never shown to the customer. See myt-main's confirm-order/utils.ts
-- (resolveAgentSettlement) for what sets this and why.
--
-- No CHECK constraint: the main app is the sole writer and already validates
-- the value server-side from trusted partner data — a constraint here would
-- just turn a future legitimate new value into a failed customer booking.

alter table "public"."reservations"
  add column if not exists "partner_settlement_method" text;

comment on column "public"."reservations"."partner_settlement_method" is
  'One of customer_card / agent_card / voucher for agent-entered bookings; null otherwise. Set by myt-main confirm-order, never by the customer.';

-- How much LESS an agent-card settlement actually charges, in ILS.
--
-- `reservations.final_purchase_price_ils` always holds the FULL price - every
-- customer-facing surface (confirmation emails, this reservation's own
-- record) reads that column, and must never see a reduced number. This
-- column holds the commission-net reduction for an agent_card settlement
-- (partner_settlement_method = 'agent_card') ONLY; myt-main's /api/payment
-- is the one place that subtracts it before charging CreditGuard. Null/0 for
-- every other reservation. See myt-main's confirm-order/utils.ts
-- (resolveAgentSettlement) and app/api/payment/route.ts.

alter table "public"."reservations"
  add column if not exists "agent_card_discount_ils" numeric;

comment on column "public"."reservations"."agent_card_discount_ils" is
  'ILS subtracted from final_purchase_price_ils before charging, for partner_settlement_method = agent_card only. Never shown to the customer.';

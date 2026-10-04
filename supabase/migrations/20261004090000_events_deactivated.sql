-- An event that cannot sell a ticket goes off the customer site by itself
-- (Dor, 04.10.2026: "שיעשה לו deactivate ויכין לנו משימה... זה חשוף ללקוח").
--
-- Event 1100 was a copy of another city's show and kept that show's TixStock
-- category: the site listed it with a price for four weeks and could not sell
-- one ticket. The TixStock price sync now compares our categories with the
-- supplier's feed (lib/services/tixstock-availability.ts) and, when nothing is
-- left to sell, writes the reason here and opens a staff task.
--
--   deactivated_reason  null = on the site.
--                       'tx_no_category' - none of our categories exists at TixStock
--                       'tx_sold_out'    - they exist, with nothing on sale
--                       The sync clears its own two values when tickets return;
--                       any other value is left alone.
--   deactivated_at      when it went off.
--
-- myt-main drops a deactivated event from every listing; its /order/{id} page
-- shows "sold out" (its tickets are off sale).
--
-- Additive only, both columns nullable. Rollback:
--   alter table public.events drop column if exists deactivated_reason, drop column if exists deactivated_at;

alter table public.events
  add column if not exists deactivated_reason text,
  add column if not exists deactivated_at timestamptz;

comment on column public.events.deactivated_reason is
  'null = on the customer site. tx_no_category / tx_sold_out = taken off by the TixStock price sync (cleared by it when tickets return).';
comment on column public.events.deactivated_at is
  'When deactivated_reason was set.';

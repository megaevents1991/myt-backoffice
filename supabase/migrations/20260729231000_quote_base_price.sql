-- Record what the system priced a quote at, alongside what the partner quoted.
--
-- The quote builder seeds a line item from the event's package price and then
-- lets the partner type over it. Only the final number was stored, so there was
-- no way to tell afterwards whether a partner had discounted $200 or added a
-- $200 service — and no way to re-derive it either, because the seed is
-- recomputed live from `events` columns that change.
--
-- Under the agreed rule the partner absorbs the difference, so the difference
-- has to be a recorded fact rather than something reconstructed later.

alter table "public"."quotes"
  add column if not exists "base_unit_price" numeric;

-- Per TRAVELLER, not per quote. computePackagePrice returns the price of one
-- package (flight + hotel + cheapest available ticket + markup) and the order
-- flow multiplies it by the number of travellers. Storing it as a total would
-- read as a baseline for the whole quote, and a family of four would look like
-- the partner had added three packages' worth of margin.
comment on column "public"."quotes"."base_unit_price" is
  'The per-traveller package price the system suggested when this quote was built, before the partner edited it. Compare against the quoted line item''s unit_price; multiply by its qty for the quote-level baseline. NULL for quotes with no event, and for quotes predating this column.';

-- Partner-facing lists and the staff view both read quotes by partner and date.
create index if not exists "quotes_partner_created_idx"
  on "public"."quotes" ("partner_tracking_code", "created_at" desc);

-- Redundant once the composite above exists — a leading-column prefix serves
-- every query the single-column index did.
drop index if exists "public"."quotes_partner_idx";

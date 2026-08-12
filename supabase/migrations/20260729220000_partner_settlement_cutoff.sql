-- Draw a line under what has already been paid to partners.
--
-- Everything owed up to and including 2026-06-30 - commission AND site credit -
-- was settled with every partner outside this system. Without a cutoff, both
-- mechanisms would pay it a second time:
--
--   * The monthly report is about to start billing on "paid but not yet
--     billed" instead of "created last month", so on its first run it would
--     sweep up every historical reservation at once.
--   * `credit_per_ticket` is a brand-new column, zero for everyone. The moment
--     staff set a partner to $20/ticket, accrual would run over that partner's
--     entire booking history and hand them credit that was already given.
--
-- 2026-07-01 is the first payable day.

-- ---------------------------------------------------------------------------
-- 1. Commission: bill by state, not by date window
-- ---------------------------------------------------------------------------
--
-- The report currently selects reservations `created_at` within the previous
-- calendar month AND `status = 'Paid'` right now. A reservation created on
-- 28 July and paid on 3 August satisfies neither run: the August run wants
-- July-created rows but it wasn't paid yet, and the September run wants
-- August-created rows. It is never billed, and nothing reports the gap.
--
-- Stamping each reservation when it is billed replaces the window with a fact.

alter table "public"."reservations"
  add column if not exists "billed_at" timestamptz;

comment on column "public"."reservations"."billed_at" is
  'When partner commission for this reservation was included in a monthly report. NULL = not yet billed. Set by the partnerMonthlyReport cron; never cleared.';

-- Only rows that were actually Paid can have been paid out. An old reservation
-- still sitting unpaid stays billable, so if it is ever settled the partner is
-- still credited for it.
-- One-shot on purpose. A pre-July reservation that becomes Paid LATER is
-- legitimately awaiting billing and still matches the WHERE clause, so a
-- re-run would write off money this migration promises stays billable. The
-- NOT EXISTS makes the whole statement a no-op once any row carries the
-- cutoff stamp.
update "public"."reservations"
   set "billed_at" = timestamptz '2026-07-01 00:00:00+00'
 where "billed_at" is null
   and "status" = 'Paid'
   and "created_at" < timestamptz '2026-07-01 00:00:00+00'
   and not exists (
     select 1
       from "public"."reservations" r
      where r."billed_at" = timestamptz '2026-07-01 00:00:00+00'
   );

-- The report's working query: unbilled paid rows for a partner.
create index if not exists "reservations_unbilled_idx"
  on "public"."reservations" ("aff_partner_tracking_code")
  where "billed_at" is null;

-- ---------------------------------------------------------------------------
-- 2. Site credit: accrue only from the cutoff
-- ---------------------------------------------------------------------------

alter table "public"."partners"
  add column if not exists "credit_accrual_start" date;

-- Existing partners start at the cutoff. New partners created later get the
-- same default, which is deliberately a fixed date and not now(): a partner
-- added next year should still accrue on any backdated reservation attributed
-- to them, and staff can move this per partner if a deal starts later.
update "public"."partners"
   set "credit_accrual_start" = date '2026-07-01'
 where "credit_accrual_start" is null;

alter table "public"."partners"
  alter column "credit_accrual_start" set default date '2026-07-01';

alter table "public"."partners"
  alter column "credit_accrual_start" set not null;

comment on column "public"."partners"."credit_accrual_start" is
  'Site credit accrues only on reservations created on or after this date. Defaults to the 2026-07-01 settlement cutoff so enabling credit_per_ticket cannot pay out history that was already settled.';

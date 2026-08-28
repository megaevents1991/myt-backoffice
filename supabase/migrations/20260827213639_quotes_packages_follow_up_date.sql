-- אזור סוכן V2 (2026-08-27): the merged הצעות מחיר table shows ONE follow-up
-- date per row - for quotes AND for prepared packages ("התאריך 24/08 זה תאריך
-- פולו שהסוכן בוחר לעצמו"). Chosen by the agent; the UI falls back to the
-- row's creation date while unset. Idempotent - safe to re-run.

alter table "public"."quotes"
  add column if not exists "follow_up_date" date;

alter table "public"."prepared_packages"
  add column if not exists "follow_up_date" date;

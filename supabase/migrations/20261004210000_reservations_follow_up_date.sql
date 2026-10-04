-- Follow-up call-back day (Dor, 04.10). A reservation in status "Follow-up" is a customer
-- waiting for us to get back to them; this is the day staff said they would.
-- Backoffice-only: main never reads or writes it, and a row it inserts simply has none.
-- Rows already in Follow-up stay without a day and read as "No date" (they still count as
-- waiting) - no backfill, nobody ever promised those customers a day.
alter table public.reservations
  add column if not exists follow_up_date date;

comment on column public.reservations.follow_up_date is
  'Day staff will get back to the customer; read only while status = Follow-up (lib/reservations/follow-up.ts).';

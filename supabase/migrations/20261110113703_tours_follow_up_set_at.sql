-- Alon 10.11 (ROAD MAP MEGATR, tab t.kw44n12anc02, note 3): "אם שיניתי תאריך פולו או ניקיתי אז לא צריך להופיע בטודיי יותר".
-- A card at "New" sat on TODAY whatever its follow-up day, because the reason "new" wins over the day. Once a rep set
-- or cleared the day, the card is handled: TODAY reads its day like any other card's (late / today / not yet).
-- A cleared day looks like a card that never had one, so the touch is remembered here: when a rep last set or cleared
-- the follow-up day by hand (updateCase, the bulk bar, an offer sent, a new card scheduled for a later day).
-- Site forms, joins and the waiting-list cron never write it. Read by lib/tours/cases.ts todayReason.
alter table public.leads add column if not exists follow_up_set_at timestamptz;

comment on column public.leads.follow_up_set_at is
  'When a rep last set or cleared follow_up_date by hand. A card at status new with a stamp leaves TODAY''s "New" reason (Alon 10.11).';

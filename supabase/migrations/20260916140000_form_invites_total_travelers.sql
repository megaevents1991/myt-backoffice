-- Trip links: how many travellers the trip actually had.
--
-- Set by staff (at creation or later from the trips report), NOT derived from
-- the answers - it is the denominator the reported travellers are measured
-- against ("15 travellers answered out of 17 on the trip"). Null means nobody
-- has said yet, and the report then shows the reported number alone.
--
-- Backoffice-only table; the main app never reads form_invites.

alter table public.form_invites
  add column if not exists total_travelers integer;

comment on column public.form_invites.total_travelers is
  'Staff-set total travellers on this trip. Null = unknown; the trips report then shows the reported sum without a denominator.';

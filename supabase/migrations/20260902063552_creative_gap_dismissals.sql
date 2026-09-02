-- "Already on the site" for the creative-gaps list.
--
-- Some gaps are not gaps: Arsenal's crest exists on the site even though
-- football_teams.logo_url is null, so the radar keeps reporting work that is
-- already done. Dismissing a gap files it away without touching the row it
-- points at - the underlying column stays null, and clearing the dismissal
-- brings the gap straight back.
--
-- Purely additive, backoffice only. The main app never reads this.

create table if not exists public.creative_gap_dismissals (
  -- "{kind}:{table}:{row_id}" - kind is part of the identity because one team
  -- can be missing its crest AND its gallery, and those are separate calls.
  gap_key      text primary key,
  kind         text not null,
  source_table text not null,
  row_id       text not null,
  -- Snapshot of the name at dismissal time, so the "already on site" list
  -- stays readable even if the row is later renamed or removed.
  label        text,
  note         text,
  dismissed_by uuid references public.user_profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Service-role only, like tasks / user_profiles: RLS on, no policies.
alter table public.creative_gap_dismissals enable row level security;

-- Two galleries per person instead of one (2026-10-01).
--
-- `gallery` did two jobs: the mood gallery on the artist / team page AND the pool
-- event cards and Meta creatives rotate through. Mood photos uploaded for the
-- Oasis page went straight onto its event cards and ads.
--
--   gallery        = mood gallery, the page only
--   event_gallery  = event variety: site event cards + the product feed creatives
--
-- football_teams gets the column too (main reads both tables with one select);
-- a team's events wear the crest, so nothing reads it there.

alter table public.artists add column if not exists event_gallery jsonb;
alter table public.football_teams add column if not exists event_gallery jsonb;

-- Artists: the cut-outs the gallery editor produced ("-cutout-" in the file name)
-- were uploaded for events - they move to event_gallery, order kept. Everything
-- else (plain photos) stays a mood picture. Runs once: only rows not split yet.
update public.artists a
set
  event_gallery = coalesce(
    (
      select jsonb_agg(u.url order by u.ord)
      from jsonb_array_elements_text(a.gallery) with ordinality as u(url, ord)
      where u.url like '%-cutout-%'
    ),
    '[]'::jsonb
  ),
  gallery = coalesce(
    (
      select jsonb_agg(u.url order by u.ord)
      from jsonb_array_elements_text(a.gallery) with ordinality as u(url, ord)
      where u.url not like '%-cutout-%'
    ),
    '[]'::jsonb
  )
where a.event_gallery is null
  and jsonb_typeof(a.gallery) = 'array';

update public.artists set event_gallery = '[]'::jsonb where event_gallery is null;
update public.football_teams set event_gallery = '[]'::jsonb where event_gallery is null;

alter table public.artists alter column event_gallery set default '[]'::jsonb;
alter table public.artists alter column event_gallery set not null;
alter table public.football_teams alter column event_gallery set default '[]'::jsonb;
alter table public.football_teams alter column event_gallery set not null;

comment on column public.artists.gallery is 'Mood gallery - the artist page only';
comment on column public.artists.event_gallery is 'Event variety - site event cards and Meta feed creatives rotate through these';

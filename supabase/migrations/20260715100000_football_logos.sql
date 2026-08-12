-- Football logo library: lightweight name→logo store for the creative
-- generator. Deliberately NOT football_teams - rows there generate public
-- team pages in the main app; these are internal assets only.

create table if not exists public.football_logos (
    id bigint generated always as identity primary key,
    name_english text not null,
    name_hebrew text,
    logo_url text not null,
    created_at timestamptz not null default now()
);

-- One logo per english name (case-insensitive).
create unique index if not exists football_logos_name_english_key
    on public.football_logos (lower(name_english));

-- No policies on purpose: only the backoffice service-role client touches
-- this table; RLS blocks the anon key entirely.
alter table public.football_logos enable row level security;

-- Public bucket: logo URLs are persisted verbatim and rendered into
-- creatives, so they must be permanent public URLs (never signed).
insert into storage.buckets (id, name, public)
values ('football-logos', 'football-logos', true)
on conflict (id) do nothing;

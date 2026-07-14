-- 2026-07-13 Creative image generator (spec: docs/superpowers/specs/2026-07-13-creative-image-generator-design.md)
-- Status: RUN by Dor in Supabase SQL editor on 2026-07-13.

-- Club logo (transparent PNG). Additive; main app unaffected.
alter table public.football_teams
  add column if not exists logo_url text null;

-- Public bucket for generator assets + output.
insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', true)
on conflict (id) do nothing;

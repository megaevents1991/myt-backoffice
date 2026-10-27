-- Tour uploader - standing settings (Alon 25.10: "תבנית קבועה שאני כותב ואז הוא רק ישלים את השמות / מפעל
-- בעברית"). 27.10.2026. Idempotent: safe to re-run.
--
-- One row per setting. Today: `description_template:football` and `description_template:artist` - the text
-- the build fills into `events.description` (lib/uploader/description.ts), value = { "template": "..." }.
-- Read and written by the service role only (the backoffice's server actions); never read by main.
-- The code tolerates the table not being here yet (no template = the build's English default).
create table if not exists public.uploader_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.uploader_settings enable row level security;
revoke all on public.uploader_settings from anon, authenticated;

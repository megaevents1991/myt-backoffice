-- office_manager role + per-agent attribution slug.
-- user_profiles is backoffice-only (RLS, no policies) - zero main-app impact.

alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('superadmin','admin','editor','office_manager','agent','affiliate'));

alter table public.user_profiles add column if not exists agent_slug text;

-- Backfill existing partner-role users deterministically (6 hex chars of the
-- uuid's md5). The unique index below is the collision backstop - the
-- migration fails loudly rather than silently double-assigning a slug.
update public.user_profiles
  set agent_slug = substr(md5(id::text), 1, 6)
  where agent_slug is null and role in ('agent','affiliate');

create unique index if not exists user_profiles_agent_slug_key
  on public.user_profiles (agent_slug) where agent_slug is not null;

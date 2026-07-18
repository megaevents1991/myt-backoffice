-- Contract attachment for partner-linked users (agent/affiliate): one file per
-- user, stored in a PRIVATE bucket — contracts are sensitive, access goes
-- through short-lived signed URLs minted by the backoffice service role only.

alter table public.user_profiles
    add column if not exists contract_url text;

insert into storage.buckets (id, name, public)
values ('user-contracts', 'user-contracts', false)
on conflict (id) do nothing;

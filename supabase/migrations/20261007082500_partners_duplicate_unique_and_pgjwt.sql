-- Two leftovers from the 2026-10-07 pass over Supabase's advisor. Nothing here changes a row.
--
-- 1. partners carries its key twice: partners_pkey and a second UNIQUE on the same column,
--    misnamed partners_user_id_key (advisor: "duplicate_index"). Five foreign keys were created
--    while that second one existed and lean on IT, so it cannot simply be dropped: they come
--    off, the duplicate goes, and they go back on - the same definitions, now resting on the
--    primary key. They return NOT VALID and are validated right after, so no row is rechecked
--    under the heavy lock.
--
--    partners is read on every tracked visit to the site, and these statements lock it until
--    the file commits - so the file holds nothing else that takes time, and gives up after
--    8 seconds rather than queue the site's reads behind a lock it cannot get.
--    Runs once: with the duplicate gone the block does nothing.
--
-- 2. pgjwt. Supabase dropped the extension from Postgres 17, so its presence is what makes
--    this project "not eligible" for the upgrade the advisor asks for
--    ("vulnerable_postgres_version"). Nothing here uses it: no function calls sign() /
--    verify(), no object depends on it (checked 2026-10-07). A dependency that appears later
--    keeps the extension and says so, instead of failing the migration.

set lock_timeout = '8s';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.partners'::regclass and conname = 'partners_user_id_key'
  ) then
    return;
  end if;

  alter table public.affiliates_tracking drop constraint affiliates_tracking_affiliate_id_fkey;
  alter table public.coupons drop constraint coupons_partner_tracking_code_fkey;
  alter table public.user_profiles drop constraint user_profiles_partner_tracking_code_fkey;
  alter table public.partner_credit_redemptions drop constraint partner_credit_redemptions_partner_tracking_code_fkey;
  alter table public.prepared_packages drop constraint prepared_packages_partner_tracking_code_fkey;

  alter table public.partners drop constraint partners_user_id_key;

  alter table public.affiliates_tracking
    add constraint affiliates_tracking_affiliate_id_fkey
    foreign key (affiliate_id) references public.partners (partner_tracking_code) on delete cascade not valid;
  alter table public.coupons
    add constraint coupons_partner_tracking_code_fkey
    foreign key (partner_tracking_code) references public.partners (partner_tracking_code) on delete set null not valid;
  alter table public.user_profiles
    add constraint user_profiles_partner_tracking_code_fkey
    foreign key (partner_tracking_code) references public.partners (partner_tracking_code) not valid;
  alter table public.partner_credit_redemptions
    add constraint partner_credit_redemptions_partner_tracking_code_fkey
    foreign key (partner_tracking_code) references public.partners (partner_tracking_code) on delete cascade not valid;
  alter table public.prepared_packages
    add constraint prepared_packages_partner_tracking_code_fkey
    foreign key (partner_tracking_code) references public.partners (partner_tracking_code) on delete cascade not valid;

  alter table public.affiliates_tracking validate constraint affiliates_tracking_affiliate_id_fkey;
  alter table public.coupons validate constraint coupons_partner_tracking_code_fkey;
  alter table public.user_profiles validate constraint user_profiles_partner_tracking_code_fkey;
  alter table public.partner_credit_redemptions validate constraint partner_credit_redemptions_partner_tracking_code_fkey;
  alter table public.prepared_packages validate constraint prepared_packages_partner_tracking_code_fkey;
end $$;

do $$
begin
  drop extension if exists pgjwt;
exception
  when dependent_objects_still_exist then
    raise notice 'pgjwt is in use and stays: %', sqlerrm;
end $$;

reset lock_timeout;

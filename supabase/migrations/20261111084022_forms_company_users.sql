-- The forms move to Mega Family - stage 2 (spec
-- docs/superpowers/specs/2026-11-11-forms-to-mega-family-design.md, "Stage 2").
-- Rides the same push as the code that reads forms.company_id (stage 1,
-- 20261111074850_forms_company.sql, added and tagged it).
--
-- 1. Re-tag: a form created between the two stages got the column's default (Mega
--    Events). One that matches the stage-1 rule moves to Mega Family; each is named
--    in the run's log.
-- 2. The two people who run the forms move to Mega Family (Dor 11.11):
--      nir1@megatr.co.il   (account role admin)          -> Mega Family, admin ONLY
--      daniel@megatr.co.il (account role forms_operator) -> Mega Family, forms_operator ONLY
--    Each only while its account role is still the one measured on 11.11 - a changed
--    account is skipped with a notice, never given powers by a guess. Their Mega
--    Events membership rows go (a membership row, not business data). user_profiles
--    is not touched.
--
-- Undo of part 2, should it be wanted: insert the two Mega Events rows back (role
-- forms_operator each, as they were) and delete the two Mega Family rows.
--
-- Idempotent: a second run finds nothing to re-tag and the memberships as wanted.

do $$
declare
  events_id uuid;
  family_id uuid;
  moved record;
  person record;
begin
  select id into events_id from public.companies where slug = 'mega-events';
  select id into family_id from public.companies where slug = 'mega-family';
  if events_id is null or family_id is null then
    raise exception 'forms_company_users: company mega-events or mega-family not found - nothing written';
  end if;

  -- 1. Re-tag what the stage-1 rule says is Mega Family's.
  for moved in
    update public.forms
       set company_id = family_id
     where company_id = events_id
       and (
         coalesce(operator_visible, false)
         or series_id is not null
         or lower(btrim(coalesce(created_by, ''))) in ('nir1@megatr.co.il', 'daniel@megatr.co.il')
       )
    returning id
  loop
    raise notice 'forms_company_users: form % moved to mega-family', moved.id;
  end loop;

  -- 2. The two accounts.
  for person in
    select p.id, w.email, p.role, w.want_role, w.member_role
      from (values
              ('nir1@megatr.co.il', 'admin', 'admin'),
              ('daniel@megatr.co.il', 'forms_operator', 'forms_operator')
           ) as w(email, want_role, member_role)
      left join public.user_profiles p on lower(btrim(p.email)) = w.email
  loop
    if person.id is null then
      raise notice 'forms_company_users: no account for %, skipped', person.email;
      continue;
    end if;
    if person.role is distinct from person.want_role then
      raise notice 'forms_company_users: % is now %, not %, skipped', person.email, person.role, person.want_role;
      continue;
    end if;

    insert into public.company_members (user_id, company_id, role)
    values (person.id, family_id, person.member_role)
    on conflict (user_id, company_id) do update set role = excluded.role;

    delete from public.company_members
     where user_id = person.id
       and company_id = events_id;

    raise notice 'forms_company_users: % works in mega-family (%) only', person.email, person.member_role;
  end loop;
end $$;

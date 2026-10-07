-- A company's site reads its schema (c_<slug>) through its OWN database role. Stage 1 of 2.
--
-- WHY. The site views are SECURITY DEFINER on purpose: the site sees published rows of one
-- company and nothing else, and some of what it sees is derived from tables it must never
-- read (seats left comes from bookings, flights from our inventory). Until now the door to
-- them was the public `anon` role, so Supabase's advisor raised every view as a critical
-- "Security Definer View" - and the advisor's own fix (security_invoker = on), pressed by
-- hand three times, cut the site off ("permission denied for table ...") until the next
-- tours migration re-created the views. The errors came back, and so did the fix.
--
-- The advisor looks at one thing: can `anon` or `authenticated` read the view. So the views
-- stay as they are and the door moves: each company gets a role `site_<slug>` that only its
-- site's key can use, and (stage 2, migration after the site switched keys) `anon` and
-- `authenticated` lose the schema. Anyone holding the public anon key - it ships in the main
-- site's browser bundle - can no longer read the views or call the lead / booking functions.
--
-- WHERE THE RULE LIVES. Access to a company schema is decided in ONE function,
-- secure_company_schema(), and reprovision_all_companies() runs it after every provision.
-- provision_company() is re-pasted whole into each tours migration and still carries its old
-- `grant ... to anon` lines - they are dead letters: the wrapper's secure step runs in the
-- same transaction and has the last word. ALWAYS go through reprovision_all_companies();
-- a bare provision_company('x') skips the secure step.
--
-- THIS STAGE changes nothing for anyone: it only ADDS the role and its grants. anon keeps
-- working until the site's new key is live.

create or replace function public.secure_company_schema(p_schema text)
returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  site_role text := 'site_' || substr(p_schema, 3);
  f record;
begin
  if p_schema !~ '^c_[a-z0-9_]+$' then
    raise exception 'secure_company_schema: "%" is not a company schema', p_schema;
  end if;
  if not exists (select 1 from pg_namespace where nspname = p_schema) then
    raise exception 'secure_company_schema: schema "%" does not exist - provision the company first', p_schema;
  end if;

  if not exists (select 1 from pg_roles where rolname = site_role) then
    execute format('create role %I nologin', site_role);
  end if;
  -- The API signs in as `authenticator` and switches to the role a key names.
  execute format('grant %I to authenticator', site_role);
  -- anon is cut at 3s; a site waiting on a cold read gets the same 8s a signed-in user has.
  execute format('alter role %I set statement_timeout = %L', site_role, '8s');

  execute format('grant usage on schema %I to %I, service_role', p_schema, site_role);
  execute format('grant select on all tables in schema %I to %I, service_role', p_schema, site_role);
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = p_schema
  loop
    execute format('revoke all on function %s from public', f.signature);
    execute format('grant execute on function %s to %I, service_role', f.signature, site_role);
  end loop;
end
$fn$;

-- Supabase hands every new public function to anon / authenticated. This one is for migrations.
revoke all on function public.secure_company_schema(text) from public, anon, authenticated;

comment on function public.secure_company_schema(text) is
  'Who may read a company site schema (c_<slug>): its own role site_<slug> and service_role. The ONE place that rule lives; reprovision_all_companies() runs it after every provision.';

-- Same body as before plus the secure step.
create or replace function public.reprovision_all_companies()
returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  r record;
begin
  for r in
    select slug, schema_name
    from public.companies
    where is_active and 'tours' = any (product_types)
  loop
    perform public.provision_company(r.slug);
    perform public.secure_company_schema(r.schema_name);
  end loop;
end
$fn$;

comment on function public.provision_company(text) is
  'Builds a company site schema. Do NOT call it bare: reprovision_all_companies() runs it and then secure_company_schema(), which decides who may read the schema.';

-- The views are untouched: only the grants are added.
select public.secure_company_schema(schema_name)
from public.companies
where is_active and 'tours' = any (product_types);

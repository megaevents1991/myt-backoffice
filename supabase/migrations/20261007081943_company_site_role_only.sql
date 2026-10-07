-- A company's site schema opens to its own role ONLY. Stage 2 of 2 (stage 1: 20261007080556).
--
-- The Mega Family site has been reading c_megafamily through its own key (role site_megafamily)
-- since its deploy of 2026-10-07 - checked on the live site: three calls ran 21 statements as
-- site_megafamily and none as anon. So the public door closes now: `anon` and `authenticated`
-- lose the schema, its views and its functions.
--
-- What this ends: the advisor's 19 critical "Security Definer View" errors and its four
-- "SECURITY DEFINER function callable by anon / authenticated" warnings - and with them the
-- reason anyone had to press its fix, which is what cut the site off. And what it closes for
-- real: until today anyone holding the public anon key could read these views and call
-- submit_lead() / site_booking() directly.
--
-- The function ends with a check of its own promise: a view or a function of the schema that
-- anon or authenticated can still reach fails the migration that left it so.
--
-- A site that still sends the anon key gets "permission denied for schema c_<slug>" - its
-- build keeps the content it has and its live routes answer 503. Give it its key:
-- Supabase > API keys > secret key with secret_jwt_template {"role": "site_<slug>"},
-- as CONTENT_SUPABASE_SITE_KEY in the site's environment.

create or replace function public.secure_company_schema(p_schema text)
returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  site_role text := 'site_' || substr(p_schema, 3);
  f record;
  leak text;
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

  -- The public door: closed. provision_company() still grants these on every run (its body is
  -- re-pasted from older migrations); this runs after it, in the same transaction.
  execute format('revoke all on schema %I from public, anon, authenticated', p_schema);
  execute format('revoke all on all tables in schema %I from public, anon, authenticated', p_schema);

  -- The site's door.
  execute format('grant usage on schema %I to %I, service_role', p_schema, site_role);
  execute format('grant select on all tables in schema %I to %I, service_role', p_schema, site_role);
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = p_schema
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to %I, service_role', f.signature, site_role);
  end loop;

  -- The promise, checked.
  select string_agg(x.obj, ', ' order by x.obj) into leak
  from (
    select c.relname::text as obj
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = p_schema
      and c.relkind in ('r', 'v', 'm', 'p', 'f')
      and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))
    union all
    select p.proname::text || '()'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = p_schema
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  ) x;
  if leak is not null
     or has_schema_privilege('anon', p_schema, 'usage')
     or has_schema_privilege('authenticated', p_schema, 'usage') then
    raise exception 'secure_company_schema: % is still open to anon / authenticated (%)', p_schema, coalesce(leak, 'schema usage');
  end if;
end
$fn$;

select public.secure_company_schema(schema_name)
from public.companies
where is_active and 'tours' = any (product_types);

comment on schema c_megafamily is
  'Mega Family site API. Read by role site_megafamily only (the site''s own key). Its views are SECURITY DEFINER on purpose - never set security_invoker on them: the site has no right on tours.* and would be cut off.';

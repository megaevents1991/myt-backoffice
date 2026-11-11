-- Forms belong to a company - stage 1 of the move of the forms to Mega Family
-- (spec docs/superpowers/specs/2026-11-11-forms-to-mega-family-design.md, "Stage 1").
--
-- Adds forms.company_id and tags every existing form. NOTHING reads the column yet:
-- the live code keeps treating every form as Mega Events', so this changes nothing
-- for anyone. Stage 2 (its own migration and push) moves the access rules and the
-- users once this split has been checked on prod.
--
-- form_fields / form_invites / form_responses get no column: they belong to their
-- form through form_id (on delete cascade), and every read reaches them through it.
-- No row of theirs is written here.
--
-- Rule (by what a form is, not by an id list, so a form created before this runs
-- lands right): Mega Family's when it is opened to the forms operators, hangs on a
-- tours series, or was created by one of the two accounts that move to Mega Family
-- (Nir, Daniel). Every other form is Mega Events'. Measured 11.11: Family = #5, #6,
-- #7, #8, #10; Events = #1, #2, #3, #4, #9. NOT "created by @megatr.co.il": two Mega
-- Events staff accounts carry that mail domain.
--
-- Idempotent: only rows with no company are written; a second run changes nothing.

alter table public.forms
  add column if not exists company_id uuid references public.companies(id);

comment on column public.forms.company_id is
  'The company the form belongs to (2026-11-11). Its fields, invites and answers follow it through form_id.';

do $$
declare
  events_id uuid;
  family_id uuid;
begin
  select id into events_id from public.companies where slug = 'mega-events';
  select id into family_id from public.companies where slug = 'mega-family';
  if events_id is null or family_id is null then
    raise exception 'forms_company: company mega-events or mega-family not found - nothing written';
  end if;

  update public.forms
     set company_id = family_id
   where company_id is null
     and (
       coalesce(operator_visible, false)
       or series_id is not null
       or lower(btrim(coalesce(created_by, ''))) in ('nir1@megatr.co.il', 'daniel@megatr.co.il')
     );

  update public.forms
     set company_id = events_id
   where company_id is null;

  -- A form the current code creates (it names no company) is Mega Events', as
  -- every form was until now. Stage 2 re-tags whatever was created in between.
  execute format('alter table public.forms alter column company_id set default %L::uuid', events_id);
end $$;

alter table public.forms alter column company_id set not null;

create index if not exists forms_company_id_idx on public.forms (company_id);

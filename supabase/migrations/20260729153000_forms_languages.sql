-- Per-form language choice.
--
-- 'en' / 'he' render the fill page in that language only, with no toggle and no
-- second set of tabs in the builder. 'both' renders one language at a time,
-- starting at `default_lang`, with an EN/עב toggle for the client.

alter table forms
  add column if not exists languages text not null default 'both';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'forms_languages_check'
  ) then
    alter table forms
      add constraint forms_languages_check check (languages in ('en', 'he', 'both'));
  end if;
end $$;

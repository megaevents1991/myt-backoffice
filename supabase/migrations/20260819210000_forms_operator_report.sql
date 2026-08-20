-- Mega Travel forms phase 2: operator role, scored review gate, trip codes.
-- See docs/superpowers/specs/2026-08-19-mega-forms-operator-design.md.
-- All tables here are backoffice-only - zero main-app impact.

-- Review gate: average of the flagged rating fields must reach this to offer
-- the external (Google) review link. null = 5. Which fields count lives in
-- form_fields.config.review_score, not in a column.
alter table forms
  add column if not exists review_min_avg numeric;

-- Forms a forms_operator user may see and run trip links for.
alter table forms
  add column if not exists operator_visible boolean not null default false;

-- Trip identity on the invite: free letters + number ("BBC" + "124"),
-- stored split so the trips report can filter/group by either part.
-- text (not int) keeps leading zeros.
alter table form_invites
  add column if not exists trip_code_prefix text;

alter table form_invites
  add column if not exists trip_code_num text;

-- forms_operator: confined to /forms*, may create trip links, view
-- responses/report and duplicate - never edit or publish a questionnaire.
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('superadmin','admin','editor','office_manager','agent','affiliate','forms_operator'));

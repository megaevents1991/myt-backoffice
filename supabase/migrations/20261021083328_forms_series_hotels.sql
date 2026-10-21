-- Feedback forms per series + a question per hotel (Alon, 21.10.2026).
-- Spec: docs/superpowers/specs/2026-10-21-forms-series-hotels-design.md
-- Backoffice-only tables (main never reads forms) - three nullable columns, nothing rewritten:
-- every existing form, trip link and answer reads exactly as before.

-- The series a feedback form belongs to (BBC / FPAR ... - the codes the trip links already carry).
-- null = a general form, like #5 today.
alter table public.forms
  add column if not exists series_id uuid references tours.series(id) on delete set null;

-- The departure a trip link was made for, when it was picked from the list (typing by hand
-- leaves it null).
alter table public.form_invites
  add column if not exists departure_id uuid references tours.departures(id) on delete set null;

-- What a hotel question asked about when THIS answer came in: { hotels: { "<fieldId>":
-- { city, name } } }. A series changing its hotel edits the form; older answers keep theirs.
alter table public.form_responses
  add column if not exists field_context jsonb;

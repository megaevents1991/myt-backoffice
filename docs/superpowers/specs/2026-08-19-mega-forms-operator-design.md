# Mega Travel forms: operator role, scored review gate, trip codes, trips report

**Date:** 2026-08-19 · **Status:** approved by Dor (chat) · **Scope:** backoffice only — zero main-app impact.

## Goal

One single Mega Travel feedback form (form #5). Per-trip variation lives on **trip
links** only (trip code + escort + departure). Every response of every trip lands
in one aggregated report — the Mega "annual dashboard". A restricted
`forms_operator` user runs day-to-day trip links without touching the questionnaire.

## 1. Review gate becomes a scored average

- Per-rating-field flag `config.review_score: true` — "counts toward the Google
  score". Lives in field config → survives duplication with no id remapping.
- `forms.review_min_avg numeric` — threshold (builder select 4 / 4.5 / 5;
  null = 5).
- Submit: pool = flagged rating fields (fallback: all rating fields when none
  flagged); average of the pool's **answered** values ≥ threshold → thank-you
  screen auto-redirects to `review_link_url`. Replaces the "every rating = max"
  rule (threshold 5 ≈ old behavior).

## 2. `forms_operator` role

- Added to `ROLES` (types/auth.types.ts) + `user_profiles` role CHECK (migration
  alters the constraint added by `20260819095423_office_manager_role.sql`).
- Managed from /users by admin+ (falls under existing `canManage`: not an
  admin-tier role). Created like any staff user (email+password).
- Middleware confines the role to `/forms*` (pattern copied from
  PARTNER_ROLES→/portal); their home (login redirect + `home` fallback) is
  `/forms`. Sidebar shows Forms + logout only.
- New guard `requireFormsAccess()` = staff ∪ forms_operator, used by: forms
  list/read, duplicate, trip links, invites list, responses, report.
  `requireStaff()` keeps: create form, edit fields/meta/design, status (Live),
  delete, email invites.
- `forms.operator_visible boolean default false` — operators see ONLY flagged
  forms (list + every per-form action re-checks). Duplicating copies the flag.
  Operator's duplicate lands as draft; staff publishes.
- /forms/[id]/edit is staff-only; an operator landing there is redirected to
  the form's invites page.

## 3. Trip code, split

- `form_invites.trip_code_prefix text` (free letters, stored uppercase) +
  `trip_code_num text` (digits; text keeps leading zeros). Displayed `BBC-124`.
- Trip identity lives on the INVITE, not on a questionnaire field. The generic
  "קוד טיול" staff field is removed from form #5 by the seed **iff no stored
  response carries it**; the trip ticket instead renders the code from the
  invite columns (first row), then the remaining staff fields (escort,
  departure).
- Trip-link creator (invites page): prefix + number (both required) + the
  form's staff fields. `label` is auto-derived `PREFIX-NUM` (manual trip-name
  input dropped).

## 4. Trips report — /forms/[id]/report

- Access: `requireFormsAccess` (+ operator_visible check for operators).
- Summary cards: total responses, overall average, trip count.
- Trips table: one row per trip link — code, escort, departure, responses,
  overall avg, last response; expandable per-question averages. Client-side
  filters: code prefix, code number, escort text, departure date range.
  Responses from the shared slug link group under "no trip".
- Row click → that trip's individual responses inline.
- Aggregation is pure JS in `lib/forms/report.ts` (unit-testable, no SQL
  grouping): inputs = rating fields + invites + responses; outputs = per-trip
  and total stats. Escort/departure resolved from invite prefill via staff
  field defs.
- One form = one report = the whole-brand dashboard (date filters cover
  "annual"). Cross-form merging is explicitly out of scope until a v2
  questionnaire ever exists.

## Data changes (single migration)

```sql
alter forms        add review_min_avg numeric, add operator_visible boolean not null default false;
alter form_invites add trip_code_prefix text, add trip_code_num text;
alter user_profiles drop constraint user_profiles_role_check, add check (role in (…, 'forms_operator'));
```

## Non-goals

- Cross-form report merging; operator email-sending; per-operator form
  assignment beyond the single `operator_visible` flag; changing main app.

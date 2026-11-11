# Forms move to Mega Family - design (2026-11-11)

Second version, after a challenge pass against the code and the prod data the same day (section
"What the challenge changed" lists every correction and why).

## Why

The forms engine (`/forms`, public `/f/*`) was built before the backoffice had companies, so it
belongs to Mega Events by default: every forms guard is "works in Mega Events", and the four forms
tables have no company of their own. In practice it serves Mega Family (מגה תיירות): trip feedback
for the organized tours, trip links per departure, hotels per series, escort feedback. Mega Events
and Mega Family are now separate businesses in the backoffice, so the forms and the people who run
them (Nir, Daniel) move to Mega Family and are managed there. **Every answer collected so far stays,
and every link already sent keeps working.**

## What is there today (prod, read 11.11)

- `forms`: 10 rows. Live: #5 "משוב על הטיול" (`mega-travel-feedback`, operator_visible) - 195
  answers, 20 trip links (all `multi_use`; BBC-927, FPAR-930 ...). Draft: #10 (series BA, created by
  nir1@megatr.co.il, operator_visible). Draft: #9 (empty "Untitled form", created by
  megaevents1991@gmail.com). Soft-deleted: #1-4 (Mega Events tests; #1 holds 4 answers), #6-8
  (copies of #5, operator_visible).
- **The counts that must be identical after every stage:** `forms` 10, `form_fields` 78,
  `form_invites` 20, `form_responses` 199. No personal (mailed) invite was ever sent (0 rows with
  `multi_use = false`).
- Foreign keys: fields / invites / answers hang on their form with `on delete cascade`, an answer on
  its invite with `on delete set null`. Nothing in the code hard-deletes a form (`softDeleteForm`);
  the one hard delete in the area is `deleteInvite` (see "Invite actions").
- `audit_log` has no company column - forms rows there are not touched.
- No other repo reads these tables (grep of myt-main and mega-family, 11.11).
- Who works on the forms (`audit_log`, which keeps 30 days): only Nir (form + trip link creates,
  22.10) and a superadmin (megaevents1991, 14.10). No other staff account acts on them, so no other
  membership needs to move.
- Nir holds no open task (assignee, creator or reviewer) and no task rule in any company - deleting
  his Mega Events membership strands nothing.
- Users:
  - **Nir** (`nir1@megatr.co.il`, "ניר"): `user_profiles.role = admin`, one membership - **Mega
    Events** with membership role `forms_operator` (copied there on 01.10, before his account role
    became admin). Effect today: he is a full **admin of Mega Events** (reservations, partners,
    users) and is **not a member of Mega Family** at all.
  - **Daniel** (`daniel@megatr.co.il`, "דניאל"): `role = forms_operator`, one membership - Mega
    Events (`forms_operator`).
  - Two MEGA EVENTS staff accounts also carry a megatr.co.il address (opsgrp1 = admin, opsfit1 =
    editor) - the mail domain says nothing about the company.

## Dor's decisions (11.11)

1. **Nir becomes an admin of Mega Family only.** He loses Mega Events. Membership role `admin`, so he
   is also a MANAGER on the tours board (`boardViewerOf`).
2. **Daniel moves to Mega Family, forms only** (`forms_operator`, same powers as today). His Mega
   Events membership goes.
3. **One `/forms` screen, per company.** The same screen in every company; each company sees only its
   own forms. Mega Events keeps its draft #9 and can build forms of its own later.

## Goals

- Mega Family's forms, answers, trip links, hotels, escorts and reports appear under Mega Family and
  nowhere else; Mega Events sees only its own forms.
- Nir and Daniel work in Mega Family after the deploy with no manual step, and Mega Family's own
  users screen can hold, add and switch off a forms operator ("sits under their users").
- Links already shared (`/f/<slug>`, `/f/i/<token>`) answer exactly as before.

## Non-goals

- A Mega Family domain for the public form pages - they stay on the backoffice's own domain.
- Changing the invite mail sender (`DEFAULT_FROM`, alon@mega-events.co.il). Unused by Family so far;
  a company sender is a later change.
- Moving `audit_log` rows or any Storage file (logos sit in `templates/forms/`, public URLs).
- Any change to the form builder, the report or the public form beyond scoping.

## Anti-goals (a failure even if it "works")

- A single answer, field, link or form lost, renumbered or re-slugged.
- A shared trip link that stops answering or opens another company's form.
- A Mega Events staff member (who is not a Family member) reading Family answers through any forms
  action, or a Family member reading a Mega Events form - including by calling an action directly
  with an id from the other company.
- Nir keeping any Mega Events access after the move.
- Daniel (or any forms operator) becoming staff by a side effect of a save on the users screen.

## Rollout in two stages (two pushes)

The first version put everything in one push and asked every forms query to tolerate the column being
absent. The challenge replaced that with two stages: the data is tagged and CHECKED on prod before any
access rule reads the tag, and the code needs no "column missing" branch at all.

### Stage 1 - the column only (no behaviour change)

`supabase/migrations/<timestamp>_forms_company.sql` - idempotent, by the repo's migration rules.

1. `alter table public.forms add column if not exists company_id uuid references public.companies(id);`
2. **Backfill by rule** - a row is Mega Family's when `operator_visible` OR `series_id is not null`
   OR its `created_by` is one of the two accounts that move (nir1@megatr.co.il, daniel@megatr.co.il,
   lower-cased); every other row is Mega Events'. Measured: Family = #5, #6, #7, #8, #10; Events =
   #1, #2, #3, #4, #9. Companies are looked up by slug (`mega-family`, `mega-events`); a missing
   company RAISES (never a silent null). Only rows whose `company_id` is null are written, so a
   re-run changes nothing.
3. `set default` (Mega Events' id) + `set not null` - the three-step NOT NULL rule. The default is
   what tags a form the OLD code creates between the stages.
4. `create index if not exists forms_company_id_idx on public.forms (company_id);`
5. `form_fields`, `form_invites`, `form_responses` get no column: they belong to their form through
   `form_id`, and every read reaches them through the form.

The live code ignores the column, so nothing changes for anyone. **Check on prod (read-only) before
stage 2:** the split is 5 / 5 as measured, and the four counts above are unchanged.

### Stage 2 - the code and the users (one push)

The code below, plus `supabase/migrations/<timestamp>_forms_company_users.sql`:

1. **Re-tag what was created between the stages:** a form still tagged Mega Events that matches the
   stage-1 rule moves to Mega Family (`raise notice` with each id, so the run's log names them).
2. **Memberships, by e-mail (lower-cased), each only when the account role is the one measured:**
   - nir1@megatr.co.il (`admin`) -> upsert (`user_id, company_id` is the primary key) Mega Family
     with role `admin`; delete his Mega Events row.
   - daniel@megatr.co.il (`forms_operator`) -> upsert Mega Family with role `forms_operator`; delete
     his Mega Events row.
   - `user_profiles.role` is not touched.
   - An account that is missing, or whose role changed since: `raise notice` and skip it (never a
     guess about powers); the rest still applies.

Known window: the migration (~1 min after the push) applies before Vercel finishes the build (~4 min).
In those minutes the OLD code still gates forms on "works in Mega Events": Nir (now Family-only) is
refused, Daniel is not (the old gate lets `forms_operator` through). Nothing is lost; push at a quiet
hour. If the migration fails, the new code is live with Nir and Daniel still in Mega Events: they see
Mega Events' forms only until it is fixed - again nothing lost.

Undo of the users part, should Dor want it back: re-insert the two Mega Events rows (`forms_operator`
each, as they were) and delete the two Family rows. The column never needs undoing.

Test before each push: the migration on PGlite over stub tables (as `scripts/tours-*-sql-pglite-test.mjs`
do) - the rule on rows shaped like the ten above plus an Events form created by a megatr Mega Events
account (stays Events), a second run that changes nothing, the RAISE on a missing company; for stage 2
the re-tag, the two memberships, and an account whose role changed (skipped).

## The code (stage 2)

### One guard for the forms area, company-scoped

Today: `requireFormsAccess()` / `requireStaff()` (both through `requireRole`, i.e. "works in Mega
Events") + `requireFormVisible(actor, formId)` (operator_visible only).

New (in `lib/company.ts`, next to `requireCompany`):

- `requireFormsCompany()` -> `{ session, company }`: staff pass as `requireCompany()` does (no product
  gate - both companies have forms); a `forms_operator` passes when it is active (`assertActorActive`,
  as today) and works in the active company. Partners and tours_agent are refused.
- **Which company a forms_operator works in:** its memberships; with NO membership it is a Mega Events
  account (the floor staff have - Mega Events' users screen creates accounts with no membership row,
  so "refuse with none" would lock out every operator Mega Events adds later); when the memberships
  CANNOT BE READ it is refused (fail closed - the generic `listCompaniesFor` answers Mega Events on a
  failed read, which would show a Family operator Mega Events' forms).
- `getCompanyContext()` (`lib/actions/company-actions.ts`) today answers "Mega Events alone" for every
  forms_operator - the top bar and the route gate would say Mega Events while the server works in
  Family. It answers the operator's real company (same rule as above).
- `requireFormInCompany(actor, company, formId)` replaces `requireFormVisible`: the form exists, its
  `company_id` is the active company's, and for a `forms_operator` it is `operator_visible`.
  Fail closed on a read error. A form of another company answers the same "not found" as a missing
  one.
- The staff-only actions (blank new form, delete a form, open it to operators, personal invites) keep
  their staff-only rule but go through `requireCompany()` instead of `requireStaff()`, so a Family
  admin (Nir) can do them in Family and a Mega Events-only admin cannot touch Family's forms.

**Every per-form action** calls `requireFormInCompany`. The full list (11.11): form-actions `getForm`,
`updateFormMeta`, `setFormStatus`, `saveFormFields`, `duplicateForm`, `createSeriesForm` (its base
form), `softDeleteForm`, `setFormSeries`, `setFormAudience`, `copyFieldToForms` (source AND every
target); form-invite-actions `getFormInvites`, `getTripLinkOptions`, `createAndSendInvites`,
`resendInvite`, `createTripLink`, `createInviteLink`, `setTripTotalTravelers`, `deleteInvite`,
`deleteTripLink`, `restoreTripLink`; form-response-actions `getFormResponses`, `deleteFormResponse`,
`restoreFormResponse`, `updateFormResponseAnswers`; `getFormTripReport`; the xlsx export route.

### Invite actions that trust an id (found in the challenge)

Three staff actions act on an id without checking which form it belongs to - harmless while there was
one company, a cross-company hole now:

- `resendInvite(inviteId)` and `deleteInvite(inviteId, formId)` read / delete by invite id alone:
  they first read the invite's `form_id` and check THAT form (the `formId` argument is only a path to
  revalidate).
- `deleteInvite` is the one HARD delete in the forms area, and an answer's link to its invite is
  `on delete set null` - deleting a trip link through it would drop its answers into "no trip". It is
  the personal-invite button; it refuses a `multi_use` row (a trip link goes through `deleteTripLink`,
  the soft delete that also refuses a trip with answers).
- `createInviteLink(formId, ...)` inserts for whatever `formId` it is given: it checks the form.

### Reads and writes follow the company

- Lists filter `forms.company_id = company.id`: the forms list, `/forms/hotels`, the targets of
  "copy question to forms" (same company only), the reviews picker, the escort suggestions taken from
  past links.
- Writes stamp the active company: blank new form, duplicate, `createSeriesForm` (the copy stays in
  the company it was made in).
- Series, departures and guides (`lib/services/form-series.ts`, session-free): each read takes the
  company and reads only its rows (`tours.series.company_id`, `tours.instructors.company_id`); the
  departure a trip link names is re-read inside the form's company. In Mega Events (no tours) the
  series picker is empty and the series parts of the screen do not show. The PUBLIC form does not use
  these reads (`form-response-actions.ts` never imports them), so nothing public depends on a company.
- `lib/actions/tours-form-reviews-actions.ts` (Family site > Reviews > "Pick from the feedback forms"):
  `requireCompany("tours")` and the company's own forms; the "also works in Mega Events" rule and its
  message (`FORMS_ARE_MEGA_EVENTS`) go.
- The xlsx export, `app/api/exports/form-responses/route.ts`, is guarded today by `guardAdminRoute()`
  (the Mega Events gate): `guardAdminRoute({ anyCompany: true })` + the active company +
  `requireFormInCompany`, keeping its staff-only rule.
- Public pages `/f/<slug>`, `/f/i/<token>` and the public submit: **unchanged** - they resolve the
  form by slug / token, never by company; slugs stay globally unique.
- **Logo / cover picker:** the builder's `StorageImageBrowser` (bucket `templates`, folder `forms`)
  runs on the Storage API, a Mega Events feature (`guardAdminRoute`). It shows only to someone that
  API admits (a superadmin, or Mega Events staff); everyone else keeps the stored logo and cover,
  exactly as a forms operator does today. So in Mega Family a new logo is a superadmin's job.

### Navigation and the route gate

- `/forms` loses `productType: "events"` in `lib/nav.ts` (shared by every company).
- `/forms` joins `isToursCompanyPath` (`lib/nav.ts`). Without it `components/company-route-gate.tsx`
  sends EVERY user of a tours-only company from `/forms` to `/tours` - Nir could never open the
  screen, and Daniel (confined to `/forms` by `middleware.ts`) would bounce between the two for ever.
- The `forms_operator` confinement in `middleware.ts` is unchanged.

### The users screen of a company (found in the challenge)

Mega Family's `/users` knows three roles (`COMPANY_MEMBER_ROLES`: admin, editor, tours_agent). Its
edit form sends every field, so today ANY save on Daniel there (a rename) would send a role from that
list and turn him into a Family editor - staff with the whole Family backoffice - and nobody could add
a second forms operator. So `forms_operator` becomes a company role with the tours_agent's rules:

- listed, created (a company admin may create one), renamed, password reset, switched on / off in the
  company it works in;
- turning a forms operator into staff or staff into a forms operator is a superadmin's move only (the
  rule `NOT_ACROSS_AGENT_LINE` enforces for tours_agent), and it ends the session as a role change to
  or from a non-staff role already does;
- its last membership is not removed (the existing rule for every role but tours_agent - with none it
  would become a Mega Events operator); switch the account off instead.
- Mega Events' own users screen is unchanged: it lists every account and creates a forms operator
  with no membership = a Mega Events operator.

## Users after the deploy

- **Nir**: no new sign-in needed. His first page is the Mega Events dashboard for a moment (his
  browser's home hint still says `events`), then `CompanyRouteGate` sees the company the server
  resolved (Mega Family - his only membership), sends him to `/tours` and corrects the hint. A few
  refused dashboard reads may flash once on that first load.
- **Daniel**: lands on `/forms` as today, now of Mega Family, with "מגה פמילי" in the top bar.
- **megaweb@megatr.co.il** (Family admin) gets the forms screen and the reviews picker with no change.
- **Superadmins** (Dor, Alon, Tom, Liz, megaevents1991): see Family's forms after switching the
  company to "מגה פמילי" in the top bar. Most work in Mega Events by default, so an empty `/forms`
  in Mega Events would look like lost data - see the hint below.
- **Mega Events staff** who are not Family members stop seeing form #5 and its answers. None of them
  used it in the last 30 days.

## My calls (not decided by Dor - flagged for him)

- The backfill rule (operator_visible / series / created by one of the two moving accounts = Family).
- Two stages / two pushes instead of one.
- `forms_operator` as a company role on a company's users screen, created by a company admin.
- A forms operator with no membership = Mega Events; unreadable memberships = refused.
- **Empty-company hint:** when `/forms` of the active company has no forms and the viewer can work in
  another company that has some, the screen says so in one line with a switch link ("הטפסים של מגה
  פמילי נמצאים בחברה מגה פמילי - החלף חברה").
- **A form page of the other company** (a superadmin in Mega Events opens a bookmarked
  `/forms/5/report`): when the viewer is a member of the form's company, the page says in one line
  that the form is in that company, with a switch through the existing `?company=<slug>` deep link
  (`contexts/company-context.tsx`). A viewer who is not a member gets the plain not-found, so it
  never says that a form exists in a company they cannot see. The ACTIONS keep the plain not-found.
- `deleteInvite` refuses a trip link (above).
- The logo / cover picker only for whoever the Storage API admits.
- The invite mail sender stays `DEFAULT_FROM` (no personal invite was ever sent).
- Deleting Nir's and Daniel's Mega Events membership rows is a hard delete of a membership row (not
  of business data) - the same thing /users does when a membership is removed.

## Verification

- Pure rules in one pure module with a selftest (`scripts/forms-company-selftest.ts`): who may see /
  act on which form (role, company, operator_visible), which company a forms operator works in (none
  / some / unreadable), the users-screen rules for the new company role. The existing forms selftests
  stay green.
- PGlite tests of both migrations (above).
- `tsc --noEmit` clean on the touched files; `npx tsx scripts/guide-selftest.ts`.
- After stage 1, read-only on prod: split 5 / 5, counts 10 / 78 / 20 / 199.
- After stage 2, read-only on prod: the same counts; Nir = one membership (Family, admin), Daniel =
  one (Family, forms_operator); `/f/mega-travel-feedback` answers and one trip link `/f/i/<token>`
  opens.
- In the browser as a superadmin: Mega Events `/forms` shows #9 + the hint; Mega Family `/forms`
  shows #5 and #10 with their answers, report, hotels and trip links; Family's `/users` lists Daniel
  as a forms operator and a rename leaves his role alone.

## Docs in the same change

- `CLAUDE.md` "Dynamic Forms": the forms are per company (`forms.company_id`), the new guards, the
  two migrations' rules, the company role; drop the wording that says the forms are Mega Events'.
- `/guide` forms section (`app/(dashboard)/guide/guide-content.ts`): forms live under each company.
- The header comments of `lib/services/form-series.ts`, `tours-form-reviews-actions.ts`,
  `worksInMegaEvents` and `getCompanyContext` that say a forms_operator is a Mega Events account.
- `scripts/seed-mega-travel-form.mjs` (a one-off seed of form #5): a note that the form is Family's.

## What the challenge changed (11.11, second pass)

1. **Users screen** - Family's `/users` has no forms_operator role; a rename of Daniel there would
   have made him a Family editor. Added "The users screen of a company".
2. **Route gate** - not only Daniel: every Family user would have been bounced off `/forms`; and
   `getCompanyContext` hard-codes Mega Events for a forms operator.
3. **No membership** - the first version refused a forms operator with no membership; Mega Events
   creates its operators with none. Now: none = Mega Events, unreadable = refused.
4. **Invite actions** - `resendInvite`, `deleteInvite`, `createInviteLink` act on an id with no form
   check; `deleteInvite` is a hard delete that would orphan a trip's answers.
5. **Backfill rule** - "created by @megatr.co.il" was wrong: two Mega Events staff accounts carry
   that domain. Now: created by one of the two accounts that move.
6. **Rollout** - two stages, so the tag is checked on prod before any rule reads it, and ~15
   "column missing" branches are not written at all.
7. **Logo picker** - the Storage API is Mega Events-gated; a Family admin cannot upload a logo.
8. Checked and left as they were: the foreign keys (nothing can cascade away an answer), the public
   form path (never reads a company), Nir's landing (the gate corrects his stale hint - no new
   sign-in), no other reader of the tables, no open tasks of Nir's.

## Left to the builder

- File names, the exact shape of the guards, whether `requireFormVisible` is removed or kept as a thin
  wrapper.
- The wording of the two hints.

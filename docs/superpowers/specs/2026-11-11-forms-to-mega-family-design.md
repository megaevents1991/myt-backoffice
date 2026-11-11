# Forms move to Mega Family - design (2026-11-11)

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
- `form_fields` 78, `form_invites` 20, `form_responses` 199. **No personal (mailed) invite was ever
  sent** (0 rows with `multi_use = false`).
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
- Nir and Daniel work in Mega Family after the deploy with no gap and no manual step.
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

## The migration (one file, rides the push to master)

`supabase/migrations/<timestamp>_forms_company.sql` - idempotent, by the repo's migration rules.

1. `alter table public.forms add column if not exists company_id uuid references public.companies(id);`
2. **Backfill by rule, not by id list** (a form created between this design and the apply lands right):
   a row is Mega Family's when `operator_visible` OR `series_id is not null` OR `created_by ilike
   '%@megatr.co.il'`; every other row is Mega Events'. Measured: Family = #5, #6, #7, #8, #10;
   Events = #1, #2, #3, #4, #9. Companies are looked up by slug (`mega-family`, `mega-events`); a
   missing company RAISES (never a silent null). Only rows whose `company_id` is null are written, so
   a re-run changes nothing.
3. Then `set default` (Mega Events' id) + `set not null` - the three-step NOT NULL rule.
4. `create index if not exists forms_company_id_idx on public.forms (company_id);`
5. **Memberships, by e-mail (lower-cased):**
   - nir1@megatr.co.il -> upsert (`user_id, company_id` is the primary key) Mega Family with role
     `admin`; delete his Mega Events row.
   - daniel@megatr.co.il -> upsert Mega Family with role `forms_operator`; delete his Mega Events row.
   - `user_profiles.role` is not touched (Nir stays `admin`, Daniel `forms_operator`).
   - An account that is not found: `raise notice` and go on (the forms part must still apply).
6. `form_fields`, `form_invites`, `form_responses` get no column: they belong to their form through
   `form_id`, and every read reaches them through the form.

Because the column AND the memberships change in the same transaction, there is no state where the
forms are Family's but Nir and Daniel are not Family members (or the other way round).

Test before the push: run it on PGlite over stub tables (as `scripts/tours-*-sql-pglite-test.mjs`
do) - the backfill rule on rows shaped like the ten above, the memberships, a second run that changes
nothing, and the RAISE on a missing company.

## The code

### One guard for the forms area, company-scoped

Today: `requireFormsAccess()` / `requireStaff()` (both through `requireRole`, i.e. "works in Mega
Events") + `requireFormVisible(actor, formId)` (operator_visible only).

New (in `lib/company.ts`, next to `requireCompany`):

- `requireFormsCompany()` -> `{ session, company }`: staff pass as `requireCompany()` does (no product
  gate - both companies have forms); a `forms_operator` passes when it is active (`assertActorActive`,
  as today) and the active company comes from its own memberships (`getActiveCompany`). A
  forms_operator with no membership is refused (fail closed - unlike staff, it has no Mega Events
  floor any more). Partners and tours_agent are refused.
- `requireFormInCompany(actor, company, formId)` replaces `requireFormVisible`: the form exists, its
  `company_id` is the active company's, and for a `forms_operator` it is `operator_visible`.
  Fail closed on a read error. A form of another company answers the same "not found" as a missing
  one.
- The staff-only actions (blank new form, delete a form, open it to operators, personal invites) keep
  their staff-only rule but go through `requireCompany()` instead of `requireStaff()`, so a Family
  admin (Nir) can do them in Family and a Mega Events-only admin cannot touch Family's forms.

**Every per-form action** calls `requireFormInCompany` - including those that arrive with a CHILD id
(response id, invite / trip link id, field id): they read the child's `form_id` first, then check the
form. The builder lists every such action; none may be left on the old guards.

### Reads and writes follow the company

- Lists filter `forms.company_id = company.id`: the forms list, `/forms/hotels`, the targets of
  "copy question to forms" (same company only), the reviews picker.
- Writes stamp the active company: blank new form, duplicate, `createSeriesForm` (the copy stays in
  the company it was made in).
- Series and departures (`lib/services/form-series.ts`) and the escort suggestions
  (`tours.instructors`) read only the active company's rows (`tours.series.company_id`,
  `tours.instructors.company_id`). In Mega Events (no tours) the series picker is empty and the
  series parts of the screen do not show.
- `lib/actions/tours-form-reviews-actions.ts` (Family site > Reviews > "Pick from the feedback forms"):
  `requireCompany("tours")` and the company's own forms; the "also works in Mega Events" rule and its
  message (`FORMS_ARE_MEGA_EVENTS`) go.
- Public pages `/f/<slug>`, `/f/i/<token>` and the public submit: **unchanged** - they resolve the
  form by slug / token, never by company; slugs stay globally unique.
- The xlsx export, `app/api/exports/form-responses/route.ts`, is guarded today by `guardAdminRoute()`
  (the Mega Events gate): it moves to the company guard + `requireFormInCompany`, keeping its current
  role rule.
- Navigation: `/forms` loses `productType: "events"` in `lib/nav.ts` (shared by every company), AND
  joins `isToursCompanyPath` (`lib/nav.ts`). Without that, `components/company-route-gate.tsx` sends a
  tours-only company away from `/forms` while `middleware.ts` confines a `forms_operator` to it - an
  endless redirect for Daniel. The `forms_operator` confinement in `middleware.ts` is unchanged.

### Before the migration is applied

If the code reaches prod before the migration (42703 / PGRST204 on `company_id`), the forms area
behaves exactly as today: every form is Mega Events', and Mega Family's `/forms` is empty. The repo's
optional-column pattern (`liveRowsQuery` in `lib/forms/soft-delete.ts`) is the model. Since the
memberships move in the same migration, "before" is wholly the old world and "after" wholly the new.

Known window: the migration (~1 min after the push) applies before Vercel finishes the build (~4 min).
In those minutes the OLD code still gates forms on "works in Mega Events": Nir (now Family-only) is
refused, Daniel is not (the old gate lets `forms_operator` through). Acceptable; nothing is lost.

## Users after the deploy

- **Nir**: his browser may still carry the `events` home hint and a `mega-events` active-company
  cookie. The builder checks what he lands on (`components/company-route-gate.tsx`, the login route's
  hint) and makes sure it is Mega Family's home, not a Mega Events dashboard full of refused actions;
  if a cookie can only be fixed by a new sign-in, that goes in the rollout note for Dor.
- **Daniel**: lands on `/forms` as today; his active company resolves to Mega Family (his only
  membership).
- **Superadmins** (Dor, Alon, Tom, Liz, megaevents1991): see Family's forms after switching the
  company to "מגה פמילי" in the top bar. Most work in Mega Events by default, so an empty `/forms`
  in Mega Events would look like lost data - see the hint below.

## My calls (not decided by Dor - flagged for him)

- The backfill rule above (operator_visible / series / a megatr creator = Family).
- **Empty-company hint:** when `/forms` of the active company has no forms and the viewer can work in
  another company that has some, the screen says so in one line with a switch link ("הטפסים של מגה
  פמילי נמצאים בחברה מגה פמילי - החלף חברה"). Cheap, and it stops "the forms are gone!" on the day
  after.
- **A form page of the other company** (a superadmin in Mega Events opens a bookmarked
  `/forms/5/report`): when the viewer is a member of the form's company, the page says in one line
  that the form is in that company, with a switch through the existing `?company=<slug>` deep link
  (`contexts/company-context.tsx`). A viewer who is not a member gets the plain not-found, so it
  never says that a form exists in a company they cannot see. The ACTIONS keep the plain not-found.
- The invite mail sender stays `DEFAULT_FROM` (no personal invite was ever sent).
- Deleting Nir's and Daniel's Mega Events membership rows is a hard delete of a membership row (not
  of business data) - the same thing /users does when a membership is removed.

## Verification

- Pure rule (who may see / act on which form, by role, company, operator_visible) in a pure module
  with a selftest (`scripts/forms-company-selftest.ts`), next to the existing forms selftests, which
  must stay green.
- PGlite test of the migration (above).
- `tsc --noEmit` clean on the touched files.
- After the apply, read-only on prod: forms split 5 / 5 as measured; Nir = one membership (Family,
  admin), Daniel = one (Family, forms_operator); #5 still answers on `/f/mega-travel-feedback` and
  one trip link `/f/i/<token>` opens.
- In the browser as a superadmin: Mega Events `/forms` shows #9 + the hint; Mega Family `/forms`
  shows #5 and #10 with their answers, report, hotels and trip links.

## Docs in the same change

- `CLAUDE.md` "Dynamic Forms": the forms are per company (`forms.company_id`), the new guards, the
  migration's rule; drop "Backoffice-only... Mega Events" wording where it says so.
- `/guide` forms section (`app/(dashboard)/guide/guide-content.ts`): forms live under each company;
  `npx tsx scripts/guide-selftest.ts`.
- The header comments of `lib/services/form-series.ts` and `tours-form-reviews-actions.ts` that say
  "the forms are Mega Events data".

## Left to the builder

- File names, the exact shape of the guards, whether `requireFormVisible` is removed or kept as a thin
  wrapper.
- How the pre-migration fallback is wired, as long as it matches "exactly as today".
- The wording of the empty-company hint.

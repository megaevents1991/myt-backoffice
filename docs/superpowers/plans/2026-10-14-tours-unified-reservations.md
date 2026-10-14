# Tours: one table for leads and reservations - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Reservations screen (+ a full case page) for a tours company that holds every site lead, site booking and staff-entered reservation as one row per customer case, with editable statuses, an automatic TASK, a booking link carrying the room composition, automatic lead -> reservation conversion, and UTM captured on the site.

**Architecture:** `public.leads` becomes the case (additive migration: new columns, a fill trigger, a status table, a booking-status trigger, `tours.booking_create` / `booking_finish_payment` redefined). Pure rules live in `lib/tours/cases.ts` (selftested); one actions file serves the screen and the case page; the site (`mega-family`, separate repo + worktree) captures attribution and pre-fills the funnel from the link.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, shadcn/ui, Supabase (Postgres, PostgREST via service role), `tsx` selftests.

**Spec:** `docs/superpowers/specs/2026-10-14-tours-unified-reservations-design.md`

**Worktrees:**
- backoffice: `myt-backoffice/.claude/worktrees/tours-unified-reservations` (branch `feat/tours-unified-reservations`, off `origin/master` d30af32)
- site: `mega-family/.claude/worktrees/booking-link-utm` (branch `feat/booking-link-utm`, off `origin/main` 365e9ee)
Both have `node_modules` junctions to the main checkout and a copied `.env.local`.

## Global Constraints

- Migration is ADDITIVE ONLY; idempotent (`if not exists`, `create or replace`); a NOT NULL column is added nullable -> backfilled -> `set not null`; no CHECK constraint on `public.leads` (site functions write it).
- Every server action: `requireCompany("tours")`, company id on every query, explicit columns, `ActionResult` answers (never throw to the client), audited with `logAudit` + `companyAudit(company)`.
- Never take a price from the browser; the booking link carries composition keys only.
- Soft delete only (`is_deleted` = date). No hard delete of a case.
- A screen loads with ONE server action on mount (repo rule).
- Status / task labels are Hebrew (ops vocabulary of the doc); screen chrome is English like the rest of the tours backoffice.
- The site's lead token query param is `lr` (never `ref` - `/booking/done` reads `ref` as the booking number).
- Deploy order free in both directions; nothing is pushed without Dor's "push".
- No AI co-author line in commits (Dor's global rule overrides the harness reminder).

## Review Focus

1. A customer who books twice from the same booking link (token) - both bookings must attach to the one case, never open a second case. (Task 2 dry run step.)
2. A phone typed with spaces / +972 / leading 0 on one side and plain digits on the other must still match the lead (phone key = last 9 digits). (Task 1 selftest.)
3. A card booking that gets paid must end with case status `paid` (not `done`) so "שליחת אישור" shows - `booking_finish_payment` used to force `done`. (Task 2 dry run step.)
4. Staff removing / renaming statuses: a status in use or a system status can never disappear; a renamed status keeps its key so existing rows keep it. (Task 1 selftest.)
5. A link opened for a date that has since sold out / a composition the date no longer prices - the funnel must fall back (default room, first open date), never crash or price an unknown key. (Task 8 selftest + build.)

---

## File map

Backoffice (worktree root):

| File | Responsibility |
|---|---|
| `lib/tours/cases.ts` (new) | pure rules + shared types of a case |
| `scripts/tours-cases-selftest.ts` (new) | selftest of the above |
| `supabase/migrations/20261014220000_tours_unified_cases.sql` (new) | schema, triggers, statuses, `booking_create` / `booking_finish_payment` |
| `scripts/tours-cases-sql-dryrun.mjs` (new) | runs the migration + checks inside BEGIN/ROLLBACK on prod via the management API |
| `types/database.types.ts` | hand-patched: `leads` columns, `lead_statuses` |
| `lib/actions/tours-cases-actions.ts` (new) | list / get / update / bulk / create / delete / statuses / link / export |
| `lib/actions/tours-reservation-actions.ts` | a sales row on a case turns it into a reservation (no more "done") |
| `lib/actions/tours-bookings-actions.ts` | `listBookings` removed; `updateBooking` stops writing the lead status; exports `bookingRowOf` for the case page |
| `lib/actions/tours-leads-actions.ts` | deleted (moved into cases actions) |
| `components/tours/cases/case-ui.tsx` (new) | `StatusTag`, `TypeBadge`, `TaskBadge`, `RepSelect`, `StatusSelect` - shared bits |
| `components/tours/cases/cases-screen.tsx` (new) | the table screen |
| `components/tours/cases/new-case-dialog.tsx` (new) | "+ New" |
| `components/tours/cases/statuses-dialog.tsx` (new) | status list editor |
| `components/tours/cases/case-page.tsx` (new) | the case page (header + cards) |
| `components/tours/cases/booking-card.tsx` (new) | one site booking inside the case (moved from bookings-screen `BookingDetails`) |
| `components/tours/cases/booking-link-card.tsx` (new) | the booking link builder |
| `components/tours/bookings/bookings-screen.tsx`, `components/tours/content/leads-inbox.tsx` | deleted |
| `app/(dashboard)/tours/reservations/page.tsx` | renders `CasesScreen` |
| `app/(dashboard)/tours/reservations/[id]/page.tsx` (new) | renders `CasePage` |
| `app/(dashboard)/tours/bookings/page.tsx`, `app/(dashboard)/tours/leads/page.tsx` | `redirect()` |
| `lib/nav.ts` | Online Bookings + Leads leave the menu |
| `components/tours/dashboard/tours-dashboard.tsx` | "New Leads" card -> `/tours/reservations?view=leads` |
| `app/(dashboard)/guide/guide-content-tours.ts`, `guide-model.ts` | guide sections |
| `CLAUDE.md` | a section for the feature |

Site (`mega-family` worktree root):

| File | Responsibility |
|---|---|
| `lib/attribution.ts` (new) | pure parse + browser capture of UTM / landing / referrer |
| `lib/link-prefill.ts` (new) | pure parse of `rooms` / `lr` + pick rooms the date prices |
| `scripts/attribution-selftest.ts` (new) | selftest of both |
| `components/shared/AttributionCapture.tsx` (new) | client island in `app/layout.tsx` that records the touch on every page |
| `lib/leads-client.ts`, `app/api/leads/route.ts`, `lib/server/leads.ts` | utm on every form |
| `lib/booking-shared.ts`, `components/package/booking-client.ts`, `app/api/booking/request/route.ts` | utm + `lead_ref` on every booking |
| `components/package/v2/TourFunnel.tsx`, `components/package/PackageFunnel.tsx` | read `rooms` / `lr`, keep params on date change |
| `CLAUDE.md` | note |

---

### Task 1: Pure case rules + selftest

**Files:**
- Create: `lib/tours/cases.ts`
- Test: `scripts/tours-cases-selftest.ts`

**Interfaces:**
- Consumes: `matchesSearch(query, ...fields)` from `@/lib/search`.
- Produces (used by every later backoffice task):
  - `CASE_TYPES`, `CaseType`, `CASE_TYPE_LABELS`, `isCaseType`, `typeOfKind(kind): CaseType`
  - `CASE_SOURCES`, `CaseSource`, `CASE_SOURCE_LABELS`, `isCaseSource`, `sourceLabel(source, utm): string`
  - `STATUS_COLORS`, `StatusColor`, `STATUS_COLOR_CLASSES`, `CaseStatus`, `DEFAULT_STATUSES`, `SYSTEM_STATUS_KEYS`, `statusOf`, `isClosedStatus`, `StatusDraft`, `validateStatuses(drafts, current)`
  - `CASE_TASKS`, `CaseTask`, `CASE_TASK_LABELS`, `isCaseTask`, `TaskFacts`, `caseTask(facts, statuses, today): CaseTask | null`, `followUpDue(c, statuses, today)`
  - `phoneKey(phone): string`, `splitName(name)`, `productIdOf(path)`, `packageSlugOf(path)`
  - `LINK_ROOMS_MAX`, `TOKEN_PATTERN`, `cleanRoomKeys(keys, offered)`, `packagePathOf(slug, dataPath)`, `bookingLink(args)`, `whatsappPhone(phone)`, `waLink(phone, text)`, `linkMessage(firstName, tourName, url)`
  - `CaseRow`, `caseName(row)`, `caseMatches(row, q)`

- [ ] **Step 1: Write the failing selftest** `scripts/tours-cases-selftest.ts` - assertions (all from the spec):
  - TYPE: notify / waitlist / newsletter -> potential; booking / advisor -> reservation; lead / contact / manual -> lead.
  - TASK: new lead -> `new_lead`; new reservation -> `new_order`; new contact / cancellation -> `service_call`; new potential -> null; `payment_review` beats a due follow-up -> `payment_check`; follow-up today -> `follow_up`, tomorrow -> null; `pending_payment` / `payment_failed` -> `payment_chase`; `paid` + confirmation pending -> `send_confirmation`, not pending -> null; closed + due follow-up -> null; override `follow_up` on a closed case -> `follow_up`; unknown override ignored; unknown status open; `spam` closed with an empty list.
  - `phoneKey`: "054-123 4567", "+972 54 123 4567", "00972541234567" all -> "541234567"; "12345" -> ""; null -> "".
  - `splitName("  דנה   כהן לוי ")` -> `{ first: "דנה", last: "כהן לוי" }`.
  - `productIdOf("/package/x/?a=1&product_id=77&b=2")` -> 77; `packageSlugOf` decodes Hebrew, keeps a broken escape raw, null off `/package/`.
  - `sourceLabel("site", {})` -> "Website"; with `{source:"facebook", medium:"paid"}` -> "facebook / paid".
  - `validateStatuses`: adding one -> `custom_1`; next after `custom_4` -> `custom_5`; dropping a status -> error; switching off a system status -> error; closing a system status is ignored (keeps its flag); duplicate label -> error; unknown colour -> error; rename keeps the key.
  - link: `cleanRoomKeys` drops unknown keys and caps at 9; `packagePathOf` encodes the slug, trusts only a `/...` data path; `bookingLink` = `https://megafamily.co.il/package/x/?product_id=100234&rooms=double_room%2Ccouple_kid&lr=<token>`; `whatsappPhone("054-1234567")` -> "972541234567"; `waLink` encodes the text; too-short -> null.
- [ ] **Step 2: Run it - expect FAIL** (`npx tsx scripts/tours-cases-selftest.ts` -> cannot find module).
- [ ] **Step 3: Write `lib/tours/cases.ts`** implementing exactly the interface above (spec sections 3.3, 4, 5, 6).
- [ ] **Step 4: Run - expect `tours-cases selftest: ok`**. Fix the module, never the assertions.
- [ ] **Step 5: Commit** `feat(tours): case rules - TYPE, TASK, statuses, phone key, booking link (pure + selftest)`.

---

### Task 2: Migration + dry run on production (rolled back) + types

**Files:**
- Create: `supabase/migrations/20261014220000_tours_unified_cases.sql`, `scripts/tours-cases-sql-dryrun.mjs`
- Modify: `types/database.types.ts`

**Produces (DB):** `public.leads` columns `case_no, type, first_name, last_name, id_number, acc_num, departure_id, package_id, source, task_override, link_token, link_sent_at, is_deleted, updated_at`; `public.lead_statuses(company_id, key, label, color, position, is_closed, is_system, is_active)` seeded for every tours company; `public.clean_utm(jsonb)`, `public.url_decode(text)`, `public.lead_status_closed(uuid, text)`; BEFORE INSERT trigger `leads_fill` (TYPE from kind, names split, departure from `?product_id=`, package from the departure / `payload.slug` / decoded `/package/<slug>/`, utm cleaned); AFTER UPDATE OF status trigger `bookings_status_to_case` (pending_payment / failed->payment_failed / review->payment_review / paid); `tours.booking_create` = the 20261003 body + case lookup (token, else phone key / e-mail on an open lead/potential of the last 90 days with no booking) + attach-or-insert with utm; `tours.booking_finish_payment` = the 20261003 body without forcing the lead to `done`. Backfill: case_no in creation order from 1001 (sequence set after), TYPE by kind, names split, source 'site', `updated_at = created_at`, a `done` lead whose booking is paid -> `paid`. `case_no` default + not null, `type` not null, `source` default 'site' not null. Indexes: case_no unique, link_token unique partial, (company,type), (company,assigned_to), (company,departure_id) partial, phone key expression. RLS on `lead_statuses`, revoke anon/authenticated, grant service_role. Helper functions revoke from public.

- [ ] **Step 1:** write the migration.
- [ ] **Step 2:** write the dry-run script: ONE management-API query `begin; <migration>; create temp table _dry(step text, result jsonb); <checks inserting into _dry>; select step, result from _dry order by step; rollback;` (the API returns the last SELECT's rows only, hence the temp table). Checks: (a) a site lead insert with a real published `?product_id=` path, phone "054-000 1111", utm with an unknown key -> type lead, names split, departure + package found, utm cleaned; (b) `booking_create('request', same phone digits)` -> still one case, type reservation, status new, 1 booking; (c) set `link_token`, `booking_create` with `lead_ref` and ANOTHER phone -> still one case, 2 bookings (Review Focus 1); (d) booking -> `paid` -> case `paid` (Review Focus 3); (e) a `notify` lead -> potential.
- [ ] **Step 3:** run it; every check must hold; then a read-only query confirms prod has no `case_no` column (nothing stayed).
- [ ] **Step 4:** hand-patch `types/database.types.ts` (`leads` Row/Insert/Update, new `lead_statuses`).
- [ ] **Step 5:** `npx tsc --noEmit -p .` (no new errors), commit `feat(tours): migration - public.leads is the case ...`.

---

### Task 3: Server actions

**Files:** Create `lib/actions/tours-cases-actions.ts`; modify `lib/actions/tours-reservation-actions.ts`, `lib/actions/tours-bookings-actions.ts`, `lib/tours/cases.ts` (shared result types); delete `lib/actions/tours-leads-actions.ts`.

**Produces:**

```ts
// lib/tours/cases.ts additions
export interface CaseRep { id: string; name: string }
export interface CasesPage { rows: CaseRow[]; truncated: boolean; statuses: CaseStatus[]; reps: CaseRep[]; currentUserId: string }
export interface CaseChange { status?: string; assignedTo?: string | null; followUpDate?: string | null; notes?: string; accNum?: string | null; idNumber?: string | null; firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null; type?: CaseType; taskOverride?: string | null; departureId?: string | null; source?: CaseSource }
export interface NewCaseInput { type: CaseType; firstName: string; lastName?: string | null; phone?: string | null; email?: string | null; idNumber?: string | null; source: CaseSource; departureId?: string | null; travelers?: number | null; assignedTo?: string | null; notes?: string | null; followUpDate?: string | null }
export interface CaseHistoryItem { at: string; actor: string | null; action: string; changes: Record<string, unknown> }
export interface CaseDetail { row: CaseRow; payload: Record<string, unknown>; bookings: BookingRow[]; sales: ToursReservationRow[]; departure: {...} | null; pkg: { id; name; path; cancellationHtml } | null; gifts: { label: string; validUntil: string | null }[]; history: CaseHistoryItem[]; statuses; reps; currentUserId; siteUrl: string | null; linkSentAt: string | null }
export interface LinkDeparture { id; code; startDate; tourName; siteId: number; packagePath: string; rooms: { key: string; title: string }[] }
export interface BookingLinkResult { url: string; whatsapp: string | null; mailto: string | null; message: string }

// lib/actions/tours-cases-actions.ts
listCases(): Promise<ActionResult<CasesPage>>
getCase(id): Promise<ActionResult<CaseDetail>>
updateCase(id, change: CaseChange): Promise<ActionResult<CaseRow>>
bulkUpdateCases(ids, change: { status?: string; assignedTo?: string | null }): Promise<ActionResult<{ updated: number }>>
createCase(input: NewCaseInput): Promise<ActionResult<{ id: string }>>
deleteCase(id): Promise<ActionResult>
saveCaseStatuses(drafts: StatusDraft[]): Promise<ActionResult<CaseStatus[]>>
listLinkDepartures(): Promise<ActionResult<LinkDeparture[]>>
mintBookingLink(caseId, input: { departureId: string; rooms: string[] }): Promise<ActionResult<BookingLinkResult>>
exportCases(ids: string[]): Promise<ActionResult<{ fileName: string; base64: string; rows: number }>>
```

Rules: explicit `CASE_COLUMNS`; every read company-scoped and `is_deleted is null`; statuses from `lead_statuses` (empty -> `DEFAULT_STATUSES`); reps = `taskPeopleOf`; `enrich` joins departures / packages / newest booking / sales pax in chunks of 100; `listCases` reads rows, statuses and reps side by side; `updateCase` validates every field (status active in the list or unchanged; rep in reps; day `yyyy-mm-dd`; notes <= 4000 audited as lengths; ACC <= 40; national id `^\d{5,9}$`; names <= 80 and also rewrite `name`; e-mail regex; type / task / source via the guards; departure company-scoped) and audits `tours_case` field by field; `bulkUpdateCases` 1..500 ids, chunked update, one audit row per case; `createCase` kind `manual`, first name + (phone or e-mail) required, a reservation needs a departure + 1..500 travelers and writes the sales row; `deleteCase` soft, refused while a paid booking hangs on the case; `saveCaseStatuses` = `validateStatuses` then upsert with `position`; `listLinkDepartures` = published future departures with the rooms their price matrix prices (`roomPrice`, `toPriceMatrix`, `ROOM_COMPOSITIONS` from `lib/tours/pricing.ts`); `mintBookingLink` validates rooms (`cleanRoomKeys`, 1..9), needs `company.siteUrl`, keeps / mints the token (`randomBytes(24).toString("base64url")`), stamps `link_sent_at`, sets the case departure when empty, audits `link`; `exportCases` = xlsx of the given ids in the doc's column order.

Also: `createToursReservation` turns the case into `type: "reservation"` instead of marking it `done`; `updateBooking` no longer writes the lead (the trigger does) and revalidates `/tours/reservations`; `tours-bookings-actions.ts` exports `bookingRowOf` + `departuresOf`, drops `listBookings`.

- [ ] Step 1: write; Step 2: `npx tsc --noEmit -p .`; Step 3: commit `feat(tours): cases actions ...`.

---

### Task 4: The Reservations screen

**Files:** create `components/tours/cases/{case-ui,cases-screen,new-case-dialog,statuses-dialog}.tsx`; modify the three tours route pages, `lib/nav.ts`, `components/tours/dashboard/tours-dashboard.tsx`, `app/(dashboard)/guide/guide-model.ts`; delete `bookings-screen.tsx`, `leads-inbox.tsx`.

- `case-ui.tsx`: `StatusTag`, `TypeBadge`, `TaskBadge` (✎ when overridden), `StatusSelect` (active statuses + the current one), `RepSelect` ("Unassigned", "(me)").
- `cases-screen.tsx`: one `useActionData(listCases)`; view in the URL (`useUrlState("view")`: all / reservations / leads / potential / mine / follow_up / unassigned); filters + search in `useSessionState`; `DataTable` dense, 50 a page, sort `caseNo` desc, row selection + bulk (status, rep), row click -> `/tours/reservations/<id>`; columns in the doc's order: ID · First name · Last name · Phone · Rep (inline) · Email · ACC NUM (inline Input, blur) · Notes (inline Input, blur, tooltip) · Product · Status (inline) · Source · Follow-up (inline date, red when due) · Departure · TYPE · TASK · Created; inline controls stop the row click; header: Refresh, Export, Statuses, + New.
- `new-case-dialog.tsx`: Type, names, phone, e-mail, national id, source, departure (from `listReservationDepartures`, required for a reservation), travelers, rep, follow-up, notes -> `createCase`.
- `statuses-dialog.tsx`: rows with label / colour / Closed / On / up-down, "+ Add status", Save -> `saveCaseStatuses`.
- routes: reservations page renders `CasesScreen` under Suspense; bookings / leads pages `redirect()` to `?view=reservations` / `?view=leads`; nav loses both items (coordinate with the navbar session); dashboard card -> `?view=leads`.
- [ ] tsc, commit `feat(tours): one Reservations screen for leads and bookings ...`.

---

### Task 5: The case page

**Files:** create `app/(dashboard)/tours/reservations/[id]/page.tsx`, `components/tours/cases/{case-page,booking-card,booking-link-card}.tsx`.

- Route awaits `params` (Next 15).
- `case-page.tsx`: one `useActionData(getCase)`; header (# case no, name, TYPE select, status, rep, TASK override, follow-up); main column: Customer (inline-edit names / phone / e-mail / national id / ACC), Order (`BookingCard` per booking), Seats (`ToursReservationsTable` + Add travelers via `ReservationDialog` prefilled with `leadId` = case id), Cancellation terms (`pkg.cancellationHtml`), History; side column: Product (+ "Open on the site"), Gift, Source (UTM, landing, referrer, form page, other form fields), Booking link (`BookingLinkCard`), Notes, Delete.
- `booking-card.tsx`: the old `BookingDetails` (notices, booking status with `statusChoices`, receipt, confirmation, price lines, payment, passengers) calling `updateBooking`, then a quiet reload of the case.
- `booking-link-card.tsx`: loads departures only when "Build a link" is clicked; departure select; a counter per offered room (1..9 total); Create -> `mintBookingLink`; URL + Copy / WhatsApp / E-mail; "Last sent".
- [ ] tsc, commit `feat(tours): the case page ...`.

---

### Task 6: Guide + CLAUDE.md

- [ ] `guide-content-tours.ts`: one Reservations section replaces the Online Bookings and Leads sections (row = customer, TYPE, TASK, views, inline edits, case page, booking link how-to, statuses, automatic conversion); every `/tours/leads` / `/tours/bookings` link re-pointed. `npx tsx scripts/guide-selftest.ts` PASS.
- [ ] `CLAUDE.md`: a block for the feature. Commit `docs(tours): guide + CLAUDE.md - one Reservations table`.

---

### Task 7: Site - attribution on every form and booking

**Files (mega-family worktree):** create `lib/attribution.ts`, `components/shared/AttributionCapture.tsx`, `scripts/attribution-selftest.ts`; modify `app/layout.tsx`, `lib/leads-client.ts`, `app/api/leads/route.ts`, `lib/server/leads.ts`, `lib/booking-shared.ts`, `components/package/booking-client.ts`, `app/api/booking/request/route.ts`.

- `Attribution` = optional strings `source, medium, campaign, term, content, gclid, fbclid, landing, referrer, at`; `touchFromUrl(href, referrer, ownHost, now)` (null when no utm / click id and no external referrer); `cleanAttribution(value)` (whitelist, strings, 300 chars); browser `recordTouch()` / `currentAttribution()` (localStorage `mf-attr` 30 days, sessionStorage when `mf-cookie === "reject"`; a touch with utm / click id replaces; a session's first landing with nothing stored records landing + referrer).
- Selftest first (utm + gclid parsed, 300-char cut, unknown keys dropped, own-host referrer dropped, none -> null).
- Wire: forms send `utm`, route cleans it, `storeLead` sends `p_utm`; `BookingDraft.utm` + `leadRef` -> `draftArgs` `utm` / `lead_ref`; `isDraft` checks their shape; request fallback lead carries utm.
- [ ] selftest, `npm run typecheck`, commit `feat(site): capture UTM ... send with every form and booking`.

---

### Task 8: Site - the booking link pre-fills the funnel

**Files:** create `lib/link-prefill.ts`; modify `components/package/v2/TourFunnel.tsx`, `components/package/PackageFunnel.tsx`, `scripts/attribution-selftest.ts`, site `CLAUDE.md`.

- `parseRoomsParam(value)` (comma split, `^[a-z0-9_]{1,40}$`, max 9); `prefillRooms(keys, dep)` (rooms the date offers, null when none); `LEAD_REF_PATTERN`; `rememberLeadRef(value)` / `storedLeadRef()` (sessionStorage `mf-lead-ref`).
- TourFunnel: the query wrapper reads `rooms` + `lr`; rooms init `prefillRooms(...) ?? defaultRooms(...)`; step 2 when a linked open date and a prefill; the live effect keeps the prefill; `selectDate`'s `replaceState` keeps the other params; focus the review heading when opening on step 2. PackageFunnel: same props, rooms filled on step 2.
- Selftest cases incl. Review Focus 5; `npm run typecheck`, `npm run build`; commit `feat(site): a booking link pre-fills the rooms and keeps the lead token to the booking`.

---

### Task 9: Verify end to end

- [ ] backoffice selftests (cases, guide), `npx tsc --noEmit -p .`, SQL dry run.
- [ ] site selftest, typecheck, build; local dev: `/package/<slug>/?product_id=<id>&rooms=couple_kid&lr=<token>&utm_source=test` lands on travelers with the room filled; date change keeps `rooms` / `lr`; `mf-attr` holds `source: test`.
- [ ] backoffice UI: the screens read the new columns, so they are checked in the browser right after the migration lands (Task 10); before that, the selftests + tsc + dry run are the gate.
- [ ] `lib/nav.ts` coordinated with the navbar-cleanup session (SendMessage) before the edit lands.

### Task 10: Ship (only on Dor's "push")

- [ ] backoffice: fetch, rebase on `origin/master`, re-run gates, check no migration shares `20261014220000`, push-coordinator protocol, `git push origin HEAD:master`; migrations workflow green; `npm run db:types`; Vercel deployment created; prod browser check of the table and a case page.
- [ ] site: rebase on `origin/main`, gates, `git push origin HEAD:main`; Vercel green; a real lead through the test link converts.

### Task 11: Alon's QA flow

- [ ] Artifact "QA - טבלה אחת ללידים והזמנות" with numbered Hebrew steps, pass / fail + note per step stored with the artifact's db capability: (1) lead from a tour page with `?utm_source=qa` -> LEAD row with source qa, product, TASK "טיפול בליד"; (2) rep + "אין מענה" + follow-up today -> TASK "פולו אפ", view "Follow-up due"; (3) case page -> booking link for couple + child, to yourself on WhatsApp; (4) open it on the phone -> travelers step with the room filled; send -> the SAME row is RESERVATION / חדש / "טיפול בהזמנה חדשה", order card shows rooms, passengers, price, cancellation terms; (5) Add travelers -> seats; (6) Statuses -> add one, use it; (7) `/tours/leads` and `/tours/bookings` land on the table; (8) search by phone / ID; (9) "+ New" phone lead; (10) Export.

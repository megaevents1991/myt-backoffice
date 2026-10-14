# Tours: one table for leads and reservations - design

Date: 2026-10-14. Source: Alon's road-map tab "חיבור למקום אחד שהוא בעצם לידים והזמנות"
(doc `1NoQ1QF5JHbfvqEHbCeNfuXeKfwTImcxOGelV3r8Cz8E`, tab `t.kw44n12anc02`). The tab shows the tours
sidebar with **Online Bookings** and **Leads** struck out: everything lands in **Reservations**.
Decisions taken with Dor in chat the same day (scope, POTENTIAL, ID, TASK, data model).

## 1. Goal

One place that receives every lead and every site booking of a tours company (Mega Family / Mega
Tourism), as comfortable as the Mega Events Reservations screen. One row per customer case, with the
columns of the doc:

First name | Last name | Phone | Rep | ID | Email | ACC NUM | Notes | Product | Status | Source |
Follow-up date | Departure date | TYPE | TASK

- **TYPE** - `reservation` (registered through the site's booking funnel, or a booking typed in by
  staff) / `lead` (a form, a call) / `potential` (a future lead: "notify me when tours open", a
  tour's waiting list, the newsletter).
- **TASK** - what has to happen now, derived from the case (section 4); a rep may override it.
- **ID** - our case number in the column; the customer's national id (ת"ז) is a field of the case.
- Inside the case: UTM, the landing / form page, the tour looked at; for a booking: the passengers,
  the site price, the package's cancellation terms, the room compositions, and whether the
  departure's promotion carries a gift.
- A lead that has not booked can be sent a **booking link with their composition**; once they book
  on the site, the SAME case becomes a reservation.
- Statuses are a list staff can extend.

**Not in this round** (doc items for phase 2, they need the WhatsApp Cloud API which is not
connected): WhatsApp automations (no answer, status change), several reps on one WhatsApp number,
"it is live" auto-message to a potential, bulk message to old leads, marketing reports. The case
model below keeps what they will need (type, statuses with keys, source, UTM, rep).

## 2. Today

Three tables, three screens, one customer twice:

| Screen | Table | What |
|---|---|---|
| Reservations `/tours/reservations` | `tours.departure_sales_entries` | +pax / -pax typed by staff, Docket |
| Online Bookings `/tours/bookings` | `tours.bookings` | site "request" / card payment |
| Leads `/tours/leads` | `public.leads` | every site form |

`tours.booking_create` inserts a lead AND a booking for every site booking, so the customer shows up
in two screens. Production holds test data only (3 leads, 1 booking, 0 live sales rows), so the
change can be made cleanly.

## 3. Data model - `public.leads` is the case

Chosen over a fourth table or a union view: the links already exist (`tours.bookings.lead_id`,
`tours.departure_sales_entries.lead_id`) and the site's `submit_lead` functions keep working
untouched. Migration is additive only.

### 3.1 New columns on `public.leads`

| Column | Type | Meaning |
|---|---|---|
| `case_no` | bigint, default `nextval('public.leads_case_no_seq')` (start 1001), unique | the ID column; existing rows backfilled in `created_at` order |
| `type` | text, not null, default `'lead'` | `reservation` / `lead` / `potential`; NO check constraint (site functions write the table) - validated in the backoffice |
| `first_name`, `last_name` | text | split from `name` on insert when not given |
| `id_number` | text | the customer's national id (ת"ז) |
| `acc_num` | text | ACC NUM (accounting number) |
| `departure_id` | uuid -> `tours.departures` on delete set null | product + departure date |
| `package_id` | uuid -> `tours.packages` on delete set null | the tour, when no date is known (a waiting list, a tour page with no `product_id`) |
| `source` | text, not null, default `'site'` | `site` / `phone` / `whatsapp` / `office` / `agent` / `other` |
| `task_override` | text | a TASK key chosen by a rep; null = automatic |
| `link_token` | text, unique | the token of the booking link (section 6) |
| `link_sent_at` | timestamptz | last time a booking link was minted for the case |
| `is_deleted` | date | soft delete, like every other table |
| `updated_at` | timestamptz, default now() + the shared `update_updated_at_column` trigger | |

Indexes: `(company_id, case_no)`, `(company_id, type)`, `(company_id, assigned_to)`,
`(company_id, departure_id)`, partial on `link_token`, and a phone key index for the conversion
match (section 5): `(company_id, right(regexp_replace(phone, '\D', '', 'g'), 9))`.

### 3.2 `public.leads_fill` - BEFORE INSERT trigger

Every insert (site forms, `booking_create`, backoffice) passes through it:

- `type` from `kind` when the insert did not set one: `notify` / `waitlist` / `newsletter` ->
  `potential`; `booking` / `advisor` -> `reservation`; anything else -> `lead`.
- `first_name` / `last_name` from `name` (first word / the rest) when both are empty.
- `departure_id` from `source_path`: `?product_id=N` -> the company's departure whose
  `legacy_product_id` or `site_id` is N (same rule as `booking_quote`). `package_id` from
  `/package/<slug>/` (decoded) or the departure's package.
- `utm` cleaned by `public.clean_utm(jsonb)`: only the known keys (`source`, `medium`, `campaign`,
  `term`, `content`, `gclid`, `fbclid`, `landing`, `referrer`, `at`), strings, 300 chars each.

### 3.3 `public.lead_statuses` - the company's status list

`(id, company_id, key, label, color, position, is_closed, is_system, is_active, created_at)`,
unique `(company_id, key)`, RLS on with no policies (service role only).

Default list (seeded for every tours company; the code falls back to the same list when a company
has no rows):

| key | label | closed | system |
|---|---|---|---|
| `new` | חדש | | ✓ |
| `no_answer` | אין מענה | | |
| `in_progress` | בטיפול | | |
| `follow_up` | פולו אפ | | |
| `pending_payment` | ממתין לתשלום | | ✓ |
| `payment_failed` | תשלום נכשל | | ✓ |
| `payment_review` | בדיקת תשלום | | ✓ |
| `paid` | שולם | | ✓ |
| `done` | נסגר | ✓ | |
| `not_relevant` | לא רלוונטי | ✓ | |
| `cancelled` | בוטל | ✓ | ✓ |
| `spam` | ספאם | ✓ | ✓ |

System statuses are the ones code sets; they can be renamed and recoloured, never removed.
A status in use is deactivated (hidden from the picker, still shown on its rows), never deleted.
Existing lead statuses map: `new` -> `new`, `in_progress` -> `in_progress`, `done` -> `done`,
`spam` -> `spam`.

### 3.4 Payment state follows the booking

AFTER UPDATE OF `status` on `tours.bookings`: `pending_payment` -> case `pending_payment`,
`failed` -> `payment_failed`, `review` -> `payment_review`, `paid` -> `paid` (on the booking's
`lead_id`). The payment functions are not rewritten. The booking keeps its own status (the payment
truth, its rules unchanged); the case status is the staff pipeline.

### 3.5 Seats

Unchanged: `tours.departure_sales_entries` (+pax / -pax) counts on the departure. "Add travelers"
on a case writes a sales row with `lead_id` = the case and turns the case into a `reservation`.

## 4. TASK - derived, overridable

Pure function `caseTask(case, statuses, today)` in `lib/tours/cases.ts`, first match wins:

1. `task_override` set -> that task.
2. status is closed -> no task.
3. status `payment_review` -> **בדיקת תשלום**.
4. follow-up day today or past -> **פולו אפ**.
5. status `pending_payment` / `payment_failed` -> **השלמת תשלום** (a hot lead).
6. status `new`: `reservation` -> **טיפול בהזמנה חדשה**; kind `contact` / `cancellation` ->
   **שיחת שירות חדשה**; `lead` -> **טיפול בליד**; `potential` -> no task (waits for the tour).
7. status `paid` and the booking's confirmation not sent -> **שליחת אישור**.
8. otherwise no task.

The override picker offers the same task list plus "Automatic". Labels are Hebrew (the ops
vocabulary of the doc); keys are English.

## 5. Lead -> reservation (`tours.booking_create`)

Redefined (create or replace, `tours` schema - no per-company re-provision). Before it inserts a
lead it looks for the case:

1. `args.lead_ref` (the booking link token, `^[A-Za-z0-9_-]{16,64}$`) -> the company's case with
   that `link_token`, not deleted. Always attaches (a case may hold several bookings).
2. else the newest case of the company, not deleted, created in the last 90 days, `type` lead or
   potential, status not closed, with no booking yet, whose phone key (last 9 digits) or e-mail
   equals the customer's.
3. else a new case, as today.

On attach: `type = 'reservation'`, `status = 'new'` (`pending_payment` for a card), `departure_id`,
names / phone / e-mail filled where empty, `utm` filled when the case had none, the booking facts
merged into `payload`. The booking's `lead_id` points at the case. `args.utm` is stored on a new
case as well. Unknown arg keys are still ignored, so an old site keeps working.

## 6. Booking link with the composition

Case page card "Send booking link": departure (default: the case's), a counter per room
composition the departure prices (the 10 keys of `tours.room_composition`), then:

`{companies.site_url}{package path}?product_id={legacy_product_id ?? site_id}&rooms=k1,k2&lr={token}`

Package path = `packages.data.path` when the WordPress import set one, else `/package/{slug}/`.
The token is minted once per case (`link_token`, 24 random bytes base64url). Buttons: Copy,
WhatsApp (`https://wa.me/<phone in 972 form>?text=...` - opens the rep's own WhatsApp, no API),
E-mail (`mailto:`). Minting is audited (`tours_case.link`) and stamps `link_sent_at`.
Room keys are validated against the departure's price matrix; `lr`, not `ref` (the site's
`/booking/done` page already reads `ref` as the booking number).

### Site (`mega-family`)

- `TourFunnel` (v2, organized tours) and `PackageFunnel` (vacation template) read `rooms` and `lr`
  in their `*FromQuery` wrappers. Rooms the date prices are pre-filled (falling back to the default
  room), the live-departures effect keeps them, and with a linked open date and a valid composition
  the visitor lands on the review step (travelers) directly.
- `lr` is kept in sessionStorage so it survives a date change; the date picker's `replaceState`
  keeps the other query params instead of dropping them.
- `lib/attribution.ts`: on any page, `utm_*`, `gclid`, `fbclid`, the landing path and an external
  `document.referrer` are captured; kept 30 days in localStorage (a new visit carrying UTM
  replaces it), session-only when the visitor rejected cookies (`mf-cookie = reject`). Sent with
  every form (`submit_lead`'s `p_utm`, sent empty today) and every booking (`args.utm`,
  `args.lead_ref`).
- Deploy order does not matter (old site + new DB, new site + old DB both work).

## 7. Screens (backoffice)

### 7.1 Menu

Tours "Reservations" stays and becomes the unified screen. "Online Bookings" and "Leads" leave the
menu; `/tours/bookings` and `/tours/leads` redirect to `/tours/reservations?view=reservations` /
`?view=leads`. The tours dashboard's "New Leads" card links to the unified screen. The departure
card's Reservations tab (seat rows of one departure) is unchanged.

### 7.2 `/tours/reservations` - the table

`DataTable` in the Mega Events look, columns in the doc's order: ID · First name · Last name ·
Phone (dials) · Rep · Email · ACC NUM · Notes · Product · Status · Source · Follow-up · Departure ·
TYPE · TASK · Created. Edited in the row: notes and ACC NUM (save on blur, like Mega Events),
rep, status (coloured tag), follow-up day (red when due). TASK shows ✎ when overridden.
Source = `utm.source` (/ medium) when present, else the source label.

Views (in the URL): All · Reservations · Leads · Potential · Mine · Follow-up due · Unassigned.
Filters: status, rep, product, source. Search (token search): name, phone, e-mail, ID, national
id, ACC NUM, booking ref, tour. Bulk (selected rows): rep, status. "+ New" opens a manual case
(type, names, phone, e-mail, national id, source, departure, rep, notes, follow-up; a reservation
needs a departure and travelers -> a sales row). "Statuses" opens the status list editor.
"Export to Excel" exports what the screen shows. The screen loads with ONE action.

### 7.3 `/tours/reservations/[id]` - the case page

Loads with ONE action. Header: name, ID, TYPE, status, rep, TASK (override), follow-up.
Cards: **Customer** (names, phone, e-mail, national id, ACC NUM - editable) · **Product**
(tour, departure, link to its site page) · **Order** per booking (rooms, passengers with birth
dates, the site price lines, payment facts, receipt no., "confirmation sent", "confirm payment"
for a review booking - the existing booking rules) · **Cancellation terms** (the package's
`cancellation_html`) · **Gift** (active `gift` promotions of the departure or its series) ·
**Source** (UTM, landing page, referrer, form page, the form's other fields) · **Seats** (the case's
sales rows, Add travelers / Cancel) · **Booking link** (section 6) · **Notes** · **History**
(the case's audit rows). Row clicks on the table open this page.

## 8. Code layout

- `lib/tours/cases.ts` - pure: types, default statuses, `typeOfKind`, `caseTask`, `phoneKey`,
  `splitName`, `productIdOf` / `packageSlugOf` (source path), `bookingLink`, `waLink`,
  `validateStatuses`, `caseMatches`, `followUpDue`. Selftest `scripts/tours-cases-selftest.ts`.
- `lib/actions/tours-cases-actions.ts` - list, get, update, bulk update, create, delete (soft),
  add travelers, mint link, statuses read/save, export. Every action `requireCompany("tours")`,
  explicit columns, audited (`tours_case`, `tours_case_status`).
- `components/tours/cases/*` - screen, table, case page cards, new-case dialog, statuses dialog,
  booking-link card.
- `app/(dashboard)/tours/reservations/page.tsx` (screen), `[id]/page.tsx` (case),
  `tours/bookings` + `tours/leads` -> redirects. `leads-inbox.tsx` and `bookings-screen.tsx` are
  removed; `tours-bookings-actions.ts` keeps `updateBooking` (used by the Order card);
  `tours-leads-actions.ts`' list/update move into the cases actions.
- Migration `supabase/migrations/<ts>_tours_unified_cases.sql`; `types/database.types.ts`
  patched by hand for the new columns / table (as before), `npm run db:types` after the push.
- Guide (`guide-content-tours.ts`, `guide-model.ts`), both CLAUDE.md files.

## 9. Testing and rollout

- Selftests: `scripts/tours-cases-selftest.ts` (backoffice); the site's attribution + rooms
  parsing get a selftest of their own.
- `tsc --noEmit` in both repos; `npm run build` in the site.
- The migration SQL is run inside `BEGIN ... ROLLBACK` against production (management API) before
  the push: insert a lead with a `?product_id=` path and UTM, then call `booking_create` with the
  same phone and with a token, and read back type / status / departure / case_no / booking
  `lead_id`. Nothing stays (sequence numbers may skip).
- Browser check of both screens on the local dev server against production data.
- Deploy: backoffice (migration rides the push to master), then the site. Then `db:types`.
- Alon's QA flow: an artifact with steps and pass / fail (section 1's journey end to end).

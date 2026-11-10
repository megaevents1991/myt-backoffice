# TixStock Ticket Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task
> (Dor chose Native execution, 09.11). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two things. First, a **Book ticket** flow in the backoffice that runs TixStock's API: listings,
hold, order, webhook, staff check, send to the customer. Second, the site checkout TixStock tests, on a hidden
sandbox event. Neither may change anything for the ~400 live products.

**Architecture:** The rules and the HTTP client are pure modules, byte-identical in both repos. The backoffice
owns the webhook, the sweeps, the button and the card. The site has one isolated branch that runs only for
`is_test` events with `tixstock_booking` set: its own ticket step, its own listings route, and a guarded block in
`confirm-order` and after payment. All state lives in three new tables plus a private bucket. The `reservations`
table is not altered.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Supabase (Postgres, Storage), TypeScript. Tests: vitest
in myt-main, `node:assert` selftests run with `npx tsx` in the backoffice, PGlite for SQL.

**Spec:** `myt-backoffice/docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md`, approved by Dor on
09.11. Read it with this plan. Section numbers like "7.8" refer to it.

**Reviewed 10.11.2026** against the spec and the code in both repos (Dor: "תריץ בדיקה על התוכנית"). The review's
fixes, TixStock's answers of 10.11 and Dor's calls of that day are folded into the tasks below; the list is in
"Review amendments" at the end of this file.

**Execution order** (not the task numbers): 1 → push the migration alone → 2, 3, 4 → 5, 5A, 6 → push → 16 →
7-12 → push → 13-15 → push → 17. Why: Tasks 5, 5A and 6 read the new column / tables, so they are committed only
once the migration is live; the test events (Task 16) are created only once Tasks 5 and 5A are live; and the
site's local checks (Tasks 8-12) need the test events, because `yarn dev` in myt-main reads the production DB.

## Global Constraints

- **Rule 9, above everything:** "הכי חשוב זה שלא יפגע בשום flow שעובד כרגע ולא יפגע בשום דבר וכול ה 400 מוצרים
  שרצים מול לקוחות אמיתיים".
- **Every new site path runs only when `event.is_test === true` and `event.tixstock_booking` is set** (7.13).
  A request that does not carry `tixstock_listing_id` reaches no new code beyond one `if`.
- **Protected files: never edited.**
  - myt-main: `app/api/tixstock/tickets/route.ts`, `lib/tixstock-feed.ts`, `lib/tixstock-quantity.ts`,
    `lib/supplier-offers.ts`, `lib/ticket-cost.ts`, `lib/eventsData.ts`, `app/order/TicketSelection.tsx`,
    `app/api/confirm-order/[id]/route.ts`, `app/api/confirm-order/utils.ts`, `app/api/sendUserEmail.ts`.
  - Backoffice: `lib/tixstock-listings.ts`, `lib/services/tixstock-sync.ts`.
- **The only edits allowed in existing live files:**
  - myt-main:
    - `app/order/OrderForm.tsx:638` (one branch)
    - `app/order/OrderReview.tsx` (blocks behind `isSandboxBookingEvent(event)`, plus one error mapping)
    - `app/api/confirm-order/route.ts` (one guarded block, Task 10)
    - `app/api/payment/validateAndRecord.ts` (one flag set beside the existing reservation read, and one gated
      block before `return`; no existing line changes - Task 11)
    - `app/confirmation/[...params]/page.tsx` (one block gated on `event_order_info.tixstock_sandbox === true`)
    - `lib/app.types.ts` (two optional fields)
  - Backoffice:
    - `lib/services/tixstock-price-sync.ts:266-274` (one `.or()` filter, Task 5)
    - `lib/actions/portal-package-actions.ts`, `lib/actions/portal-dashboard-actions.ts`,
      `lib/actions/quote-actions.ts` (one `.eq("is_test", false)` on each event LIST query, Task 5A)
    - `types/app.types.ts` (mirror)
    - `lib/email.ts` (optional `attachments`)
    - `app/(dashboard)/reservations/[id]/page.tsx` (render the card)
    - `app/(dashboard)/reservations/reservations-table.tsx` + `lib/actions/reservation-actions.ts` (one list view)
    - `vercel.json` (one cron, one function entry)
- **Deploy order:** the migration (Task 1) must be live on production before any code that names
  `tixstock_booking` or the new tables is deployed, in either app. Without it, a filter on a missing column breaks
  the price sync for every TixStock event.
- **Shared checkout - a commit is as good as deployed.** Other sessions work on the same `master` / `main`, and
  any session's push ships every local commit there; `db-migrate.yml` applies a migration on any push that
  touches `supabase/migrations/**`. So:
  - the migration commit is pushed ALONE, right after Task 1 (stop and ask Dor for "תדחוף");
  - Tasks 5, 5A and 6 are not committed until the migration is confirmed live;
  - every commit must be harmless if it ships on its own: nothing here runs until the test events exist and the
    sandbox env vars are on Vercel;
  - the test events (Task 16 `--apply`) are created only after Task 5 and Task 5A are live.
- **Git:**
  - backoffice on `master`, myt-main on `main`, no branches;
  - commit by explicit path (`git commit -- <paths>`), conventional commits, **no AI co-author line**;
  - push only when Dor says "push" / "תדחוף", through the push lock (skill `push-coordinator`).
- **Tokens:** Claude never types or prints a token. Dor pastes them.
- **Env names (exact):**
  - `NEXT_SECRET_TIXSTOCK_SANDBOX_URL` = `https://sandbox-pf.tixstock.com/v1` and
    `NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN` (both apps);
  - `NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN` and `NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING` (`true` opens production);
  - no webhook secret exists: TixStock signs a webhook with that environment's API token (their answer of
    10.11), so the key is `NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN` / `NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN`;
  - `NEXT_SECRET_FULFILMENT_OPEN` (gate).
  
  Production host constant: `https://pf.tixstock.com/v1`. The existing `NEXT_SECRET_TIXSTOCK_API_URL` /
  `_TOKEN` are untouched.
- **TixStock strings (exact):**
  - statuses `Sale on Hold`, `Approved`, `Commissionable`, `Cancelled`;
  - split types: the guide and the Seller Portal say `None`, `Single Seats`, `Sell in Multiples`, `Avoid Leaving
    One`, `All Together`; the LIVE feed spells them "No Preferences", "Avoid Leaving One Ticket", "Sell
    Together", "Multiples" (`lib/tixstock-quantity.ts:7-8`). Never compare a split string yourself: go through
    `listingCanSatisfyQuantity` / `listingSeatsTogether`. Task 16 records what the sandbox feed returns;
  - `datetime` format `2026-05-23T20:45:00+0000`, in UTC;
  - an expired hold answers orders/add with "Resource Not Found" (TixStock 10.11).
- **Prices:** the feed has ONE price field, `proceed_price` (no `display_price` - measured on the live feed
  10.11). It already includes TixStock's fee, so it is our full cost. With `target_currency=USD` it comes in USD
  at TixStock's rate. `items[].price` in orders/add is that amount exactly as the feed returned it - never the
  rounded card price and never the customer's price.
- **Our id at TixStock:** the reservation id, as a string. It is the `external_id` of every webhook answer
  (TixStock 10.11: "your own internal order ID"). orders/add has no field for it in the guide, so nothing is sent
  there until TixStock answers (asked 10.11); `getOrder` / `updateOrder` take TixStock's `data.id` until then.
- **Italian events** (the TixStock event's `venue.country_code` is `IT`): every attendee needs first name, last
  name, passport number (sent as `national_id`), nationality (ISO 3166-1 alpha-2), date of birth (`YYYY-MM-DD`),
  gender and place of birth (TixStock's list of 10.11). The attendee's `email_address` is the buyer's e-mail -
  no field for it (Dor 10.11: minimal Italian handling). **Provisional until TixStock answers the 10.11
  follow-up:** the field name `gender` with values `M` / `F`, and the ISO code in `nationality`. Both live in
  `buildOrderRequest` only, so an answer changes one function.
- **`requires_lead_booker`:** a listing flag neither repo reads today (false on all 57 live listings sampled
  10.11; TixStock was asked what it requires). A listing with it `true` gets no card on the sandbox step and a
  warning line in the office dialog.
- **Hebrew copy fixed by the spec:**
  - dialog: "רכישה סופית - הזמנה מאושרת ב-TixStock לא מתבטלת", "הזמן כרטיס", "קטגוריות אחרות", "האירוע
    דורש פרטי זיהוי";
  - uncertain: "לא ודאי - לא להזמין שוב עד שיתברר", "בדקתי - נוצרה הזמנה <id>", "בדקתי - לא נוצרה", and the
    plan's own line under them: "בודקים ב-Request Logs של TixStock אם ההזמנה נוצרה";
  - card: "כרטיסים התקבלו - לבדוק ולשלוח", "בדקתי את הכרטיסים", "שלח ללקוח", "העתק לוואטסאפ", "נשלח בוואטסאפ",
    "בדיקה - סנדבוקס", "TixStock - הזמנה בפרודקשן עוד לא נפתחה";
  - list view: "התקבלו ולא נשלחו";
  - site: "ייתכן שהמושבים לא יהיו צמודים", "קישור לכרטיסים נשלח אליכם במייל", "הכרטיסים יישלחו אליכם עד <date>";
  - external transfer: "הכרטיסים מועברים אליך ישירות על ידי הספק - בדקו את תיבת המייל".
- **Gate:** superadmin only until `NEXT_SECRET_FULFILMENT_OPEN === "true"`, then admin + superadmin. Checked in the
  page and in every ticket action / route, except the signed webhook.
- **Test commands:**
  - myt-main: `npx vitest run <file>`;
  - backoffice: `npx tsx scripts/<name>-selftest.ts` (header comment `// Run: npx tsx scripts/<name>-selftest.ts`,
    `node:assert/strict`, no DB, no network) and `node scripts/<name>-sql-pglite-test.mjs` for SQL.
  
  Type gate: `npx tsc --noEmit` in each repo (the builds ignore type errors).
- **Shared modules:** `lib/tixstock-booking/rules.ts` and `lib/tixstock-booking/client.ts` are byte-identical in
  both repos. After touching one, `cmp` the pair (`cmp ../myt-main/lib/tixstock-booking/rules.ts
  lib/tixstock-booking/rules.ts`).
- **`*Deps` types** (`WebhookDeps`, `ApplyDeps`, `SweepDeps`, `SiteHoldDeps`, `OfficeDeps`) are defined by the
  implementer in the same file as their function. Every DB, network, mail and clock call goes through them, so the
  tests stub them. The real deps are built by a `real...Deps()` function beside them.

## Plan calls - where this plan departs from the spec (for Dor and the reviewer)

1. **The ticket-page link goes in a separate email, sent once the order is Approved** (Task 11), not inside the
   existing confirmation email. This keeps `sendUserEmail.ts` and the email template untouched (rule 9). Approved
   by Dor with the review (10.11); spec 7.8 and 8.21 now say so.
2. **Until the fulfilment panel exists, Book ticket requires three staff ticks on every reservation** (Task 14):
   flight + hotel done, not bought by hand, final purchase. They replace the panel's "hotel step done" rule and the
   before-open-date tick of spec 7.1.
3. **The passport is sent as `Attendee.national_id`,** because the API has no passport field. TixStock's list of
   10.11 names "National id" among the Italian attendee details.
4. **No separate ops alert.** A site booking that fails after payment (listing gone) shows as `failed` on the
   backoffice card and is logged as `[tixstock-site-booking]`. This is the test event only.
5. **The confirmation page knows a test order by `event_order_info.tixstock_sandbox === true`,** a marker the
   sandbox summary adds. Real orders' confirmation pages make no new request.
6. **The webhook signature is HMAC-SHA256 of the raw body, keyed with that environment's API token** (TixStock
   10.11). Hex or base64 was not said, so both are accepted. With no token configured, every webhook is refused
   with 401.
7. **`lib/fulfilment/visibility.ts` is created here,** and the RateHawk work reuses it.
8. **Italian attendees get the buyer's e-mail,** and the Italian form on the site is built on the test event only
   (Dor 10.11: option ב). 58 of the 438 TixStock products on sale are at an Italian venue; real orders get these
   details from staff in the office dialog.
9. **The partner portal skips test events (Task 5A).** Its event lists filter `is_hidden` / `is_deleted` only,
   so a partner could link, quote or package a sandbox event to a real customer. Three live portal action files
   get one filter per list. This also fixes today's test events.
10. **Test reservations are not filtered out of dashboards, marketing numbers or mails by code.** Nothing in
    either repo reads `is_test` on a reservation, and adding it means edits in many live files. Instead: after
    the health check the test reservations are soft-deleted, and the team is told that "TEST ·" mails are not
    leads (Task 17). This replaces spec 7.11.3's "stay out of every number".
11. **A paid site order that was never ordered at TixStock is marked `failed` by the sweep, not ordered by it**
    (Task 6). Staff book it from the button. One ordering implementation per app, test event only.
12. **A site booking's tickets are released to the customer's page as they arrive** (Task 4), with no staff
    check. This is the spec's own rule (7.8.7, 8.12) - the first draft of this plan never set
    `released_to_customer_at` for a site row, so the ticket page would have stayed empty. Office bookings keep
    the staff check.

## Review Focus

1. **Both payment callers run for every payment** - CreditGuard's callback (`app/api/confirmation/...`), then
   the confirmation page (`app/api/payment/[id]/[txId]/[promoCode]`), one after the other: exactly one
   `orders/add`. The claim is a one-way status move (`on_hold` → `ordering`), never a timer. Task 11 test `one
   orders/add when two callers race`.
2. **The customer spends over 10 minutes on CreditGuard's page,** so the hold has expired: orders/add answers
   "Resource Not Found"; hold the same listing once more and order. If it is gone, `failed` with no third call.
   A new hold is placed ONLY on that answer and only on the row's first orders/add - a used hold may answer Not
   Found too, and TixStock says a repeated orders/add can create a second order. An unanswered call is
   `uncertain`, always. Task 11 tests `re-holds once after an expired hold`, `no answer is uncertain`.
3. **A webhook arrives twice or out of order** (Commissionable before the last e-ticket's Approved): files are not
   duplicated and the status never moves back. Task 4 tests `repeat is idempotent` and `no status regression`.
4. **A refresh restores the order draft without the listing id** on a sandbox event: the summary sends the
   customer back to pick a ticket and never takes a payment with no hold. Task 9 test `pick_again without listing`.
5. **A real event's order carries a stray `tixstock_listing_id`** (a tampered request): no hold and no booking, a
   warning in the log, and the order goes through as today. Task 10 test `ignores a listing id on a real event`.
6. **A real payment never reaches the new code.** `validateAndRecord.ts` registers `after()` only when the
   reservation carries `event_order_info.tixstock_sandbox === true`, inside its own try/catch: an `after()` that
   threw would turn `GET /api/payment/...` into a 500 and show "error" to a customer who paid. Task 11.
7. **A partner never sees a test event** (Task 5A), and **a real event never leaves the price sync** (Task 5's
   filter needs both `is_test` and the mode).

---

## Task 0: Dor's setup (manual; Claude does none of these steps)

**הטוקן לסנדבוקס - איך מוצאים אותו**
1. **אפשרות א':** הטוקן שכבר נשלח בקבוצת הוואטסאפ עם TixStock. אם הוא עדיין עובד, משתמשים בו.
2. **אפשרות ב' - טוקן חדש:**
   - נכנסים ל-Reseller Admin של הסנדבוקס: https://sandbox-resellers.tixstock.com.
   - הכניסה היא עם החשבון ש-TixStock פתחו. אין סיסמה? מאפסים דרך הקישור במייל. אם הוא מבקש passkey, לוחצים
     קודם Login ואז האפשרות מופיעה.
   - **זהירות:** סיסמה חדשה לפורטל אחד יכולה לשבש את הכניסה לפורטל השני.
   - ב-API keys יוצרים bearer token.
3. **מדביקים בעצמך** (לא בצ'אט) ב-`.env.local` של `myt-backoffice` וגם של `myt-main`:
   ```
   NEXT_SECRET_TIXSTOCK_SANDBOX_URL=https://sandbox-pf.tixstock.com/v1
   NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN=<הטוקן>
   ```
4. **Vercel:** לפני שלב 2 של העלייה (Task 17), מוסיפים את שני המשתנים לשני הפרויקטים ב-Vercel, בדשבורד.

**שאר ההכנות**
5. **Seller Portal** (https://sandbox-new.tixstock.com): קובעים סיסמה. את רשימת ה-listings ליצירה נותנת Task 16.
6. **שאלות ל-TixStock** (אתה שולח; Claude מנסח, אתה מאשר את הנוסח). השאלות והתשובות המלאות:
   `docs/tixstock/2026-11-10-questions-to-tixstock.md`.
   - **נענו ב-10.11:**
     - חתימת ה-webhook: sha256, והמפתח הוא ה-Bearer token.
     - `external_id` הוא מזהה ההזמנה שלנו.
     - אסור לחזור על orders/add; hold שפג עונה "Resource Not Found".
     - המחיר ב-feed כבר כולל את העמלה שלהם.
     - רשימת פרטי המשתתף באירוע איטלקי.
   - **נוסחו כהודעה אחת ב-10.11, מחכות לתשובה:** איפה שולחים את מזהה ההזמנה שלנו ב-orders/add; באיזה מטבע
     נרשמת הזמנה; `requires_lead_booker`; פרטי משתתף לפי מדינת האירוע או לפי הלקוח; שם השדה והערכים של מגדר
     ופורמט האזרחות; סעיף ה-Serie A מהבקאופיס; hex או base64 בחתימה; התשובה ל-`ticket.hold` / `ticket.release`;
     webhook מעל 4.5MB; כתובת webhook לכל סביבה; טוקן הפרודקשן; הזמנות מהבקאופיס ימים אחרי התשלום; כרטיסי נייר
     למלון.
7. **Webhook:** אחרי שלב 2, נרשמים ב-Reseller Admin ל-webhooks עם הכתובת
   `<backoffice production origin>/api/tixstock/webhook/sandbox`. לפי הזיכרון הכתובת היא
   `backoffice-app-six.vercel.app`, וה-builder מאמת מול `appOrigin()`. אין secret להדביק: המפתח הוא טוקן
   הסנדבוקס, שחייב להיות ב-env של הבקאופיס ב-Vercel.
8. **החזרים:** אחרי הבדיקות של TixStock מחזירים את החיובים ב-CreditGuard.

---

## Phase A - Backoffice foundation

### Task 1: Migration, shared types, SQL test

**Files:**
- Create: `myt-backoffice/supabase/migrations/20261110100000_tixstock_ticket_booking.sql` (first `ls
  supabase/migrations | tail -3`: the version must be later than every file there, and unique - `db-migrate.yml`
  refuses a duplicate)
- Create: `myt-backoffice/scripts/tixstock-booking-sql-pglite-test.mjs`
- Modify: `myt-backoffice/types/app.types.ts:76` (Event), the `OrderTicket` mirror; `myt-backoffice/types/database.types.ts` (new tables)
- Modify: `myt-main/lib/app.types.ts:80` (Event), `:547` (OrderTicket)

**Interfaces:**
- Produces:
  - `events.tixstock_booking text null` (values `sandbox_site` | `sandbox_office`);
  - tables `ticket_bookings`, `ticket_booking_files`, `tixstock_webhook_events`;
  - bucket `ticket-files`;
  - TS: `Event.tixstock_booking?: "sandbox_site" | "sandbox_office" | null` and `OrderTicket.tixstock?: {
    listingId: string; italian: boolean; singleSeats: boolean }`, in both repos.

- [ ] **Step 1: Write the PGlite test** `scripts/tixstock-booking-sql-pglite-test.mjs`. Copy the setup of
  `scripts/club-sql-pglite-test.mjs`, with a stub `public.reservations(id bigint primary key)` and
  `public.events(id bigint primary key)` and `storage.buckets` before the migration. Assertions:
  - `second live booking is refused`: insert two rows for one reservation with status `on_hold`; the second
    raises a unique violation on `ticket_bookings_one_live`.
  - `failed then new is allowed`: `failed` + `on_hold` for one reservation succeeds.
  - `uncertain blocks`: `uncertain` + `holding` raises.
  - `ordering blocks`: `ordering` + `on_hold` raises (a row mid-call still locks the reservation).
  - `released then new is allowed`: `released` + `on_hold` succeeds.
  - `claim is one-way`: `update ticket_bookings set status = 'ordering' where id = $1 and status = 'on_hold'
    returning id` returns one row the first time and none the second.
  - `file dedupe`: two `ticket_booking_files` rows with the same `dedupe_key` raise.
  - `migration runs twice`: apply the file twice with no error.
- [ ] **Step 2: Run it.** `node scripts/tixstock-booking-sql-pglite-test.mjs`. Expected: FAIL (the file is
  missing).
- [ ] **Step 3: Write the migration.** Follow `20261109104145_members_club.sql`: idempotent, RLS on, `revoke all
  ... from anon, authenticated`, no CHECK constraints (values validated in code), a comment per enum-like column.
  - `alter table public.events add column if not exists tixstock_booking text;`
  - **`ticket_bookings`:**
    - `id uuid pk default gen_random_uuid()`
    - `reservation_id` (same type as `reservations.id`, FK, not null)
    - `env text not null`, `source text not null`
    - `tixstock_event_id text not null`, `listing_id text not null`, `hold_id text`, `tixstock_order_id text`
    - `quantity int not null`, `status text not null` (`holding` | `on_hold` | `ordering` | `sale_on_hold` |
      `approved` | `commissionable` | `failed` | `released` | `uncertain` | `cancelled`),
      `attempt_started_at timestamptz` (set when the row moves to `ordering`)
    - `listing jsonb not null`
    - `price_per_ticket numeric(12,2)`, `currency text not null default 'USD'`, `total numeric(12,2)` (what we
      sent: the feed's amount)
    - `order_currency text`, `order_total numeric(12,2)` (what TixStock's orders/add answer registered)
    - `cost_sold_usd numeric(12,2)`, `gap_accepted_by text`
    - `buyer jsonb`, `attendees jsonb`, `shipping_address jsonb`, `prerequisites_ack jsonb`
    - `uncertain_resolution jsonb`, `last_error text`, `last_refresh_at timestamptz`, `link_email_sent_at
      timestamptz`
    - `created_by text`, `created_at`, `updated_at`, `approved_at`, `commissionable_at`
    - `checked_by text`, `checked_at`
    - `sent_to_customer_at`, `sent_to_customer_by text`, `sent_channels text[] not null default '{}'`,
      `released_to_customer_at`
    - `customer_token text not null unique`
  - **Indexes on `ticket_bookings`:**
    - `create unique index if not exists ticket_bookings_one_live on public.ticket_bookings (reservation_id)
      where status in ('holding','on_hold','ordering','sale_on_hold','approved','commissionable','uncertain');`
    - indexes on `(tixstock_order_id)` and `(status, created_at)`.
  - **`ticket_booking_files`:**
    - `id uuid pk`, `booking_id uuid not null fk`, `kind text not null` (`pdf` | `mobile_link` | `proof` |
      `additional`)
    - `row text`, `seat text`, `storage_path text`, `content_type text`, `url text`
    - `webhook_event_id uuid`, `dedupe_key text not null unique`, `received_at timestamptz not null default now()`
  - **`tixstock_webhook_events`:**
    - `id uuid pk`, `env text`, `type text`, `signature_valid boolean not null`, `tixstock_order_id text`
    - `payload jsonb` (base64 bodies replaced by their length), `result jsonb`
    - `received_at timestamptz not null default now()`
  - **Bucket:** `insert into storage.buckets (id, name, public) values ('ticket-files','ticket-files',false) on
    conflict (id) do nothing;`
- [ ] **Step 4: Run the test.** `node scripts/tixstock-booking-sql-pglite-test.mjs`. Expected: all assertions pass.
- [ ] **Step 5: Add the types.**
  - In both repos, after `is_test`: `tixstock_booking?: "sandbox_site" | "sandbox_office" | null;` with the
    comment "honoured only with is_test (2026-11-09 TixStock booking design)".
  - In both repos, on `OrderTicket`: `tixstock?: { listingId: string; italian: boolean; singleSeats: boolean };`.
  - Add the three tables to `types/database.types.ts` by hand, following the neighbouring table blocks.
  - Run `npx tsc --noEmit` in both repos. Expected: no new errors.
- [ ] **Step 6: Commit (each repo separately).**
  ```bash
  git commit -m "feat(tixstock): booking tables, events.tixstock_booking, private ticket-files bucket" -- supabase/migrations/20261110100000_tixstock_ticket_booking.sql scripts/tixstock-booking-sql-pglite-test.mjs types/app.types.ts types/database.types.ts
  ```
  ```bash
  git commit -m "feat(types): Event.tixstock_booking + OrderTicket.tixstock (mirror of backoffice)" -- lib/app.types.ts
  ```
  myt-main: `yarn build` green before the commit, and no dev server running in that folder.
- [ ] **Step 7: Stop for the push.** Report the commits as local and ask Dor for "תדחוף" on the backoffice (skill
  `push-coordinator` first). After it: `db-migrate.yml` is green, and a read-only `select tixstock_booking from
  events limit 1` plus `select id from ticket_bookings limit 1` (supabase-js, `.env.local`) answer without an
  error. Tasks 2-4 can be built while waiting; Tasks 5, 5A and 6 cannot.

### Task 2: Pure booking rules (byte-identical in both repos)

**Files:**
- Create: `myt-main/lib/tixstock-booking/rules.ts`; copy to `myt-backoffice/lib/tixstock-booking/rules.ts`
- Test: `myt-main/lib/__tests__/tixstockBookingRules.test.ts`, `myt-backoffice/scripts/tixstock-booking-rules-selftest.ts` (same cases)

**Interfaces (produces):**
```ts
export type TixstockBookingMode = "sandbox_site" | "sandbox_office";
export type BookingEnv = "sandbox" | "production";
export type BookingStatus = "holding" | "on_hold" | "ordering" | "sale_on_hold" | "approved" | "commissionable"
  | "failed" | "released" | "uncertain" | "cancelled";
export const ACTIVE_STATUSES: readonly BookingStatus[]; // the seven in the unique index
export type EventFlags = { is_test?: boolean | null; tixstock_booking?: string | null };
export function bookingEnvFor(e: EventFlags): { ok: true; env: BookingEnv } | { ok: false; kind: "test_without_sandbox" };
export function isSandboxBookingEvent(e: EventFlags | null | undefined): boolean;
export function siteBooksAfterPayment(e: EventFlags | null | undefined): boolean;
export function tixstockDatetime(d: Date): string;
export function statusFromTixstock(s: unknown): BookingStatus | null;
export function canMoveTo(from: BookingStatus, to: BookingStatus): boolean;
export type Buyer = { first_name: string; last_name: string; email: string; phone: string };
export type AttendeeInput = { first_name: string; last_name: string; passport?: string; nationality?: string;
  dob?: string; gender?: "M" | "F"; birth_place?: string };
export type AttendeeIssue = "name" | "passport" | "nationality" | "dob" | "gender" | "birth_place";
export function attendeeIssues(a: AttendeeInput, italian: boolean): AttendeeIssue[];
export function buildOrderRequest(input: { status: "Sale on Hold" | "Approved"; at: Date; buyer: Buyer;
  attendees: AttendeeInput[]; quantity: number; italian: boolean;
  listing: { generalAdmission: boolean; row: string; pricePerTicket: number };
  shippingAddress?: Record<string, string> }):
  { ok: true; body: Record<string, unknown> } | { ok: false; kind: "attendee_count" | "attendee_issues" };
export const SITE_ORIGIN = "https://www.mega-events.co.il";
export function ticketPageUrl(token: string): string; // `${SITE_ORIGIN}/ticket/${token}`
export function ticketLinkEmail(eventName: string, url: string): { subject: string; html: string; text: string };
```

- [ ] **Step 1: Write the failing tests.** The same cases in both files:
  - `env for sandbox_site test event`: `bookingEnvFor({is_test:true, tixstock_booking:"sandbox_site"})` deep-equals
    `{ok:true, env:"sandbox"}`. Also `sandbox_office` gives sandbox.
  - `real event is production even with a mode`: `{is_test:false, tixstock_booking:"sandbox_site"}` gives
    `{ok:true, env:"production"}`.
  - `test event without mode refused`: `{is_test:true, tixstock_booking:null}` and `{is_test:true,
    tixstock_booking:"bogus"}` give `{ok:false, kind:"test_without_sandbox"}`.
  - `site books only sandbox_site`: true for `{is_test:true, tixstock_booking:"sandbox_site"}`; false for
    `sandbox_office`, for a non-test event, and for `null`.
  - `datetime format`: `tixstockDatetime(new Date("2026-05-23T20:45:00Z")) === "2026-05-23T20:45:00+0000"`.
  - `status mapping`: `"Sale on Hold"`→`"sale_on_hold"`, `"Approved"`→`"approved"`,
    `"Commissionable"`→`"commissionable"`, `"Cancelled"`→`"cancelled"`, `"approved "`→`"approved"` (trimmed, case
    folded), `"Awaiting"`→`null`, `42`→`null`.
  - `transitions`: every pair of the table in Step 3 is asserted, allowed and refused. Among them:
    - true: `holding→on_hold`, `on_hold→ordering`, `on_hold→released`, `ordering→sale_on_hold`,
      `ordering→approved` (the office orders as Approved), `ordering→uncertain`, `sale_on_hold→approved`,
      `sale_on_hold→commissionable`, `approved→commissionable`, `approved→cancelled`,
      `commissionable→cancelled`, `uncertain→approved`, `uncertain→commissionable`, `uncertain→failed`,
      `released→ordering`;
    - false: `commissionable→approved`, `approved→sale_on_hold`, `on_hold→approved` (it must pass `ordering`),
      `approved→released`, `approved→failed`, `failed→approved`, `released→on_hold`, `cancelled→approved`, and
      every `x→x`.
  - `italian issues`, on the base attendee `{first_name:"Dana", last_name:"Levi", passport:"12345678",
    nationality:"IL", dob:"1990-01-31", gender:"F", birth_place:"Tel Aviv"}` with `italian:true`:
    - complete gives `[]`;
    - without `passport` gives `["passport"]`; without `gender` gives `["gender"]`; without `birth_place` gives
      `["birth_place"]` - for an Israeli too, not only for nationality `IT`;
    - `dob:"31/01/1990"` gives `["dob"]`; `nationality:"Israel"` gives `["nationality"]`.
    
    With `italian:false`: a blank last name gives `["name"]`, and a complete name with nothing else gives `[]`.
  - `order body, plain`: 2 tickets, 2 attendees, `italian:false`, status `"Approved"`:
    - `body.order_status === "Approved"`;
    - `body.customer` deep-equals `{first_name, last_name, email_address, contact_number}` from the buyer;
    - `body.items.length === 2`;
    - `body.items[0].customer` has exactly the keys `first_name`, `last_name`;
    - `body.items[0].price === pricePerTicket`, untouched (59.2 stays 59.2);
    - `body.datetime` matches `/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+0000$/`.
  - `order body, italian`: `items[i].customer` has exactly `first_name`, `last_name`, `email_address` (the
    buyer's), `national_id` (= passport), `nationality`, `dob`, `gender`, `birth_place` - for every attendee.
  - `no id of ours in the body`: the body has no `external_id` and `customer` has no `id` (open with TixStock).
  - `link email`: `ticketLinkEmail("Juventus - Como", ticketPageUrl("tok"))`: the html has `dir="rtl"`, the event
    name and `https://www.mega-events.co.il/ticket/tok`; the subject is "הקישור לכרטיסים שלכם"; the body says
    "הכרטיסים יופיעו בקישור ברגע שהספק ישלח אותם".
  - `attendee count`: 2 tickets with 1 attendee gives `{ok:false, kind:"attendee_count"}`.
  - `issues block the body`: italian with a missing passport gives `{ok:false, kind:"attendee_issues"}`.
- [ ] **Step 2: Run them.** `npx vitest run lib/__tests__/tixstockBookingRules.test.ts` (myt-main) and `npx tsx
  scripts/tixstock-booking-rules-selftest.ts` (backoffice). Expected: FAIL, module not found.
- [ ] **Step 3: Implement `lib/tixstock-booking/rules.ts`.**
  - `canMoveTo` is one explicit table. A move that is not listed is refused:

    | from | to |
    |---|---|
    | `holding` | `on_hold`, `failed` |
    | `on_hold` | `ordering`, `released`, `failed` |
    | `ordering` | `sale_on_hold`, `approved`, `uncertain`, `failed` |
    | `sale_on_hold` | `approved`, `commissionable`, `cancelled` |
    | `approved` | `commissionable`, `cancelled` |
    | `commissionable` | `cancelled` |
    | `uncertain` | `sale_on_hold`, `approved`, `commissionable`, `cancelled`, `failed` |
    | `released` | `ordering` (the site only: the customer paid after the hold was released) |
    | `failed`, `cancelled` | nothing |

    `cancelled` is only ever reported by TixStock (a webhook or a refresh); nothing here sets it by itself.
  - `attendeeIssues` on an Italian event asks every attendee for a passport, a two-letter nationality, a
    `YYYY-MM-DD` date of birth, a gender and a place of birth.
  - `buildOrderRequest` is the ONE place that names TixStock's attendee fields. `gender` (`M` / `F`) and the ISO
    code in `nationality` are provisional (Global Constraints): say so in a comment.
  - `bookingEnvFor` accepts only the two mode strings.
  - No imports, so the module stays byte-identical.
- [ ] **Step 4: Run both test files.** Expected: PASS. Copy the file to the backoffice, and `cmp` the pair.
  Expected: no output.
- [ ] **Step 5: Commit each repo** (`feat(tixstock): pure booking rules shared with the site`).

### Task 3: TixStock HTTP client (byte-identical) + backoffice env resolver

**Files:**
- Create: `myt-backoffice/lib/tixstock-booking/client.ts` (written and tested here, where the selftest lives),
  copied to `myt-main/lib/tixstock-booking/client.ts`
- Create: `myt-backoffice/lib/services/tixstock-booking-env.ts`
- Test: `myt-backoffice/scripts/tixstock-booking-client-selftest.ts` (stub `fetchImpl`)

**Interfaces (produces):**
```ts
export type TixstockCall<T> = { ok: true; data: T }
  | { ok: false; kind: "refused"; status: number; code?: number | string; message: string }
  | { ok: false; kind: "no_answer"; detail: string };
export type RawListing = Record<string, unknown>; // TixStockListing shape, read with the site's types
export type TixstockClient = {
  listings(eventId: string): Promise<TixstockCall<RawListing[]>>;           // GET /tickets/feed?event_id&target_currency=USD&per_page=50, all pages
  eventVenueCountry(eventId: string): Promise<TixstockCall<string | null>>; // GET /feed?event_id=&per_page=1 -> data[0].venue.country_code
  hold(listingId: string, qty: number): Promise<TixstockCall<{ holdId: string }>>;          // meta.hold_id
  release(holdId: string, qty: number): Promise<TixstockCall<true>>;
  addOrder(holdId: string, qty: number, body: Record<string, unknown>): Promise<TixstockCall<{ orderId: string; status: string;
    currency: string | null; total: number | null }>>; // data.id, data.status, data.currency, data.grand_total
  updateOrder(orderId: string, body: Record<string, unknown>): Promise<TixstockCall<{ status: string }>>;
  getOrder(orderId: string): Promise<TixstockCall<Record<string, unknown>>>; // callers pass TixStock's data.id until TixStock says which id the path takes
};
export function holdExpired(r: TixstockCall<unknown>): boolean; // refused, with status 404 or a message matching /resource not found/i
export function createTixstockClient(cfg: { baseUrl: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number }): TixstockClient;
// backoffice only:
export const TIXSTOCK_PRODUCTION_URL = "https://pf.tixstock.com/v1";
export function tixstockClientFor(env: BookingEnv): { ok: true; client: TixstockClient } | { ok: false; kind: "not_configured" | "production_closed" };
```

- [ ] **Step 1: Write the failing selftest.** Its cases:
  - `bearer and currency`: `listings("E1")` calls `${baseUrl}/tickets/feed?event_id=E1&target_currency=USD&per_page=50&page=1`
    with `Authorization: Bearer T`; with `meta.last_page = 2` it calls page 2 and concatenates.
  - `hold id`: a 200 `{meta:{hold_id:"h1"}}` gives `{ok:true, data:{holdId:"h1"}}`.
  - `5xx is no_answer`: a 502 on `addOrder` gives `kind:"no_answer"`; an AbortError (timeout) and a thrown
    `TypeError` give `no_answer`.
  - `4xx is refused`: a 403 `{"message":"request is forbidden"}` gives `kind:"refused", status:403`; a 400 with
    `{"code":108}` gives `code:108`.
  - `empty add answer`: a 200 with body `[]` on `addOrder` gives `kind:"refused"` with a message containing
    `datetime`.
  - `expired hold`: a 404 `{"message":"Resource Not Found"}` on `addOrder` gives `refused`, and `holdExpired` is
    true for it. `holdExpired` is false for a 400 with code 108 and for a `no_answer`.
  - `order answer`: a 200 `{data:{id:"9", status:"Approved", currency:"GBP", grand_total:"150.00"}}` gives
    `{orderId:"9", status:"Approved", currency:"GBP", total:150}`; with neither field, both are `null`.
  - `env resolver`:
    - `production` with `NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING` unset gives `production_closed`;
    - set but with no `NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN` gives `not_configured`;
    - `sandbox` with no sandbox token gives `not_configured`;
    - never returns a client built from `NEXT_SECRET_TIXSTOCK_TOKEN`.
- [ ] **Step 2: Run it.** `npx tsx scripts/tixstock-booking-client-selftest.ts`. Expected: FAIL.
- [ ] **Step 3: Implement both files.**
  - Default `timeoutMs` 15000 (`AbortController`), `cache: "no-store"`, JSON body.
  - `release` treats code 109 as `ok` (already released).
  - The env resolver reads `process.env` at call time.
- [ ] **Step 4: Run it.** Expected: PASS. Copy `client.ts` to myt-main and `cmp`.
- [ ] **Step 5: Commit each repo** (`feat(tixstock): booking API client (sandbox + production by event)`).

### Task 4: Webhook receiver (backoffice)

**Files:**
- Create: `lib/services/tixstock-webhook.ts`, `app/api/tixstock/webhook/[env]/route.ts`
- Create: `lib/services/tixstock-order-apply.ts` (shared with the refresh action and the sweep)
- Modify: `vercel.json` (functions entry `"app/api/tixstock/webhook/[env]/route.ts": { "maxDuration": 30 }`)
- Test: `scripts/tixstock-webhook-selftest.ts`

**Interfaces:**
- Consumes: `statusFromTixstock`, `canMoveTo` (Task 2).
- Produces:
```ts
export function verifyTixstockSignature(rawBody: string, header: string | null, apiToken: string | undefined): boolean;
export type OrderUpdate = { status: BookingStatus | null; files: Array<{ kind: "pdf" | "mobile_link" | "proof" | "additional";
  row: string | null; seat: string | null; base64?: string; url?: string; dedupeKey: string }> };
export function readOrderPayload(type: string, data: Record<string, unknown>): OrderUpdate; // in tixstock-order-apply.ts
export function applyOrderUpdate(bookingId: string, update: OrderUpdate, deps: ApplyDeps): Promise<{ status: BookingStatus; newFiles: number }>;
export function handleTixstockWebhook(input: { env: BookingEnv; rawBody: string; signature: string | null; apiToken: string | undefined },
  deps: WebhookDeps): Promise<{ status: number; body: { external_id: string | null; order_status: string | null; message: string; success: boolean } }>;
```
  - **Payload:** `{data, meta}`. Type = `meta.type`; order id = `data.order_id`; listing = `data.id`; PDF =
    `data.file`; `data.proof_file_url[]`; `data.additional_file`; `data.mobile_links[{seat, link}]`; status =
    `data.order_status ?? data.status`.
  - **`dedupeKey`:** `${orderId}:${kind}:${row}:${seat}:${index}`. The webhook type is NOT in it, so the same
    file arriving again through a refresh (`orders/get`) is not stored twice.
  - **Storage path** (inside the `ticket-files` bucket; the bucket's name is not part of it):
    `${bookingId}/${sha256(dedupeKey).slice(0, 32)}`. Row and seat are a seller's free text and never go into a
    path.
  - **`external_id`** in every answer = the booking's reservation id as a string; `null` when no booking matched.

- [ ] **Step 1: Write the failing selftest** (all I/O through `deps` stubs):
  - `bad signature 401`: a wrong signature gives 401; nothing saved; the event is logged with
    `signature_valid:false`.
  - `missing token 401`: an undefined API token gives 401 (fails closed).
  - `signature encodings`: the HMAC-SHA256 of the raw body keyed with the token passes as lower-case hex, as
    upper-case hex, as `sha256=<hex>` and as base64. The digest of the same JSON re-serialised with another key
    order fails.
  - `eticket stores and answers`:
    - payload `meta.type="order.eticket_fulfilment"`, `data.order_status="Approved"`, one base64 `file`;
    - `saveFile` is called once with kind `pdf`;
    - booking status `approved`;
    - answer 200 `{external_id: "<reservation id>", order_status:"Approved", success:true}`;
    - a `source=site` booking gets `released_to_customer_at` from this first file (plan call 12); a
      `source=office` booking does not - staff release it (Task 15).
  - `repeat is idempotent`: the same payload twice gives `saveFile` once in total; the answers are equal.
  - `no status regression`: Commissionable first, then a late Approved: the stored status stays
    `commissionable`, and the answer says `Commissionable`.
  - `mobile link`: `mobile_links:[{seat:"12",link:"https://x"}]` stores kind `mobile_link` with that url.
  - `proof only`: `proof_file_url:["https://p"]` stores kind `proof`.
  - `instruction letter`: `additional_file` stores kind `additional`.
  - `retry after a half-stored file`: the upload succeeded but the row insert failed; the same payload again
    uploads over the object (`upsert:true`) and inserts the row - one row in the end.
  - `uncertain is matched`: an unknown order id, plus exactly ONE `uncertain` booking of the same env with that
    `listing_id` and quantity, created under 60 minutes ago: it gets `tixstock_order_id` and moves to the
    payload's status. With two such bookings nothing is matched: logged, `success:false`.
  - `unknown order`: no booking and no uncertain match gives 200 with `success:false`, `message:"unknown order"`.
  - `hold, release and listing fulfilment are logged only`: `meta.type` of `ticket.hold`, `ticket.release` or
    `ticket.fullfillment` (no order id): the event is logged, nothing else is read or written, and the answer is
    200 `{external_id:null, order_status:null, message:"logged", success:true}`. TixStock fires these for every
    hold we place ourselves, so "unknown order" would answer `success:false` to each of them.
  - `order.update answers our status`: answers with the booking's current status, as TixStock spells it.
- [ ] **Step 2: Run it.** `npx tsx scripts/tixstock-webhook-selftest.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`verifyTixstockSignature`:** HMAC-SHA256 of the raw body, keyed with the environment's API token (TixStock
    10.11: "hashed using sha256 ... the payload of the webhook JSON encoded ... The key is set to your Bearer
    Token"). The header may be hex in either case, `sha256=<hex>` or base64; compared with `timingSafeEqual`
    (copy `lib/whatsapp/rules.ts:64-70`). The body is read with `request.text()` BEFORE any parse and is never
    re-serialised. The first sandbox webhook is the proof of this reading (Task 17, Stage 5).
  - **The route:** copies `app/api/whatsapp/webhook/route.ts`. `env` param `sandbox` | `production`, else 404.
    Key from `NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN` / `NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN`. Header
    `x-tixstock-signature`. Real deps: `supabase` from `@/lib/supabase-server`, and storage `upload(path,
    Buffer.from(base64,"base64"), {contentType, upsert:true})`; the file row is inserted with `on conflict
    (dedupe_key) do nothing`. `content_type` is `application/pdf` when the bytes start with `%PDF`, else
    `application/octet-stream`.
  - **Size:** Vercel refuses a request body over 4.5 MB before the route runs, so a very large PDF webhook never
    arrives. The fallback is the refresh (`orders/get`, Task 6 / Task 15); TixStock was asked on 10.11 whether a
    webhook can be that large.
  - **The log:** `tixstock_webhook_events` stores the payload with each base64 body replaced by
    `{bytes: n}`.
- [ ] **Step 4: Run it.** Expected: PASS. Run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** (`feat(tixstock): signed webhook receiver stores tickets, links and proof`).

### Task 5: Keep test events out of the price sync

**Files:**
- Modify: `lib/services/tixstock-price-sync.ts:266-274`
- Create: `scripts/tixstock-sync-selection-check.ts` (read-only)

**Not before Task 1's migration is live on production:** the filter names the new column (Global Constraints).

- [ ] **Step 1: Write the read-only check** `scripts/tixstock-sync-selection-check.ts` (`npx tsx`, loads
  `.env.local` = production, writes nothing). It runs the selection of `loadEvents` twice - with today's filters,
  and with the new one added - and prints each count and whether the two id sets are equal. A dry-run of the
  cron under `npm run dev` reads the LOCAL Supabase and proves nothing about production.
- [ ] **Step 2: Run it.** If it fails on a missing column, stop: the migration is not live. Otherwise the two
  sets are equal, because no event has the column set yet.
- [ ] **Step 3: Add the filter.** Add `.or("tixstock_booking.is.null,is_test.is.false")` after
  `.is("is_deleted", null)` in `loadEvents`. It sits before the `eventIds` branch, so the cron, admin-sync, the
  editor's "check now" and the uploader's recheck are all covered. An event leaves the sync only when it is BOTH
  a test event and carries the mode: a real event stays in even if the column is ever set on it by mistake
  (`is_test` is `boolean not null default false`). Nothing else in the file changes.
- [ ] **Step 4: Verify.** `npx tsc --noEmit`; `git diff -- lib/services/tixstock-price-sync.ts` shows the one
  added line.
- [ ] **Step 5: Commit** (`fix(tixstock-sync): skip TixStock sandbox test events`), with the check script.

### Task 5A: The partner portal skips test events

**Why:** the portal's event lists filter `is_deleted`, `is_hidden` and the date only. A test event cannot be
hidden (`confirm-order` refuses a hidden event), so a partner would find the sandbox event in the package
builder, in quotes and on the "what's new" rail of every partner's home - and could sell it to a real customer.
True for today's test events too. It must be live before Task 16's `--apply`.

**Files:**
- Modify: `lib/actions/portal-package-actions.ts` (`:222`, `:443`, `:876`),
  `lib/actions/portal-dashboard-actions.ts` (`:259`, `:675`), `lib/actions/quote-actions.ts` (`:121`, `:165`,
  `:224`) - the eight `.eq("is_hidden", false)` lines as of 10.11
- Create: `scripts/portal-test-events-check.ts` (read-only)

- [ ] **Step 1: Read each of the eight queries.** `grep -n 'is_hidden' <the three files>`. For each one: is it a
  LIST or a search of events offered to a partner, or a read of one event by id? Only lists and searches get the
  filter; a by-id read stays as it is, so nothing a partner already holds breaks. Also `grep -rn
  'from("events")' app/portal lib/actions/portal-*.ts lib/actions/quote-actions.ts` for a list with no
  `is_hidden` line at all.
- [ ] **Step 2: Write the read-only check** `scripts/portal-test-events-check.ts` (`npx tsx`, `.env.local`). It
  prints the events that are `is_test = true`, not hidden, not deleted and in the future: the ones a partner can
  see today.
- [ ] **Step 3: Add `.eq("is_test", false)`** right after each list's `.eq("is_hidden", false)`. `is_test` is
  `boolean not null default false` (`20260806170000_test_events_flag.sql`), so no real event is dropped.
- [ ] **Step 4: Verify.** `npx tsc --noEmit`; `git diff --stat` shows the three files, one added line per query.
  After deploy: in the portal (Dor's signed-in browser pane) search for one of the names Step 2 printed - it is
  not offered; a real event still is.
- [ ] **Step 5: Commit** (`fix(portal): test events never reach a partner's lists`).

### Task 6: Bookings sweep cron (backoffice)

**Files:**
- Create: `lib/services/tixstock-booking-sweep.ts`, `app/api/cron/tixstockBookings/route.ts`
- Modify: `vercel.json` (`{ "path": "/api/cron/tixstockBookings", "schedule": "*/10 * * * *" }`)
- Test: `scripts/tixstock-booking-sweep-selftest.ts`

**Interfaces:**
- Consumes: `tixstockClientFor` (Task 3); `applyOrderUpdate`, `readOrderPayload` (Task 4).
- Produces: `sweepTixstockBookings(now: Date, deps: SweepDeps): Promise<{ released: number; approved: number;
  overdue: number; refreshed: number }>`.

- [ ] **Step 1: Write the failing selftest.**
  - `abandoned hold released`: a `source=site` row `on_hold`, created 16 minutes ago, whose reservation is not
    Paid: the row is moved to `released` FIRST (`... where id = $1 and status = 'on_hold'`), then `release` is
    called once. When that update matches no row (a payment claimed it meanwhile), `release` is not called. The
    same row at 14 minutes is untouched.
  - `paid but never ordered`: a `source=site` row still `on_hold` 20 minutes after creation whose reservation IS
    Paid (the `after()` never ran): moved to `failed` with `last_error:"paid_not_ordered"`, `release` called
    once, `console.error` with `"tixstock_paid_site_booking_not_ordered"`. No `addOrder` from the sweep (plan
    call 11).
  - `dead order attempt is uncertain`: a row `ordering` whose `attempt_started_at` is over 5 minutes old becomes
    `uncertain`, with no client call. TixStock may hold that order.
  - `stuck office rows`: `holding` over 5 minutes old becomes `failed` (`last_error:"hold_never_answered"`; a
    hold, if one was placed, expires by itself). A `source=office` row `on_hold` over 15 minutes old is moved to
    `released`, then `release` is called once.
  - `stuck sale on hold approved`: a `sale_on_hold` row 6 minutes old with a Paid reservation:
    `updateOrder(orderId, {order_status:"Approved"})` is called and the row becomes `approved`. For a
    `source=site` row with `link_email_sent_at` null, the link email is sent once and the column is set; a row
    that has it set gets no second email.
  - `overdue logged`: a `sale_on_hold` row over 90 minutes old whose update fails: `overdue === 1` and
    `console.error` is called with `"tixstock_sale_on_hold_over_90m"` (the card shows it too, Task 15).
  - `daily refresh`: an `approved` row with no files and no refresh in 24h, whose event is within 14 days OR
    whose `env` is `sandbox` (the test event is months away): `getOrder` is called once, `applyOrderUpdate` is
    applied and `last_refresh_at` is set.
  - `dry run`: with `dryRun:true`, no client call and no write.
- [ ] **Step 2: Run it.** `npx tsx scripts/tixstock-booking-sweep-selftest.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The route: `guardCronRoute(request)` first; `?dry_run=1`; batch of 25.
  - Every status change is a compare-and-set on the status it read; a lost race is skipped, never retried.
  - The link email goes through `lib/email.ts` with the text of `ticketLinkEmail` (Task 2) and the From the
    site's confirmation email uses (`"MegaEvents Reservations" <reservations@mega-events.co.il>`).
  - **Not committed before Task 1's migration is live:** the cron runs every 10 minutes and reads the new table.
- [ ] **Step 4: Run it.** Expected: PASS. Run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** (`feat(tixstock): sweep abandoned holds, stuck Sale on Hold, missing tickets`).

---

## Phase B - The site test flow (myt-main)

### Task 7: Sandbox env, cards rule and the sandbox listings route

**Files:**
- Create: `lib/tixstock-booking/site-env.ts`, `lib/tixstock-booking/sandbox-cards.ts`,
  `app/api/tixstock/sandbox-tickets/route.ts`
- Test: `lib/__tests__/tixstockSandboxCards.test.ts`

**Interfaces:**
- Consumes: `createTixstockClient` (Task 3), `isSandboxBookingEvent` (Task 2), `getEvents` (read-only import),
  `listingCanSatisfyQuantity`, `hasObstructedViewRestriction`, `isExcludedSection` (imports, not edits).
- Produces:
```ts
export function sandboxClient(): TixstockClient | null; // null when either sandbox env var is missing
export type SandboxCard = { category: string; listingId: string; pricePerTicketUsd: number; listingAmountUsd: number; ticketType: string;
  splitType: string; singleSeats: boolean; restrictions: string[]; deliveryDate: string | null;
  instantDownload: boolean; available: number };
export function sandboxCards(listings: TixStockListing[], qty: number): SandboxCard[];
// GET /api/tixstock/sandbox-tickets?db_event_id=&ticket_quantity=
//   -> 200 { cards: SandboxCard[], mapListings: TixStockListing[], venueCountryCode: string | null, tixEventId: string }
//   -> 404 when the event is not a sandbox booking event; 503 when sandboxClient() is null
```

- [ ] **Step 1: Write the failing vitest.**
  - `cheapest per category`: two `Longside` listings priced 80 and 60 (USD) give one card, with the listing priced
    60 and `pricePerTicketUsd === 60`.
  - `price rounds up`: an amount of `"59.20"` gives `pricePerTicketUsd === 60` (what the customer sees) and
    `listingAmountUsd === 59.2` (what TixStock is told).
  - `display quantity caps`: `quantity_available:10, display_quantity:2` with qty 3 is excluded; with qty 2,
    `available === 2`.
  - `zero display uses available`: `display_quantity:0, quantity_available:5` gives `available === 5`.
  - `single seats flagged`: a split type that contains "single" (any case) gives `singleSeats === true`.
  - `split rule applies`: an all-or-nothing listing ("Sell Together" and "All Together" both) with 4 available
    and qty 2 is excluded - through `listingCanSatisfyQuantity`, never by comparing the string here.
  - `lead booker listings are left out`: `requires_lead_booker: true` gives no card.
  - `instant download`: `"1"`, `"true"` and `"Yes"` are true; `"0"` and `""` are false.
  - `restrictions text`: `restrictions_benefits.options` names plus `other` (non-empty) become `restrictions`,
    with the same extraction as `TicketSelection.tsx:842-852`.
  - `restricted view dropped`: a listing with an obstructed-view restriction gives no card.
- [ ] **Step 2: Run it.** `npx vitest run lib/__tests__/tixstockSandboxCards.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`sandboxCards`:** groups by the normalised category, the same way `cheapestTixstockListing` normalises it.
    Import the helper `lib/supplier-offers.ts` uses; if it is not exported, port it verbatim into
    `sandbox-cards.ts`, since that file is protected.
  - **The route:**
    1. `getEvents(Number(db_event_id))`, then `isSandboxBookingEvent`.
    2. `tixEventId` = the event's TixStock `eid`, using the same helper `TicketSelection.tsx:317` uses
       (import it).
    3. `client.listings(tixEventId)` and `client.eventVenueCountry(tixEventId)`.
    4. Answer `Cache-Control: no-store`.
    
    It **never writes** `tickets_and_rates` and never invalidates a cache.
- [ ] **Step 4: Run it.** Expected: PASS. Run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** (`feat(tixstock): sandbox listings route + one card per category, the listing's own details`).

### Task 8: The sandbox ticket step

**Files:**
- Create: `app/order/sandbox/SandboxTicketStep.tsx`
- Modify: `app/order/OrderForm.tsx:638` (only this line)

**Interfaces:**
- Consumes: `GET /api/tixstock/sandbox-tickets` (Task 7), `isSandboxBookingEvent` (Task 2), `OrderContext`
  (`setEventTicket`, the step setter that `TicketSelection` uses to continue), `TixstockDynamicMap` (read its
  props, do not edit it).
- Produces: an `OrderTicket` with `id` = the id of the event's `tickets_and_rates` row of that category,
  `supplier:"tixstock"`, `eid: tixEventId`, `category`, `price: pricePerTicketUsd`, `quantity`,
  `supplierCategory: category`, and `tixstock: { listingId, italian: venueCountryCode === "IT", singleSeats }`.
  The `id` is not optional: the continue bar is disabled without it (`OrderForm.tsx:265`, `:451`), and the order
  draft restores a ticket only when its id is on the event (`lib/order/draft.ts:263-267`). A card whose category
  has no row on the event is not shown, and is logged.

- [ ] **Step 1: Add the branch.** At `OrderForm.tsx:638`: `{step === 1 && (isSandboxBookingEvent(event) ?
  <SandboxTicketStep initialEvent={event} /> : <TicketSelection initialEvent={event} />)}`.
- [ ] **Step 2: Build the component.**
  - quantity 1-9 (`MAX_TICKETS` = 9);
  - fetch on every quantity change;
  - one card per `SandboxCard`: zone/category title, price, ticket type, a split line, "ייתכן שהמושבים לא יהיו
    צמודים" when `singleSeats`, the restrictions list, the delivery date, an instant-download badge, and
    "available N";
  - the map highlights the chosen card's category;
  - choosing a card sets the ticket and continues like `TicketSelection` does;
  - on 404 or 503, a short "האירוע לא זמין" notice. Hebrew, RTL, Tailwind.
- [ ] **Step 3: Verify locally.** `yarn dev` (one dev server per checkout; it reads the PRODUCTION DB), with the
  sandbox env in `.env.local` and the Task 16 test event already created (see Execution order). Open `/order/<test event id>`: the cards match the Seller Portal listings.
  Open one real `tx_event` and one `sports_event`: their ticket step is unchanged (take screenshots before and
  after).
- [ ] **Step 4: Check types.** Run `npx tsc --noEmit`. Expected: no new errors.
- [ ] **Step 5: Commit** (`feat(tixstock): sandbox ticket step for test events only`).

### Task 9: Summary - Italian fields, listing id, back-to-ticket guard

**Files:**
- Create: `lib/tixstock-booking/summary.ts`, `app/order/sandbox/AttendeeFields.tsx`
- Modify: `app/order/OrderReview.tsx` (blocks behind `const sandboxBooking = isSandboxBookingEvent(event)` only,
  plus the `TICKET_UNAVAILABLE` mapping)
- Test: `lib/__tests__/tixstockSummary.test.ts`

**Interfaces:**
- Consumes: `attendeeIssues`, `AttendeeInput` (Task 2), `OrderTicket.tixstock` (Task 1).
- Produces:
```ts
export function sandboxSummaryState(event: EventFlags | undefined, ticket: OrderTicket | undefined):
  { kind: "none" } | { kind: "pick_again" } | { kind: "ready"; italian: boolean; singleSeats: boolean };
export function attendeesForRequest(passengers: Array<{ firstName: string; lastName: string }>,
  extra: Array<Partial<AttendeeInput>>, italian: boolean): AttendeeInput[];
// request body (top level, sandbox only): tixstock_listing_id: string, tixstock_attendees: AttendeeInput[]
// event_order_info (sandbox only): tixstock_sandbox: true
```

- [ ] **Step 1: Write the failing vitest.**
  - `none for real events`: `sandboxSummaryState({is_test:false}, ticket)` gives `{kind:"none"}`.
  - `pick_again without listing`: a sandbox event with a ticket that has no `tixstock` gives `{kind:"pick_again"}`.
  - `ready`: with `tixstock:{listingId:"L", italian:true, singleSeats:false}`, gives `{kind:"ready",
    italian:true, singleSeats:false}`.
  - `attendees`: two passengers plus extras give two entries, with names trimmed. Italian fields are kept only
    when `italian`.
- [ ] **Step 2: Run it.** `npx vitest run lib/__tests__/tixstockSummary.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `summary.ts` and wire `OrderReview.tsx`.**
  - **`pick_again`:** the pay block is replaced by a notice and a button back to step 1.
  - **`ready` with `italian`:** `AttendeeFields` renders under each traveller row (inside the `passengers.map` at
    about 2981-3196, after the name fieldset). Fields: passport, nationality (`<select>` of ISO alpha-2, with
    Hebrew labels), date of birth, gender (`<select>`: זכר / נקבה) and place of birth - for every traveller. No
    e-mail field. Pay is blocked while `attendeeIssues` returns any issue.
  - **These fields live in the component's own state only.** They are never written to `sessionStorage`:
    `writeOrderForm` (`OrderReview.tsx:746`) and the `myt:order-form` key are not touched, so a passport number
    never sits in the browser's storage. A refresh empties them.
  - **`singleSeats`:** shows "ייתכן שהמושבים לא יהיו צמודים" near the ticket line.
  - **The request:** `updatedFormData` gets `tixstock_listing_id`, `tixstock_attendees`, and
    `event_order_info.tixstock_sandbox = true`, all only when `ready`. `tixstock_sandbox` is not on the shared
    `OrderData` type: a narrow cast at this one write site (as `confirmation/[...params]/page.tsx:208-216` does
    for its server-only fields), not a new field on the shared type.
  - **The error:** `body?.error === "TICKET_UNAVAILABLE"` throws `new Error("TICKET_UNAVAILABLE")`, and the catch
    maps it to `setSubmitFailReason("supplier")` (the existing copy "הכרטיס שבחרתם כבר לא זמין במחיר הזה").
  - **Nothing else** in the file changes. The existing 4 `Fields` and their validation are untouched.
- [ ] **Step 4: Verify.** Run the vitest (PASS) and `npx tsc --noEmit`. Locally:
  - on the test event (Italian), the summary blocks pay until the fields are valid;
  - a refresh with the draft and no listing id shows the back-to-ticket notice;
  - a real event's summary is unchanged.
- [ ] **Step 5: Commit** (`feat(tixstock): attendee details + listing id on the sandbox summary only`).

### Task 10: `confirm-order` - hold the exact listing (test events only)

**Files:**
- Create: `lib/tixstock-booking/site-booking.ts` (hold half)
- Modify: `app/api/confirm-order/route.ts` (one block right before `insertReservation`, after `snapshotTicketCost`
  at ~377-384, and one after the insert at ~460). **Re-read the file first:** another session ("server-side check
  of the checkout price") may have moved these anchors since 10.11.
- Test: `lib/__tests__/tixstockSiteHold.test.ts`

**Interfaces:**
- Consumes: `siteBooksAfterPayment`, `attendeeIssues` (Task 2); `sandboxClient` (Task 7); `sandboxCards` rules
  (fit + price, Task 7).
- Produces:
```ts
export type HeldListing = { holdId: string; tixEventId: string; listingId: string; quantity: number;
  pricePerTicketUsd: number; listingAmountUsd: number; snapshot: Record<string, unknown>; attendees: AttendeeInput[];
  italian: boolean };
export function prepareSiteHold(req: { listingId: unknown; attendees: unknown; eventId: number; quantity: number;
  payNow: boolean; chargedPerTicketUsd: number }, deps: SiteHoldDeps):
  Promise<{ kind: "none" } | { kind: "held"; held: HeldListing } | { kind: "unavailable" } | { kind: "bad_attendees" }>;
export function recordSiteHold(reservationId: number, held: HeldListing, buyer: Buyer, deps: SiteHoldDeps): Promise<void>; // releases the hold if the insert fails
export function releaseHeld(held: HeldListing, deps: SiteHoldDeps): Promise<void>;
export function buyerFromOrder(o: { main_contact_first_name: string; main_contact_last_name: string;
  main_contact_email: string; main_contact_phone_number: string }): Buyer;
```

- [ ] **Step 1: Write the failing vitest** (deps stubbed):
  - `none without listing id`: `listingId: undefined` gives `{kind:"none"}`, and `deps.loadEventFlags` is **not
    called**.
  - `none when not paying now`: `payNow:false` gives `none`.
  - `ignores a listing id on a real event`: `loadEventFlags` returns `{is_test:false}`: the result is `none`,
    `console.warn` is called once, and no client call is made.
  - `unavailable when gone`: the listing is not in the sandbox listings.
  - `unavailable when dearer`: the listing price is 61 with `chargedPerTicketUsd` 60.
  - `unavailable when quantity no longer fits`.
  - `bad attendees`: a count mismatch, or an attendee of an Italian event with no passport / gender / place of
    birth.
  - `held`: the hold is called with `(listingId, quantity)`, and the result carries `holdId`.
  - `record releases on insert failure`: the booking insert rejects: `release(holdId, quantity)` is called once.
  - `record writes token`: the inserted row has `status:"on_hold"`, `source:"site"`, `env:"sandbox"`, and
    `customer_token` matching `/^[A-Za-z0-9_-]{43}$/` (`randomBytes(32).toString("base64url")`).
  - `record keeps the feed's amount`: the row's `price_per_ticket` is `listingAmountUsd` (59.2), not the card's
    60.
- [ ] **Step 2: Run it.** `npx vitest run lib/__tests__/tixstockSiteHold.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the module and wire the route.**
  - **Right before `insertReservation`** (not after `validateOwnStock`: `resolveAgentSettlement` at ~360-371 can
    still answer 400 after that point, and a hold placed earlier would leak):
    1. `const siteHold = await prepareSiteHold({ listingId: orderDetails.tixstock_listing_id, attendees:
       orderDetails.tixstock_attendees, eventId: Number(validatedData.event_id), quantity:
       validatedData.event_order_info.number_of_ticket, payNow, chargedPerTicketUsd:
       validatedData.event_order_info.price_per_ticket }, realSiteHoldDeps())`.
    2. `unavailable` → `NextResponse.json({ error: "TICKET_UNAVAILABLE" }, { status: 400 })`.
    3. `bad_attendees` → 400 `{ error: "Invalid order data" }`.
  - **After a successful insert:** `if (siteHold.kind === "held") await recordSiteHold(id, siteHold.held,
    buyerFromOrder(validatedData), realSiteHoldDeps())`.
  - **On insert failure:** release the hold.
  - Every error inside the module is caught and logged, and it never throws into the route.
- [ ] **Step 4: Verify.** Run the vitest (PASS) and `npx tsc --noEmit`. Then `git diff -- app/api/confirm-order/route.ts`:
  it shows only those blocks.
- [ ] **Step 5: Commit** (`feat(tixstock): hold the customer's exact listing at the pay click (test events only)`).

### Task 11: After payment - order, approve, link email; release on failure

**Files:**
- Modify: `lib/tixstock-booking/site-booking.ts` (payment half)
- Create: `lib/tixstock-booking/ticket-link-email.ts`
- Modify: `app/api/payment/validateAndRecord.ts` (one flag beside the existing reservation read, one gated block
  immediately before `return { isSuccess }`)
- Test: `lib/__tests__/tixstockSiteAfterPayment.test.ts`

**Interfaces:**
- Consumes: `buildOrderRequest`, `tixstockDatetime` (Task 2); `sandboxClient` (Task 7); `HeldListing` row shape
  (Task 10).
- Produces: `bookSiteOrderAfterPayment(orderId: string, deps): Promise<"none" | "busy" | "approved" |
  "sale_on_hold" | "uncertain" | "failed">`, `releaseSiteHoldFor(orderId: string, deps): Promise<void>`,
  `sendTicketLinkEmail(to: string, eventName: string, url: string): Promise<void>`.

- [ ] **Step 1: Write the failing vitest.**
  - `none for orders without a site booking`: no `source=site` row for the reservation gives `"none"`, after one
    lookup and no client call.
  - `one orders/add when two callers race`: two concurrent calls with a CAS stub where only the first claim
    (`on_hold` → `ordering`) succeeds: `addOrder` is called once, and the second call returns `"busy"`. A third
    call an hour later, with the row still `ordering`, is `"busy"` too: the claim never expires here (the sweep
    turns a dead one into `uncertain`, Task 6).
  - `sale on hold then approved`:
    - `addOrder` with body `order_status === "Sale on Hold"`;
    - then `updateOrder(orderId, { order_status: "Approved" })`;
    - the row ends `approved` with `approved_at`;
    - `sendTicketLinkEmail` is called once with `ticketPageUrl(token)`, and `link_email_sent_at` is set;
    - the row keeps the answer's `order_currency` / `order_total`. When the total is not quantity × the amount
      sent (±0.01), or the currency is not USD, `console.warn` is called with `"tixstock_order_total_mismatch"`
      and the booking still goes through.
  - `re-holds once after an expired hold`: the first `addOrder` is refused with `holdExpired` true (404
    "Resource Not Found"), `hold` is called again for the same listing, and the second `addOrder` succeeds. If
    the second is also refused, the new hold is released, the row is `failed` with `last_error`, and there is no
    third call.
  - `any other refusal does not re-hold`: `addOrder` is refused with a 400: `release` once, `failed`, no second
    `hold`.
  - `no answer is uncertain`: `addOrder` gives `no_answer`, on the first call or after a re-hold: the row is
    `uncertain`, with no `updateOrder`, no release and no further call.
  - `paid after the hold was released`: the row is `released` and the payment succeeded: it is claimed
    (`released` → `ordering`), a new hold is placed, and the order goes on as usual. If the listing is gone the
    row is `failed`.
  - `approve failure leaves sale on hold`: `updateOrder` is refused: the row stays `sale_on_hold`, for the sweep
    (Task 6).
  - `payment failed releases`: `releaseSiteHoldFor` on an `on_hold` row calls `release` once and the row becomes
    `released`.
- [ ] **Step 2: Run it.** `npx vitest run lib/__tests__/tixstockSiteAfterPayment.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Claim:** `update ticket_bookings set status = 'ordering', attempt_started_at = now() where id = $1 and
    status = 'on_hold'`, returning the row (CAS; no row = `busy`). The claim is a status, not a timer: a claim
    that a second caller may take again after two minutes is exactly a second orders/add.
  - **Re-hold:** only when `holdExpired(refusal)`, once. Never after a `no_answer`.
  - **`releaseSiteHoldFor`** (the payment did not succeed): `on_hold` → `released` by CAS, then `release`. A
    later successful payment of the same order goes through the `released` → `ordering` path.
  - **The buyer:** from the reservation's `main_contact_*`.
  - **`validateAndRecord.ts`** - three additions, and no existing line changes:
    1. `import { after } from "next/server"` (if the installed Next exposes only `unstable_after`, use that).
    2. `let sandboxOrder = false;` before the email `try`; and inside it, right after the existing `const
       orderData = data as OrderData | null;`: `sandboxOrder = (orderData?.event_order_info as {
       tixstock_sandbox?: boolean } | undefined)?.tixstock_sandbox === true;`. The read is already there, so a
       real payment costs no extra query.
    3. Before `return { isSuccess }`:
       ```ts
       if (sandboxOrder) {
         try {
           after(() =>
             (isSuccess ? bookSiteOrderAfterPayment(orderId) : releaseSiteHoldFor(orderId)).catch((e) =>
               console.error("[tixstock-site-booking]", String(e)),
             ),
           );
         } catch (e) {
           console.error("[tixstock-site-booking] after() failed", String(e));
         }
       }
       ```
    
    For a real order this is one boolean and no `after()`. The Paid write and the email run first, exactly as
    before. If the existing read fails, `sandboxOrder` stays false and the sweep's `paid_not_ordered` rule shows
    the order to staff (Task 6).
  - **The link email:** `sendUserEmail.ts` exports only `sendUserEmail` and builds its transport inline, so there
    is nothing to import. `ticket-link-email.ts` builds its own nodemailer transport from the same env
    (`EMAIL_SERVER_USER` / `EMAIL_SERVER_PASSWORD`; copy the options at `sendUserEmail.ts:48-56`) and uses the
    same From (`"MegaEvents Reservations" <reservations@mega-events.co.il>`). The text comes from
    `ticketLinkEmail` (Task 2): subject "הקישור לכרטיסים שלכם"; body: the event name, the link, and "הכרטיסים
    יופיעו בקישור ברגע שהספק ישלח אותם". After it is sent, `link_email_sent_at` is set.
- [ ] **Step 4: Verify.** Run the vitest (PASS) and `npx tsc --noEmit`. `git diff --
  app/api/payment/validateAndRecord.ts` shows additions only - the import, the flag (two lines) and the gated
  block - and no removed line.
- [ ] **Step 5: Commit** (`feat(tixstock): order as Sale on Hold, approve after payment check, test events only`).

### Task 12: The ticket page, the file route, the confirmation block

**Files:**
- Create: `lib/tixstock-booking/ticket-page.ts`, `app/ticket/[token]/page.tsx`,
  `app/api/ticket-file/[token]/[fileId]/route.ts`, `app/api/tixstock/order-summary/[orderId]/route.ts`
- Modify: `app/confirmation/[...params]/page.tsx` (one block after the `Tickets:` row at line 420)
- Test: `lib/__tests__/tixstockTicketPage.test.ts`

**Interfaces:**
- Produces: `loadTicketPage(token: string, deps): Promise<TicketPageData | null>` where `TicketPageData = {
  eventName: string; eventDate: string; category: string; section: string | null; row: string | null;
  ticketType: string; quantity: number; deliveryDate: string | null; restrictions: string[]; released: boolean;
  externalTransfer: boolean; files: Array<{ id: string; kind: string; row: string | null; seat: string | null;
  url?: string }> }`.

- [ ] **Step 1: Write the failing vitest.**
  - `malformed token`: `"abc"` gives `null`, with no DB call.
  - `unknown token`: `null`.
  - `before release`: `released:false` and `files:[]`, even when file rows exist.
  - `after release`: the files are listed; a `pdf` and an `additional` (the seller's instruction letter) have no
    `url` (served by the file route); a `mobile_link` has its `url`; `proof` rows are **never** listed.
  - `summary state`: `approved` with `link_email_sent_at` gives `"ordered"`; `approved` without it, `on_hold`,
    `ordering` and `sale_on_hold` give `"pending"`; `failed`, `uncertain`, `released` and `cancelled` give
    `"problem"`.
- [ ] **Step 2: Run it.** `npx vitest run lib/__tests__/tixstockTicketPage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The page:** a server component, `export const dynamic = "force-dynamic"`, `robots: { index: false, follow:
    false }`. It shows "הכרטיסים יישלחו אליכם עד <date>" before release, and the external-transfer line when it
    applies.
  - **The file route:** checks token → booking → that the file belongs to it, is released and is `pdf` or
    `additional`. Then `supabase.storage.from("ticket-files").download(path)` → `new NextResponse(blob, {
    headers: { "content-type": <the row's content_type, default application/pdf>, "content-disposition":
    "inline; filename=<kind>-<row>-<seat>.pdf", "cache-control": "private, no-store" } })`. Row and seat are a
    seller's free text: every character outside `[A-Za-z0-9_-]` becomes `-` before it goes into the header.
  - **`order-summary/[orderId]`:** returns `{ state, ticketType, restrictions, deliveryDate }` only for a
    reservation with a `source=site` booking, else 404. `state` is `"ordered"`, `"pending"` or `"problem"` (the
    vitest above). No token and no files.
  - **The confirmation page:** fetches it only when `orderData.event_order_info?.tixstock_sandbox === true`, and
    renders the three rows plus one line by `state`:
    - `ordered`: "קישור לכרטיסים נשלח אליכם במייל";
    - `pending`: "הכרטיסים בהזמנה - קישור יישלח אליכם במייל";
    - `problem`: "נציג שלנו יחזור אליכם לגבי הכרטיסים".
    
    It never says a link was sent when none was.
- [ ] **Step 4: Verify.** Run the vitest (PASS) and `npx tsc --noEmit`. A real order's confirmation page makes
  no new request (browser pane, Network tab). After deploy, `curl -sI
  https://www.mega-events.co.il/ticket/<a real token>` shows `cache-control: private, no-store`:
  `middleware.ts` sets a public header on every page, but on a per-request render Next's own header wins
  (measured 10.11 on `/search` and `/confirmation/...`). No middleware edit; if the header ever reads `public`,
  stop and report.
- [ ] **Step 5: Commit** (`feat(tixstock): token ticket page and file route; confirmation block for test orders`).

---

## Phase C - Backoffice button and card

### Task 13: Visibility, listing ranking, open-dialog actions

**Files:**
- Create: `lib/fulfilment/visibility.ts` (the RateHawk work reuses it), `lib/tixstock-booking/rank.ts`,
  `lib/actions/ticket-booking-actions.ts` (read actions)
- Test: `scripts/tixstock-booking-rank-selftest.ts`

**Interfaces:**
- Consumes: `listingsTheSiteSells` (`lib/tixstock-listings.ts`, import only), `tixstockClientFor` (Task 3),
  `bookingEnvFor` (Task 2).
- Produces:
```ts
export function fulfilmentVisibleTo(role: Role | undefined, openFlag: string | undefined): boolean;
export type RankedListing = { listingId: string; category: string; section: string | null; row: string | null;
  ticketType: string; splitType: string; pricePerTicketUsd: number; totalUsd: number; gapUsd: number | null;
  gapPct: number | null; dearer: boolean; restrictions: string[]; deliveryDate: string | null;
  instantDownload: boolean; paper: boolean; leadBooker: boolean }; // pricePerTicketUsd = the feed's amount, not rounded
export function adminOrHidden(guard: () => Promise<unknown>): Promise<boolean>; // false when the guard throws
export function rankListings(listings: TixStockListing[], input: { soldCategory: string | null; quantity: number;
  together: boolean; excludedSections: string[]; costSoldTotalUsd: number | null }):
  { sameCategory: RankedListing[]; others: RankedListing[] };
// "use server". requireAdmin() THROWS for other roles (lib/auth/guards.ts:243-249), and the reservation page is a
// client component that every staff role opens: each action starts with adminOrHidden(requireAdmin) and answers
// { ok:false, kind:"hidden" } - it never throws to the page. Then fulfilmentVisibleTo, with the same answer.
export async function getTicketBooking(reservationId: number): Promise<{ ok: true; booking: TicketBookingView | null; files: TicketFileView[] } | { ok: false; kind: "hidden" | "db" }>; // signed URLs, 300 s
export async function openTicketBooking(reservationId: number, tixstockEventId?: string): Promise<{ ok: true; env: BookingEnv;
  tixstockEventId: string; italian: boolean; listings: ReturnType<typeof rankListings>; buyer: Buyer; attendees: AttendeeInput[];
  hotelShipping: Record<string, string> | null } | { ok: false; kind: "hidden" | "not_paid" | "not_tixstock" | "no_event"
  | "test_without_sandbox" | "production_closed" | "not_configured" | "supplier" }>;
export async function searchTixstockEvents(query: string): Promise<Array<{ event_id: string; event_name: string; show_date: string; venue_name: string }>>;
```

- [ ] **Step 1: Write the failing selftest.**
  - `visibility`:
    - `superadmin` is true with the flag unset;
    - `admin` is false with the flag unset, and true with `"true"`;
    - `editor` is false with `"true"`;
    - `undefined` is false.
  - `same category first, cheapest first`: listings in `Longside` at 90/70 and in `Behind Goal` at 50, with
    `soldCategory:"longside"`, give `sameCategory` ordered 70 then 90, and `others` holding the 50.
  - `gap`: 2 tickets at 70 with `costSoldTotalUsd` 120 give `totalUsd:140`, `gapUsd:20`, `gapPct` ≈ 16.67, and
    `dearer:true`. A `null` cost gives `gapUsd:null` and `dearer:false`.
  - `together excludes single seats`: `together:true` drops a `Single Seats` listing.
  - `restricted view excluded`: through `listingsTheSiteSells`.
  - `paper flagged`: `ticket.type:"Paper"` (case-insensitive) gives `paper:true`.
  - `lead booker flagged`: `requires_lead_booker:true` gives `leadBooker:true`.
  - `guard never throws`: `adminOrHidden(async () => { throw new Error("Unauthorized"); })` resolves to `false`;
    with a guard that resolves, `true`.
- [ ] **Step 2: Run it.** `npx tsx scripts/tixstock-booking-rank-selftest.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Ported verbatim into `rank.ts`:** myt-main `listingSeatsTogether` (`lib/tixstock-quantity.ts:34`) and
    `normalizeTxCategory` (`lib/tixstock-category.ts:14`), each with a comment naming its source file. The
    backoffice's `lib/tixstock-listings.ts` exports neither, and it is protected.
  - **`adminOrHidden`** lives in `lib/fulfilment/visibility.ts`; every ticket action starts with it.
  - **`openTicketBooking`:**
    - **Event id:** the TixStock event id comes from `event_order_info.supplier_event_id`, or from the argument
      (hand-typed rows, via `searchTixstockEvents`).
    - **Italian:** `tixstock_events.country_code === "IT"`, or for sandbox events `client.eventVenueCountry`.
    - **Shipping:** `hotelShipping` comes from `hotel_order_info` (name, address, check-in date).
    - **Attendees:** the lead first, then `more_pax_info`.
- [ ] **Step 4: Run it.** Expected: PASS. Run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** (`feat(tixstock): ranked live listings and the gap for the booking dialog`).

### Task 14: The book action

**Files:**
- Create: `lib/tixstock-booking/office-booking.ts`
- Modify: `lib/actions/ticket-booking-actions.ts` (add `bookReservationTicket`)
- Test: `scripts/tixstock-office-booking-selftest.ts`

**Interfaces:**
- Consumes: `buildOrderRequest`, `attendeeIssues` (Task 2); `tixstockClientFor` (Task 3); `rankListings` data
  (Task 13); `logAudit` (`@/lib/audit`).
- Produces:
```ts
export type OfficeBookingInput = { reservationId: number; tixstockEventId: string; listingId: string; buyer: Buyer;
  attendees: AttendeeInput[]; italian: boolean; shippingAddress?: Record<string, string>; acceptGap: boolean;
  acks: { flightHotelDone: boolean; notBoughtByHand: boolean; finalPurchase: boolean } };
export type OfficeBookingResult = { ok: true; status: "approved"; orderId: string }
  | { ok: false; kind: "hidden" | "acks" | "attendees" | "shipping" | "gap_not_accepted" | "locked" | "gone"
      | "refused" | "uncertain" | "production_closed" | "not_configured" | "db"; message?: string };
export function runOfficeBooking(input: OfficeBookingInput, actor: string, deps: OfficeDeps): Promise<OfficeBookingResult>;
export async function bookReservationTicket(input: OfficeBookingInput): Promise<OfficeBookingResult>; // "use server"
```
  - **The three acks are required on every reservation in this work** (plan call: the fulfilment panel that
    would know "hotel step done" is not built yet). They are stored in `prerequisites_ack` with who and when.
  - When the RateHawk panel lands, `flightHotelDone` is replaced by its hotel-step rule.

- [ ] **Step 1: Write the failing selftest** (deps stubbed):
  - `acks required`: any ack false gives `kind:"acks"`, with no DB or client call.
  - `dearer needs acceptGap`: the live listing is dearer than `cost_sold_usd` and `acceptGap:false`: the result is
    `gap_not_accepted`, with no hold call.
  - `locked`: the booking insert hits the unique violation: `locked`, with no hold call.
  - `gone`: `hold` is refused with code 108: the row is `failed` and the result is `gone`.
  - `hold with no answer`: `hold` gives `no_answer`: the row is `failed` (`last_error:"hold: no answer"`), with no
    release call (there is no hold id; a hold TixStock did place expires in 10 minutes) and no `addOrder`.
  - `approved`: the row goes `holding` → `on_hold` → `ordering` (CAS) → `approved`: hold, then `addOrder` with
    `order_status:"Approved"`. The row has `tixstock_order_id`, `order_currency` and `order_total`, and
    `logAudit` is called with `action:"tixstock_ticket_booked"`.
  - `refused releases once`: `addOrder` is refused: `release(holdId, qty)` is called once, and the row is
    `failed`. An expired hold (404) is a refusal like any other here: no automatic re-hold - staff press the
    button again.
  - `no answer is uncertain`: `addOrder` gives `no_answer`: the row is `uncertain`, with no release and no second
    `addOrder`.
  - `paper needs shipping`: a paper listing with no `shippingAddress` gives `shipping`.
  - `audit before the call`: `logAudit` with `action:"tixstock_ticket_booking_started"` is called before `hold`.
- [ ] **Step 2: Run it.** `npx tsx scripts/tixstock-office-booking-selftest.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The action: `adminOrHidden(requireAdmin)` (Task 13), then `fulfilmentVisibleTo`, then
  `runOfficeBooking` with real deps. Errors are returned, never thrown.
- [ ] **Step 4: Run it.** Expected: PASS. Run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** (`feat(tixstock): book ticket - hold + Approved order, lock, audit, uncertain`).

### Task 15: The card, the dialog, delivery and the list view

**Files:**
- Create: `app/(dashboard)/reservations/[id]/ticket-booking-card.tsx`,
  `app/(dashboard)/reservations/[id]/ticket-booking-dialog.tsx`, `lib/tixstock-booking/customer-email.ts`
- Modify: `lib/actions/ticket-booking-actions.ts` (delivery actions), `lib/email.ts` (attachments),
  `app/(dashboard)/reservations/[id]/page.tsx` (render the card after the Event Information card, about line 700),
  `lib/actions/reservation-actions.ts` + `types/reservation.types.ts` + `reservations-table.tsx` (view
  `tickets-waiting`)
- Test: `scripts/tixstock-customer-email-selftest.ts`

**Interfaces:**
- Consumes: Tasks 4, 13 and 14.
- Produces:
```ts
// lib/email.ts
export type SendMailInput = { /* existing */ attachments?: Array<{ filename: string; content: Buffer; contentType: string }> };
// lib/tixstock-booking/customer-email.ts
export const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
export function customerTicketEmail(v: { eventName: string; eventDate: string; seats: string; ticketType: string;
  restrictions: string[]; deliveryNote: string | null; pageUrl: string; externalTransfer: boolean;
  mobileLinks: string[] }): { subject: string; html: string; text: string };
export function whatsappTicketText(v: { eventName: string; pageUrl: string }): string;
// actions ("use server", requireAdmin + fulfilmentVisibleTo, audited):
markTicketsChecked(bookingId: string); sendTicketsToCustomer(bookingId: string); markWhatsappSent(bookingId: string);
updateTicketAttendees(bookingId: string, attendees: AttendeeInput[]); refreshTicketBooking(bookingId: string);
resolveUncertain(bookingId: string, r: { created: true; orderId: string } | { created: false }, note: string);
// each returns { ok: true } | { ok: false; kind: string }
```

- [ ] **Step 1: Write the failing selftest.**
  - `external transfer copy`: with `externalTransfer:true`, the html contains "הכרטיסים מועברים אליך ישירות על
    ידי הספק - בדקו את תיבת המייל" and the page URL.
  - `mobile links listed`: each link appears as an `<a href>`.
  - `restrictions listed`: each restriction appears.
  - `rtl`: the html root has `dir="rtl"`.
  - `whatsapp text`: it contains the event name and the page URL, and has no html tags.
- [ ] **Step 2: Run it.** `npx tsx scripts/tixstock-customer-email-selftest.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`lib/email.ts`:** passes `attachments` through to nodemailer. Nothing else changes.
  - **`sendTicketsToCustomer`:** refuses unless `checked_at` is set. It attaches the PDFs (downloaded from the
    bucket) while their total is ≤ `MAX_ATTACH_BYTES`, else sends the link only. It passes `from` explicitly -
    `"MegaEvents Reservations" <reservations@mega-events.co.il>`, the sender customers know from the site's
    confirmation email (`lib/email.ts` defaults to `alon@mega-events.co.il`, `DEFAULT_FROM` at `:11`). It sets
    `sent_to_customer_at/by`,
    appends `email` to `sent_channels`, and sets `released_to_customer_at`.
  - **`refreshTicketBooking`:** `getOrder`, then `readOrderPayload` / `applyOrderUpdate` (Task 4).
  - **`updateTicketAttendees`:** `updateOrder(orderId, { items })` built with `buildOrderRequest`'s items.
  - **The card:**
    - status, order id, listing, cost vs sold, buyer and attendees;
    - files (signed URLs);
    - "כרטיסים התקבלו - לבדוק ולשלוח" when files exist and nothing has been sent;
    - the "בדיקה - סנדבוקס" badge for `env=sandbox`;
    - the amber uncertain block with its two buttons and the line "בודקים ב-Request Logs של TixStock אם ההזמנה
      נוצרה" (TixStock 10.11: that is the only way to know);
    - a red line when the row has been `sale_on_hold` for over 90 minutes (TixStock expects Approved within 2
      hours);
    - "בדקתי את הכרטיסים", "שלח ללקוח", "העתק לוואטסאפ" (clipboard) and "נשלח בוואטסאפ";
    - update attendees, refresh.
  - **The dialog:**
    - event picker when there is no TixStock event id;
    - two listing groups ("קטגוריות אחרות" collapsed);
    - an amber gap line;
    - a warning on a listing with `leadBooker`;
    - attendees, with the Italian fields when `italian` (passport, nationality, date of birth, gender, place of
      birth), and the tick "האירוע דורש פרטי זיהוי";
    - shipping for paper;
    - the three acks;
    - the red line "רכישה סופית - הזמנה מאושרת ב-TixStock לא מתבטלת";
    - the button "הזמן כרטיס".
  - **The card renders nothing** when `getTicketBooking` answers `hidden` or `db`, and when the call rejects: its
    effect catches everything. The reservation page must look exactly as it does today for every other role.
  - **The list view `tickets-waiting` ("התקבלו ולא נשלחו"):** a best-effort mark merged like `wa_new`
    (`.catch(() => new Set())`), from `ticket_bookings` with `source = 'office'`, at least one file and
    `sent_to_customer_at is null`. `getReservations` already holds the `requireStaff()` session: the query runs
    only when `fulfilmentVisibleTo(session.role, flag)` is true. For everyone else no query is added to the
    list's load, the mark set is empty and the tab is not rendered. Site (test) rows are left out: nobody
    "sends" them, so they would sit in the view for ever.
- [ ] **Step 4: Verify.** Run the selftest (PASS) and `npx tsc --noEmit`. `npm run dev` in the backoffice reads a
  LOCAL Supabase with the mail credentials blanked (`.env.development.local` - confirm it exists, never delete
  it), so the check is in two places:
  - **Locally,** as superadmin. First apply the migration to the local DB, and insert by SQL one `is_test` event
    with `tixstock_booking = 'sandbox_office'` and one Paid reservation on it. Then:
    1. open the dialog, see the sandbox listings, and book;
    2. fulfil the order in the Seller Portal, then press Refresh (a webhook cannot reach localhost): the PDF
       shows;
    3. tick checked. Sending is NOT checked here: no mail leaves a local dev server.
  - **On production, in Stage 4** (superadmin only; the gate is closed for everyone else), on event B's
    reservation: the same three steps with the real webhook, then send - the email arrives with the PDF.
  
  As admin with the flag unset, the card is absent and the reservations list makes no extra query.
- [ ] **Step 5: Commit** (`feat(tixstock): booking card + dialog, check and send, WhatsApp copy, waiting view`).

---

## Phase D - Test events, rollout, health check

### Task 16: Test events and the Seller Portal listings

**Files:**
- Create: `myt-backoffice/scripts/tixstock-sandbox-test-events.ts` (dry-run by default; `--apply` under the push
  lock)
- Create: `myt-backoffice/docs/tixstock/2026-11-09-sandbox-listings-checklist-he.md` (for Dor)

**Runs after Stage 2** (Tasks 5 and 5A live), once Dor has the sandbox token and has created the listings of
Step 2 - the script reads them.

- [ ] **Step 1: Write the script.**
  - It builds each row EXPLICITLY, field by field, as `scripts/seed-liverpool-test-events.ts:148-168` does - not
    by copying an existing event (a copy carries its prices, pictures, ready package and campaign fields).
    Idempotent by name; loads `.env.local`.
  - Two events:
    - **A:** "TEST · Juventus FC vs Como (TixStock sandbox)", date 2027-06-11, `type:"tx_event"`, `is_test:true`,
      `is_hidden:false` (`confirm-order` refuses a hidden event), `package_mode:"ticket_only"`,
      `skip_flight:true`, `base_flight_price:0`, `base_hotel_price:0`, `card_image_url:""`, no ready package,
      `tixstock_booking:"sandbox_site"`, venue country IT in the event's location;
    - **B:** the same, with `tixstock_booking:"sandbox_office"`.
  - **`tickets_and_rates` comes from the SANDBOX feed** (`createTixstockClient` with the sandbox env,
    `listings("01kja2n8zk31zyv0z7zxkzf8vd")`): one row per category, `supplier:"tixstock"`, `eid` = that id, and
    the price = the cheapest listing of the category rounded up - the price the sandbox card will show.
    `confirm-order`'s price floor is built from the cheapest `tickets_and_rates` price (`utils.ts:214-219`), so a
    hand-typed price above a real listing would refuse the tester's order (`PRICE_VALIDATION_FAILED`). With no
    listings in the sandbox yet, the script stops and says so.
  - It prints, per listing, the feed's own `ticket.type`, `ticket.split_type`, `delivery.type` and
    `requires_lead_booker`: the spellings the sandbox really uses (Global Constraints).
  - `ticket_only_markup` = 5 (USD). Before `--apply`, it checks that `validatePurchasePriceFloor` /
    `validateTicketOnlyOrder` in myt-main accept that price (read both functions; adjust the markup only if they
    refuse).
  - `--apply` refuses to run unless `events.tixstock_booking` exists (the migration is live).
  - `--dry-run` prints both rows.
  - **The venue map** is not set by the script. It is attached in the event editor ("Suppliers & zones"), where
    the categories get their `data-zones`; the health check's Mapping items need it.
- [ ] **Step 2: Write the checklist** (Hebrew, for Dor, in the Seller Portal): seven listings on the sandbox event,
  each with benefits & restrictions filled in and categories / sections that match the map:

  | # | Ticket type | Split | Quantity |
  |---|---|---|---|
  | L1 | E-Ticket | None | 4 |
  | L2 | Mobile Link | Single Seats | 4 |
  | L3 | Mobile / external transfer | Avoid Leaving One | 4 |
  | L4 | Mobile Screenshot | Sell in Multiples (2) | 6 |
  | L5 | E-Ticket | All Together | 2 |
  | L6 | E-Ticket | None, `display_quantity` 2 | 10 |
  | L7 | E-Ticket, instant download | None | 2 |

  The lowest price TixStock allows.
- [ ] **Step 3: Dry-run.** `npx tsx scripts/tixstock-sandbox-test-events.ts`. Expected: two rows printed, no
  write.
- [ ] **Step 3a: `--apply`** (Dor's go, under the push lock: it writes to production). Then check, read-only:
  - `scripts/tixstock-sync-selection-check.ts`: the two events are OUT of the price sync's selection, and every
    other event is in;
  - `scripts/portal-test-events-check.ts` lists them, and the portal does not offer them (Task 5A);
  - they are in no feed and no catalog list (`isListedEvent` drops `is_test`), and `/order/<id>` opens.
  
  Known and accepted: the creatives cron may render campaign pictures for the two rows (they reach no feed).
- [ ] **Step 4: Commit** (`chore(tixstock): sandbox test events script + Seller Portal checklist`).

### Task 17: Verification and staged rollout

- [ ] **Step 1: Protected files untouched.** From each repo, with `<base>` = the commit before Task 1:
  - myt-main: `git diff --stat <base>..HEAD -- app/api/tixstock/tickets/route.ts lib/tixstock-feed.ts
    lib/tixstock-quantity.ts lib/supplier-offers.ts lib/ticket-cost.ts lib/eventsData.ts
    app/order/TicketSelection.tsx 'app/api/confirm-order/[id]/route.ts' app/api/confirm-order/utils.ts
    app/api/sendUserEmail.ts`;
  - backoffice: `git diff --stat <base>..HEAD -- lib/tixstock-listings.ts lib/services/tixstock-sync.ts`.
  
  Expected: empty output.
- [ ] **Step 2: Allowed edits reviewed.** `git diff <base>..HEAD --` on each allowed live file (Global
  Constraints) shows only the blocks this plan names.
- [ ] **Step 3: All checks.**
  - myt-main: `npx vitest run` and `npx tsc --noEmit`, then `yarn build`.
  - Backoffice: every `scripts/tixstock-*-selftest.ts`, the PGlite test, `npx tsc --noEmit` and `npm run build`.
  
  Never build while a dev server runs in the same folder. Expected: all green.
- [ ] **Step 4: Staged rollout.** Each stage needs Dor's "push" and goes through the push lock. Each one is checked
  live before the next: the `Vercel=` status on the commit, plus a real event's order page in the browser pane.
  1. **Stage 1 (backoffice):** Task 1's migration, alone, right after Task 1. Check that `db-migrate.yml` is
     green and that the column and the tables exist.
  2. **Stage 2 (backoffice):** Tasks 2-4, then 5, 5A and 6 (those three are committed only once Stage 1 is
     live). Check: the selection script reports equal sets; the portal no longer offers today's test events;
     the sweep's `?dry_run=1` answers. Then Dor registers the webhook (Task 0, step 7).
  3. **Stage 2b:** Dor creates the Seller Portal listings; Task 16 `--apply` and its checks.
  4. **Stage 3 (myt-main):** Tasks 1 (types), 2, 3 and 7-12. Check three live events (one `tx_event`, one
     `sports_event`, one music event) down to the summary without paying: the same cards and prices as the
     screenshots taken before. One unpaid order on an existing test event (1130) through the regular flow
     reaches CreditGuard's page as before - the regular path of `confirm-order` with the new block in place.
  5. **Stage 4 (backoffice):** Tasks 13-15, behind the gate.
  6. **Stage 5:** an end-to-end run on the sandbox:
     - one paid order per listing type on event A;
     - fulfil each in the Seller Portal;
     - the webhook lands and the ticket page shows each ticket. The webhook's log row has `signature_valid =
       true`: that is the proof of how we read TixStock's signature answer;
     - one office booking on event B;
     - **probes, written into the health-check answers:** which id `orders/get` takes (TixStock's `data.id`, the
       reservation id, or both); the `currency` / `grand_total` an order is registered with, against the amount
       sent; what orders/add really answers on a hold older than 10 minutes.
     
     Dor refunds the charges.
  7. **After the health check:** soft-delete the test reservations (`is_deleted`), so they leave the dashboards
     and the marketing numbers (plan call 10). While the testing runs they ARE in those numbers, and every
     attempt sends the sales-rep mail ("TEST ·" in the event's name - tell the team these are not leads), the
     customer mail, a GA / Mixpanel `purchase`, and - when the WhatsApp number is connected - a "payment
     received" WhatsApp to the tester's phone.
- [ ] **Step 5: Kill switch rehearsal.** Remove `NEXT_SECRET_TIXSTOCK_SANDBOX_*` from a preview environment: the
  test event shows "האירוע לא זמין" and real events are unchanged.
- [ ] **Step 6: Health-check answers.** Claude drafts `docs/tixstock/<date>-health-check-answers.md`: one
  screenshot per validation item from the Stage 5 run. Dor sends it to TixStock.

---

## Review amendments (10.11.2026)

What the review of 10.11 changed in this plan, and why. The evidence, file and line per finding, is in the
session note `2026-11-10-tixstock-plan-review-results.md`.

**Protects a live flow**
- **Task 5A (new):** the partner portal listed `is_test` events.
- **Task 11:** `after()` is registered only for a sandbox order, inside its own try/catch. No existing line of
  `validateAndRecord.ts` changes.
- **Global Constraints:** on a shared checkout a commit is as good as deployed. The migration is pushed alone;
  Tasks 5, 5A and 6 wait for it; the test events wait for 5 and 5A.
- **Task 5:** `.or("tixstock_booking.is.null,is_test.is.false")`, so a real event can never leave the price sync.
- **Tasks 13-15:** the ticket actions never throw to the reservation page, and the list's mark adds no query for
  other roles.
- **Plan call 10:** test reservations are cleaned up after the health check, not filtered by code.

**Makes the test flow correct**
- **A new status, `ordering`.** The claim before orders/add is a one-way status move. A new hold is placed only
  on "Resource Not Found"; an unanswered call is `uncertain`; the sweep turns a dead `ordering` row into
  `uncertain`.
- **Task 6:** stuck office rows, a paid site row that was never ordered, the link email after a sweep approval,
  and the refresh of sandbox rows whatever the event's date.
- **Task 4:** the signature key is the API token; `external_id` is the reservation id; hold / release webhooks
  are logged and answered `success:true`; the dedupe key has no webhook type; storage paths are hashed; a retry
  after a half-stored file works; instruction letters are stored.
- **Task 2:** one transition table. Italian attendees follow TixStock's list of 10.11: gender, place of birth
  for everyone, the buyer's e-mail.
- **Tasks 7-10:** the card price (rounded up) and the feed's amount (sent to TixStock) are two fields; the
  sandbox ticket carries the event's ticket id; the hold is placed right before the insert.
- **Task 12:** instruction letters download; the confirmation page says "sent" only when the link was sent.
- **Task 16:** explicit rows, tickets built from the sandbox feed, run before the site tasks.
- **Every verification step** says which database and which mail it really touches.

**Disproved by the review - no change**
- The ticket page is not publicly cached. On production a per-request page gets `private, no-store` from Next,
  although `middleware.ts` sets a public header. One header check stays in Task 12.
- The request's `tixstock_*` fields do survive `validateOrderData` (it returns the original object), and the
  insert maps columns explicitly, so passports never reach `reservations`.

**Still open** (asked TixStock on 10.11, `docs/tixstock/2026-11-10-questions-to-tixstock.md`): where our order
id goes in orders/add; the order's currency; `requires_lead_booker`; attendee details by event or by customer;
the `gender` field and the `nationality` format; the Serie A item from the back office; hex or base64; the answer
to hold / release webhooks; webhooks over 4.5 MB.

# TixStock Ticket Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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
    - `app/api/payment/validateAndRecord.ts` (one `after()` call before `return`)
    - `app/confirmation/[...params]/page.tsx` (one block gated on `event_order_info.tixstock_sandbox === true`)
    - `lib/app.types.ts` (two optional fields)
  - Backoffice:
    - `lib/services/tixstock-price-sync.ts:266-274` (one `.is()` filter)
    - `types/app.types.ts` (mirror)
    - `lib/email.ts` (optional `attachments`)
    - `app/(dashboard)/reservations/[id]/page.tsx` (render the card)
    - `app/(dashboard)/reservations/reservations-table.tsx` + `lib/actions/reservation-actions.ts` (one list view)
    - `vercel.json` (one cron, one function entry)
- **Deploy order:** the migration (Task 1) must be live on production before any code that names
  `tixstock_booking` or the new tables is deployed, in either app. Without it, a `.is("tixstock_booking", null)` on a
  missing column breaks the price sync for every TixStock event.
- **Git:**
  - backoffice on `master`, myt-main on `main`, no branches;
  - commit by explicit path (`git commit -- <paths>`), conventional commits, **no AI co-author line**;
  - push only when Dor says "push" / "תדחוף", through the push lock (skill `push-coordinator`).
- **Tokens:** Claude never types or prints a token. Dor pastes them.
- **Env names (exact):**
  - `NEXT_SECRET_TIXSTOCK_SANDBOX_URL` = `https://sandbox-pf.tixstock.com/v1` and
    `NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN` (both apps);
  - `NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN` and `NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING` (`true` opens production);
  - `NEXT_SECRET_TIXSTOCK_SANDBOX_WEBHOOK_SECRET` and `NEXT_SECRET_TIXSTOCK_WEBHOOK_SECRET` (backoffice);
  - `NEXT_SECRET_FULFILMENT_OPEN` (gate).
  
  Production host constant: `https://pf.tixstock.com/v1`. The existing `NEXT_SECRET_TIXSTOCK_API_URL` /
  `_TOKEN` are untouched.
- **TixStock strings (exact):**
  - statuses `Sale on Hold`, `Approved`, `Commissionable`, `Cancelled`;
  - split types `None`, `Single Seats`, `Sell in Multiples`, `Avoid Leaving One`, `All Together`;
  - `datetime` format `2026-05-23T20:45:00+0000`, in UTC.
- **Italian attendee fields:** full name, passport number, nationality (ISO 3166-1 alpha-2), date of birth
  (`YYYY-MM-DD`), and place of birth, required only when nationality is `IT`. TixStock's `Attendee` has no passport
  field: send the passport as `national_id`, pending TixStock's confirmation (Task 0, question 3).
- **Hebrew copy fixed by the spec:**
  - dialog: "רכישה סופית - הזמנה מאושרת ב-TixStock לא מתבטלת", "הזמן כרטיס", "קטגוריות אחרות", "האירוע
    דורש פרטי זיהוי";
  - uncertain: "לא ודאי - לא להזמין שוב עד שיתברר", "בדקתי - נוצרה הזמנה <id>", "בדקתי - לא נוצרה";
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
   existing confirmation email. This keeps `sendUserEmail.ts` and the email template untouched (rule 9).
2. **Until the fulfilment panel exists, Book ticket requires three staff ticks on every reservation** (Task 14):
   flight + hotel done, not bought by hand, final purchase. They replace the panel's "hotel step done" rule and the
   before-open-date tick of spec 7.1.
3. **The passport is sent as `Attendee.national_id`,** because the API has no passport field. It goes to TixStock
   as a question (Task 0).
4. **No separate ops alert.** A site booking that fails after payment (listing gone) shows as `failed` on the
   backoffice card and is logged as `[tixstock-site-booking]`. This is the test event only.
5. **The confirmation page knows a test order by `event_order_info.tixstock_sandbox === true`,** a marker the
   sandbox summary adds. Real orders' confirmation pages make no new request.
6. **The webhook signature is checked as HMAC-SHA256 of the raw body until TixStock answers.** With no secret
   configured, every webhook is refused with 401.
7. **`lib/fulfilment/visibility.ts` is created here,** and the RateHawk work reuses it.

## Review Focus

1. **Both payment callers fire at once** (`app/api/payment/[id]/[txId]/[promoCode]` and
   `app/api/confirmation/...`): exactly one `orders/add`. Task 11 test `one orders/add when two callers race`.
2. **The customer spends over 10 minutes on CreditGuard's page,** so the hold has expired: hold the same listing
   once more and order. If it is gone, `failed` with no third call. Task 11 test `re-holds once after an expired hold`.
3. **A webhook arrives twice or out of order** (Commissionable before the last e-ticket's Approved): files are not
   duplicated and the status never moves back. Task 4 tests `repeat is idempotent` and `no status regression`.
4. **A refresh restores the order draft without the listing id** on a sandbox event: the summary sends the
   customer back to pick a ticket and never takes a payment with no hold. Task 9 test `pick_again without listing`.
5. **A real event's order carries a stray `tixstock_listing_id`** (a tampered request): no hold and no booking, a
   warning in the log, and the order goes through as today. Task 10 test `ignores a listing id on a real event`.

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
6. **שאלות ל-TixStock** (אתה שולח; Claude מנסח, אתה מאשר את הנוסח):
   1. איך מאמתים את `X-Tixstock-Signature` (אלגוריתם וסוד)?
   2. כש-orders/add לא עונה, איך בודקים אם ההזמנה נוצרה: חיפוש לפי `hold_id`, ואם מותר לחזור על הקריאה?
   3. האם מספר הדרכון של משתתף נשלח בשדה `national_id`?
7. **Webhook:** אחרי שלב 2, נרשמים ב-Reseller Admin ל-webhooks עם הכתובת
   `<backoffice production origin>/api/tixstock/webhook/sandbox`. לפי הזיכרון הכתובת היא
   `backoffice-app-six.vercel.app`, וה-builder מאמת מול `appOrigin()`. את ה-secret מדביקים ב-backoffice env בשם
   `NEXT_SECRET_TIXSTOCK_SANDBOX_WEBHOOK_SECRET`.
8. **החזרים:** אחרי הבדיקות של TixStock מחזירים את החיובים ב-CreditGuard.

---

## Phase A - Backoffice foundation

### Task 1: Migration, shared types, SQL test

**Files:**
- Create: `myt-backoffice/supabase/migrations/20261109210000_tixstock_ticket_booking.sql`
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
    - `quantity int not null`, `status text not null`, `attempt_started_at timestamptz`
    - `listing jsonb not null`
    - `price_per_ticket numeric(12,2)`, `currency text not null default 'USD'`, `total numeric(12,2)`
    - `cost_sold_usd numeric(12,2)`, `gap_accepted_by text`
    - `buyer jsonb`, `attendees jsonb`, `shipping_address jsonb`, `prerequisites_ack jsonb`
    - `uncertain_resolution jsonb`, `last_error text`
    - `created_by text`, `created_at`, `updated_at`, `approved_at`, `commissionable_at`
    - `checked_by text`, `checked_at`
    - `sent_to_customer_at`, `sent_to_customer_by text`, `sent_channels text[] not null default '{}'`,
      `released_to_customer_at`
    - `customer_token text not null unique`
  - **Indexes on `ticket_bookings`:**
    - `create unique index if not exists ticket_bookings_one_live on public.ticket_bookings (reservation_id)
      where status in ('holding','on_hold','sale_on_hold','approved','commissionable','uncertain');`
    - indexes on `(tixstock_order_id)` and `(status, created_at)`.
  - **`ticket_booking_files`:**
    - `id uuid pk`, `booking_id uuid not null fk`, `kind text not null` (`pdf` | `mobile_link` | `proof` |
      `additional`)
    - `row text`, `seat text`, `storage_path text`, `url text`
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
  git commit -m "feat(tixstock): booking tables, events.tixstock_booking, private ticket-files bucket" -- supabase/migrations/20261109210000_tixstock_ticket_booking.sql scripts/tixstock-booking-sql-pglite-test.mjs types/app.types.ts types/database.types.ts
  ```
  ```bash
  git commit -m "feat(types): Event.tixstock_booking + OrderTicket.tixstock (mirror of backoffice)" -- lib/app.types.ts
  ```

### Task 2: Pure booking rules (byte-identical in both repos)

**Files:**
- Create: `myt-main/lib/tixstock-booking/rules.ts`; copy to `myt-backoffice/lib/tixstock-booking/rules.ts`
- Test: `myt-main/lib/__tests__/tixstockBookingRules.test.ts`, `myt-backoffice/scripts/tixstock-booking-rules-selftest.ts` (same cases)

**Interfaces (produces):**
```ts
export type TixstockBookingMode = "sandbox_site" | "sandbox_office";
export type BookingEnv = "sandbox" | "production";
export type BookingStatus = "holding" | "on_hold" | "sale_on_hold" | "approved" | "commissionable"
  | "failed" | "released" | "uncertain" | "cancelled";
export const ACTIVE_STATUSES: readonly BookingStatus[]; // the six in the unique index
export type EventFlags = { is_test?: boolean | null; tixstock_booking?: string | null };
export function bookingEnvFor(e: EventFlags): { ok: true; env: BookingEnv } | { ok: false; kind: "test_without_sandbox" };
export function isSandboxBookingEvent(e: EventFlags | null | undefined): boolean;
export function siteBooksAfterPayment(e: EventFlags | null | undefined): boolean;
export function tixstockDatetime(d: Date): string;
export function statusFromTixstock(s: unknown): BookingStatus | null;
export function canMoveTo(from: BookingStatus, to: BookingStatus): boolean;
export type Buyer = { first_name: string; last_name: string; email: string; phone: string };
export type AttendeeInput = { first_name: string; last_name: string; passport?: string; nationality?: string;
  dob?: string; birth_place?: string };
export type AttendeeIssue = "name" | "passport" | "nationality" | "dob" | "birth_place";
export function attendeeIssues(a: AttendeeInput, italian: boolean): AttendeeIssue[];
export function buildOrderRequest(input: { status: "Sale on Hold" | "Approved"; at: Date; buyer: Buyer;
  attendees: AttendeeInput[]; quantity: number; italian: boolean;
  listing: { generalAdmission: boolean; row: string; pricePerTicket: number };
  shippingAddress?: Record<string, string> }):
  { ok: true; body: Record<string, unknown> } | { ok: false; kind: "attendee_count" | "attendee_issues" };
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
  - `no status regression`: `canMoveTo("commissionable","approved") === false`;
    `canMoveTo("approved","commissionable") === true`; `canMoveTo("sale_on_hold","approved") === true`;
    `canMoveTo("uncertain","approved") === true`; `canMoveTo("failed","approved") === false`;
    `canMoveTo("released","on_hold") === false`.
  - `italian issues`: `attendeeIssues({first_name:"Dana", last_name:"Levi", nationality:"IL",
    dob:"1990-01-31"}, true)` deep-equals `["passport"]`. Nationality `"IT"` with no `birth_place` gives
    `["birth_place"]`. `dob:"31/01/1990"` gives `["dob"]`. A complete `IL` attendee gives `[]`. Blank last name
    with `italian:false` gives `["name"]`. A complete name with `italian:false` gives `[]`.
  - `order body, plain`: 2 tickets, 2 attendees, `italian:false`, status `"Approved"`:
    - `body.order_status === "Approved"`;
    - `body.customer` deep-equals `{first_name, last_name, email_address, contact_number}` from the buyer;
    - `body.items.length === 2`;
    - `body.items[0].customer` has exactly the keys `first_name`, `last_name`;
    - `body.items[0].price === pricePerTicket`;
    - `body.datetime` matches `/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+0000$/`.
  - `order body, italian`: `items[i].customer` has `national_id` = passport, `nationality`, `dob`, and
    `birth_place` only when nationality is `IT`.
  - `attendee count`: 2 tickets with 1 attendee gives `{ok:false, kind:"attendee_count"}`.
  - `issues block the body`: italian with a missing passport gives `{ok:false, kind:"attendee_issues"}`.
- [ ] **Step 2: Run them.** `npx vitest run lib/__tests__/tixstockBookingRules.test.ts` (myt-main) and `npx tsx
  scripts/tixstock-booking-rules-selftest.ts` (backoffice). Expected: FAIL, module not found.
- [ ] **Step 3: Implement `lib/tixstock-booking/rules.ts`.**
  - `canMoveTo` allows only forward moves along
    `holding → on_hold → sale_on_hold → approved → commissionable`, plus:
    - any active status → `failed`, `released` or `cancelled`;
    - `uncertain` → `approved` / `failed`.
    
    It never moves from `commissionable`, `failed`, `released` or `cancelled`.
  - `bookingEnvFor` accepts only the two mode strings.
  - No imports, so the module stays byte-identical.
- [ ] **Step 4: Run both test files.** Expected: PASS. Copy the file to the backoffice, and `cmp` the pair.
  Expected: no output.
- [ ] **Step 5: Commit each repo** (`feat(tixstock): pure booking rules shared with the site`).

### Task 3: TixStock HTTP client (byte-identical) + backoffice env resolver

**Files:**
- Create: `myt-main/lib/tixstock-booking/client.ts`, copied to `myt-backoffice/lib/tixstock-booking/client.ts`
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
  addOrder(holdId: string, qty: number, body: Record<string, unknown>): Promise<TixstockCall<{ orderId: string; status: string }>>; // data.id, data.status
  updateOrder(orderId: string, body: Record<string, unknown>): Promise<TixstockCall<{ status: string }>>;
  getOrder(orderId: string): Promise<TixstockCall<Record<string, unknown>>>;
};
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
export function verifyTixstockSignature(rawBody: string, header: string | null, secret: string | undefined): boolean;
export type OrderUpdate = { status: BookingStatus | null; files: Array<{ kind: "pdf" | "mobile_link" | "proof" | "additional";
  row: string | null; seat: string | null; base64?: string; url?: string; dedupeKey: string }> };
export function readOrderPayload(type: string, data: Record<string, unknown>): OrderUpdate; // in tixstock-order-apply.ts
export function applyOrderUpdate(bookingId: string, update: OrderUpdate, deps: ApplyDeps): Promise<{ status: BookingStatus; newFiles: number }>;
export function handleTixstockWebhook(input: { env: BookingEnv; rawBody: string; signature: string | null; secret: string | undefined },
  deps: WebhookDeps): Promise<{ status: number; body: { external_id: string | null; order_status: string | null; message: string; success: boolean } }>;
```
  - **Payload:** `{data, meta}`. Type = `meta.type`; order id = `data.order_id`; listing = `data.id`; PDF =
    `data.file`; `data.proof_file_url[]`; `data.additional_file`; `data.mobile_links[{seat, link}]`; status =
    `data.order_status ?? data.status`.
  - **`dedupeKey`:** `${orderId}:${type}:${row}:${seat}:${kind}:${index}`.
  - **Storage path:** `ticket-files/${bookingId}/${dedupeKey}.pdf`.

- [ ] **Step 1: Write the failing selftest** (all I/O through `deps` stubs):
  - `bad signature 401`: a wrong signature gives 401; nothing saved; the event is logged with
    `signature_valid:false`.
  - `missing secret 401`: an undefined secret gives 401 (fails closed).
  - `eticket stores and answers`:
    - payload `meta.type="order.eticket_fulfilment"`, `data.order_status="Approved"`, one base64 `file`;
    - `saveFile` is called once with kind `pdf`;
    - booking status `approved`;
    - answer 200 `{external_id: <booking id>, order_status:"Approved", success:true}`.
  - `repeat is idempotent`: the same payload twice gives `saveFile` once in total; the answers are equal.
  - `no status regression`: Commissionable first, then a late Approved: the stored status stays
    `commissionable`, and the answer says `Commissionable`.
  - `mobile link`: `mobile_links:[{seat:"12",link:"https://x"}]` stores kind `mobile_link` with that url.
  - `proof only`: `proof_file_url:["https://p"]` stores kind `proof`.
  - `uncertain is matched`: an unknown order id, plus one `uncertain` booking with the same `listing_id` and quantity
    created under 60 minutes ago: that booking gets `tixstock_order_id` and moves to the payload's status.
  - `unknown order`: no booking and no uncertain match gives 200 with `success:false`, `message:"unknown order"`.
  - `order.update answers our status`: answers with the booking's current status, as TixStock spells it.
- [ ] **Step 2: Run it.** `npx tsx scripts/tixstock-webhook-selftest.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`verifyTixstockSignature`:** HMAC-SHA256 hex of the raw body with the secret; the header may be bare hex or
    `sha256=<hex>`; compared with `timingSafeEqual` (copy `lib/whatsapp/rules.ts:64-70`). Mark it in a comment as
    provisional until TixStock answers question 10.1.
  - **The route:** copies `app/api/whatsapp/webhook/route.ts`. `env` param `sandbox` | `production`, else 404.
    Secret from `NEXT_SECRET_TIXSTOCK_SANDBOX_WEBHOOK_SECRET` / `NEXT_SECRET_TIXSTOCK_WEBHOOK_SECRET`. Header
    `x-tixstock-signature`. Real deps: `supabase` from `@/lib/supabase-server`, and storage `upload(path,
    Buffer.from(base64,"base64"), {contentType:"application/pdf", upsert:false})`.
  - **The log:** `tixstock_webhook_events` stores the payload with each base64 body replaced by
    `{bytes: n}`.
- [ ] **Step 4: Run it.** Expected: PASS. Run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** (`feat(tixstock): signed webhook receiver stores tickets, links and proof`).

### Task 5: Keep test events out of the price sync

**Files:**
- Modify: `lib/services/tixstock-price-sync.ts:266-274`

- [ ] **Step 1: Record the baseline.** Run the nightly sync's selection in dry-run (`/api/cron/nightlyTixstockPriceSync?dry_run=1`
  locally, against the local Supabase) and note the number of events selected.
- [ ] **Step 2: Add the filter.** Add `.is("tixstock_booking", null)` after `.is("is_deleted", null)` in
  `loadEvents`. Nothing else in the file changes.
- [ ] **Step 3: Verify.** Run the same dry-run. Expected: the same count (no event has the column set yet). Run
  `npx tsc --noEmit`.
- [ ] **Step 4: Commit** (`fix(tixstock-sync): skip TixStock sandbox test events`). **Deploy only after Task 1's
  migration is live.**

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
    Paid: `release` is called once and the row becomes `released`. The same row at 14 minutes is untouched.
  - `stuck sale on hold approved`: a `sale_on_hold` row 6 minutes old with a Paid reservation:
    `updateOrder(orderId, {order_status:"Approved"})` is called and the row becomes `approved`.
  - `overdue logged`: a `sale_on_hold` row over 90 minutes old whose update fails: `overdue === 1` and
    `console.error` is called with `"tixstock_sale_on_hold_over_90m"`.
  - `daily refresh`: an `approved` row with no files, an event within 14 days, and no refresh in 24h: `getOrder`
    is called once and `applyOrderUpdate` is applied.
  - `dry run`: with `dryRun:true`, no client call and no write.
- [ ] **Step 2: Run it.** `npx tsx scripts/tixstock-booking-sweep-selftest.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The route: `guardCronRoute(request)` first; `?dry_run=1`; batch of 25.
  - The last refresh time is stored in `listing.last_refresh_at` (inside the jsonb).
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
export type SandboxCard = { category: string; listingId: string; pricePerTicketUsd: number; ticketType: string;
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
  - `price rounds up`: an amount of `"59.20"` gives 60.
  - `display quantity caps`: `quantity_available:10, display_quantity:2` with qty 3 is excluded; with qty 2,
    `available === 2`.
  - `zero display uses available`: `display_quantity:0, quantity_available:5` gives `available === 5`.
  - `single seats flagged`: `split_type:"Single Seats"` gives `singleSeats === true`.
  - `split rule applies`: `All Together` with 4 available and qty 2 is excluded.
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
- Produces: an `OrderTicket` with `supplier:"tixstock"`, `eid: tixEventId`, `category`,
  `price: pricePerTicketUsd`, `quantity`, `supplierCategory: category`, and `tixstock: { listingId, italian:
  venueCountryCode === "IT", singleSeats }`.

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
- [ ] **Step 3: Verify locally.** `yarn dev` (one dev server per checkout), with the sandbox env in `.env.local`
  and the Task 16 test event created. Open `/order/<test event id>`: the cards match the Seller Portal listings.
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
    Hebrew labels), date of birth, and place of birth when nationality is `IT`. Pay is blocked while
    `attendeeIssues` returns any issue.
  - **`singleSeats`:** shows "ייתכן שהמושבים לא יהיו צמודים" near the ticket line.
  - **The request:** `updatedFormData` gets `tixstock_listing_id`, `tixstock_attendees`, and
    `event_order_info.tixstock_sandbox = true`, all only when `ready`.
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
- Modify: `app/api/confirm-order/route.ts` (one block after `validateOwnStock` at ~327, one after the insert at ~460)
- Test: `lib/__tests__/tixstockSiteHold.test.ts`

**Interfaces:**
- Consumes: `siteBooksAfterPayment`, `attendeeIssues` (Task 2); `sandboxClient` (Task 7); `sandboxCards` rules
  (fit + price, Task 7).
- Produces:
```ts
export type HeldListing = { holdId: string; tixEventId: string; listingId: string; quantity: number;
  pricePerTicketUsd: number; snapshot: Record<string, unknown>; attendees: AttendeeInput[]; italian: boolean };
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
  - `bad attendees`: a count mismatch, or an Italian attendee with no passport.
  - `held`: the hold is called with `(listingId, quantity)`, and the result carries `holdId`.
  - `record releases on insert failure`: the booking insert rejects: `release(holdId, quantity)` is called once.
  - `record writes token`: the inserted row has `status:"on_hold"`, `source:"site"`, `env:"sandbox"`, and
    `customer_token` matching `/^[A-Za-z0-9_-]{43}$/` (`randomBytes(32).toString("base64url")`).
- [ ] **Step 2: Run it.** `npx vitest run lib/__tests__/tixstockSiteHold.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the module and wire the route.**
  - **After `validateOwnStock`:**
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
- Modify: `app/api/payment/validateAndRecord.ts` (one `after()` call immediately before `return { isSuccess }`)
- Test: `lib/__tests__/tixstockSiteAfterPayment.test.ts`

**Interfaces:**
- Consumes: `buildOrderRequest`, `tixstockDatetime` (Task 2); `sandboxClient` (Task 7); `HeldListing` row shape
  (Task 10).
- Produces: `bookSiteOrderAfterPayment(orderId: string, deps): Promise<"none" | "busy" | "approved" |
  "sale_on_hold" | "uncertain" | "failed">`, `releaseSiteHoldFor(orderId: string, deps): Promise<void>`,
  `sendTicketLinkEmail(to: string, eventName: string, url: string): Promise<void>`.

- [ ] **Step 1: Write the failing vitest.**
  - `none for orders without a site booking`: no `on_hold` `source=site` row gives `"none"`, after one lookup and
    no client call.
  - `one orders/add when two callers race`: two concurrent calls with a CAS stub where only the first claim
    succeeds: `addOrder` is called once, and the second call returns `"busy"`.
  - `sale on hold then approved`:
    - `addOrder` with body `order_status === "Sale on Hold"`;
    - then `updateOrder(orderId, { order_status: "Approved" })`;
    - the row ends `approved` with `approved_at`;
    - `sendTicketLinkEmail` is called once with `<site origin>/ticket/<token>`.
  - `re-holds once after an expired hold`: the first `addOrder` is refused, `hold` is called again for the same
    listing, and the second `addOrder` succeeds. If the second is also refused, the row is `failed` with
    `last_error`, and there is no third call.
  - `no answer is uncertain`: `addOrder` gives `no_answer`: the row is `uncertain`, with no `updateOrder` and no
    release.
  - `approve failure leaves sale on hold`: `updateOrder` is refused: the row stays `sale_on_hold`, for the sweep
    (Task 6).
  - `payment failed releases`: `releaseSiteHoldFor` on an `on_hold` row calls `release` once and the row becomes
    `released`.
- [ ] **Step 2: Run it.** `npx vitest run lib/__tests__/tixstockSiteAfterPayment.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Claim:** `update ticket_bookings set attempt_started_at = now() where id = $1 and status = 'on_hold' and
    (attempt_started_at is null or attempt_started_at < now() - interval '2 minutes')`, returning the row (CAS;
    no row = `busy`).
  - **The buyer:** from the reservation's `main_contact_*`.
  - **`validateAndRecord.ts`:** add `import { after } from "next/server"` and, before the return, `after(() =>
    (isSuccess ? bookSiteOrderAfterPayment(orderId) : releaseSiteHoldFor(orderId)).catch((e) =>
    console.error("[tixstock-site-booking]", String(e))))`. If the installed Next exposes only
    `unstable_after`, use that name. Nothing else in the file changes, and the Paid write and the email run first,
    exactly as before.
  - **The link email:** sent with the same transporter `sendUserEmail` uses (import; do not edit that file).
    Subject "הקישור לכרטיסים שלכם"; body: the event name, the link, and "הכרטיסים יופיעו בקישור ברגע שהספק
    ישלח אותם".
- [ ] **Step 4: Verify.** Run the vitest (PASS) and `npx tsc --noEmit`. `git diff --
  app/api/payment/validateAndRecord.ts` shows the import and the one call only.
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
  - `after release`: the files are listed; a `pdf` has no `url` (served by the file route); a `mobile_link` has
    its `url`; `proof` rows are **never** listed.
- [ ] **Step 2: Run it.** `npx vitest run lib/__tests__/tixstockTicketPage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The page:** a server component, `export const dynamic = "force-dynamic"`, `robots: { index: false, follow:
    false }`. It shows "הכרטיסים יישלחו אליכם עד <date>" before release, and the external-transfer line when it
    applies.
  - **The file route:** checks token → booking → that the file belongs to it, is released and is `pdf`. Then
    `supabase.storage.from("ticket-files").download(path)` → `new NextResponse(blob, { headers: { "content-type":
    "application/pdf", "content-disposition": "inline; filename=ticket-<row>-<seat>.pdf", "cache-control":
    "private, no-store" } })`.
  - **`order-summary/[orderId]`:** returns `{ ticketType, restrictions, deliveryDate }` only for a reservation
    with a `source=site` booking, else 404. No token and no files.
  - **The confirmation page:** fetches it only when `orderData.event_order_info?.tixstock_sandbox === true`, and
    renders the three rows plus "קישור לכרטיסים נשלח אליכם במייל".
- [ ] **Step 4: Verify.** Run the vitest (PASS) and `npx tsc --noEmit`. A real order's confirmation page makes
  no new request (browser pane, Network tab).
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
  instantDownload: boolean; paper: boolean };
export function rankListings(listings: TixStockListing[], input: { soldCategory: string | null; quantity: number;
  together: boolean; excludedSections: string[]; costSoldTotalUsd: number | null }):
  { sameCategory: RankedListing[]; others: RankedListing[] };
// "use server" (requireAdmin + fulfilmentVisibleTo, else { ok:false, kind:"hidden" }):
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
- [ ] **Step 2: Run it.** `npx tsx scripts/tixstock-booking-rank-selftest.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Ported verbatim into `rank.ts`:** myt-main `listingSeatsTogether` (`lib/tixstock-quantity.ts:34`) and the
    category normaliser `cheapestTixstockListing` uses, each with a comment naming its source file.
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
  - `approved`: hold then `addOrder` with `order_status:"Approved"`: the row is `approved` with
    `tixstock_order_id`, and `logAudit` is called with `action:"tixstock_ticket_booked"`.
  - `refused releases once`: `addOrder` is refused: `release(holdId, qty)` is called once, and the row is
    `failed`.
  - `no answer is uncertain`: `addOrder` gives `no_answer`: the row is `uncertain`, with no release and no second
    `addOrder`.
  - `paper needs shipping`: a paper listing with no `shippingAddress` gives `shipping`.
  - `audit before the call`: `logAudit` with `action:"tixstock_ticket_booking_started"` is called before `hold`.
- [ ] **Step 2: Run it.** `npx tsx scripts/tixstock-office-booking-selftest.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The action: `requireAdmin()`, then `fulfilmentVisibleTo`, then `runOfficeBooking`
  with real deps. Errors are returned, never thrown.
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
    bucket) while their total is ≤ `MAX_ATTACH_BYTES`, else sends the link only. It sets `sent_to_customer_at/by`,
    appends `email` to `sent_channels`, and sets `released_to_customer_at`.
  - **`refreshTicketBooking`:** `getOrder`, then `readOrderPayload` / `applyOrderUpdate` (Task 4).
  - **`updateTicketAttendees`:** `updateOrder(orderId, { items })` built with `buildOrderRequest`'s items.
  - **The card:**
    - status, order id, listing, cost vs sold, buyer and attendees;
    - files (signed URLs);
    - "כרטיסים התקבלו - לבדוק ולשלוח" when files exist and nothing has been sent;
    - the "בדיקה - סנדבוקס" badge for `env=sandbox`;
    - the amber uncertain block with its two buttons;
    - "בדקתי את הכרטיסים", "שלח ללקוח", "העתק לוואטסאפ" (clipboard) and "נשלח בוואטסאפ";
    - update attendees, refresh.
  - **The dialog:**
    - event picker when there is no TixStock event id;
    - two listing groups ("קטגוריות אחרות" collapsed);
    - an amber gap line;
    - attendees, with the Italian fields when `italian`, and the tick "האירוע דורש פרטי זיהוי";
    - shipping for paper;
    - the three acks;
    - the red line "רכישה סופית - הזמנה מאושרת ב-TixStock לא מתבטלת";
    - the button "הזמן כרטיס".
  - **The card renders nothing** when `getTicketBooking` answers `hidden`.
  - **The list view `tickets-waiting` ("התקבלו ולא נשלחו"):** a best-effort mark merged like `wa_new`
    (`.catch(() => new Set())`), from `ticket_bookings` with at least one file and `sent_to_customer_at is null`.
- [ ] **Step 4: Verify.** Run the selftest (PASS) and `npx tsc --noEmit`. Then, locally as superadmin, on a
  `sandbox_office` test reservation:
  1. open the dialog, see the listings, and book;
  2. fulfil the order in the Seller Portal; the webhook (or refresh) shows the PDF;
  3. tick checked, then send; the email arrives with the PDF.
  
  As admin with the flag unset, the card is absent.
- [ ] **Step 5: Commit** (`feat(tixstock): booking card + dialog, check and send, WhatsApp copy, waiting view`).

---

## Phase D - Test events, rollout, health check

### Task 16: Test events and the Seller Portal listings

**Files:**
- Create: `myt-backoffice/scripts/tixstock-sandbox-test-events.ts` (dry-run by default; `--apply` under the push
  lock)
- Create: `myt-backoffice/docs/tixstock/2026-11-09-sandbox-listings-checklist-he.md` (for Dor)

- [ ] **Step 1: Write the script.**
  - It reads one existing future `tx_event` as the field template (prints which).
  - It builds two events:
    - **A:** "TEST · Juventus FC vs Como (TixStock sandbox)", date 2027-06-11, `type:"tx_event"`, `is_test:true`,
      `package_mode` ticket-only, `tixstock_booking:"sandbox_site"`, venue country IT in the event's location,
      `tickets_and_rates` one row per category in the checklist, with `supplier:"tixstock"`,
      `eid:"01kja2n8zk31zyv0z7zxkzf8vd"` and the price = the listing price in USD;
    - **B:** the same, with `tixstock_booking:"sandbox_office"`.
  - `ticket_only_markup` = 5 (USD). Before `--apply`, it checks that `validatePurchasePriceFloor` /
    `validateTicketOnlyOrder` in myt-main accept that price (read both functions; adjust the markup only if they
    refuse).
  - `--dry-run` prints both rows.
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
  write. `--apply` waits for Stage 5 (Task 17).
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
  1. **Stage 1 (backoffice):** Task 1's migration. Check that `db-migrate.yml` is green and that the columns
     exist.
  2. **Stage 2 (backoffice):** Tasks 2-6. Check that the price sync dry-run selects the same count; then Dor
     registers the webhook (Task 0, step 7).
  3. **Stage 3 (myt-main):** Tasks 1 (types), 2, 3 and 7-12. Check three live events (one `tx_event`, one
     `sports_event`, one music event) down to the summary without paying: the same cards and prices as the
     screenshots taken before.
  4. **Stage 4 (backoffice):** Tasks 13-15, behind the gate.
  5. **Stage 5:** Task 16 `--apply`; Dor creates the listings. Then an end-to-end run on the sandbox:
     - one paid order per listing type on event A;
     - fulfil each in the Seller Portal;
     - the webhook lands and the ticket page shows each ticket;
     - one office booking on event B.
     
     Dor refunds the charges.
- [ ] **Step 5: Kill switch rehearsal.** Remove `NEXT_SECRET_TIXSTOCK_SANDBOX_*` from a preview environment: the
  test event shows "האירוע לא זמין" and real events are unchanged.
- [ ] **Step 6: Health-check answers.** Claude drafts `docs/tixstock/<date>-health-check-answers.md`: one
  screenshot per validation item from the Stage 5 run. Dor sends it to TixStock.

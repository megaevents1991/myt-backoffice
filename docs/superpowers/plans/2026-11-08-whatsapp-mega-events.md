# WhatsApp for Mega Events (phases E1-E3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mega Events' number 054-200-2722 gets three things:

- its conversations inside the backoffice: a WhatsApp screen, a fold on each order, a reply box, a "new" mark and an
  unanswered alert;
- automatic order updates;
- date reminders.

This builds on the tours WhatsApp phase 1 that is already live.

**Architecture:**

- **Inbound:** the webhook's inbound flow dispatches by the account's company. An `events` company goes to a new
  `handleEventsMessage`, which keeps per-phone state in `wa_chats` and never writes `leads` or `customers`.
- **Order updates:** an exception-safe AFTER trigger on `reservations` queues them into `wa_outbox`. That catches
  myt-main's checkout writes with no change to myt-main. A 2-minute cron drains the queue through the existing
  `sendTemplate`.
- **Date reminders:** an hourly cron enqueues the date kinds.
- **Where the rules live:** in pure modules under `lib/whatsapp/events/`, with tsx selftests. The SQL is tested on
  PGlite.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (service role, PostgREST), shadcn/ui, Meta
WhatsApp Cloud API (Graph v26.0), Vercel cron, PGlite for SQL tests, `npx tsx` selftests (`node:assert/strict`).

**Spec:** `docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md`. Read it with this plan. Phase E4
(marketing) is NOT in this plan (Dor, 08.11).

## Global Constraints

**Git and deploy**
- Work on `master` in `/Users/dor/work/myt-backoffice`. No branch, no PR, **never push**.
- Commit by explicit path only: `git commit -m "..." -- <paths>`. The checkout is shared with other sessions.
- Conventional commits, with **no `Co-Authored-By` or any AI attribution line**.
- Never apply a migration by hand. Migrations ride the push to master. Create each one with `npm run db:new <name>`
  after `git fetch origin`; never reuse a version prefix.

**Code**
- `npx tsc --noEmit` is the type gate; the build ignores TS errors.
- Every new `wa_*` table is read through the repo's boundary cast `const db = supabase as any` (scoped
  eslint-disable), as in `lib/services/whatsapp-db.ts`, until `npm run db:types` is rerun.
- Every new route handler guards itself on its first line: `guardCronRoute(request)` for crons. `middleware.ts` skips
  `/api`.
- Server actions return `{ ok: false, kind, message }` instead of throwing a user-facing error (Next masks thrown errors
  in prod).
- Load one action per screen on mount, never several. Any read that can pass 1,000 rows goes through `fetchPaged`
  (`lib/supabase-paged.ts`). `.in()` id lists stay at 200 or fewer per request.
- No `select('*')` on hot paths. Map columns explicitly on every insert and update.
- Soft deletes only, never a hard delete of a reservation.

**Rules from the spec**
- **The rule names come from the spec:** a conversation = a `wa_chats` row per `(company_id, phone_key)`. `phone_key` =
  the last 9 digits (`phoneKey` in `lib/tours/cases.ts`, SQL twin `public.phone_key`).
- **Gaps and windows:**
  - new-conversation gap = `WA_INQUIRY_GAP_HOURS` (24);
  - reply window = `canSendText` (24 h);
  - unanswered = **60 working minutes**, where working time = Sunday-Thursday 09:00-17:00 Asia/Jerusalem;
  - live statuses for R-2 = `Paid`, `Follow-up`, and `Pending` / `24Save` created in the last 7 days, among orders
    whose event date is today or later.
- **Template names** (Hebrew, `he`): `payment_received`, `payment_failed`, `phone_order`, `materials_sent`,
  `order_cancelled`, `flight_reminder`, `event_today`, `after_trip`.
- **Slots** (Israel time):
  - `flight_reminder` at 09:00, 3 days before the outbound departure's local date;
  - `event_today` at 10:00 on `events.date`;
  - `after_trip` at 11:00 the day after the return.
  - `payment_failed` waits 15 minutes.
- **Env:**
  - `EVENTS_WHATSAPP_AUTO=off` is the kill switch.
  - `NEXT_SECRET_WA_EVENTS_TRIAL_PHONE` is the trial recipient.
  - `NEXT_SECRET_WA_EVENTS_ALERT_TO` (comma-separated; unset = `DEFAULT_FROM` in `lib/email.ts`).
  - `EVENTS_WA_AFTER_TRIP=on` starts `after_trip`; it is off by default.
- **Never send from history.** History rows set no `last_in_at`, mark nothing, alert nothing, move no order.
- **The tours path must behave exactly as today.** Every existing selftest still passes unchanged.

## Review Focus

1. **myt-main's checkout writes a reservation while the outbox insert fails** (table locked, column missing, a bad
   cast): the reservation write must still succeed and the failure becomes a warning. Pinned in Task 10's PGlite test
   ("a broken wa_outbox never fails a reservation write").
2. **Connect day: the 6-month history arrives in large batches.** No chat may become unseen or unanswered, no order may
   move to Follow-up, and the webhook still answers inside 30 s. Pinned in Task 4's selftest ("history marks nothing").
3. **The same phone typed as `054-200-2722`, `+972 54 200 2722` or `0542002722`** must give one `phone_key` in TS (the
   chat) and in SQL (the reservation). Pinned in Task 2's PGlite test ("phone key matches the TS twin").
4. **The edit page saves a whole stale row** after someone flipped "לא לשלוח וואטסאפ" in another tab: the switch must
   survive, and the generated phone key must not break the save. Pinned in Task 8 (`updateReservation` strips the
   columns) and Task 2 (the trigger overwrites `main_contact_phone_key`).
5. **A customer whose first payment failed pays on a retry**, which is a NEW reservation: they must not get "התשלום
   לא עבר". Pinned in Task 11's selftest (`newerPaidSameEvent` -> "שולם בהזמנה חדשה"); Task 12's drain computes it.

---

### Task 1: Pure rules - conversations, orders, opt-out, auto texts

**Files:**
- Create: `lib/whatsapp/events/chat-rules.ts`
- Test: `scripts/whatsapp-events-selftest.ts` (new; later tasks append sections)

**Interfaces:**
- Produces:
  - `type EventsResLite = { id: number; status: string; createdAt: string; eventDate: string | null; isDeleted: boolean }`
    (`eventDate` = `YYYY-MM-DD`).
  - `isEventsCompany(productTypes: readonly string[]): boolean`: true when it includes `"events"` and not `"tours"`.
  - `countsAsInbound(type: WaMessageType): boolean`: false for `reaction` and `sticker`.
  - `isOptOutWhole(text: string | null | undefined): boolean`: the cleaned text EQUALS one of `OPT_OUT_WORDS`. Same
    cleaning as `isOptOut` in `lib/whatsapp/rules.ts`.
  - `normAutoText(text: string | null | undefined): string`: trim and collapse whitespace.
  - `suggestAutoTexts(echoes: { phoneKey: string; text: string | null }[], minChats = 5): string[]`: the normalized
    texts sent identically to at least `minChats` distinct phone keys.
  - `isLiveForFollowUp(r: EventsResLite, today: string, now: Date): boolean`.
  - `lostToFollowUp(rs: EventsResLite[], today: string, now: Date): number | null`: the id of the newest `Lost`, or
    null.
  - `markedReservation(rs: EventsResLite[], linkedId: number | null, today: string): number | null`.

- [ ] **Step 1: Write the failing tests** in `scripts/whatsapp-events-selftest.ts` (header comment: `npx tsx scripts/whatsapp-events-selftest.ts`, pure, no DB):

```ts
assert.equal(isEventsCompany(["events"]), true);
assert.equal(isEventsCompany(["tours"]), false);
assert.equal(isEventsCompany(["events", "tours"]), false);
assert.equal(countsAsInbound("reaction"), false);
assert.equal(countsAsInbound("sticker"), false);
assert.equal(countsAsInbound("text"), true);
assert.equal(isOptOutWhole("הסר"), true);
assert.equal(isOptOutWhole(" הסר! "), true);
assert.equal(isOptOutWhole("הסר את המלון מההזמנה"), false);
assert.equal(isOptOutWhole("STOP"), true);
assert.deepEqual(suggestAutoTexts([1,2,3,4,5].map((i) => ({ phoneKey: `54000000${i}`, text: "שלום!  נחזור אליכם " }))), ["שלום! נחזור אליכם"]);
assert.deepEqual(suggestAutoTexts([1,2,3,4].map((i) => ({ phoneKey: `54000000${i}`, text: "x" }))), []);

const NOW = new Date("2026-11-08T10:00:00Z"); const TODAY = "2026-11-08";
const r = (id: number, status: string, createdAt: string, eventDate: string | null) => ({ id, status, createdAt, eventDate, isDeleted: false });
// R-2: only orders whose event is ahead count; old Lost never moves
assert.equal(lostToFollowUp([r(1, "Lost", "2026-01-01T00:00:00Z", "2026-03-01")], TODAY, NOW), null);
assert.equal(lostToFollowUp([r(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01"), r(2, "Lost", "2026-10-05T00:00:00Z", "2026-12-01")], TODAY, NOW), 2);
// a stale Pending (abandoned checkout, 10 days old) does not block; a fresh one does
assert.equal(lostToFollowUp([r(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01"), r(2, "Pending", "2026-10-29T00:00:00Z", "2026-12-01")], TODAY, NOW), 1);
assert.equal(lostToFollowUp([r(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01"), r(2, "Pending", "2026-11-05T00:00:00Z", "2026-12-01")], TODAY, NOW), null);
assert.equal(lostToFollowUp([r(1, "Lost", "2026-10-01T00:00:00Z", "2026-12-01"), r(2, "Paid", "2026-09-01T00:00:00Z", "2026-12-20")], TODAY, NOW), null);
// the mark: linked, else nearest upcoming Paid, else newest
const rs = [r(1, "Paid", "2026-09-01T00:00:00Z", "2026-12-20"), r(2, "Paid", "2026-10-01T00:00:00Z", "2026-11-20"), r(3, "Lost", "2026-11-01T00:00:00Z", "2027-01-01")];
assert.equal(markedReservation(rs, null, TODAY), 2);
assert.equal(markedReservation(rs, 3, TODAY), 3);
assert.equal(markedReservation([r(4, "Lost", "2026-10-01T00:00:00Z", "2026-01-01"), r(5, "Lost", "2026-10-02T00:00:00Z", "2026-01-01")], null, TODAY), 5);
assert.equal(markedReservation([], null, TODAY), null);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: FAIL (cannot resolve `../lib/whatsapp/events/chat-rules`).

- [ ] **Step 3: Implement the module.** Soft-deleted rows are excluded everywhere. `isLiveForFollowUp` = the event date
  is today or later, AND (`Paid` / `Follow-up`, OR `Pending` / `24Save` with `createdAt` within 7 days of `now`).
  "Nearest Paid" sorts ascending by `eventDate`, among `eventDate >= today`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: prints `whatsapp-events selftest: OK` and exits 0.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): Mega Events conversation rules" -- lib/whatsapp/events/chat-rules.ts scripts/whatsapp-events-selftest.ts
```

### Task 2: Migration E1 - `wa_chats`, `wa_app_auto_texts`, reservation columns

**Files:**
- Create: `supabase/migrations/<ts>_whatsapp_events_phase1.sql` (`npm run db:new whatsapp_events_phase1`)
- Test: `scripts/whatsapp-events-sql-pglite-test.mjs` (same harness as `scripts/whatsapp-sql-pglite-test.mjs`:
  `PGLITE_PATH` or `npm i --no-save @electric-sql/pglite`)

**Interfaces:**
- Produces:
  - tables `public.wa_chats` and `public.wa_app_auto_texts`, columns exactly as spec section 5;
  - `reservations.main_contact_phone_key` (trigger-kept) with index `reservations_phone_key_idx`;
  - `reservations.whatsapp_off_at` and `reservations.whatsapp_off_by`;
  - index `wa_messages_reservation_idx` on `wa_messages(reservation_id) where reservation_id is not null`.
- Consumes: `public.phone_key(text)` (exists since `20261019180000_tours_customers.sql`).

- [ ] **Step 1: Write the PGlite test.** It creates a stub `public.reservations` (`id bigserial`,
  `main_contact_phone_number text`, `status text`, `created_at timestamptz`), stub `companies` and `wa_messages`, and
  `public.phone_key` extracted from its migration. Then it runs the new migration and asserts:
  - **"phone key matches the TS twin":** inserting `054-200-2722`, `+972 54 200 2722` and `0542002722` all store
    `542002722`.
  - **"a whole-row update cannot set the key":** `update reservations set main_contact_phone_key = 'x'` leaves it
    recomputed.
  - **The backfill:** a row inserted before the migration gets its key.
  - `unique (company_id, phone_key)` on `wa_chats`, and `unique (company_id, text_norm)` on `wa_app_auto_texts`.
  - RLS is enabled on both new tables; `anon` / `authenticated` have no privilege.
  - **Idempotency:** running the migration twice passes.

  It also has a `--baseline` mode: without the migration it fails at the first assertion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/whatsapp-events-sql-pglite-test.mjs --baseline`
Expected: FAIL at "phone key matches the TS twin".

- [ ] **Step 3: Write the migration.**
  - The column comes first; the backfill is an `update` setting the key from the phone; then the BEFORE INSERT OR
    UPDATE trigger `reservations_phone_key` sets `new.main_contact_phone_key := public.phone_key(new.main_contact_phone_number)`.
  - All DDL uses `if not exists` / `create or replace`.
  - It ends with `revoke all ... from anon, authenticated` on both tables.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/whatsapp-events-sql-pglite-test.mjs`
Expected: `whatsapp-events SQL: OK`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): Mega Events chats table and reservation phone key" -- supabase/migrations/<ts>_whatsapp_events_phase1.sql scripts/whatsapp-events-sql-pglite-test.mjs
```

### Task 3: DB boundary for Events chats

**Files:**
- Create: `lib/services/whatsapp-events-db.ts`

**Interfaces:**
- Consumes: `supabase` from `lib/supabase-server.ts`; `EventsResLite` (Task 1); `fetchPaged`.
- Produces:
  - `type WaChat = { id: string; companyId: string; phone: string; phoneKey: string; profileName: string | null; lastInAt: string | null; lastOutAt: string | null; answeredAt: string | null; seenAt: string | null; linkedReservationId: number | null; optedOutAt: string | null; alertedAt: string | null }`.
  - `chatByKey(companyId: string, phoneKey: string): Promise<WaChat | null>`.
  - `upsertChat(companyId: string, phone: string, phoneKey: string, patch: Partial<Pick<WaChat, "profileName" | "lastInAt" | "lastOutAt" | "answeredAt" | "seenAt">>): Promise<WaChat>`.
    The patch is applied only where it moves a timestamp FORWARD (`greatest`), so an out-of-order webhook never moves
    one back.
  - `markChat(chatId: string, patch: { seenAt?: string; seenBy?: string | null; answeredAt?: string; linkedReservationId?: number | null; linkedBy?: string | null; optedOutAt?: string | null; optedOutSource?: string | null; alertedAt?: string }): Promise<void>`.
  - `reservationsByPhoneKeys(keys: string[]): Promise<(EventsResLite & { phoneKey: string; eventId: number | null; contactName: string })[]>`.
    It joins `events.date` as `eventDate`; keys are chunked by 200.
  - `moveToFollowUp(reservationId: number, today: string, chatId: string): Promise<boolean>`. It writes ONLY `status`
    and `follow_up_date` with `.eq("status", "Lost")` (a rep who got there first wins), and audits `reservation.status`
    with `{ via: "whatsapp", chat_id }`.
  - `autoTexts(companyId: string): Promise<Set<string>>` (cached 60 s per instance), `addAutoTexts(companyId: string, texts: string[], source: "history" | "staff"): Promise<void>`, `removeAutoText(companyId: string, textNorm: string): Promise<void>`.
  - `listChats(companyId: string, filter: "all" | "new" | "unanswered" | "no_order", page: number, pageSize: number): Promise<{ rows: WaChat[]; total: number }>`.
    The `no_order` filter resolves through `reservationsByPhoneKeys` on the page's keys.

- [ ] **Step 1: Write the module.** Every function checks `{ error }` and throws
  `new Error(\`wa_chats: ${error.message}\`)`; callers decide. `listChats` orders by `last_in_at desc nulls last`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p . 2>&1 | grep whatsapp-events-db`
Expected: no lines.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(whatsapp): Mega Events chats DB boundary" -- lib/services/whatsapp-events-db.ts
```

### Task 4: Inbound branch for Mega Events, plus the template-status fix

**Files:**
- Create: `lib/services/whatsapp-events-inbound.ts`
- Modify: `lib/services/whatsapp-inbound.ts`
  - `handleMessage`: dispatch at the top, after the account is found.
  - `handleTemplate`: the status-only update.
  - `handleHistory`: the auto-text suggestion.
- Modify: `lib/services/whatsapp-inbound-deps.ts` (wire the Events deps)
- Modify: `lib/services/whatsapp-db.ts`: `upsertTemplate` gains a status-only path
  (`updateTemplateStatus(companyId, name, language, status)`).
- Test: `scripts/whatsapp-events-selftest.ts` (append), `scripts/whatsapp-inbound-selftest.ts` (must pass unchanged
  except the template-status assertion, updated to expect body and paramCount kept)

**Interfaces:**
- Consumes: Task 1 rules; Task 3 functions; `phoneKey`; `isOptOut`'s word list; `OPT_OUT_REPLY`; `shouldOpenInquiry`.
- Produces:
  - `InboundDeps` gains `companyProducts(companyId: string): Promise<string[]>` (cached per batch) and
    `events: EventsInboundDeps`.
  - `EventsInboundDeps = { chatByKey, upsertChat, markChat, reservationsByPhoneKeys, moveToFollowUp, autoTexts, addAutoTexts, recentEchoes(companyId: string, days: number): Promise<{ phoneKey: string; text: string | null }[]> }`.
  - `handleEventsMessage(ev: MessageEvent, account: WaAccount, deps: InboundDeps, out: InboundSummary): Promise<void>`.

- [ ] **Step 1: Write the failing tests.** Append a section to `scripts/whatsapp-events-selftest.ts` with in-memory
  stubs of `InboundDeps`. Copy `ACCOUNT` from the inbound selftest and use company `co-ev` with products `["events"]`.
  The tests:
  - **"no tours rows for an events company":** a customer text calls `insertLead` 0 times and `findCustomers` 0 times;
    one `wa_messages` row; the chat's `lastInAt` = the message time.
  - **"a reaction stores but does not open":** a `reaction` sets no `lastInAt` and calls no `moveToFollowUp`.
  - **"history marks nothing":**
    - 300 history messages (both directions) in one batch;
    - the chat's `seenAt` and `answeredAt` are set, and `lastInAt` stays null;
    - `moveToFollowUp` is never called, and no service text is sent;
    - the batch finishes in under 2 s on the stubs.
  - **"an echo answers":** an `app` echo sets `answeredAt` and `seenAt`. An echo whose `normAutoText` is in
    `autoTexts` sets neither.
  - **"R-2 on a new conversation only":**
    - a first message from a phone whose only order (event ahead) is `Lost` calls `moveToFollowUp(id, TODAY, chatId)`
      once;
    - a second message 1 h later calls nothing;
    - a message 25 h later calls it again.
  - **"opt-out is the whole message":** "הסר" sets `optedOutAt` and sends `OPT_OUT_REPLY` once. "הסר את המלון" does
    neither.
  - **"tours path unchanged":** the same text to a `["tours"]` company calls `insertLead` once.
  - **"template status keeps the body":** a `message_template_status_update` calls `updateTemplateStatus` and never
    `upsertTemplate` with a null body.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: FAIL at "no tours rows for an events company".

- [ ] **Step 3: Implement.**
  - `handleMessage` calls `handleEventsMessage` and returns when `isEventsCompany(await deps.companyProducts(account.companyId))`.
  - **Order inside `handleEventsMessage`:**
    1. store the message (`customerId` and `caseId` null; media as today);
    2. history -> `upsertChat` with `seenAt` and `answeredAt` = now, and stop;
    3. echo -> answer unless it is an auto text, and stop;
    4. a customer message that does not count as inbound -> stop;
    5. opt-out;
    6. `previous` = the chat's `lastInAt` read BEFORE the upsert, then `upsertChat({ lastInAt })`;
    7. if `shouldOpenInquiry(previous, ev.sentAt)`: `lostToFollowUp` -> `moveToFollowUp`.
  - "Today" is the Israel day (`israelToday` in `lib/marketing/range.ts`).
  - `handleHistory`, for an events company, also calls `addAutoTexts(companyId, suggestAutoTexts(await recentEchoes(companyId, 200)), "history")`.

- [ ] **Step 4: Run all the inbound tests**

Run: `npx tsx scripts/whatsapp-events-selftest.ts && npx tsx scripts/whatsapp-inbound-selftest.ts && npx tsx scripts/whatsapp-webhook-selftest.ts && npx tsx scripts/whatsapp-selftest.ts`
Expected: all four print OK.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): Mega Events inbound branch, no tours rows; template status keeps its body" -- lib/services/whatsapp-events-inbound.ts lib/services/whatsapp-inbound.ts lib/services/whatsapp-inbound-deps.ts lib/services/whatsapp-db.ts scripts/whatsapp-events-selftest.ts scripts/whatsapp-inbound-selftest.ts
```

### Task 5: Settings for a Mega Events admin (connect, templates, auto texts)

**Files:**
- Modify: `lib/actions/whatsapp-settings-actions.ts`
  - `manager()` accepts an active company selling `tours` or `events`, with `isManagerRole`; ADMIN_ROLES for events.
  - `finishWhatsappSignup` skips `requestContactsSync` when `isEventsCompany`.
- Create: `lib/actions/whatsapp-auto-text-actions.ts`: `listAutoTexts()`, `addAutoText(text)`, `removeAutoText(textNorm)`.
  Each guards with `manager()`, returns `{ ok, ... }`, and audits `whatsapp.auto_text`.
- Create: `components/whatsapp/auto-texts-card.tsx`

**Interfaces:**
- Consumes: `isEventsCompany` (Task 1); `addAutoTexts` / `removeAutoText` / `autoTexts` (Task 3).
- Produces: `AutoTextsCard({ initial }: { initial: { text: string; source: string }[] })`, used by Task 7's settings
  tab.

- [ ] **Step 1: Write the failing test.** Append to `scripts/whatsapp-events-selftest.ts` a pure test of the exported
  helper `signupSyncs(productTypes: string[]): { contacts: boolean; history: boolean }`, placed in `chat-rules.ts`:

```ts
assert.deepEqual(signupSyncs(["events"]), { contacts: false, history: true });
assert.deepEqual(signupSyncs(["tours"]), { contacts: true, history: true });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: FAIL (`signupSyncs` is not exported).

- [ ] **Step 3: Implement** `signupSyncs`, the guard change, the contacts skip, the auto-text actions and the card (a
  list with source tags, a textarea + "הוסף", a remove icon per row).

- [ ] **Step 4: Verify**

Run: `npx tsx scripts/whatsapp-events-selftest.ts && npx tsc --noEmit -p . 2>&1 | grep -E "whatsapp-(settings|auto-text)|auto-texts-card"`
Expected: OK, and no tsc lines.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): connect and auto texts for a Mega Events admin; no phone-book sync for events" -- lib/actions/whatsapp-settings-actions.ts lib/actions/whatsapp-auto-text-actions.ts components/whatsapp/auto-texts-card.tsx lib/whatsapp/events/chat-rules.ts scripts/whatsapp-events-selftest.ts
```

### Task 6: Chat actions and the shared thread + reply box

**Files:**
- Create: `lib/actions/whatsapp-events-actions.ts`. Every action uses `requireCompany("events")` and returns
  `{ ok: true, ... } | { ok: false, kind, message }`.
- Create: `components/whatsapp/thread-view.tsx`
  - It renders a `WaThread` without tours imports: lift the pure parts of `components/tours/cases/whatsapp-thread.tsx`.
  - The tours component keeps its look and becomes a wrapper over it.
- Create: `components/whatsapp/reply-box.tsx`
- Modify: `components/tours/cases/whatsapp-thread.tsx` (wrap `ThreadView`; same props, same output)
- Modify: `lib/services/whatsapp-cloud.ts`: `SendMeta` gains `reservationId?: number | null`, written to
  `wa_messages.reservation_id` (`WaMessageInsert` gains `reservationId`, default null, so the tours callers are
  unchanged).

**Interfaces:**
- Consumes: Task 3 functions; `listThread(companyId, phoneKeys, opts)` from `whatsapp-db.ts`; `sendText`; `canSendText`.
- Produces:
  - `listEventsChats(input: { filter: "all" | "new" | "unanswered" | "no_order"; page: number })`
    -> `{ ok: true; rows: ChatRow[]; total: number }`, where
    `ChatRow = WaChat & { orders: { id: number; status: string }[]; displayName: string; lastText: string | null; unansweredMinutes: number | null }`.
  - `openEventsChat(chatId: string)` -> `{ ok: true; chat: ChatRow; thread: WaThread }`. It stamps `seenAt` / `seenBy`;
    never while impersonating.
  - `replyEventsChat(input: { chatId: string; text: string; reservationId: number | null })` -> `{ ok: true } | { ok: false; kind: "window_closed" | "send_failed"; message: string }`.
    On success it sets `answeredAt`, `lastOutAt` and `seenAt`.
  - `markChatHandled(chatId: string)` -> `{ ok: true }` (`answeredAt` + `seenAt`, audited `whatsapp.handled`).
  - `linkChatToReservation(chatId: string, reservationId: number | null)` (audited `whatsapp.chat_linked`).
  - `searchReservationsForLink(q: string)` -> `{ ok: true; rows: { id: number; name: string; status: string; eventName: string | null }[] }`
    (id, name or phone; 20 rows).
  - `setChatOptOut(chatId: string, optedOut: boolean, note: string)` (note at least 3 characters; audited
    `whatsapp.consent`).
  - `ThreadView({ thread, onLoadMore? })`;
    `ReplyBox({ chatId, reservationId, lastInAt, onSent }: { chatId: string; reservationId: number | null; lastInAt: string | null; onSent: () => void })`.

- [ ] **Step 1: Write the failing test.** Append the pure helper `replyState(lastInAt: string | null, now: string): { open: boolean; note: string | null }`
  in `chat-rules.ts`:

```ts
assert.deepEqual(replyState("2026-11-08T09:00:00Z", "2026-11-08T10:00:00Z"), { open: true, note: null });
assert.deepEqual(replyState("2026-11-07T09:00:00Z", "2026-11-08T10:00:00Z"), { open: false, note: "הלקוח כתב לפני יותר מ-24 שעות - עונים מהאפליקציה" });
assert.deepEqual(replyState(null, "2026-11-08T10:00:00Z").open, false);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: FAIL (`replyState` missing).

- [ ] **Step 3: Implement** the helper, the actions, `ThreadView`, `ReplyBox` (textarea up to `WA_TEXT_MAX`, Enter
  sends, Shift+Enter is a new line, disabled with the note when closed) and the `SendMeta` field.

- [ ] **Step 4: Verify** that the tours thread is unchanged and the types pass

Run: `npx tsx scripts/whatsapp-events-selftest.ts && npx tsx scripts/whatsapp-selftest.ts && npx tsc --noEmit -p . 2>&1 | grep -E "whatsapp"`
Expected: OK, OK, no tsc lines.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): Mega Events chat actions, shared thread view and reply box" -- lib/actions/whatsapp-events-actions.ts components/whatsapp/thread-view.tsx components/whatsapp/reply-box.tsx components/tours/cases/whatsapp-thread.tsx lib/services/whatsapp-cloud.ts lib/services/whatsapp-db.ts lib/whatsapp/events/chat-rules.ts scripts/whatsapp-events-selftest.ts
```

### Task 7: The WhatsApp screen `/whatsapp`

**Files:**
- Create: `app/(dashboard)/whatsapp/page.tsx` (server; `requireCompany("events")`)
- Create: `app/(dashboard)/whatsapp/whatsapp-screen.tsx` (client)
- Modify: `lib/nav.ts`: item `{ name: "WhatsApp", href: "/whatsapp", icon: MessageCircle, keywords: "whatsapp וואטסאפ שיחות", productType: "events" }`
  in the group that holds `/reservations`.
- Modify: `app/(dashboard)/guide/guide-content.ts` (section with `nav: "/whatsapp"`, EN + HE, a `howTo` for answering
  and for "הצמד להזמנה")

**Interfaces:**
- Consumes: Task 6 actions and components; Task 5's `AutoTextsCard`; the existing `WhatsappCard` from
  `components/tours/content/whatsapp-card.tsx`; `UrlTabs`; `useUrlState`; `getWhatsappSettings`.

- [ ] **Step 1: Build the screen.**
  - Tabs `שיחות` | `הגדרות` (`?tab=`). The settings tab is shown only to `ADMIN_ROLES`.
  - The list loads with ONE `listEventsChats` call. The filter is in the URL (`?f=`), 50 a page.
  - A row click calls `openEventsChat` and shows `ThreadView` + `ReplyBox` + "פתח בוואטסאפ" (`whatsappAppLink`) +
    "טופל" + "הצמד להזמנה" (a popover over `searchReservationsForLink`) + "בטל הצמדה".
  - The settings tab renders `WhatsappCard` + `AutoTextsCard`. When `NEXT_SECRET_WA_EVENTS_TRIAL_PHONE` is set it
    adds the line "מצב ניסיון: כל ההודעות האוטומטיות הולכות ל-<last 4 digits>". When `EVENTS_WHATSAPP_AUTO=off` it
    adds "ההודעות האוטומטיות כבויות".

- [ ] **Step 2: Run the guide check**

Run: `npx tsx scripts/guide-selftest.ts`
Expected: OK (it fails while `/whatsapp` has no section).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "whatsapp|nav.ts|guide-content"`
Expected: no lines.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(whatsapp): the Mega Events WhatsApp screen" -- "app/(dashboard)/whatsapp/page.tsx" "app/(dashboard)/whatsapp/whatsapp-screen.tsx" lib/nav.ts "app/(dashboard)/guide/guide-content.ts"
```

### Task 8: The order page fold, the off switch, and the list mark

**Files:**
- Modify: `app/(dashboard)/reservations/[id]/page.tsx` (a WhatsApp fold)
- Create: `app/(dashboard)/reservations/[id]/whatsapp-fold.tsx`
- Modify: `lib/actions/reservation-actions.ts`
  - `updateReservation` strips `whatsapp_off_at`, `whatsapp_off_by` and `main_contact_phone_key` from `rest`, beside
    the cost columns.
  - `getReservations` side-reads the marks (best-effort, like `follow_up_date`).
- Create in `lib/actions/whatsapp-events-actions.ts`:
  - `reservationWhatsapp(reservationId: number)` -> `{ ok: true; chats: ChatRow[]; thread: WaThread; off: { at: string; by: string | null } | null; outbox: OutboxLine[] }`.
    `OutboxLine` = `{ kind: string; at: string; status: string; reason: string | null; sentTo: string | null }`; it is
    `[]` until Task 10's table exists, and the read tolerates 42P01 / PGRST205.
  - `setReservationWhatsappOff(reservationId: number, off: boolean)` (audited `reservation.whatsapp_off`).
  - `whatsappMarks(reservationIds: number[]): Promise<Set<number>>`.
- Modify: `app/(dashboard)/reservations/reservations-table.tsx`: "💬" in the status cell for marked ids, and the view
  "הודעות חדשות (N)" via `?wa=new`.
- Modify: `types/reservation.types.ts`: `ReservationListRow.wa_new?: boolean`.

**Interfaces:**
- Consumes: `markedReservation` (Task 1), `reservationsByPhoneKeys` (Task 3), Task 6 components.

- [ ] **Step 1: Write the failing test.** Append the pure helpers `withoutWaColumns<T extends Record<string, unknown>>(row: T): Omit<T, "whatsapp_off_at" | "whatsapp_off_by" | "main_contact_phone_key">` and
  `marksFor(unseen: { phoneKey: string; linkedReservationId: number | null }[], orders: (EventsResLite & { phoneKey: string })[], today: string): Set<number>`
  in `chat-rules.ts`:

```ts
const orders = [{ ...r(10, "Paid", "2026-09-01T00:00:00Z", "2026-12-01"), phoneKey: "542002722" }, { ...r(11, "Lost", "2026-10-01T00:00:00Z", "2026-12-05"), phoneKey: "542002722" }];
assert.deepEqual([...marksFor([{ phoneKey: "542002722", linkedReservationId: null }], orders, TODAY)], [10]);
assert.deepEqual([...marksFor([{ phoneKey: "500000000", linkedReservationId: 11 }], orders, TODAY)], [11]);
assert.deepEqual([...marksFor([], orders, TODAY)], []);
// the edit page's whole-row save never writes the WhatsApp columns (withoutWaColumns, used by updateReservation)
assert.deepEqual(withoutWaColumns({ status: "Paid", whatsapp_off_at: null, whatsapp_off_by: null, main_contact_phone_key: "x" }), { status: "Paid" });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: FAIL (`marksFor` missing).

- [ ] **Step 3: Implement.**
  - The fold loads with ONE `reservationWhatsapp` call, opened on request.
  - Opening it stamps `seenAt` for its chats.
  - It shows `ThreadView`, `ReplyBox` (`reservationId` = the page's), "טופל", the off switch, and the outbox lines
    ("נשלח 12:03", "לא נשלח: <reason>", "נשלח לטלפון הניסיון").
  - `getReservations` calls `whatsappMarks` in a `try` and leaves `wa_new` unset on failure.

- [ ] **Step 4: Verify**

Run: `npx tsx scripts/whatsapp-events-selftest.ts && npx tsx scripts/reservation-follow-up-selftest.ts && npx tsc --noEmit -p . 2>&1 | grep -E "reservation|whatsapp"`
Expected: OK, OK, no tsc lines.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): WhatsApp on the order page and a new-message mark on the reservations list" -- "app/(dashboard)/reservations/[id]/page.tsx" "app/(dashboard)/reservations/[id]/whatsapp-fold.tsx" lib/actions/reservation-actions.ts lib/actions/whatsapp-events-actions.ts "app/(dashboard)/reservations/reservations-table.tsx" types/reservation.types.ts lib/whatsapp/events/chat-rules.ts scripts/whatsapp-events-selftest.ts
```

### Task 9: The unanswered alert (rule, banner, nav count, mail cron)

**Files:**
- Create: `lib/whatsapp/events/working-time.ts`
- Create: `lib/services/whatsapp-events-alerts.ts`: `runEventsAlerts({ dryRun, now })`
- Create: `app/api/cron/waEventsAlerts/route.ts`
- Create: `components/whatsapp-unanswered-alert.tsx` (dashboard banner beside `FollowUpAlert`)
- Modify: `app/(dashboard)/dashboard/page.tsx` (mount the banner); `lib/nav.ts` / the sidebar count (follow the
  existing badge pattern if one exists, else the banner alone)
- Modify: `vercel.json`: `{ "path": "/api/cron/waEventsAlerts", "schedule": "*/15 6-15 * * 0-4" }` (UTC; it covers
  09:00-17:00 Israel in both summer and winter, and the rule itself filters)
- Test: `scripts/whatsapp-events-selftest.ts` (append)

**Interfaces:**
- Produces:
  - `workingMinutesBetween(from: Date, to: Date): number` (Sunday-Thursday 09:00-17:00 Asia/Jerusalem).
  - `unansweredFor(lastInAt: string | null, answeredAt: string | null, now: Date): number | null`: the working minutes
    when at least 60 and unanswered, else null.
  - `isAlertTime(now: Date): boolean`.
  - `runEventsAlerts(...)` -> `{ unanswered: number; mailed: number; chatIds: string[] }`.
  - `countUnanswered(companyId: string): Promise<number>` (used by the banner and the nav).

- [ ] **Step 1: Write the failing tests**

```ts
// Sunday 08.11.2026 is IST (UTC+2): 09:00 IL = 07:00Z
assert.equal(workingMinutesBetween(new Date("2026-11-08T07:00:00Z"), new Date("2026-11-08T08:00:00Z")), 60);
// 16:30 Sunday -> 09:30 Monday = 30 + 30 = 60
assert.equal(workingMinutesBetween(new Date("2026-11-08T14:30:00Z"), new Date("2026-11-09T07:30:00Z")), 60);
// Thursday 16:00 -> Sunday 09:00 = 60 (Friday and Saturday do not count)
assert.equal(workingMinutesBetween(new Date("2026-11-12T14:00:00Z"), new Date("2026-11-15T07:00:00Z")), 60);
assert.equal(unansweredFor("2026-11-08T07:00:00Z", null, new Date("2026-11-08T07:59:00Z")), null);
assert.equal(unansweredFor("2026-11-08T07:00:00Z", null, new Date("2026-11-08T08:00:00Z")), 60);
assert.equal(unansweredFor("2026-11-08T07:00:00Z", "2026-11-08T07:10:00Z", new Date("2026-11-08T09:00:00Z")), null);
// summer (IDT, UTC+3): Sunday 07.06.2026 09:00 IL = 06:00Z
assert.equal(workingMinutesBetween(new Date("2026-06-07T06:00:00Z"), new Date("2026-06-07T07:00:00Z")), 60);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: FAIL (`workingMinutesBetween` missing).

- [ ] **Step 3: Implement.**
  - `runEventsAlerts` reads the unanswered chats of the Mega Events company (`last_in_at > answered_at`, not history).
  - It mails ONE digest, through `sendMail`, of the chats with `alertedAt < lastInAt`, to `NEXT_SECRET_WA_EVENTS_ALERT_TO`
    (else `DEFAULT_FROM`). Each line: name / phone last 4 digits / minutes / the order chips / a link to
    `/whatsapp?chat=<id>`, HTML-escaped (`lib/html-escape.ts`).
  - THEN it stamps `alertedAt`. A failed mail stamps nothing.
  - The route: `guardCronRoute`, `?dry_run=1` = the report with no mail and no stamp, and `maxDuration` 60.

- [ ] **Step 4: Verify**

Run: `npx tsx scripts/whatsapp-events-selftest.ts && npx tsc --noEmit -p . 2>&1 | grep -E "whatsapp|waEventsAlerts"`
Expected: OK, no tsc lines.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): unanswered Mega Events chats - banner, count and a mail digest" -- lib/whatsapp/events/working-time.ts lib/services/whatsapp-events-alerts.ts app/api/cron/waEventsAlerts/route.ts components/whatsapp-unanswered-alert.tsx "app/(dashboard)/dashboard/page.tsx" lib/nav.ts vercel.json scripts/whatsapp-events-selftest.ts
```

### Task 10: Migration E2 - `wa_outbox` and the reservations trigger

**Files:**
- Create: `supabase/migrations/<ts>_whatsapp_events_outbox.sql` (`npm run db:new whatsapp_events_outbox`, after Task 2's)
- Test: `scripts/whatsapp-events-outbox-pglite-test.mjs`

**Interfaces:**
- Produces:
  - table `public.wa_outbox` (spec section 5, including `from_status`);
  - function `public.reservations_wa_outbox()`;
  - trigger `reservations_wa_outbox` AFTER INSERT OR UPDATE OF `status`, `payment_info`, `confirmation_email_sent`,
    `travel_materials_sent_at` ON `public.reservations` FOR EACH ROW.
  - The Mega Events company id `a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601` (`MEGA_EVENTS_COMPANY_ID`) is a constant in the
    function.

- [ ] **Step 1: Write the PGlite test.**
  - Stub tables:
    - `reservations` with `status`, `payment_info jsonb`, `confirmation_email_sent bool`,
      `partner_settlement_method text`, `travel_materials_sent_at timestamptz`;
    - `wa_accounts` with `company_id`, `is_active`;
    - `wa_messages`.
  - The scenarios (`dedupe_key` exactly as the spec):
    - **"no account, no rows":** with no active Mega Events account, a Paid update queues nothing.
    - **`payment_received`:** with an account, `Pending -> Paid` queues `payment_received:<id>` once. A second Paid
      update queues nothing new.
    - **`payment_failed`:** a `payment_info` update with `status` still `Pending` queues
      `payment_failed:<id>:<Israel day>`, with `due_at` about now + 15 minutes. The same update with `status = 'Paid'`
      queues `payment_received` and no failure.
    - **`phone_order`:** `confirmation_email_sent` false -> true with `Pending`, `payment_info` null and settlement null
      queues `phone_order:<id>`. With settlement `voucher` it queues nothing.
    - **`materials_sent`:** `travel_materials_sent_at` null -> now queues `materials_sent:<id>`.
    - **`order_cancelled`:** `Paid -> Cancelled` queues `order_cancelled:<id>` with `from_status = 'Paid'`.
    - **"a broken wa_outbox never fails a reservation write":** drop a column of `wa_outbox`, then
      `update reservations set status = 'Paid'` succeeds and the row is `Paid`.
    - The migration runs twice cleanly.
  - `--baseline` (without the migration) fails at the first queue assertion.

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/whatsapp-events-outbox-pglite-test.mjs --baseline`
Expected: FAIL at "payment_received".

- [ ] **Step 3: Write the migration.**
  - The function body is wrapped in `begin ... exception when others then raise warning 'reservations_wa_outbox: %', sqlerrm; end;`
    and `return null`.
  - The EXISTS check on an active Mega Events account comes first.
  - Inserts use `on conflict (dedupe_key) do nothing`. The Israel day comes from
    `(now() at time zone 'Asia/Jerusalem')::date`.
  - RLS on, revoke from `anon` / `authenticated`, and index `(status, due_at)`.

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/whatsapp-events-outbox-pglite-test.mjs`
Expected: `whatsapp-events outbox SQL: OK`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): order updates queue from a reservations trigger that never fails a booking" -- supabase/migrations/<ts>_whatsapp_events_outbox.sql scripts/whatsapp-events-outbox-pglite-test.mjs
```

### Task 11: The send decision and the template parameters (pure)

**Files:**
- Create: `lib/whatsapp/events/outbox.ts`
- Create: `lib/whatsapp/events/params.ts`
- Test: `scripts/whatsapp-events-selftest.ts` (append)

**Interfaces:**
- Produces:
  - `type OutboxKind = "payment_received" | "payment_failed" | "phone_order" | "materials_sent" | "order_cancelled" | "flight_reminder" | "event_today" | "after_trip"`.
  - `type OutboxRowLite = { id: string; kind: OutboxKind; reservationId: number; dueAt: string; fromStatus: string | null; createdAt: string }`.
  - `type OrderLite = { id: number; status: string; isDeleted: boolean; whatsappOffAt: string | null; itineraryGroup: string | null; phone: string | null; phoneKey: string; eventId: number | null; eventDate: string | null; createdAt: string; paymentReceivedSent: boolean }`.
  - `type DecisionEnv = { auto: boolean; approved: Set<string> }`.
  - `outboxDecision(row: OutboxRowLite, order: OrderLite, newerPaidSameEvent: boolean, env: DecisionEnv, now: Date): { act: "send"; to: string } | { act: "skip"; reason: string } | { act: "wait" }`.
    The checks and Hebrew reasons are exactly those of spec section 9, in that order. "Day passed" applies to date
    kinds whose `dueAt` Israel day is before today.
  - `documentsOf(o: { hasFlight: boolean; hasHotel: boolean }): string` (the four strings of spec section 10).
  - `type ParamSource = { firstName: string | null; orderId: number; eventLabel: string; resumeUrl: string; documents: string; flight?: { city: string; number: string; date: string; hour: string; airport: string }; place?: string }`.
  - `paramsFor(kind: OutboxKind, s: ParamSource): string[]`: the `{{n}}` order of the drafts in spec section 10.
  - `greetingName(first: string | null): string`: a single word of letters, else "שלום".
  - `cleanParam(s: string): string`: drops newlines and tabs, collapses 4 or more spaces, trims.

- [ ] **Step 1: Write the failing tests** (an order and env builder at the top of the section):

```ts
const env = { auto: true, approved: new Set(["payment_received:he", "payment_failed:he", "order_cancelled:he", "flight_reminder:he"]) };
assert.deepEqual(outboxDecision(row("payment_received"), order({ status: "Paid" }), false, { ...env, auto: false }, NOW), { act: "skip", reason: "הופסק ידנית" });
assert.deepEqual(outboxDecision(row("payment_received"), order({ status: "Paid", whatsappOffAt: "2026-11-01T00:00:00Z" }), false, env, NOW), { act: "skip", reason: "כבוי להזמנה הזו" });
assert.deepEqual(outboxDecision(row("payment_received"), order({ status: "Paid", itineraryGroup: "g1" }), false, env, NOW), { act: "skip", reason: "טיול יורו - לא בסבב הזה" });
assert.deepEqual(outboxDecision(row("payment_received"), order({ status: "Paid", phone: "12" }), false, env, NOW), { act: "skip", reason: "אין טלפון תקין" });
assert.deepEqual(outboxDecision(row("materials_sent"), order({ status: "Paid" }), false, env, NOW), { act: "skip", reason: "התבנית לא אושרה" });
assert.deepEqual(outboxDecision(row("payment_failed", { dueAt: "2026-11-08T10:10:00Z" }), order({ status: "Pending" }), false, env, NOW), { act: "wait" });
assert.deepEqual(outboxDecision(row("payment_failed"), order({ status: "Pending" }), true, env, NOW), { act: "skip", reason: "שולם בהזמנה חדשה" });
assert.deepEqual(outboxDecision(row("payment_failed"), order({ status: "Paid" }), false, env, NOW), { act: "skip", reason: "ההזמנה השתנתה" });
assert.deepEqual(outboxDecision(row("order_cancelled", { fromStatus: "Pending" }), order({ status: "Cancelled" }), false, env, NOW), { act: "skip", reason: "ההזמנה לא שולמה" });
assert.deepEqual(outboxDecision(row("order_cancelled", { fromStatus: "Paid" }), order({ status: "Cancelled" }), false, env, NOW), { act: "send", to: "972542002722" });
assert.deepEqual(outboxDecision(row("payment_received"), order({ status: "Paid", eventDate: "2026-10-01" }), false, env, NOW), { act: "skip", reason: "האירוע עבר" });
assert.deepEqual(outboxDecision(row("flight_reminder", { dueAt: "2026-11-07T07:00:00Z" }), order({ status: "Paid" }), false, env, NOW), { act: "skip", reason: "עבר הזמן" });
assert.equal(documentsOf({ hasFlight: true, hasHotel: true }), "אישור ההזמנה, כרטיסי הטיסה ושובר המלון");
assert.equal(documentsOf({ hasFlight: false, hasHotel: false }), "אישור ההזמנה");
assert.equal(greetingName("דנה"), "דנה");
assert.equal(greetingName("dana123"), "שלום");
assert.equal(cleanParam("a\nb\t c     d"), "a b c d");
assert.equal(paramsFor("order_cancelled", src).length, 3);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: FAIL (`outboxDecision` missing).

- [ ] **Step 3: Implement both modules.**
  - `approved` keys are `name:language`.
  - The phone goes through `whatsappPhone` from `lib/tours/cases.ts`.
  - `greetingName` reuses the `NAME_ALLOWED` pattern; export it from `lib/tours/waitlist-dates.ts` rather than copying
    it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx scripts/whatsapp-events-selftest.ts && npx tsx scripts/tours-waitlist-dates-selftest.ts`
Expected: OK, OK.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): Mega Events send decision and template parameters" -- lib/whatsapp/events/outbox.ts lib/whatsapp/events/params.ts lib/tours/waitlist-dates.ts scripts/whatsapp-events-selftest.ts
```

### Task 12: The drain - service, cron, trial and kill switch, staff paths

**Files:**
- Create: `lib/services/whatsapp-events-outbox.ts`
- Create: `app/api/cron/waEventsOutbox/route.ts`
- Modify: `vercel.json`: `{ "path": "/api/cron/waEventsOutbox", "schedule": "*/2 * * * *" }`
- Modify: `lib/actions/reservation-actions.ts`: after the write in `updateReservation`, `updateReservationsStatus`,
  `cancelReservation` and `setTravelMaterialsSent`, call `drainOutboxFor(id)`. A failure is logged and never fails the
  action.

**Interfaces:**
- Consumes:
  - `outboxDecision`, `paramsFor`, `documentsOf` (Task 11);
  - `sendTemplate` with `origin: "automation"` and `reservationId` (Task 6);
  - `companyById(MEGA_EVENTS_COMPANY_ID)`, `listTemplates`;
  - `normalizeReservationEventOrderInfo` (`lib/utils.ts`), `shortPlace` (`lib/lodging.ts`).
- Produces:
  - `drainOutbox(opts: { budgetMs: number; dryRun: boolean; reservationId?: number; now?: Date }): Promise<{ sent: number; skipped: number; failed: number; waiting: number; lines: { id: string; kind: string; reservationId: number; result: string }[] }>`.
  - `drainOutboxFor(reservationId: number): Promise<void>` = `drainOutbox({ budgetMs: 8000, dryRun: false, reservationId })`.
  - `trialPhone(): string | null` (`whatsappPhone(process.env.NEXT_SECRET_WA_EVENTS_TRIAL_PHONE)`).

- [ ] **Step 1: Write the failing test.** Append a section to `scripts/whatsapp-events-selftest.ts` that runs
  `drainOutbox` over injected deps. The service takes `deps` as an optional last argument, defaulting to the real ones,
  as in `runWaitlistTick`. The tests:
  - **"trial sends to the trial phone":** with the trial phone `0525287144`, the `send` stub receives
    `to: "972525287144"` with the customer's params, and the row is finished `sent` with `sentTo: "972525287144"`.
  - **"dry run sends nothing and finishes nothing":** a dry run calls `send` 0 times and writes 0 finishes.
  - **"a failed send retries twice then stays failed":** `attempts` goes 1, 2, 3, then the row is `failed` with Meta's
    error.
  - **"pending wait is left pending":** a `payment_failed` row inside its 15 minutes is not touched.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: FAIL (`drainOutbox` missing).

- [ ] **Step 3: Implement.**
  - The pending rows are read with `due_at <= now`, oldest first, 100 at most.
  - For each one, the order is read once and `newerPaidSameEvent` is computed: the same `main_contact_phone_key`, the
    same `event_id`, `status = 'Paid'`, a later `created_at`.
  - The approved set comes from `wa_templates`.
  - Each row is finished with `status`, `reason`, `wa_message_id`, `sent_to` and `finished_at`, inside the budget.
  - The route: `guardCronRoute`, `?dry_run=1`, a 45 s budget, `maxDuration` 60, one summary log line.

- [ ] **Step 4: Verify**

Run: `npx tsx scripts/whatsapp-events-selftest.ts && npx tsc --noEmit -p . 2>&1 | grep -E "whatsapp|waEventsOutbox|reservation-actions"`
Expected: OK, no tsc lines.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): send Mega Events order updates - drain cron, trial phone, kill switch" -- lib/services/whatsapp-events-outbox.ts app/api/cron/waEventsOutbox/route.ts vercel.json lib/actions/reservation-actions.ts scripts/whatsapp-events-selftest.ts
```

### Task 13: The date schedule (pure rules)

**Files:**
- Create: `lib/whatsapp/events/schedule.ts`
- Test: `scripts/whatsapp-events-selftest.ts` (append)

**Interfaces:**
- Produces:
  - `type FlightFacts = { departureLocal: string; number: string; airport: string; returnArrivalLocal: string | null }`
    (local `YYYY-MM-DDTHH:mm:ss`, no zone).
  - `flightFacts(input: { flightOrderInfo: unknown; offline: { outbound_departure_time: string | null; outbound_flight_number: string | null; outbound_departure_airport: string | null; inbound_arrival_time: string | null; is_deleted: unknown; cancelled_at: string | null } | null }): FlightFacts | null`.
    The offline row wins when it is live. The number is `offer.itineraries[0].segments[0].carrierCode + number` when
    present, else `outbound.flightNumber`. A `{}` or missing time gives null.
  - `slotFor(kind: "flight_reminder" | "event_today" | "after_trip", f: { flight: FlightFacts | null; eventDate: string | null }): string | null`
    (a UTC ISO instant of the Israel-time slot).
  - `dueThisHour(slot: string | null, now: Date): boolean` (the slot is in the current Israel hour).
  - `lateBooking(createdAt: string, slot: string): boolean` (`createdAt` after `slot`).
  - `airportLabel(iata: string): string` ("נתב״ג" for TLV).
  - `flightParams(f: FlightFacts, flightCity: string)` -> `{ city; number; date: "DD.MM"; hour: "HH:MM"; airport }`.
    It uses `formatHm` / `formatDmy` from `lib/itinerary/reservation-group.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
const amadeus = { outbound: { departureTime: "2026-11-12T06:40:00", departureAirport: "TLV", flightNumber: "LY315" }, inbound: { arrivalTime: "2026-11-15T22:10:00" }, offer: { itineraries: [{ segments: [{ carrierCode: "LY", number: "317" }] }] } };
const ff = flightFacts({ flightOrderInfo: amadeus, offline: null })!;
assert.equal(ff.number, "LY317"); // the operating segment, not the validating carrier's stored number
assert.equal(flightFacts({ flightOrderInfo: {}, offline: null }), null);
assert.equal(flightFacts({ flightOrderInfo: amadeus, offline: { outbound_departure_time: "2026-11-12T09:00:00", outbound_flight_number: "IZ101", outbound_departure_airport: "TLV", inbound_arrival_time: null, is_deleted: null, cancelled_at: null } })!.number, "IZ101");
// 3 days before 12.11 at 09:00 Israel (IST, UTC+2) = 2026-11-09T07:00:00Z
assert.equal(slotFor("flight_reminder", { flight: ff, eventDate: "2026-11-13" }), "2026-11-09T07:00:00.000Z");
assert.equal(slotFor("event_today", { flight: ff, eventDate: "2026-11-13" }), "2026-11-13T08:00:00.000Z");
assert.equal(slotFor("after_trip", { flight: ff, eventDate: "2026-11-13" }), "2026-11-16T09:00:00.000Z");
assert.equal(slotFor("after_trip", { flight: null, eventDate: "2026-11-13" }), "2026-11-14T09:00:00.000Z");
assert.equal(slotFor("flight_reminder", { flight: null, eventDate: "2026-11-13" }), null);
assert.equal(dueThisHour("2026-11-09T07:00:00.000Z", new Date("2026-11-09T07:05:00Z")), true);
assert.equal(dueThisHour("2026-11-09T07:00:00.000Z", new Date("2026-11-09T08:05:00Z")), false);
assert.equal(lateBooking("2026-11-10T10:00:00Z", "2026-11-09T07:00:00.000Z"), true);
assert.deepEqual(flightParams(ff, "לונדון"), { city: "לונדון", number: "LY317", date: "12.11", hour: "06:40", airport: "נתב״ג" });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: FAIL (`flightFacts` missing).

- [ ] **Step 3: Implement.** The Israel-time slot instants go through `Intl` (Asia/Jerusalem); no library.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): Mega Events reminder slots - flight, event day, after the trip" -- lib/whatsapp/events/schedule.ts scripts/whatsapp-events-selftest.ts
```

### Task 14: The schedule cron, the event place, and the docs

**Files:**
- Create: `lib/services/whatsapp-events-schedule.ts`: `runEventsSchedule({ dryRun, now })`
- Create: `app/api/cron/waEventsSchedule/route.ts`
- Modify: `vercel.json`: `{ "path": "/api/cron/waEventsSchedule", "schedule": "5 * * * *" }`
- Modify: `lib/services/whatsapp-events-outbox.ts`: build `flight` / `place` params for the date kinds.
- Modify: `CLAUDE.md` (a block for this feature beside the tours WhatsApp block; the four env names in the env section)
- Modify: `app/(dashboard)/guide/guide-content.ts` (the automatic messages and the trial week)

**Interfaces:**
- Consumes:
  - `flightFacts`, `slotFor`, `dueThisHour`, `lateBooking`, `flightParams` (Task 13);
  - `fetchPaged`;
  - `ticketSupplier` / `supplierEventId` from `lib/suppliers.ts` for the venue;
  - `tixstock_events.venue_name`, `live_events.venues`.
- Produces: `runEventsSchedule(...)` -> `{ enqueued: { kind: string; reservationId: number }[]; skipped: { reservationId: number; why: string }[] }`.
  Inserts use `on conflict (dedupe_key) do nothing`:
  - `flight_reminder:<id>:<departure day>`;
  - `event_today:<id>:<event day>`;
  - `after_trip:<id>:<slot day>`.

- [ ] **Step 1: Write the failing test.** Append a section that runs `runEventsSchedule` over injected deps (one
  Paid order flying 12.11 and one ticket-only order). The cases:
  - at `2026-11-09T07:05Z` it enqueues `flight_reminder` for the first only;
  - at `2026-11-13T08:05Z` it enqueues `event_today` for both;
  - `after_trip` is enqueued only when `EVENTS_WA_AFTER_TRIP=on`;
  - a late booking (created after the slot) is in `skipped` with `why: "הזמנה מאוחרת"`;
  - an order with `itinerary_group` is skipped.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/whatsapp-events-selftest.ts`
Expected: FAIL (`runEventsSchedule` missing).

- [ ] **Step 3: Implement.**
  - The candidates are `Paid`, not deleted, with an event date from yesterday to 4 days ahead (the only window any slot
    can fall in). They are read with `fetchPaged`.
  - The place for `event_today` = the venue name (TixStock / LiveTickets, when the ticket comes from one), then a comma
    and `shortPlace` of `event_location` else `location`.
  - The flight city for `flight_reminder` = `shortPlace(events.location.name)`.
  - The route: `guardCronRoute`, `?dry_run=1` (lists and writes nothing), `maxDuration` 60.

- [ ] **Step 4: Run every check**

Run: `npx tsx scripts/whatsapp-events-selftest.ts && npx tsx scripts/whatsapp-selftest.ts && npx tsx scripts/whatsapp-inbound-selftest.ts && npx tsx scripts/whatsapp-webhook-selftest.ts && npx tsx scripts/tours-waitlist-dates-selftest.ts && npx tsx scripts/guide-selftest.ts && node scripts/whatsapp-events-sql-pglite-test.mjs && node scripts/whatsapp-events-outbox-pglite-test.mjs && npx tsc --noEmit -p .`
Expected: every line OK; `tsc` prints no error in a file this plan touched.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(whatsapp): Mega Events date reminders and docs" -- lib/services/whatsapp-events-schedule.ts app/api/cron/waEventsSchedule/route.ts vercel.json lib/services/whatsapp-events-outbox.ts CLAUDE.md "app/(dashboard)/guide/guide-content.ts" scripts/whatsapp-events-selftest.ts
```

---

## After the build (not tasks; reported, not done)

- **Nothing is pushed.** The push carries two migrations. It must go before connect day, and Dor says when.
- **Not verifiable without the connected number:**
  - the WhatsApp screen with real chats;
  - the template sends;
  - the history import size.

  Check the screens on prod after the push. Run each cron once with `?dry_run=1`.
- **Templates:** submit the eight drafts (spec section 10) on the Events WABA right after connect, once Alon and Tom
  have approved the wording. `after_trip` waits for Alon's text.
- **Trial:** set `NEXT_SECRET_WA_EVENTS_TRIAL_PHONE` to Alon's phone in Vercel before the first template is approved.
  Dor unsets it after a week.

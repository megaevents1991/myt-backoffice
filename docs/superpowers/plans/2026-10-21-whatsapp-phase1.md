# WhatsApp Cloud API - Phase 1 ("the wire") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every WhatsApp message between a tours company's number and a customer lands on the customer's card, a new conversation opens or joins a case, and the company can connect its number from the settings screen.

**Architecture:** Meta's Cloud API in coexistence with the WhatsApp Business app. A webhook route (`app/api/whatsapp/webhook`) stores every event in `wa_messages`; a pure rules module decides when a message opens an inquiry, which the existing `leads_fill` trigger routes (with one new branch for `kind = 'whatsapp'`); the case and customer pages show the thread; a settings card runs Meta's Embedded Signup. Sending stays in `lib/services/whatsapp-cloud.ts` behind a provider interface.

**Tech Stack:** Next.js 15 App Router (route handler + server actions), Supabase Postgres (migration, plpgsql trigger), Meta Graph API v26.0, Facebook JS SDK (Embedded Signup v5), `node:crypto` HMAC, `npx tsx` selftests.

**Spec:** `docs/superpowers/specs/2026-10-21-whatsapp-cloud-api-design.md` (sections 5, 6, 7, 8 "settings card" + "customer card", 9, 10 step 6-7).

## Global Constraints

- Every new table: RLS on, no policies, `revoke all ... from anon, authenticated` (service role only), like `lead_statuses` in `20261014220000`.
- Migration SQL idempotent (`create table if not exists`, `add column if not exists`, `create or replace function`); `leads_fill` is re-pasted WHOLE from `supabase/migrations/20261019180000_tours_customers.sql` with the new branch - never a partial edit.
- Migration file minted with `npm run db:new whatsapp_phase1` (a timestamp after `20261021164145`); never applied from a branch; it rides the push to master.
- New tables are read through ONE boundary module with `const db = supabase as any` (`lib/services/whatsapp-db.ts`, scoped eslint-disable) - `types/database.types.ts` cannot be regenerated locally (dead token); `leads.wa_seen_at` and the `customers.wa_*` columns are hand-patched into `types/database.types.ts` like `follow_up_date` was.
- Every read of a new column falls back when the migration is not applied yet: `wa_seen_at` joins `CASE_COLUMN_SETS` (a fourth set without it); a missing `wa_messages` table (`42P01` / `PGRST205`) reads as an empty thread and zero unseen, never an error.
- Tokens: env only (`NEXT_SECRET_WHATSAPP_TOKEN`, optional `NEXT_SECRET_WHATSAPP_TOKEN_<SLUG>` read first, `NEXT_SECRET_WHATSAPP_PHONE_ID_<SLUG>`); the signup's exchanged business token is used inside `finishWhatsappSignup` only and never stored, logged or returned to the client.
- Phone numbers: `whatsappPhone()` (972 form) for sending, `phoneKey()` (last 9 digits) for matching - both in `lib/tours/cases.ts`, never a third rule.
- Constants live in `lib/whatsapp/rules.ts` only: `WA_INQUIRY_GAP_HOURS = 24`, `WA_WINDOW_HOURS = 24`, `WA_THREAD_PAGE = 50`, `WA_TEXT_MAX = 4096`, `OPT_OUT_WORDS`.
- The webhook answers 200 inside the request for every well-signed body; a bad signature is 401; it never throws past the handler.
- A customer message's TEXT never goes into `audit_log` (ids and counts only).
- `middleware.ts` skips `/api`: the route guards itself (signature), no session.
- Hebrew copy is exact where the spec fixes it: opt-out reply `הוסרת מרשימת התפוצה שלנו. לכל שאלה אנחנו כאן.`; TODAY label `הודעה חדשה בוואטסאפ`.
- Selftests run with `npx tsx scripts/<name>-selftest.ts`; `npx tsc --noEmit` is the type gate (the build ignores errors).
- Commits: conventional, no AI co-author line, only the files of the task (`git add <paths>`; this checkout is shared with other sessions - never `git add -A`).

## Review Focus

1. A webhook batch holding two `messages` entries for the same `wamid` (Meta re-delivery): the second insert is ignored, nothing is opened twice - Task 4 test `handles a re-delivered batch once`.
2. A customer whose phone is on TWO customers (a merge not done yet): the one `leads_fill` picks - the LOWEST `customer_no` (`order by customer_no limit 1`) - so the message and the inquiry land on the same person - Task 4 test `picks the customer leads_fill would pick`.
3. An inbound message with no text (sticker, reaction, unsupported type): stored with `type` and a stand-in text, opens an inquiry like text does, never throws on `text.body` - Task 2 test `parseWebhook: a sticker and a reaction`.
4. The migration not applied yet (a deploy that beat it): the case page, the board and the customer page still load; the webhook answers 200 and logs "wa_messages missing" - Task 6 test of the column fallback, Task 4 step "missing table".
5. A rep's echo for a number that has no customer yet (the rep wrote first from the app): the message is stored with `customer_id null`, no case opened, and the customer is created on the first INBOUND, after which Task 4's `attachOrphans` backfills `customer_id` by `phone_key` - Task 4 test `echo before any inbound`.

---

### Task 1: Migration - tables, columns, bucket, `leads_fill` WhatsApp branch

**Files:**
- Create: `supabase/migrations/<timestamp>_whatsapp_phase1.sql` (via `npm run db:new whatsapp_phase1`)
- Create: `scripts/whatsapp-sql-dryrun.mjs` (copy of `scripts/tours-cases-sql-dryrun.mjs`'s harness: runs the file inside a transaction that aborts itself)
- Modify: `types/database.types.ts` (hand-patch `leads.wa_seen_at`, `customers.wa_consent`, `wa_consent_source`, `wa_consent_at`, `wa_last_in_at`, `wa_profile_name` in Row / Insert / Update)

**Interfaces:**
- Produces: tables `public.wa_accounts`, `public.wa_messages`, `public.wa_templates` exactly as spec section 5 (columns, types, nullability); `wa_messages.reservation_id bigint references public.reservations(id) on delete set null`; indexes `wa_messages (company_id, phone_key, sent_at desc)`, `wa_messages (customer_id, sent_at desc)`, `wa_messages (case_id)`, unique `wa_messages (wa_message_id)`, unique `wa_accounts (phone_number_id)`, unique `wa_templates (company_id, name, language)`; storage bucket `wa-media` (private, `insert into storage.buckets ... on conflict do nothing` like `task-attachments` in `20260916210000`); `customers.wa_consent text not null default 'none'` (no CHECK), `wa_consent_source text`, `wa_consent_at timestamptz`, `wa_last_in_at timestamptz`, `wa_profile_name text`; `leads.wa_seen_at timestamptz`.
- Produces: `public.leads_fill` with the branch below; `kind = 'whatsapp'` gets `type = 'lead'` by the existing `else` arm (no change needed there).

- [ ] **Step 1: Mint the file and write the DDL**

Run: `npm run db:new whatsapp_phase1` - note the generated name. Write the tables, columns, indexes, grants and the bucket per the Interfaces block. Comment each table with the spec section it comes from.

- [ ] **Step 2: Re-paste `leads_fill` with the WhatsApp branch**

Copy the whole `create or replace function public.leads_fill()` from `20261019180000_tours_customers.sql` (lines ~171-313) and change ONLY the routing block, so it reads:

```sql
  if new.kind not in ('booking', 'advisor', 'manual', 'newsletter') and not coalesce(new.to_file, false) then
    if new.kind = 'whatsapp' then
      -- a WhatsApp message is the continuation of a conversation, not a form about a tour: it joins the
      -- customer's NEWEST open card whatever its tour, and is never filed (spec 2026-10-21 section 6 step 4)
      select l.id, l.case_no into v_target
        from public.leads l
        left join tours.departures d on d.id = l.departure_id
       where l.company_id = new.company_id and l.customer_id = v_cust and l.is_deleted is null
         and not l.to_file
         and not public.lead_status_closed(new.company_id, l.status)
         and not (l.status in ('paid', 'deposit_paid') and coalesce(d.start_date < v_today, false))
       order by coalesce(l.updated_at, l.created_at) desc
       limit 1;
    elsif new.package_id is not null then
      select ... (the existing same-tour query, unchanged)
    end if;
    if found and v_target.id is not null then
      -- (the existing join block, unchanged: is_deleted := v_today, joined_into, returned, follow_up_date, inquiries[])
    elsif new.kind <> 'whatsapp' and exists ( ... the existing open-cards query ... ) then
      new.to_file := true;
    end if;
  end if;
```

Also add, right after the customer is resolved (`new.customer_id := v_cust;`): when `new.payload->>'acceptance' = 'on'` or `new.kind = 'newsletter'`, `update public.customers set wa_consent = 'opted_in', wa_consent_source = 'site_form', wa_consent_at = now() where id = v_cust and wa_consent = 'none'` (spec section 9: a form checkbox or the newsletter form is consent; never over `opted_out`).

- [ ] **Step 3: Write the dry-run script and run it**

`scripts/whatsapp-sql-dryrun.mjs`: the migration file + these checks inside one transaction that ends in `rollback`: (a) insert a `leads` row `kind = 'whatsapp'` for a phone that has an open card -> the row comes back `is_deleted` set, `payload->'joined_into'->>'id'` = that card; (b) the same phone with every card closed -> a new row, `to_file = false`, `type = 'lead'`; (c) a `kind = 'contact'` row with `payload.acceptance = 'on'` -> the customer reads `wa_consent = 'opted_in'`; (d) `select count(*) from information_schema.tables where table_name in ('wa_accounts','wa_messages','wa_templates')` = 3.

Run: `node scripts/whatsapp-sql-dryrun.mjs` (needs `SUPABASE_DB_URL` or the password; when unavailable, say so in the commit body and rely on the TS twin tests of Task 3 - the push applies it).
Expected: `4 checks ok, rolled back`.

- [ ] **Step 4: Hand-patch `types/database.types.ts`**

Add the six `customers` columns and `leads.wa_seen_at` to Row / Insert / Update. Run: `npx tsc --noEmit`. Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<timestamp>_whatsapp_phase1.sql scripts/whatsapp-sql-dryrun.mjs types/database.types.ts
git commit -m "feat(whatsapp): phase 1 schema - wa_accounts, wa_messages, wa_templates, consent columns, leads_fill whatsapp branch"
```

---

### Task 2: Pure rules + webhook parser (`lib/whatsapp/rules.ts`)

**Files:**
- Create: `lib/whatsapp/rules.ts`
- Create: `scripts/whatsapp-selftest.ts`

**Interfaces:**
- Produces (all pure, no imports from services):
  - `WA_INQUIRY_GAP_HOURS = 24`, `WA_WINDOW_HOURS = 24`, `WA_THREAD_PAGE = 50`, `WA_TEXT_MAX = 4096`, `OPT_OUT_WORDS: readonly string[]` = `["הסר", "להסרה", "הסירו אותי", "stop", "unsubscribe"]`, `OPT_OUT_REPLY = "הוסרת מרשימת התפוצה שלנו. לכל שאלה אנחנו כאן."`.
  - `shouldOpenInquiry(lastInboundAt: string | null, now: string): boolean` - true when null or `now - lastInboundAt >= WA_INQUIRY_GAP_HOURS` hours.
  - `canSendText(lastInboundAt: string | null, now: string): boolean` - true when `now - lastInboundAt < WA_WINDOW_HOURS` hours.
  - `isOptOut(text: string | null): boolean` - trimmed, case-insensitive, the whole text or its first word is one of `OPT_OUT_WORDS` (punctuation stripped).
  - `verifySignature(rawBody: string, header: string | null, secret: string): boolean` - `sha256=` + hex HMAC-SHA256, `crypto.timingSafeEqual`, false on any shape mismatch.
  - `type WaEvent = { kind: "message"; phoneNumberId: string; waMessageId: string; from: string; profileName: string | null; type: WaMessageType; text: string | null; media: { id: string; mime: string; sha256: string | null; caption: string | null } | null; sentAt: string; origin: "customer" | "app" | "history"; direction: "in" | "out"; to: string | null } | { kind: "status"; phoneNumberId: string; waMessageId: string; status: "sent" | "delivered" | "read" | "failed"; at: string; error: string | null } | { kind: "template"; wabaId: string; name: string; language: string; status: string; reason: string | null } | { kind: "account"; wabaId: string; event: string; payload: unknown }`.
  - `type WaMessageType = "text" | "image" | "document" | "audio" | "video" | "sticker" | "location" | "contacts" | "template" | "reaction" | "unsupported"`.
  - `parseWebhook(body: unknown): WaEvent[]` - walks `entry[].changes[]`: field `messages` -> `message` events (`origin: "customer"`, `direction: "in"`, `from` = `messages[].from`, `profileName` = `contacts[0].profile.name`) and `status` events from `statuses[]`; field `smb_message_echoes` -> `message` events with `origin: "app"`, `direction: "out"`, `to` = the echo's `to`; field `history` -> `message` events with `origin: "history"` and the direction from the payload (`from` equals the business number = out); field `message_template_status_update` -> `template`; `account_update` / `phone_number_quality_update` -> `account`. Unknown fields are skipped. `text` = `text.body` ?? media `caption` ?? a stand-in: `[תמונה]`, `[קובץ]`, `[הודעה קולית]`, `[וידאו]`, `[סטיקר]`, `[מיקום]`, `[איש קשר]`, `[תגובה]`, `[הודעה לא נתמכת]`. `sentAt` = the message's `timestamp` (unix seconds) as ISO.
  - `standInText(type: WaMessageType): string` (the list above).
  - `previewText(text: string | null, max = 80): string` - one line for chips.

- [ ] **Step 1: Write the failing selftest**

`scripts/whatsapp-selftest.ts` with `node:assert/strict`, one block per rule:

```ts
assert.equal(shouldOpenInquiry(null, "2026-10-21T10:00:00Z"), true);
assert.equal(shouldOpenInquiry("2026-10-21T09:00:00Z", "2026-10-21T10:00:00Z"), false);
assert.equal(shouldOpenInquiry("2026-10-20T09:59:00Z", "2026-10-21T10:00:00Z"), true);
assert.equal(canSendText("2026-10-21T09:00:00Z", "2026-10-21T10:00:00Z"), true);
assert.equal(canSendText("2026-10-20T09:00:00Z", "2026-10-21T10:00:00Z"), false);
assert.equal(canSendText(null, "2026-10-21T10:00:00Z"), false);
assert.equal(isOptOut("הסר"), true);
assert.equal(isOptOut("  STOP. "), true);
assert.equal(isOptOut("הסר אותי מהרשימה"), true);
assert.equal(isOptOut("אל תסירו אותי"), false);
assert.equal(isOptOut("כן"), false);
assert.equal(isOptOut(null), false);
const secret = "s3cr3t";
const body = '{"object":"whatsapp_business_account"}';
const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
assert.equal(verifySignature(body, good, secret), true);
assert.equal(verifySignature(body, "sha256=00", secret), false);
assert.equal(verifySignature(body, null, secret), false);
// parseWebhook: a text, a sticker and a reaction, a status, an echo, a template update (fixture objects inline)
const events = parseWebhook(FIXTURE_MESSAGES);
assert.equal(events.length, 4);
assert.deepEqual(events[0], { kind: "message", phoneNumberId: "111", waMessageId: "wamid.A", from: "972541234567", profileName: "דנה", type: "text", text: "היי", media: null, sentAt: "2026-10-21T10:00:00.000Z", origin: "customer", direction: "in", to: null });
assert.equal((events[1] as { type: string }).type, "sticker");
assert.equal((events[1] as { text: string }).text, "[סטיקר]");
assert.equal((events[2] as { type: string }).type, "reaction");
assert.deepEqual(events[3], { kind: "status", phoneNumberId: "111", waMessageId: "wamid.A", status: "delivered", at: "2026-10-21T10:01:00.000Z", error: null });
const echo = parseWebhook(FIXTURE_ECHO)[0] as Extract<WaEvent, { kind: "message" }>;
assert.equal(echo.origin, "app"); assert.equal(echo.direction, "out"); assert.equal(echo.to, "972541234567");
assert.deepEqual(parseWebhook(FIXTURE_TEMPLATE)[0], { kind: "template", wabaId: "222", name: "offer_sent", language: "he", status: "APPROVED", reason: null });
assert.deepEqual(parseWebhook({ entry: [{ changes: [{ field: "something_else", value: {} }] }] }), []);
assert.deepEqual(parseWebhook(null), []);
assert.equal(previewText("שלום\nמה המחיר?", 10), "שלום מה ה…");
console.log("whatsapp-selftest ok");
```

Fixtures: Meta's documented shapes - `FIXTURE_MESSAGES` = one `entry` with `changes[0].field = "messages"`, `value.metadata.phone_number_id = "111"`, `contacts[0].profile.name = "דנה"`, `messages` = a `text` (`timestamp: "1792576800"`), a `sticker` (`sticker.id/mime_type/sha256`), a `reaction`, and `statuses` = one `delivered` for `wamid.A` at `"1792576860"`. `FIXTURE_ECHO` = `field: "smb_message_echoes"`, `value.message_echoes[0]` with `from` = the business, `to = "972541234567"`. `FIXTURE_TEMPLATE` = `field: "message_template_status_update"` with `event: "APPROVED"`, `message_template_name`, `message_template_language`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx scripts/whatsapp-selftest.ts`
Expected: fails on the import (`lib/whatsapp/rules` not found).

- [ ] **Step 3: Implement `lib/whatsapp/rules.ts`**

Signatures from the Interfaces block. `parseWebhook` is defensive on every level (`Array.isArray`, `typeof`), never throws. Dates via `new Date(Number(ts) * 1000).toISOString()`.

- [ ] **Step 4: Run the selftest**

Run: `npx tsx scripts/whatsapp-selftest.ts`
Expected: `whatsapp-selftest ok`

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp/rules.ts scripts/whatsapp-selftest.ts
git commit -m "feat(whatsapp): pure rules - inquiry gap, 24h window, opt-out, signature, webhook parser"
```

---

### Task 3: Case rules - `routeInquiry` WhatsApp branch, TODAY reason, row fields

**Files:**
- Modify: `lib/tours/cases.ts` (`routeInquiry` ~376, `TODAY_REASONS` / `TODAY_REASON_LABELS` 277-287, `TodayFacts` 306, `todayReason` 317, `CaseRow` 633, `CaseDetail` 942, `CustomerPageData` 854)
- Modify: `types/tours.types.ts:173` (`LEAD_KIND_LABELS`)
- Modify: `components/tours/cases/case-ui.tsx` (`REASON_CLASSES`, `TodayBadge`)
- Modify: `scripts/tours-cases-selftest.ts`

**Interfaces:**
- Produces in `lib/tours/cases.ts`:
  - `routeInquiry(form: { kind: string; packageId: string | null }, cards, statuses, today)`: when `form.kind === "whatsapp"` -> `{ kind: "join", cardId }` of the open card with the newest `updatedAt ?? createdAt` (add `updatedAt: string | null` to `RouteCard`), else `{ kind: "new" }` - never `{ kind: "file" }`.
  - `TODAY_REASONS = ["returned", "whatsapp", "payment", "file", "new", "late", "today", "confirmation"]`; `TODAY_REASON_LABELS.whatsapp = "הודעה חדשה בוואטסאפ"`.
  - `TodayFacts.waUnseen: number` (default 0 everywhere a `TodayFacts` is built); `todayReason`: after the `toFile` and closed checks and after `returned`: `if (c.waUnseen > 0) return "whatsapp"`.
  - `CaseRow.waUnseen: number` (inbound messages after `wa_seen_at`); `CaseRow.waSeenAt: string | null`.
  - `WaMessageType` is imported from `lib/whatsapp/rules.ts` (Task 2; pure, so `cases.ts` may import it).
  - `export interface WaThreadMessage { id: string; waMessageId: string; direction: "in" | "out"; origin: "customer" | "app" | "api" | "automation" | "broadcast" | "history"; type: WaMessageType; text: string | null; mediaUrl: string | null; mediaMime: string | null; template: { name: string; params: string[] } | null; status: string; error: string | null; sentAt: string; sentBy: string | null; caseId: string | null }`.
  - `export interface WaThread { messages: WaThreadMessage[]; hasMore: boolean; consent: { state: string; source: string | null; at: string | null }; lastInAt: string | null; windowOpen: boolean; connected: boolean }` (`connected` = the company has a `wa_accounts` row).
  - `CaseDetail.whatsapp: WaThread`; `CustomerPageData.whatsapp: WaThread`.
  - `export const WA_CONSENT_LABELS: Record<string, string> = { none: "לא אישר/ה", opted_in: "אישר/ה דיוור", customer: "לקוח/ה (תנאי הזמנה)", opted_out: "ביקש/ה הסרה" }`.
- Produces in `types/tours.types.ts`: `LEAD_KIND_LABELS.whatsapp = "WhatsApp"`.
- Produces in `case-ui.tsx`: `REASON_CLASSES.whatsapp` (the green of `returned`), `TodayBadge` prints the label unchanged.

- [ ] **Step 1: Add the failing assertions to `scripts/tours-cases-selftest.ts`**

```ts
// a WhatsApp message joins the newest open card whatever its tour, and is never filed
const openA = { id: "a", packageId: "p1", status: "new", toFile: false, departureStart: null, createdAt: "2026-10-01", updatedAt: "2026-10-05" };
const openB = { id: "b", packageId: "p2", status: "offer_sent", toFile: false, departureStart: null, createdAt: "2026-10-03", updatedAt: "2026-10-02" };
assert.deepEqual(routeInquiry({ kind: "whatsapp", packageId: null }, [openA, openB], DEFAULT_STATUSES, "2026-10-21"), { kind: "join", cardId: "a" });
assert.deepEqual(routeInquiry({ kind: "whatsapp", packageId: null }, [{ ...openA, status: "not_relevant" }], DEFAULT_STATUSES, "2026-10-21"), { kind: "new" });
assert.deepEqual(routeInquiry({ kind: "contact", packageId: null }, [openA], DEFAULT_STATUSES, "2026-10-21"), { kind: "file" });
// TODAY: unseen WhatsApp beats payment, loses to returned
const base = { status: "new", followUpDate: null, toFile: false, paymentAnswer: null, confirmationPending: false, waUnseen: 0 };
assert.equal(todayReason({ ...base, waUnseen: 2 }, DEFAULT_STATUSES, "2026-10-21"), "whatsapp");
assert.equal(todayReason({ ...base, status: "returned", waUnseen: 2 }, DEFAULT_STATUSES, "2026-10-21"), "returned");
assert.equal(todayReason({ ...base, status: "pending_payment", paymentAnswer: "paid", waUnseen: 1 }, DEFAULT_STATUSES, "2026-10-21"), "whatsapp");
assert.equal(todayReason({ ...base, status: "not_relevant", waUnseen: 5 }, DEFAULT_STATUSES, "2026-10-21"), null);
assert.ok(todayRank("whatsapp") < todayRank("payment"));
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx scripts/tours-cases-selftest.ts`
Expected: FAIL (type error on `updatedAt` / `waUnseen`, or a wrong route).

- [ ] **Step 3: Implement the changes in `lib/tours/cases.ts`, `types/tours.types.ts`, `case-ui.tsx`**

Per the Interfaces block. Every existing `TodayFacts` literal in `lib/actions/tours-cases-actions.ts` and `components/tours/cases/*` gets `waUnseen: 0` for now (Task 6 fills the real count); `toCaseRow` sets `waUnseen: 0`, `waSeenAt: null` until Task 6. Update the SQL-twin comment above `routeInquiry` to name the WhatsApp branch.

- [ ] **Step 4: Run the selftest and the type gate**

Run: `npx tsx scripts/tours-cases-selftest.ts && npx tsc --noEmit`
Expected: the selftest's final ok line; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/tours/cases.ts types/tours.types.ts components/tours/cases/case-ui.tsx scripts/tours-cases-selftest.ts lib/actions/tours-cases-actions.ts components/tours/cases
git commit -m "feat(whatsapp): whatsapp inquiries join the newest open card; TODAY reason for unseen messages"
```

---

### Task 4: DB boundary + inbound service

**Files:**
- Create: `lib/services/whatsapp-db.ts`
- Create: `lib/services/whatsapp-inbound.ts`
- Create: `scripts/whatsapp-inbound-selftest.ts`

**Interfaces:**
- `whatsapp-db.ts` (the only file that touches the three tables; `const db = supabase as any` boundary):
  - `type WaAccount = { id: string; companyId: string; wabaId: string; phoneNumberId: string; displayPhone: string; verifiedName: string | null; mode: "coexistence" | "api_only"; provider: string; qualityRating: string | null; messagingLimit: string | null; historyRequestedAt: string | null; historySyncedAt: string | null; connectedAt: string; isActive: boolean }`.
  - `accountByPhoneId(phoneNumberId: string): Promise<WaAccount | null>`; `accountOfCompany(companyId: string): Promise<WaAccount | null>`; `upsertAccount(input: Omit<WaAccount, "id" | "connectedAt">): Promise<WaAccount>`; `patchAccount(id: string, patch: Partial<Pick<WaAccount, "qualityRating" | "messagingLimit" | "historyRequestedAt" | "historySyncedAt" | "isActive">>): Promise<void>`.
  - `type WaMessageInsert = { companyId: string; waMessageId: string; phone: string; phoneKey: string; customerId: string | null; caseId: string | null; direction: "in" | "out"; origin: string; type: string; text: string | null; media: unknown | null; template: unknown | null; status: string; sentBy: string | null; sentAt: string }`; `insertMessage(row: WaMessageInsert): Promise<{ inserted: boolean; id: string | null }>` (`on conflict (wa_message_id) do nothing` -> `inserted: false`).
  - `updateStatus(waMessageId: string, status: string, at: string, error: string | null): Promise<void>`.
  - `lastInboundAt(companyId: string, phoneKey: string): Promise<string | null>`; `lastInboundCaseId(companyId: string, phoneKey: string): Promise<string | null>`.
  - `listThread(companyId: string, phoneKeys: string[], opts: { before?: string; limit: number }): Promise<WaThreadMessage[]>` (newest first, `mediaUrl` = a 10-minute signed URL of `media.storage_path` when set).
  - `countUnseen(cases: { id: string; waSeenAt: string | null }[]): Promise<Map<string, number>>` (chunks of 100 ids; inbound rows with `sent_at > wa_seen_at` or all inbound when null).
  - `attachOrphans(companyId: string, phoneKey: string, customerId: string): Promise<number>` (rows of that phone with `customer_id is null`).
  - `upsertTemplate(companyId: string, t: { name: string; language: string; category: string | null; status: string; body: string | null; paramCount: number | null }): Promise<void>`; `listTemplates(companyId: string): Promise<WaTemplate[]>`; `type WaTemplate = { name: string; language: string; category: string | null; status: string; body: string | null; paramCount: number | null; syncedAt: string }`.
  - Every function: on `42P01` / `PGRST205` (table missing) returns the empty value and `console.warn` once per process (`missingTable` pattern of the cases actions); any other error throws.
- `whatsapp-inbound.ts`:
  - `handleWebhookEvents(events: WaEvent[], deps?: InboundDeps): Promise<{ stored: number; skipped: number; inquiries: number; errors: string[] }>` - the whole section 6 flow; `deps` defaults to the real DB + provider and exists for the selftest (`InboundDeps` = the subset of `whatsapp-db` + `downloadMedia` + `sendText` + `insertLead` + `findCustomerByPhoneKey` + `setCustomerFields` as functions).
  - Per `message` event: resolve the account (unknown -> skipped, warn); `phone` = `from` for inbound, `to` for an echo; `phoneKey = phoneKey(phone)`; `customer = findCustomerByPhoneKey(companyId, phoneKey)` (the row `leads_fill` would pick: live, lowest `customer_no`); store the message (`caseId` decided below); on `inserted: false` stop (re-delivery). Inbound only: `setCustomerFields(customer.id, { wa_last_in_at: sentAt, wa_profile_name when empty })`; `isOptOut(text)` -> consent `opted_out` + `sendText(OPT_OUT_REPLY)` (the window is open: they just wrote) and no inquiry; else `shouldOpenInquiry(lastInboundAt before this message, sentAt)` -> `insertLead({ company_id, kind: "whatsapp", source: "whatsapp", name: profileName, phone, message: text ?? standInText(type), payload: { wa_message_id } })` returning the inserted row's `id`, `is_deleted`, `payload.joined_into.id`, `customer_id` -> `caseId` = `joined_into.id ?? id`; then `attachOrphans` with the row's `customer_id`; else `caseId = lastInboundCaseId(...)`. Media: `downloadMedia(media.id)` -> `wa-media/<companyId>/<waMessageId>.<ext>`; a failed download keeps `storage_path` null. Echo: `caseId` = the customer's newest open case (`lastInboundCaseId` is enough for phase 1: the case the conversation is on), `customerId` from the lookup or null. History: stored with `origin: "history"`, no inquiry, no consent, no media download.
  - Per `status` event: `updateStatus`. Per `template` event: `upsertTemplate` (company by `wabaId` -> `wa_accounts`). Per `account` event: `patchAccount` quality / limit when present.
  - Nothing here throws past the function: each event is `try/catch`ed into `errors[]`.

- [ ] **Step 1: Write the failing selftest with stub deps**

`scripts/whatsapp-inbound-selftest.ts` builds an in-memory `InboundDeps` (arrays as tables) and asserts:

```ts
// 1. first text from a new number: customer looked up, message stored, ONE inquiry inserted, caseId = the new case
// 2. a second text 5 minutes later: stored, no new inquiry, caseId = the same case
// 3. a text 2 days later: a new inquiry (the stub's insertLead answers joined_into -> caseId = that card)
// 4. handles a re-delivered batch once: the same wamid twice -> stored 1, skipped 1, inquiries unchanged
// 5. "הסר": consent set to opted_out, sendText called once with OPT_OUT_REPLY, no inquiry
// 6. echo before any inbound: stored with customerId null, no inquiry; then the first inbound attaches it (attachOrphans called with that phoneKey)
// 7. picks the customer leads_fill would pick: two customers share the key -> the lower customer_no
// 8. a status event updates the row; a template event upserts; an event for an unknown phone id is skipped with a warning, not an error
// 9. a sticker opens an inquiry with message "[סטיקר]"
// 10. missing table: deps whose insertMessage returns { inserted: false, id: null } with a warn -> result.errors stays empty
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx scripts/whatsapp-inbound-selftest.ts`
Expected: fails on the imports.

- [ ] **Step 3: Implement `whatsapp-db.ts` then `whatsapp-inbound.ts`**

Per the Interfaces block. `findCustomerByPhoneKey` default = `supabaseTyped.from("customers").select("id, customer_no, wa_consent, wa_profile_name").eq("company_id", ...).is("is_deleted", null).contains("phone_keys", [key]).order("customer_no").limit(1)`. `insertLead` default = `supabaseTyped.from("leads").insert(...).select("id, is_deleted, payload, customer_id").single()`.

- [ ] **Step 4: Run the selftest and tsc**

Run: `npx tsx scripts/whatsapp-inbound-selftest.ts && npx tsc --noEmit`
Expected: `whatsapp-inbound-selftest ok`; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/services/whatsapp-db.ts lib/services/whatsapp-inbound.ts scripts/whatsapp-inbound-selftest.ts
git commit -m "feat(whatsapp): inbound service - store every message, one inquiry per conversation, opt-out, echoes, history"
```

---

### Task 5: Provider interface + sending additions (`whatsapp-cloud.ts`)

**Files:**
- Modify: `lib/services/whatsapp-cloud.ts`
- Modify: `scripts/whatsapp-selftest.ts` (the pure parts: `tokenFor`, `envKey`)

**Interfaces:**
- Produces:
  - `export type TemplateArgs = { to: string; template: string; params: string[]; language: string }` (the existing `sendTemplate` args with the defaults resolved).
  - `export interface WaProvider { sendTemplate(cfg: Config, args: TemplateArgs): Promise<SendResult>; sendText(cfg: Config, args: { to: string; text: string }): Promise<SendResult>; downloadMedia(cfg: Config, mediaId: string): Promise<{ bytes: Uint8Array; mime: string } | null>; listTemplates(cfg: Config, wabaId: string): Promise<WaTemplate[]>; requestHistorySync(cfg: Config): Promise<SendResult>; subscribeApp(token: string, wabaId: string): Promise<SendResult> }` and `export const metaProvider: WaProvider` (Graph `v26.0`: `/{phoneId}/messages`, `/{mediaId}` then its `url` with the bearer, `/{wabaId}/message_templates?fields=name,language,category,status,components`, `POST /{phoneId}/smb_app_data { messaging_product: "whatsapp", sync_type: "history" }` - the builder confirms the two coexistence endpoints against Meta's "Onboard WhatsApp Business app users" page and pins them in one place -, `POST /{wabaId}/subscribed_apps`).
  - `tokenFor(slug: string, env: NodeJS.ProcessEnv = process.env): string | null` - `NEXT_SECRET_WHATSAPP_TOKEN_<SLUG>` first (slug upper-cased, non-alphanumerics `_`), else `NEXT_SECRET_WHATSAPP_TOKEN`; `configOf` uses it. Fix the docstring example to `mega-family -> ..._MEGA_FAMILY`.
  - `sendTemplate(company, args & { origin?: string; sentBy?: string | null; customerId?: string | null; caseId?: string | null })` - unchanged contract, now writes the `wa_messages` row (`status: "accepted"`) through `insertMessage` BEFORE the call and `updateStatus` after (`sent` with Meta's id, or `failed` + error); `whatsappApiReady` also true when `accountOfCompany` has a row and `tokenFor` is set.
  - `sendText(company, args: { to: string; text: string; lastInAt: string | null; origin?: string; sentBy?: string | null; customerId?: string | null; caseId?: string | null }): Promise<SendResult>` - refuses when `!canSendText(lastInAt, nowIso())` with `"More than 24 hours since the customer wrote - send a template."`, caps at `WA_TEXT_MAX`, records the row like `sendTemplate`.
  - `exchangeSignupCode(code: string): Promise<{ token: string } | { error: string }>` - `GET /oauth/access_token?client_id=NEXT_PUBLIC_WHATSAPP_APP_ID&client_secret=NEXT_SECRET_WHATSAPP_APP_SECRET&code=`.
  - Every successful `sendTemplate` / `sendText` calls `logAudit({ action: "whatsapp.sent", entityType: "wa_message", entityId: <wa_messages.id>, metadata: { company_id, origin, template?: name, case_id } })` - ids only, never the text (spec section 7).

- [ ] **Step 1: Add the failing pure assertions to `scripts/whatsapp-selftest.ts`**

```ts
assert.equal(tokenFor("mega-family", { NEXT_SECRET_WHATSAPP_TOKEN: "shared" }), "shared");
assert.equal(tokenFor("mega-family", { NEXT_SECRET_WHATSAPP_TOKEN: "shared", NEXT_SECRET_WHATSAPP_TOKEN_MEGA_FAMILY: "own" }), "own");
assert.equal(tokenFor("mega-family", {}), null);
assert.equal(envKey("mega-family"), "NEXT_SECRET_WHATSAPP_PHONE_ID_MEGA_FAMILY");
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx scripts/whatsapp-selftest.ts`
Expected: FAIL - `tokenFor` / `envKey` not exported.

- [ ] **Step 3: Implement the provider, `tokenFor`, `sendText`, the row recording, `exchangeSignupCode`**

Keep `explain()` and its error codes; add `131042` -> `"The WhatsApp account has no payment method - add one in WhatsApp Manager."`. The provider gets the raw `Config`; the public functions resolve `Config` from the company and the account row.

- [ ] **Step 4: Run the selftest and tsc**

Run: `npx tsx scripts/whatsapp-selftest.ts && npx tsc --noEmit`
Expected: ok; tsc clean. `prepareOffer`'s existing `sendTemplate` call still compiles unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/services/whatsapp-cloud.ts scripts/whatsapp-selftest.ts
git commit -m "feat(whatsapp): provider interface, per-company token, sendText inside the window, sends recorded in wa_messages"
```

---

### Task 6: Webhook route

**Files:**
- Create: `app/api/whatsapp/webhook/route.ts`
- Modify: `vercel.json` (`functions` entry `app/api/whatsapp/webhook/route.ts` `maxDuration: 30`, like the cron entries)

**Interfaces:**
- Consumes: `verifySignature`, `parseWebhook` (Task 2); `handleWebhookEvents` (Task 4).
- Produces: `GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...` -> 200 `hub.challenge` as `text/plain` when the token equals `NEXT_SECRET_WHATSAPP_VERIFY_TOKEN`, else 403; `POST` -> 401 on a bad / missing signature (env `NEXT_SECRET_WHATSAPP_APP_SECRET` missing = 401 + one `console.error`), else 200 `{ ok: true, stored, skipped, inquiries, errors: errors.length }` whatever happened inside. `export const maxDuration = 30; export const dynamic = "force-dynamic";`.

- [ ] **Step 1: Write the route test as a script**

`scripts/whatsapp-webhook-check.mjs` (manual, against a dev server): posts the Task 2 text fixture signed with a local `NEXT_SECRET_WHATSAPP_APP_SECRET` to `http://localhost:3000/api/whatsapp/webhook` and expects `200 {"ok":true,...}`; posts it with `sha256=00` and expects 401; GETs the handshake with the right and a wrong token and expects 200 + the challenge, then 403.

- [ ] **Step 2: Implement the route**

Raw body via `await request.text()`; header `x-hub-signature-256`; `JSON.parse` inside try (a bad JSON with a good signature = 200 `{ ok: true, stored: 0 }` + a warn - Meta signed it, it is theirs). Log one line per batch: `[whatsapp] events=<n> stored=<n> inquiries=<n> errors=<n>`.

- [ ] **Step 3: Run the check**

Run the dev server with the four `NEXT_SECRET_WHATSAPP_*` env values set locally (the phone id may be a fake `111` matching a `wa_accounts` test row, or the batch answers `skipped`), then `node scripts/whatsapp-webhook-check.mjs`.
Expected: `4 checks ok`.

- [ ] **Step 4: Commit**

```bash
git add app/api/whatsapp/webhook/route.ts vercel.json scripts/whatsapp-webhook-check.mjs
git commit -m "feat(whatsapp): webhook route - handshake, signature check, events to the inbound service"
```

---

### Task 7: The thread on the case and customer pages + unseen counts

**Files:**
- Modify: `lib/actions/tours-cases-actions.ts` (`CASE_COLUMNS` 128-133, `enrich` 238, `toCaseRow` 416, `getCase` 1042, `getCustomerPage` 1763)
- Create: `lib/actions/whatsapp-thread-actions.ts`
- Create: `components/tours/cases/whatsapp-thread.tsx`
- Modify: `components/tours/cases/case-page.tsx` (a `Fold` near "Card activity", ~797), `components/tours/cases/customer-page.tsx` (a section under the header), `components/tours/cases/board-screen.tsx` (chip), `components/tours/cases/case-ui.tsx` (`CardWho` / `CardWhat` chip)

**Interfaces:**
- Consumes: `listThread`, `countUnseen`, `accountOfCompany` (Task 4); `WaThread`, `WaThreadMessage`, `WA_CONSENT_LABELS` (Task 3); `whatsappAppLink` (existing).
- Produces:
  - `CASE_COLUMNS` gains `, wa_seen_at`; `CASE_COLUMN_SETS` gains a set without it (first in the list is the full one). `toCaseRow` fills `waSeenAt`, `waUnseen` from `Enrichment.waUnseen: Map<string, number>` (read in `enrich` through `countUnseen`, concurrent with the other reads).
  - `getCase`: `whatsapp` = `threadOf(company, customerId, phones)` run inside the existing `Promise.all` (one more read, no new round of actions): `listThread` over the customer's `phone_keys` (fall back to `phoneKey(record.phone)`), `WA_THREAD_PAGE` newest, `hasMore`, consent from the `customers` row (`wa_consent`, `wa_consent_source`, `wa_consent_at`, `wa_last_in_at`), `windowOpen = canSendText(wa_last_in_at, now)`, `connected = !!(await accountOfCompany(company.id))`. Same for `getCustomerPage`.
  - `whatsapp-thread-actions.ts` (`"use server"`, `requireCompany("tours")`): `markThreadSeen(caseId: string): Promise<ActionResult<{ seenAt: string }>>` (sets `leads.wa_seen_at = now()`, scoped to the company; no audit); `loadThreadBefore(customerId: string, before: string): Promise<ActionResult<{ messages: WaThreadMessage[]; hasMore: boolean }>>`; `setCustomerConsent(customerId: string, state: "opted_in" | "opted_out", note: string): Promise<ActionResult<{ state: string }>>` (note >= 3 chars, source `staff:<session.sub>`, audit `whatsapp.consent` with `{ customer_id, from, to, note }`).
  - `WhatsappThread({ thread, customerId, caseId, phone, firstName, onSeen }: { thread: WaThread; customerId: string | null; caseId: string | null; phone: string | null; firstName: string | null; onSeen?: () => void })` - client component: when `!thread.connected` a one-line note "המספר של החברה עדיין לא מחובר - הגדרות > WhatsApp"; else bubbles oldest-first (inbound start-aligned, outbound end-aligned, `dir="rtl"`), the origin tag (`מהאפליקציה` for `app`, `אוטומציה`, `דיוור`, `היסטוריה`; none for `customer` / `api`), a template as `template.name` + its params joined, media as an `<img>` for images (signed URL) or a named chip for files, delivery as `✓` / `✓✓` / `✓✓ נקרא` / `✗ ` + error, "עוד" button -> `loadThreadBefore`, the existing `WhatsAppButton` (opens the rep's app), the consent line (`WA_CONSENT_LABELS[state]` + source + date) with two buttons "סמן הסכמה" / "סמן הסרה" opening a note dialog -> `setCustomerConsent`, and "הלקוח כתב לפני X" / "חלון 24 השעות סגור - רק תבנית" from `windowOpen` / `lastInAt`. On mount with `caseId` and `thread.messages.some(m => m.direction === "in")`: `markThreadSeen(caseId)` once, then `onSeen()`.
  - Board / ALL chip: `row.waUnseen > 0` -> `💬 N` beside the status (`CardWhat`), tooltip `הודעות חדשות בוואטסאפ`.

- [ ] **Step 1: Implement the actions and `enrich` / `getCase` / `getCustomerPage` additions**

Per the Interfaces block. `enrich`'s `countUnseen` runs in the same `Promise.all` as the other reads; a missing table answers an empty map.

- [ ] **Step 2: Implement `WhatsappThread` and mount it**

Case page: `<Fold icon={MessageCircle} tone="neutral" title="WhatsApp" description={unseen ? `${unseen} חדשות` : thread.messages.length ? `${thread.messages.length} הודעות` : "אין הודעות"} defaultOpen={unseen > 0}>`. Customer page: the same component under the header, before the open cards. `onSeen` patches the local row's `waUnseen` to 0.

- [ ] **Step 3: Verify in the browser (dev server)**

With the migration applied and a `wa_accounts` row for the company: open `/tours/reservations/<cardId>` of a customer with rows in `wa_messages` (insert three by SQL: in, app echo, in) - the fold shows 3 bubbles, "2 חדשות" before opening, 0 after, the board chip disappears on reload.
Expected: screenshots of the fold with bubbles and of the chip, in the handoff.

- [ ] **Step 4: Verify the column fallback (Review Focus 4)**

In a local, uncommitted edit, misspell the new column in `CASE_COLUMNS` (`wa_seen_atx`), reload the board, the case page and the customer page: all three load (the next column set answers), the thread fold reads "אין הודעות", no error toast; revert the edit.
Expected: the three pages render; the server log shows one `readCaseColumns` fallback line.

- [ ] **Step 5: tsc, selftests, commit**

Run: `npx tsc --noEmit && npx tsx scripts/tours-cases-selftest.ts`
Expected: clean.

```bash
git add lib/actions/tours-cases-actions.ts lib/actions/whatsapp-thread-actions.ts components/tours/cases/whatsapp-thread.tsx components/tours/cases/case-page.tsx components/tours/cases/customer-page.tsx components/tours/cases/board-screen.tsx components/tours/cases/case-ui.tsx
git commit -m "feat(whatsapp): the thread on the case and customer pages, unseen counts on the board, consent marks"
```

---

### Task 8: Settings card - connect (Embedded Signup), status, templates, test send

**Files:**
- Create: `components/tours/content/whatsapp-card.tsx`
- Create: `lib/actions/whatsapp-settings-actions.ts`
- Modify: `app/(dashboard)/tours/settings/page.tsx` (render the card under the form)

**Interfaces:**
- Consumes: `accountOfCompany`, `upsertAccount`, `patchAccount`, `listTemplates`, `upsertTemplate` (Task 4); `metaProvider`, `exchangeSignupCode`, `sendTemplate`, `tokenFor`, `whatsappApiReady` (Task 5).
- Produces (`"use server"`, every action `requireCompany("tours")` + `requireAdmin()`):
  - `getWhatsappSettings(): Promise<ActionResult<WhatsappSettings>>` with `type WhatsappSettings = { account: WaAccount | null; tokenSet: boolean; signup: { appId: string; configId: string } | null; templates: WaTemplate[]; staffPhone: string | null }` (`signup` null when `NEXT_PUBLIC_WHATSAPP_APP_ID` / `NEXT_SECRET_WHATSAPP_CONFIG_ID` are unset; `staffPhone` = the session user's phone from `user_profiles` when it has one).
  - `finishWhatsappSignup(input: { code: string; phoneNumberId: string; wabaId: string; sharedHistory: boolean }): Promise<ActionResult<WaAccount>>` - validates ids as digits; `exchangeSignupCode(code)`; with that token: `subscribeApp(token, wabaId)`; reads `/{phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,platform_type` (the provider gets a `phoneInfo(token, phoneNumberId)` method here); `upsertAccount({ mode: platform_type === "SMB" ? "coexistence" : "api_only", provider: "meta", ... })`; when `sharedHistory`: `requestHistorySync` with the exchanged token and `patchAccount({ historyRequestedAt: now })`; the token is a local `const` and leaves with the function. Audit `whatsapp.connected` `{ company_id, waba_id, phone_number_id, mode }`.
  - `syncWhatsappTemplates(): Promise<ActionResult<WaTemplate[]>>` - `listTemplates` via the provider with `tokenFor(company.slug)`, upserts each, returns the list; `"The sending token is not set in Vercel."` when no token.
  - `sendWhatsappTest(input: { to: string; template: string }): Promise<ActionResult<{ messageId: string | null }>>` - `to` must be a STAFF phone (equals the session user's `user_profiles.phone` after `whatsappPhone`), template must be `APPROVED` in the cache, params filled with `"בדיקה"`; `origin: "api"`.
  - `WhatsappCard({ initial }: { initial: WhatsappSettings })` client component, a `Section` like the settings form's: not connected -> the warning list from spec section 8 (app 2.24.17+, broadcast lists stop, computers re-link, Windows app unsupported, history choice is final, log in as an admin of the portfolio that owns the app and pick it) + "חבר את WhatsApp של החברה" which loads `https://connect.facebook.net/en_US/sdk.js` once, `FB.init({ appId, version: "v26.0" })`, `window.addEventListener("message", ...)` for `WA_EMBEDDED_SIGNUP` events (`data.event === "FINISH"` -> `phone_number_id`, `waba_id`; session logging = every event posted to `console.info` and kept in state), then `FB.login(cb, { config_id, response_type: "code", override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: "3" } })`; the callback's `authResponse.code` + the captured ids -> `finishWhatsappSignup`. `signup === null` -> the button is disabled with "חסרים NEXT_PUBLIC_WHATSAPP_APP_ID / NEXT_SECRET_WHATSAPP_CONFIG_ID". Connected -> the number, verified name, mode, quality, tier, `historySyncedAt` ("ההיסטוריה טרם סונכרנה - יש 24 שעות" while null and `historyRequestedAt` set), `tokenSet` hint, the templates table (name / language / category / status / synced) + "סנכרן תבניות", and "שלח בדיקה אליי" (disabled without a staff phone) with a template select.
- The page renders `<WhatsappCard initial={...} />` under the form when `getWhatsappSettings` succeeds (a failure prints `PageLoadError` for the card alone).

- [ ] **Step 1: Pure check of the signup input**

Add to `scripts/whatsapp-selftest.ts`: `parseSignupInput` (exported from `lib/whatsapp/rules.ts`): `assert.deepEqual(parseSignupInput({ code: "AQ..", phoneNumberId: "111", wabaId: "222", sharedHistory: true }), { ok: true, ... })`; `assert.equal(parseSignupInput({ code: "", phoneNumberId: "x", wabaId: "222" }).ok, false)`.

- [ ] **Step 2: Run it to see it fail, implement `parseSignupInput`, run again**

Run: `npx tsx scripts/whatsapp-selftest.ts` - fail, then ok.

- [ ] **Step 3: Implement the actions and the card**

Per the Interfaces block. The provider gains `phoneInfo`.

- [ ] **Step 4: Verify in the browser**

Dev server, `/tours/settings` as an admin of Mega Family: the card renders "not connected" with the warning list and a disabled button when the two env values are unset; with fake values the button opens Facebook's popup (close it - no real signup locally). With a `wa_accounts` row inserted by SQL: the connected view, "סנכרן תבניות" answers the token error sentence when no token is set.
Expected: screenshots of both states.

- [ ] **Step 5: tsc, commit**

Run: `npx tsc --noEmit`

```bash
git add components/tours/content/whatsapp-card.tsx lib/actions/whatsapp-settings-actions.ts "app/(dashboard)/tours/settings/page.tsx" lib/whatsapp/rules.ts scripts/whatsapp-selftest.ts lib/services/whatsapp-cloud.ts
git commit -m "feat(whatsapp): settings card - Embedded Signup connect, account status, template sync, test send"
```

---

### Task 9: Site consent wording (mega-family) + docs

**Files:**
- Modify (mega-family repo, `C:\Users\doraz\OneDrive\Desktop\Work\MegaEvent\MYT_Git_Shered\mega-family`): `components/pages/ContactForm.tsx:52` (the checkbox label)
- Modify (this repo): `CLAUDE.md` (env block + a short "WhatsApp Cloud API (phase 1)" note under the tours cases section), `app/(dashboard)/guide/guide-content-tours.ts` (a `howTo` "לחבר את WhatsApp של החברה" under the settings screen's section)

**Interfaces:**
- Consumes: nothing new; `payload.acceptance === "on"` already travels from the form to `leads_fill` (Task 1 reads it).
- Produces: the label reads `אני מאשר/ת קבלת מבצעים והטבות במייל ובוואטסאפ`; CLAUDE.md documents `NEXT_PUBLIC_WHATSAPP_APP_ID`, `NEXT_SECRET_WHATSAPP_APP_SECRET`, `NEXT_SECRET_WHATSAPP_CONFIG_ID`, `NEXT_SECRET_WHATSAPP_VERIFY_TOKEN`, `NEXT_SECRET_WHATSAPP_TOKEN_<SLUG>` (optional override) next to the three existing WhatsApp vars, and the phase-1 behaviour in five lines (coexistence, webhook, one inquiry per 24 h, never to file, consent sources).

- [ ] **Step 1: Change the label, run the site's checks**

In mega-family: edit the label; run `npm run lint` (or the repo's selftest if the label is asserted anywhere - `grep -rn "והטבות במייל" .` first).
Expected: lint clean; the grep finds only the component.

- [ ] **Step 2: Commit in mega-family**

```bash
git -C "C:/Users/doraz/OneDrive/Desktop/Work/MegaEvent/MYT_Git_Shered/mega-family" add components/pages/ContactForm.tsx
git -C "C:/Users/doraz/OneDrive/Desktop/Work/MegaEvent/MYT_Git_Shered/mega-family" commit -m "feat(forms): marketing consent names WhatsApp too"
```

- [ ] **Step 3: Docs in this repo**

`guide-content-tours.ts` is shared with another live session (uncommitted hunks on 21.10): `git diff app/(dashboard)/guide/guide-content-tours.ts` first; add the howTo as a separate hunk and commit this file by explicit path only. Run: `npx tsx scripts/guide-selftest.ts`. Expected: ok.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md "app/(dashboard)/guide/guide-content-tours.ts"
git commit -m "docs(whatsapp): env, phase-1 behaviour, guide recipe for connecting the company number"
```

---

### Task 10: Whole-branch check

- [ ] **Step 1: Run every gate**

Run: `npx tsc --noEmit && npx tsx scripts/whatsapp-selftest.ts && npx tsx scripts/whatsapp-inbound-selftest.ts && npx tsx scripts/tours-cases-selftest.ts && npx tsx scripts/guide-selftest.ts && npm run lint`
Expected: all ok.

- [ ] **Step 2: Review the diff against the spec's anti-goals**

`git log --oneline master..HEAD` lists the nine commits; `git diff master --stat` touches no file outside the plan; grep the diff for `console.log(` lines that print a message body or a token (`grep -n "token" -- <diff>` shows only env names).

- [ ] **Step 3: Report**

Hand back: the commits, the two screenshots (thread, settings card), what the dry run proved or could not (DB password), and the phase-0 items that gate a real test (Tom: WhatsApp product + Tech Provider + webhook URL + app secret; Vercel env).

# Tours board round 3 (paid cards, sales-agent role, shortcuts in place) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paid card drops its follow-up day and a deposit demands one; `tours_agent` becomes the sales-agent role with three screens and a "Take it" button; ACC NUM lives on the card; the folded card's shortcuts and a TODAY-row menu act in place.

**Architecture:** Rules stay pure in `lib/tours/cases.ts` (selftest `scripts/tours-cases-selftest.ts`); the server applies them in `tours-cases-actions.ts` and one migration (backfill + the booking trigger). The role is widened through ONE new guard, `requireCompanyRep`, swapped into the actions the three screens call; paths / menu live in `lib/auth/tours-agent.ts`. The in-place shortcuts are one new client file, `card-quick-actions.tsx`, reusing `booking-link-card.tsx`'s exported pieces, mounted by the customer page (popovers) and the board (a dropdown + dialogs).

**Tech Stack:** Next 15 App Router, React 19, shadcn/ui (Popover, Dialog, DropdownMenu, Textarea), Supabase (service role), `npx tsx` selftests.

**Spec:** `docs/superpowers/specs/2026-10-22-tours-board-round-3-design.md`

## Global Constraints

- Shared checkout on `master`: commit by explicit paths (`git commit -- <paths>`), never push, no AI co-author line, conventional commits.
- Pure rules only in `lib/tours/*.ts`; no DB / React there. Every rule gets a selftest line.
- Server actions return `{ success: false, error }` through `actionFail` - never throw past it (Next masks thrown errors in prod).
- The migration is idempotent and the reads tolerate it not being applied (no new column is read, so nothing to fall back on).
- `requireCompany()` stays as it is - the new guard is `requireCompanyRep()`; nothing outside the three screens' actions switches.
- Constants: `DEPOSIT_FOLLOW_UP_DAYS_BEFORE = 30`, `DEPOSIT_FOLLOW_UP_DEFAULT_DAYS = 7`; label "Sales agent" / "נציג מכירות"; the role's home `/tours`; menu hrefs `/tours`, `/tours/reservations`, `/tasks`.
- Byte-for-byte texts: "Pick the day to follow up on the balance.", "The follow-up day cannot be in the past.", `"<label>" names a follow-up day - set it on each card.`

## Review Focus

- A card moving to `deposit_paid` whose stored follow-up day is in the PAST and no day in the request → refused, not silently kept (Task 1 test).
- A move to `paid` that carries `followUpDate` in the same request keeps that day; one that carries nothing clears it; `followUpDate: null` sent explicitly also clears (Task 1 test).
- Bulk `paid` on cards with a follow-up day today → every one cleared; bulk `deposit_paid` refused before any write (Task 3, by reading the patch; Task 1 tests the blocker).
- A `tours_agent` profile must never appear in Mega Events' task people, and must appear in its own company's (Task 4a selftest).
- "Take it" on a card another rep took a second ago (stale screen) → the server's viewer gate answers "This card belongs to another rep" and the row is not patched - the existing `caseRecord(company, id, viewer)` path; Task 6b keeps the call on `updateCase` so that gate is the one hit (no new action).

---

### Task 1: Pure rules - follow-up after a status, the deposit suggestion, the bulk blocker, "Take it"

**Files:**
- Modify: `lib/tours/cases.ts` (after `followUpTone`, ~line 555)
- Test: `scripts/tours-cases-selftest.ts` (after the `followUpTone` asserts, ~line 149)

**Interfaces:**
- Produces:
  - `export const DEPOSIT_FOLLOW_UP_DAYS_BEFORE = 30; export const DEPOSIT_FOLLOW_UP_DEFAULT_DAYS = 7;`
  - `export function addDaysIso(day: string, days: number): string` - UTC arithmetic on `YYYY-MM-DD` (the way `daysLate` parses).
  - `export function suggestDepositFollowUp(departureDate: string | null, today: string): string`
  - `export type FollowUpAfterStatus = { ok: true; followUpDate: string | null | undefined } | { ok: false; error: string };`
  - `export function followUpAfterStatus(input: { to: string; requested: string | null | undefined; stored: string | null; today: string }): FollowUpAfterStatus` (the spec's `from` is not needed - the rule reads the target status only).
  - `export function bulkStatusBlocker(key: string, label: string): string | null`
  - `export const canTakeCard = (card: { assignedTo: string | null }): boolean => card.assignedTo === null;`

- [ ] **Step 1: Write the failing tests** (append to the selftest's imports and after line ~149):

```ts
// ---------------------------------------------------------------- paid drops the follow-up, a deposit needs one (Alon 22.10)
assert.equal(addDaysIso("2026-10-14", 7), "2026-10-21");
assert.equal(addDaysIso("2026-12-30", 3), "2027-01-02");
assert.equal(suggestDepositFollowUp("2026-12-01", TODAY), "2026-11-01", "30 days before the departure");
assert.equal(suggestDepositFollowUp("2026-10-20", TODAY), TODAY, "a departure inside 30 days: today, never before");
assert.equal(suggestDepositFollowUp(null, TODAY), "2026-10-21", "no departure: a week from today");
assert.equal(suggestDepositFollowUp("2026-09-01", TODAY), "2026-10-21", "a departure already past: a week from today");
assert.deepEqual(followUpAfterStatus({ to: "paid", requested: undefined, stored: "2026-10-01", today: TODAY }), { ok: true, followUpDate: null }, "paid clears a stale day");
assert.deepEqual(followUpAfterStatus({ to: "paid", requested: null, stored: "2026-10-01", today: TODAY }), { ok: true, followUpDate: null });
assert.deepEqual(followUpAfterStatus({ to: "paid", requested: "2026-11-05", stored: null, today: TODAY }), { ok: true, followUpDate: "2026-11-05" }, "a day sent with the status is the rep's own");
assert.deepEqual(followUpAfterStatus({ to: "deposit_paid", requested: "2026-11-01", stored: null, today: TODAY }), { ok: true, followUpDate: "2026-11-01" });
assert.deepEqual(followUpAfterStatus({ to: "deposit_paid", requested: undefined, stored: "2026-11-01", today: TODAY }), { ok: true, followUpDate: undefined }, "a stored day ahead stands");
assert.deepEqual(followUpAfterStatus({ to: "deposit_paid", requested: undefined, stored: TODAY, today: TODAY }), { ok: true, followUpDate: undefined }, "today counts");
assert.deepEqual(followUpAfterStatus({ to: "deposit_paid", requested: undefined, stored: "2026-10-01", today: TODAY }), { ok: false, error: "Pick the day to follow up on the balance." }, "a past day is no plan");
assert.deepEqual(followUpAfterStatus({ to: "deposit_paid", requested: undefined, stored: null, today: TODAY }), { ok: false, error: "Pick the day to follow up on the balance." });
assert.deepEqual(followUpAfterStatus({ to: "deposit_paid", requested: "2026-10-01", stored: null, today: TODAY }), { ok: false, error: "The follow-up day cannot be in the past." });
assert.deepEqual(followUpAfterStatus({ to: "deposit_paid", requested: null, stored: "2026-11-01", today: TODAY }), { ok: false, error: "Pick the day to follow up on the balance." }, "clearing the day with a deposit is refused");
assert.deepEqual(followUpAfterStatus({ to: "no_answer", requested: "2026-10-15", stored: null, today: TODAY }), { ok: true, followUpDate: "2026-10-15" }, "any other status: the request as sent");
assert.deepEqual(followUpAfterStatus({ to: "offer_sent", requested: undefined, stored: "2026-10-01", today: TODAY }), { ok: true, followUpDate: undefined });
assert.equal(bulkStatusBlocker("future", "ליד עתידי"), '"ליד עתידי" names a tour and a season - set it on each card.');
assert.equal(bulkStatusBlocker("deposit_paid", "שולם מקדמה"), '"שולם מקדמה" names a follow-up day - set it on each card.');
assert.equal(bulkStatusBlocker("paid", "שולם"), null);
assert.equal(canTakeCard({ assignedTo: null }), true);
assert.equal(canTakeCard({ assignedTo: "rep-1" }), false);
```

- [ ] **Step 2: Run to verify it fails:** `npx tsx scripts/tours-cases-selftest.ts` → fails on the missing exports.
- [ ] **Step 3: Implement the six exports in `lib/tours/cases.ts`** under a comment block "paid drops the follow-up, a deposit needs one (Alon 22.10)". `followUpAfterStatus`: `to === "paid"` → `requested === undefined || requested === null ? null : requested`; `to === "deposit_paid"` → requested `null` → error 1; requested a day → `< today` ? error 2 : that day; requested undefined → stored `>= today` ? `undefined` : error 1; otherwise → `requested`.
- [ ] **Step 4: Run:** `npx tsx scripts/tours-cases-selftest.ts` → `tours-cases selftest: ok`.
- [ ] **Step 5: Commit:** `git commit -m "feat(cases): paid drops the follow-up day, a deposit needs one, bulk blocker, canTakeCard - pure rules (Alon 22.10)" -- lib/tours/cases.ts scripts/tours-cases-selftest.ts`

### Task 2: Migration - stale days on paid cards, the booking trigger clears the day

**Files:**
- Create: `supabase/migrations/<ts>_tours_board_round_3.sql` via `npm run db:new tours_board_round_3`

- [ ] **Step 1: Write the SQL:** (1) `update public.leads set follow_up_date = null where status = 'paid' and follow_up_date is not null and is_deleted is null and follow_up_date < (now() at time zone 'Asia/Jerusalem')::date;` (2) `create or replace function tours.bookings_status_to_case()` - the body of `20261019180000_tours_customers.sql:318-344` verbatim, with the `update public.leads set ...` gaining `follow_up_date = case when v_status = 'paid' and status <> 'paid' then null else follow_up_date end` (a card already paid keeps the day its rep set); keep the two `revoke` lines. (3) `update public.leads l set acc_num = c.acc_num from public.customers c where c.id = l.customer_id and c.company_id = l.company_id and l.acc_num is null and nullif(btrim(c.acc_num), '') is not null and l.is_deleted is null;`. Header comment names the spec and that the trigger binding is untouched.
- [ ] **Step 2: Check:** `grep -c "create or replace function tours.bookings_status_to_case" supabase/migrations/*_tours_board_round_3.sql` → 1; `ls supabase/migrations | cut -c1-14 | sort | uniq -d` → empty (no duplicate prefix).
- [ ] **Step 3: Commit:** `git commit -m "feat(cases): migration - stale follow-up days off paid cards, review->paid booking clears the day" -- supabase/migrations/<file>`

### Task 3: Server - `updateCase` / `bulkUpdateCases` apply the rule; ACC NUM stops being copied

**Files:**
- Modify: `lib/actions/tours-cases-actions.ts` (`updateCase` ~610-660, `bulkUpdateCases` ~764-790, `createCase` ~899, `updateCustomer` ~1925 + ~1959)
- Modify: `lib/tours/cases.ts` (`CustomerChange`: drop `accNum`)

**Interfaces:**
- Consumes: Task 1's `followUpAfterStatus`, `bulkStatusBlocker`; `todayIso` (already imported).

- [ ] **Step 1: `updateCase`:** inside the status block, after `set("status", ...)`: `const fu = followUpAfterStatus({ to: status.key, requested: change.followUpDate, stored: before.follow_up_date, today: todayIso() }); if (!fu.ok) throw new UserError(fu.error); followUpDate = fu.followUpDate;` where `let followUpDate = change.followUpDate;` is declared before the block; the existing `if (change.followUpDate !== undefined)` block becomes `if (followUpDate !== undefined)` and validates / sets that value.
- [ ] **Step 2: `bulkUpdateCases`:** replace the `future` throw with `const blocker = bulkStatusBlocker(status.key, status.label); if (blocker) throw new UserError(blocker);` and add `if (status.key === "paid") patch.follow_up_date = null;` (the audit's `changes` already records every patch key).
- [ ] **Step 3: ACC NUM:** remove `accNum` from `CustomerChange`; delete the `change.accNum` line and the `cardPatch.acc_num` line in `updateCustomer`; drop `acc_num: customer.acc_num` from `createCase`'s insert.
- [ ] **Step 4: Verify:** `npx tsc --noEmit 2>&1 | grep -E "tours-cases-actions|lib/tours/cases|customer-page" ` → the only hit is `customer-page.tsx` (`saveCustomer({ accNum })`, fixed in Task 6a); `npx tsx scripts/tours-cases-selftest.ts` ok.
- [ ] **Step 5: Commit:** `git commit -m "feat(cases): paid clears the follow-up, a deposit refuses to save without one, bulk paid clears it; ACC NUM no longer copied from the customer" -- lib/actions/tours-cases-actions.ts lib/tours/cases.ts`

### Task 4a: The role - guard, paths, menu, label, task people

**Files:**
- Modify: `lib/company.ts` (after `requireCompanyViewer`), `lib/auth/tours-agent.ts`, `lib/nav.ts:549-556`, `types/auth.types.ts:20-35`, `lib/services/task-people.ts`, `lib/tasks-scope.ts:136-142`
- Test: `scripts/tasks-company-scope-selftest.ts` (~line 520)

**Interfaces:**
- Produces:
  - `export async function requireCompanyRep(productType?: ProductType): Promise<{ session: SessionPayload; company: Company }>` in `lib/company.ts`.
  - `lib/auth/tours-agent.ts`: `TOURS_AGENT_HOME = "/tours"`, `export const TOURS_AGENT_MENU: readonly string[] = ["/tours", "/tours/reservations", "/tasks"]`, `export const isToursAgentMenuPath = (href: string): boolean`, `isToursAgentPath` = exact `/tours` OR a prefix of `/tours/reservations`, `/tours/customers`, `/tasks`, `/tours/departures`.
  - `ROLE_LABELS.tours_agent = { en: "Sales agent", he: "נציג מכירות" }`.
  - `pickTaskPeople`: a row with `role === "tours_agent"` is kept only when `!megaEvents && companies?.has(companyId)`; `taskPeopleOf` reads `.in("role", [...STAFF_ROLES, TOURS_AGENT_ROLE])`.

- [ ] **Step 1: Failing test** in `scripts/tasks-company-scope-selftest.ts` next to the `people:` checks - add a staff row `{ id: "mf-agent", role: "tours_agent", ... }` with a membership in `OTHER_COMPANY`, and: `check("people: a sales agent is a person of its own company", ids(pickTaskPeople(staff, memberships, OTHER_COMPANY)), ["root", "mf-editor", "both", "mf-agent"]); check("people: never of Mega Events", ...MEGA_EVENTS... unchanged list)`; also a tours_agent with NO membership → absent from both.
- [ ] **Step 2: Run** `npx tsx scripts/tasks-company-scope-selftest.ts` → the new checks fail.
- [ ] **Step 3: Implement** the four files above. `requireCompanyRep`: `const session = await getSession(); if (session?.role !== TOURS_AGENT_ROLE) return requireCompany(productType); const company = await getActiveCompany(session); <product check as requireCompanyViewer>; return { session, company };`. `requireTaskBoard` calls `requireCompanyRep()` instead of `requireCompany()`. `visibleGroups` filters the role's items with `isToursAgentMenuPath(item.href)`. Update the doc comments in `auth.types.ts` / `tours-agent.ts` (the role sells: three screens + the read-only departures board by link).
- [ ] **Step 4: Run** the selftest → ok; `npx tsx scripts/guide-selftest.ts` → ok (nav hrefs unchanged).
- [ ] **Step 5: Commit:** `git commit -m "feat(auth): tours_agent = the sales agent - requireCompanyRep, home /tours, a three-screen menu, 'Sales agent' label, a person of its company's task board" -- lib/company.ts lib/auth/tours-agent.ts lib/nav.ts types/auth.types.ts lib/services/task-people.ts lib/tasks-scope.ts scripts/tasks-company-scope-selftest.ts`

### Task 4b: The role on the three screens - actions admitted, pages, dashboard cards, Statuses hidden

**Files:**
- Modify: `lib/actions/tours-cases-actions.ts` (every `requireCompany("tours")` except in `saveCaseStatuses`), `lib/actions/tours-payments-actions.ts` (all but `saveCancellationRules`), `lib/actions/tours-bookings-actions.ts:42`, `lib/actions/tours-reservation-actions.ts` (`listToursReservations`, `listReservationDepartures`, `createToursReservation`), `lib/actions/tours-dashboard-actions.ts:102,270`, `lib/actions/whatsapp-thread-actions.ts:29,45,62`, `app/(dashboard)/tours/page.tsx`, `components/tours/dashboard/tours-dashboard.tsx`, `components/tours/cases/board-screen.tsx` (header actions)

- [ ] **Step 1: Swap the guards** listed above to `requireCompanyRep("tours")` (import from `@/lib/company`). Leave `saveCaseStatuses`, `saveCancellationRules`, `deleteToursReservation` on `requireCompany`.
- [ ] **Step 2: `tours/page.tsx`:** `requireCompanyRep("tours")`; `const agent = session.role === TOURS_AGENT_ROLE;` → `<ToursDashboard isManager={...} agent={agent} />` and `actions={agent ? undefined : <PublishSiteButton />}`. `tours-dashboard.tsx`: `agent?: boolean` prop; the "Tours on Sale" and "Seats Left" cards get `href={agent ? undefined : "..."}` (check `StatCard`'s `href` is optional - `components/dashboard/stat-card.tsx`).
- [ ] **Step 3: `board-screen.tsx`:** `const { user } = useAuth();` (`@/contexts/auth-context`); render the "Statuses" button only when `user?.role !== TOURS_AGENT_ROLE`.
- [ ] **Step 4: Verify:** `grep -n "requireCompany(\"tours\")" lib/actions/tours-cases-actions.ts` → only `saveCaseStatuses`; `npx tsc --noEmit 2>&1 | grep -E "tours-(cases|payments|bookings|reservation|dashboard)-actions|whatsapp-thread-actions|tours/page|tours-dashboard|board-screen"` → empty.
- [ ] **Step 5: Commit:** `git commit -m "feat(tours): a sales agent works the dashboard, the reservations board and tasks as a rep - the screens' actions take requireCompanyRep" -- <the files above>`

### Task 5: Deposit dialog - the status change asks for the follow-up day

**Files:**
- Modify: `components/tours/cases/case-ui.tsx` (`StatusSelect` ~415-485, a new `DepositDialog` beside `FutureDialog`), `components/tours/cases/case-page.tsx:931,1058` + `saveStatus`, `components/tours/cases/cases-screen.tsx:243`

**Interfaces:**
- Produces: `export function DepositDialog({ open, initial, onCancel, onConfirm }: { open: boolean; initial: { departureDate: string | null; followUpDate: string | null }; onCancel: () => void; onConfirm: (followUpDate: string) => void })`; `StatusSelect` gains `deposit?: { departureDate: string | null; followUpDate: string | null }` and its `onChange` a fourth argument `followUpDate?: string`.
- Consumes: Task 1's `suggestDepositFollowUp`, `addDaysIso`; `todayIso` from `@/lib/tours/format`.

- [ ] **Step 1: `DepositDialog`:** title "Deposit paid (שולם מקדמה)", description "The balance is still owed - which day do you follow up on it? The card comes back to TODAY then."; one `type="date"` input (min = today) starting at `initial.followUpDate >= today ? it : suggestDepositFollowUp(initial.departureDate, today)`; three quick buttons "Tomorrow" / "In a week" / "30 days before departure" (the last only when a departure date exists); "Keep the status" / "Save as deposit paid" (disabled until the value is a day ≥ today). `onClick={(e) => e.stopPropagation()}` on the content, like `FutureDialog`.
- [ ] **Step 2: `StatusSelect`:** `pick`: `if (next === "deposit_paid") return setAskingDeposit(true);` mount the dialog only while asking; confirm → `onChange("deposit_paid", undefined, undefined, day)`.
- [ ] **Step 3: Callers:** case page `saveStatus = (status, closeReason, pick, followUpDate) => void save({ status, closeReason, ...(pick ? {...} : {}), ...(followUpDate ? { followUpDate } : {}) })` and both `<StatusSelect deposit={{ departureDate: row.departureDate, followUpDate: row.followUpDate }} …>`; `cases-screen.tsx` the same with `row.original`.
- [ ] **Step 4: Verify:** `npx tsc --noEmit 2>&1 | grep -E "case-ui|case-page|cases-screen"` → empty.
- [ ] **Step 5: Commit:** `git commit -m "feat(cases): 'Deposit paid' asks for the follow-up day (suggested 30 days before departure)" -- components/tours/cases/case-ui.tsx components/tours/cases/case-page.tsx components/tours/cases/cases-screen.tsx`

### Task 6a: Shortcuts that act in place - `card-quick-actions.tsx`, the customer page

**Files:**
- Create: `components/tours/cases/card-quick-actions.tsx`
- Modify: `components/tours/cases/booking-link-card.tsx` (export `SendButtons`, `OfferSummary`, `SendProps`), `components/tours/cases/customer-page.tsx` (`HeaderField` ACC NUM gone ~444; `CardRow` ~174-280; `CardShortcut` ~296; `CustomerPage` reads `?focus=`)

**Interfaces:**
- Produces (all in `card-quick-actions.tsx`):
  - `export interface CardActionHost { apply: (action: () => Promise<ActionResult<CaseRow>>, done: string) => Promise<boolean>; openCard: (section: "link" | "notes") => void; }`
  - `export function NotesEditor({ card, host, onDone }: { card: Pick<CaseRow, "id" | "notes">; host: CardActionHost; onDone: () => void })` - textarea (`maxLength` 4000), Save → `host.apply(() => updateCase(card.id, { notes }), "Notes saved")`, Cancel.
  - `export function OfferPanel({ card, host, onDone }: { card: Pick<CaseRow, "id" | "offer" | "phone" | "email" | "firstName">; host: CardActionHost; onDone: () => void })` - with an offer: `OfferSummary` (`onSent` → `host.apply(() => markOfferSent(...), 'Recorded as sent - the case is "Offer sent"')`, `onEdit` → `host.openCard("link")`, `onWithdraw` → `useConfirm` then `host.apply(() => withdrawOffer(...), "Offer withdrawn")`); without: "No booking link on this card yet." + "Build an offer" → `host.openCard("link")`.
  - `export function FollowUpPicker({ card, host, today, onDone }: { card: Pick<CaseRow, "id" | "followUpDate">; host: CardActionHost; today: string; onDone: () => void })` - a `type="date"` input + Tomorrow / In 2 days / In a week (`addDaysIso`) + "Clear"; a pick → `host.apply(() => updateCase(card.id, { followUpDate }), "Follow-up day saved")`.
  - `export function TakeCardButton({ card, host, currentUserId, busy, size }: { card: Pick<CaseRow, "id" | "assignedTo">; host: CardActionHost; currentUserId: string; busy?: boolean; size?: "sm" })` - renders nothing unless `canTakeCard(card)`; "Take it" → `host.apply(() => updateCase(card.id, { assignedTo: currentUserId }), "The card is yours")`.
  - `export function CardActionsMenu({ card, host, today, currentUserId }: { card: CaseRow; host: CardActionHost; today: string; currentUserId: string })` - a `DropdownMenu` on an icon button (`MoreHorizontal`, `aria-label="Actions"`): "Notes", "Booking link", "Follow-up", and "Take it" when `canTakeCard`; each of the first three opens a `Dialog` holding the body above (`onClick={(e) => e.stopPropagation()}` on `DialogContent`); the body's `onDone` closes it.
- Consumes: `updateCase`, `markOfferSent`, `withdrawOffer` from `tours-cases-actions`; `canTakeCard`, `addDaysIso` (Task 1); `OfferSummary` / `SendButtons` exported here.

- [ ] **Step 1: Export** `SendButtons`, `OfferSummary` and `SendProps` from `booking-link-card.tsx` (no behaviour change).
- [ ] **Step 2: Write `card-quick-actions.tsx`** with the exports above.
- [ ] **Step 3: Customer page:** delete the ACC NUM `HeaderField`; in `CardRow` build `host` (`apply` = `run(action, done)` then `onChanged()`; `openCard` = `go(section)`); the "Booking link" and "Notes" shortcuts become `Popover`s (`PopoverTrigger asChild` around `CardShortcut`, which must spread its props / `ref` onto the `<button>`) with `OfferPanel` / `NotesEditor` inside (`onDone` closes the popover); add an inline "ACC" box (an `<input>` with `GHOST_FIELD` classes, `dir="ltr"`, saved on blur through `host.apply(() => updateCase(card.id, { accNum }), "ACC NUM saved")`, shown on every card - closed too); add `<TakeCardButton size="sm" …>` after the shortcuts. `CustomerPage`: `const focus = params.get("focus")`; when it is `"link"` or `"notes"` and the card is `wanted`, pass `initialFocus` into that `CardRow`, whose `focus` state starts from it (the card is already opened for `wanted`).
- [ ] **Step 4: Verify:** `npx tsc --noEmit 2>&1 | grep -E "card-quick-actions|customer-page|booking-link-card"` → empty.
- [ ] **Step 5: Commit:** `git commit -m "feat(cases): the folded card's Booking link / Notes act in place, ACC NUM moves to the card, 'Take it' on an unassigned card" -- components/tours/cases/card-quick-actions.tsx components/tours/cases/booking-link-card.tsx components/tours/cases/customer-page.tsx`

### Task 6b: The board - "Take it" + the actions menu on TODAY and LEADS, ACC on RESERVATIONS

**Files:**
- Modify: `components/tours/cases/board-screen.tsx` (`save` → a `host`, `todayColumns` actions ~310-350, `leadColumns` + a new `actions` column, `orderColumns` ACC)

- [ ] **Step 1: A host per card:** `const hostFor = useCallback((card: CaseRow): CardActionHost => ({ apply: async (action, done) => { setBusy(card.id); const r = await run(action, done); setBusy(null); if (!r.success) return false; <the afterSave patch the existing save does>; return true; }, openCard: (section) => router.push(`/tours/reservations/${card.id}?focus=${section}`) }), […])`; `save` becomes `hostFor(card).apply(() => updateCase(card.id, change), done)`.
- [ ] **Step 2: TODAY actions cell:** before the existing buttons `<TakeCardButton size="sm" card={card} host={hostFor(card)} currentUserId={currentUserId} busy={working} />`; after everything (outside the reason ternary) `<CardActionsMenu card={card} host={hostFor(card)} today={today} currentUserId={currentUserId} />`.
- [ ] **Step 3: LEADS (a NEW column - the tab has none today; rows are plain `CaseRow`):** a last column `{ id: "actions", enableHiding: false, header: () => <span className="sr-only">Actions</span>, cell: … <InRow> TakeCardButton + CardActionsMenu </InRow> }`.
- [ ] **Step 4: RESERVATIONS:** after "travelers": `{ id: "acc", accessorFn: (r) => r.card.accNum ?? "", header: "ACC", cell: ({ row }) => <span dir="ltr" className="tabular text-sm">{row.original.card.accNum ?? EMPTY}</span> }`.
- [ ] **Step 5: Verify:** `npx tsc --noEmit 2>&1 | grep -E "board-screen"` → empty; `npx tsx scripts/tours-cases-selftest.ts` ok.
- [ ] **Step 6: Commit:** `git commit -m "feat(board): 'Take it' and an actions menu (Notes / Booking link / Follow-up) on TODAY and LEADS rows, ACC on RESERVATIONS" -- components/tours/cases/board-screen.tsx`

### Task 7: Guide + CLAUDE.md

**Files:**
- Modify: `app/(dashboard)/guide/guide-content-tours.ts` (sections `tours-reservations` ~204-296, `tours-tasks` ~298, `tours-users` ~928-966), `CLAUDE.md` (after the "Alon's TODAY round (21.10.2026…)" paragraph, line ~212)

- [ ] **Step 1: Guide:** Reservations - a step on the row menu ("⋯" → Notes / Booking link / Follow-up) and "Take it"; a point: paid clears the follow-up day, a deposit asks for one (30 days before departure suggested); a point: ACC NUM is on the card (folded box, RESERVATIONS column), the national id on the customer. Users - "Sales agent" (נציג מכירות) replaces "Tours agent" in the role step and the Roles point: "sells for the company: Dashboard, Reservations (their own and unassigned cards) and Tasks; the departures board read-only". Tasks - intro: "…an editor or a sales agent changes the status of their own tasks". EN + HE on every `t()`.
- [ ] **Step 2: CLAUDE.md:** one paragraph "**Alon's round 3 (22.10.2026; spec …, plan …, migration `<file>`).**" naming: the pure rules (`followUpAfterStatus`, `suggestDepositFollowUp`, `bulkStatusBlocker`, `canTakeCard`), the trigger line, `requireCompanyRep` + which actions take it, the role's home / menu / label and `TOURS_AGENT_MENU`, `card-quick-actions.tsx`, ACC NUM per card (`customers.acc_num` unwritten), and **Dor's step:** /users → each rep `editor` → "Sales agent".
- [ ] **Step 3: Verify:** `npx tsx scripts/guide-selftest.ts` → ok.
- [ ] **Step 4: Commit:** `git commit -m "docs(tours): guide + CLAUDE.md - round 3 (paid / deposit follow-up, sales agent, shortcuts in place)" -- app/(dashboard)/guide/guide-content-tours.ts CLAUDE.md`

### Task 8: Verification

- [ ] `npx tsx scripts/tours-cases-selftest.ts`, `npx tsx scripts/tasks-company-scope-selftest.ts`, `npx tsx scripts/guide-selftest.ts` → all ok.
- [ ] `npx tsc --noEmit 2>&1 | grep -E "lib/tours/cases|tours-cases-actions|tours-payments-actions|tours-bookings-actions|tours-reservation-actions|tours-dashboard-actions|whatsapp-thread-actions|lib/company|tours-agent|lib/nav|auth.types|task-people|tasks-scope|case-ui|case-page|cases-screen|card-quick-actions|customer-page|booking-link-card|board-screen|tours-dashboard|tours/page|guide-content-tours"` → empty (the repo's build ignores TS errors; this is the gate).
- [ ] `npm run lint -- --quiet` on the touched files (or `npx eslint <files>`) → no errors.
- [ ] `git status --short` → only the committed files; `git log --oneline origin/master..HEAD` lists the round's commits. Nothing pushed.
- [ ] Report: what needs Dor - push (the migration rides it), /users role moves, a look at prod after the deploy (local dev cannot sign in with the prod password).

# Tours board - Alon's TODAY round - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TODAY on `/tours/reservations` becomes the rep's own list - coloured by reason, numbered and dragged into a private order, phone / notes / mail in reach, only their cards and the unassigned ones - and the manager hands out leads in bulk; the customer page opens its cards folded.

**Architecture:** Every rule is pure in a new `lib/tours/board.ts` (viewer, visibility, order, note line) and tested in `scripts/tours-cases-selftest.ts`; the server actions in `lib/actions/tours-cases-actions.ts` apply the viewer on every read and write; `components/data-table.tsx` gains one optional row-reorder prop (dnd-kit, already a dependency); the three case screens take the new columns. One idempotent migration adds `leads.notes_at` and `public.lead_board_orders`; every read falls back when it is not applied yet.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (`supabaseTyped`), TanStack Table through `DataTable`, `@dnd-kit/core` + `@dnd-kit/sortable`, shadcn/ui, `npx tsx` selftests.

**Spec:** `docs/superpowers/specs/2026-10-21-tours-board-round-design.md`

## Global Constraints

- Work directly on `master`, no branch, no PR; commit only the files this plan names (other sessions have uncommitted edits in `guide-content-tours.ts` and elsewhere - commit by explicit paths, `git commit -- <paths>`); never push; no AI co-author line.
- Migration through `npm run db:new tours_board_round`; SQL idempotent; no CHECK constraints on new columns; RLS on, no policy.
- Every read of `notes_at` and of `lead_board_orders` tolerates the migration not applied (`missingColumn` / `missingTable` in the actions file).
- Pure modules import nothing from React, Next or Supabase; selftests run under `npx tsx` with no DB.
- Manager = `ADMIN_ROLES.includes(session.role)` OR `company_members.role === 'admin'` in the active company; a failed membership read = rep.
- A rep sees `assignedTo === viewer.id || assignedTo === null`; a manager sees all. Customers (people) are never filtered.
- `BOARD_ORDER_MAX = 500`, `NOTE_LINE_MAX = 80`, Israel day = `todayIso()` (`lib/tours/deadlines.ts`, `Asia/Jerusalem`).
- Copy: customer numbers print bare (`1004`); "This card belongs to another rep"; "Only a manager assigns cards in bulk."; "handed to X"; "N cards of other reps are not shown".
- TypeScript gate is `npx tsc --noEmit` (the build ignores errors).

## Review Focus

- A saved order holding ids that left TODAY, duplicates or junk: `orderBoard` must ignore what is not on the list and number the rest 1..N without gaps (Task 1 test).
- A note of whitespace or CRLF lines: `noteLine` answers "" and the column prints nothing, never "\r" (Task 1 test).
- A note stamped 22:30Z on 20.10 is 01:30 Israel on 21.10: `writtenToday` compares ISRAEL days (Task 1 test).
- A rep calls `bulkUpdateCases({ assignedTo })` or `exportCases` with another rep's id by hand: the server refuses / drops it, the client never decides (Task 3, checked by reading the code path; no DB in the selftests).
- Dragging while a search or "Mine" narrows the list must be off, or a filtered slice would be saved as the whole order (Task 4: `DataTable` turns it off on its own search; Task 5: the screen passes `enabled: !q && !mine`).

---

### Task 1: Pure rules - `lib/tours/board.ts`, bare customer number

**Files:**
- Create: `lib/tours/board.ts`
- Modify: `lib/tours/cases.ts:420` (`customerLabel`), `:687-702` (`caseMatches`), `:631-681` (`CaseRow`: add `notesAt`, `arrivedAt`)
- Test: `scripts/tours-cases-selftest.ts`

**Interfaces:**
- Produces (all exported from `lib/tours/board.ts`):
  - `interface BoardViewer { id: string; manager: boolean }`
  - `boardViewerOf(id: string, role: Role, membershipRole: string | null): BoardViewer` - manager when `ADMIN_ROLES.includes(role) || membershipRole === "admin"`.
  - `canSeeCard(card: { assignedTo: string | null }, viewer: BoardViewer): boolean`
  - `visibleCards<T extends { assignedTo: string | null }>(cards: readonly T[], viewer: BoardViewer): T[]`
  - `arrivalOf(createdAt: string, inquiryTimes: readonly string[]): string` - the newest inquiry time (max ISO string) else `createdAt`.
  - `orderBoard<T extends { id: string; arrivedAt: string }>(rows: readonly T[], savedIds: readonly string[]): { row: T; position: number }[]` - saved first in saved order, then the rest by `arrivedAt` asc then `id`; positions 1..N.
  - `moveInOrder(ids: readonly string[], activeId: string, overId: string): string[]` - arrayMove; unknown ids = the same array.
  - `placeInOrder(ids: readonly string[], id: string, place: number): string[]` - 1-based, clamped to 1..length; a non-integer = the same array.
  - `cleanOrderIds(ids: readonly unknown[]): string[]` - uuid-shaped strings only, deduped, first `BOARD_ORDER_MAX` kept.
  - `BOARD_ORDER_MAX = 500`, `NOTE_LINE_MAX = 80`
  - `noteLine(notes: string | null | undefined): string` - first non-blank line, trimmed, cut to `NOTE_LINE_MAX` with "…".
  - `writtenToday(at: string | null | undefined, today: string): boolean` - `todayIso(new Date(at))` equals `today` (reuse `todayIso` from `lib/tours/deadlines.ts`; an unparsable date = false).
- `lib/tours/cases.ts`: `customerLabel(no)` answers `String(no)` (empty for null); `caseMatches` also passes `` row.customerNo ? `C-${row.customerNo}` : null ``; `CaseRow` gains `notesAt: string | null` and `arrivedAt: string`.

- [ ] **Step 1: Write the failing tests** - append a `// ---- board (Alon 21.10)` block to `scripts/tours-cases-selftest.ts` importing from `@/lib/tours/board` (the file uses `@/` imports already):

```ts
const manager = boardViewerOf("u1", "editor", "admin");
const rep = boardViewerOf("u2", "editor", "editor");
assert.equal(manager.manager, true, "a company admin membership is a manager");
assert.equal(boardViewerOf("u3", "admin", null).manager, true, "a global admin is a manager everywhere");
assert.equal(rep.manager, false);
assert.equal(boardViewerOf("u4", "superadmin", "editor").manager, true);
const cards = [{ id: "a", assignedTo: "u2" }, { id: "b", assignedTo: null }, { id: "c", assignedTo: "u9" }];
assert.deepEqual(visibleCards(cards, rep).map((c) => c.id), ["a", "b"], "a rep: own + unassigned");
assert.deepEqual(visibleCards(cards, manager).map((c) => c.id), ["a", "b", "c"]);
assert.equal(canSeeCard({ assignedTo: "u9" }, rep), false);

assert.equal(arrivalOf("2026-10-01T10:00:00Z", []), "2026-10-01T10:00:00Z");
assert.equal(arrivalOf("2026-10-01T10:00:00Z", ["2026-10-19T09:00:00Z", "2026-10-20T08:00:00Z"]), "2026-10-20T08:00:00Z", "the newest inquiry is the arrival");

const rows = [
  { id: "n", arrivedAt: "2026-10-21T08:00:00Z" },
  { id: "o", arrivedAt: "2026-10-01T08:00:00Z" },
  { id: "m", arrivedAt: "2026-10-10T08:00:00Z" },
];
assert.deepEqual(orderBoard(rows, []).map((r) => [r.row.id, r.position]), [["o", 1], ["m", 2], ["n", 3]], "default = arrival, oldest first");
assert.deepEqual(orderBoard(rows, ["n", "gone", "n"]).map((r) => r.row.id), ["n", "o", "m"], "saved first; ids not on the list and repeats are ignored");
assert.deepEqual(orderBoard(rows, ["m", "n", "o"]).map((r) => r.position), [1, 2, 3], "no gaps");
assert.deepEqual(moveInOrder(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
assert.deepEqual(moveInOrder(["a", "b", "c", "d"], "b", "d"), ["a", "c", "d", "b"]);
assert.deepEqual(moveInOrder(["a", "b"], "x", "a"), ["a", "b"], "an unknown id moves nothing");
assert.deepEqual(placeInOrder(["a", "b", "c", "d"], "d", 1), ["d", "a", "b", "c"]);
assert.deepEqual(placeInOrder(["a", "b", "c", "d"], "a", 99), ["b", "c", "d", "a"], "clamped to the end");
assert.deepEqual(placeInOrder(["a", "b"], "a", 1.5), ["a", "b"], "not a whole number: unchanged");
const uuid = "123e4567-e89b-12d3-a456-426614174000";
assert.deepEqual(cleanOrderIds([uuid, uuid, "junk", 7, null]), [uuid]);
assert.equal(cleanOrderIds(Array.from({ length: 600 }, (_, i) => `123e4567-e89b-12d3-a456-${String(i).padStart(12, "0")}`)).length, BOARD_ORDER_MAX);

assert.equal(noteLine("  \r\n\r\n  call back at 15:00 \r\nsecond line"), "call back at 15:00");
assert.equal(noteLine(" \n \r\n"), "");
assert.equal(noteLine(null), "");
assert.equal(noteLine("x".repeat(100)), `${"x".repeat(NOTE_LINE_MAX - 1)}…`);
assert.equal(writtenToday("2026-10-20T22:30:00Z", "2026-10-21"), true, "22:30Z is already the 21st in Israel");
assert.equal(writtenToday("2026-10-20T12:00:00Z", "2026-10-21"), false);
assert.equal(writtenToday(null, "2026-10-21"), false);
assert.equal(writtenToday("not a date", "2026-10-21"), false);

assert.equal(customerLabel(1004), "1004", "no C- prefix any more (Alon 21.10)");
assert.equal(customerLabel(null), "");
```
  Also fix the existing `customerLabel` assertion in that file (search for `"C-"`) to the bare number, and add to the existing `caseMatches` checks: a row with `customerNo: 1004` matches `"C-1004"` and `"1004"`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/tours-cases-selftest.ts`
Expected: FAIL - `Cannot find module '@/lib/tours/board'`.

- [ ] **Step 3: Implement `lib/tours/board.ts`** with the signatures above (header comment: what the file is, "pure - no DB, no React"; `Role` / `ADMIN_ROLES` from `@/types/auth.types`; `todayIso` from `@/lib/tours/deadlines`; the uuid regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` case-insensitive). Change `customerLabel`, `caseMatches` and `CaseRow` in `lib/tours/cases.ts` as the Interfaces block says (`notesAt`, `arrivedAt` are filled in Task 2 - until then `tsc` complains in `toCaseRow`; that is expected and fixed next task).

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx scripts/tours-cases-selftest.ts`
Expected: `tours-cases selftest: ok`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(tours): board rules - viewer, private order, note line; bare customer number (Alon 21.10)" -- lib/tours/board.ts lib/tours/cases.ts scripts/tours-cases-selftest.ts
```

---

### Task 2: Migration, DB types, `notes_at` + `arrivedAt` on the row

**Files:**
- Create: `supabase/migrations/<ts>_tours_board_round.sql` (via `npm run db:new tours_board_round`)
- Modify: `types/database.types.ts` (`leads` Row / Insert / Update gain `notes_at: string | null`; new table `lead_board_orders` beside `customers` at `:3564` - copy that block's shape: Row `{ company_id: string; user_id: string; lead_ids: string[]; updated_at: string }`, Insert with `lead_ids?` / `updated_at?`, Update all optional, `Relationships: []`)
- Modify: `lib/actions/tours-cases-actions.ts:125-131` (`CASE_COLUMNS` + `, notes_at`; `LEGACY_CASE_COLUMNS` also strips `, notes_at`; `missingColumn` regex gains `notes_at`), `:465-473` (`withDefaults`: `notes_at: record.notes_at ?? null`), `:404-451` (`toCaseRow`: `notesAt: r.notes_at ?? null`, `arrivedAt: arrivalOf(r.created_at, inquiriesOf(asObject(r.payload)).map((i) => i.at))`), `:613-619` (`updateCase` notes: when the trimmed text is non-empty and changed, `patch.notes_at = new Date().toISOString()`), `:819-838` (`createCase` insert: `notes_at: notes ? new Date().toISOString() : null`)
- Modify: `CaseRecord` Pick (`:137+`) to include `"notes_at"`.

**Interfaces:**
- Consumes: `arrivalOf` (Task 1), `inquiriesOf`, `asObject` (already imported in the actions file - check; `inquiriesOf` is in `lib/tours/cases.ts`).
- Produces: `CaseRow.notesAt`, `CaseRow.arrivedAt` filled for every row the actions answer.

- [ ] **Step 1: Create the migration**

Run: `npm run db:new tours_board_round` - then write into the new file:

```sql
-- Tours board, Alon's TODAY round (21.10.2026): when a card's note was last written, and each rep's own order of TODAY.
-- Both backoffice-only: RLS on, no policy, the service role alone (spec docs/superpowers/specs/2026-10-21-tours-board-round-design.md).
alter table public.leads add column if not exists notes_at timestamptz;
comment on column public.leads.notes_at is 'When notes were last written to a non-empty text (updateCase / createCase); null = never since the column exists. TODAY highlights a note written today.';

create table if not exists public.lead_board_orders (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  lead_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
comment on table public.lead_board_orders is 'One row per (company, user): the order of TODAY this user dragged (lib/tours/board.ts orderBoard). Replaced whole on every drag; at most 500 ids.';
alter table public.lead_board_orders enable row level security;
```

- [ ] **Step 2: Hand-patch `types/database.types.ts`** as the Files block says (the same way `customers` was added on 19.10 - `npm run db:types` needs a live link and would answer the same).

- [ ] **Step 3: Wire the column through the actions file** (Files block). The update that writes `notes_at` must survive a deploy that beat the migration: in `updateCase`, when the update answers `missingColumn(error)` AND the patch carries `notes_at`, retry once without `notes_at` (the note saves, the stamp waits) before the existing "A closing reason can be saved after the system update" throw; in `createCase` the same retry on the insert.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "tours-cases-actions|lib/tours/(cases|board)" ; echo "exit ${PIPESTATUS[0]}"`
Expected: no lines for those files.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(tours): leads.notes_at and lead_board_orders (migration), notesAt/arrivedAt on the case row" -- supabase/migrations/*_tours_board_round.sql types/database.types.ts lib/actions/tours-cases-actions.ts
```

---

### Task 3: The viewer on the server - who sees what, bulk gate, order save

**Files:**
- Create: `lib/services/tours-board-viewer.ts` (server-only module, no `"use server"`)
- Modify: `lib/actions/tours-cases-actions.ts` - `caseRecord` (`:453`), `listBoard` (`:1626`), `listCases` (`:542`), `getCustomerPage` (`:1652`), `bulkUpdateCases` (`:710`), `exportCases` (`:2102`), `findMergeCandidates` (`:1232` - add `assigned_to` to its select), `mergeCases` (`:1281`), `moveCardToCustomer` (`:1969`), `fileInquiry` (`:1994`), `updateCase` (`:568`), `deleteCase` (`:880`), `getCase` (`:996`), `holdCaseSeats` (`:1174`), `prepareOffer` (`:1448`), `markOfferSent` (`:1538`), `withdrawOffer` (`:1572`); new `saveBoardOrder`
- Modify: `lib/tours/cases.ts` - `BoardPage` (`:828`): `+ viewer: BoardViewer; order: string[]; known: Record<string, KnownFrom>`; `CasesPage` (`:712`): `+ viewer: BoardViewer`; `CustomerPageData` (`:838`): `+ hiddenCards: number; travelled: boolean`
- Modify: `lib/actions/tours-dashboard-actions.ts:169-176` (the "new leads" count)

**Interfaces:**
- Consumes: `boardViewerOf`, `canSeeCard`, `visibleCards`, `cleanOrderIds`, `BOARD_ORDER_MAX` (Task 1); `knownFrom` (exists).
- Produces:
  - `boardViewerFor(session: SessionPayload, company: Company): Promise<BoardViewer>` in `lib/services/tours-board-viewer.ts` - one `company_members.role` read by `(user_id, company_id)`, `maybeSingle`; any error logged and read as `null` (rep).
  - `caseRecord(company, id, viewer?: BoardViewer)` - with a viewer, a row that `!canSeeCard` throws `UserError("This card belongs to another rep")`. Every FIRST read of a user-triggered single-card action passes the viewer (the list in Files); `freshRow` and the re-reads after a write pass none.
  - `saveBoardOrder(ids: string[]): Promise<ActionResult<{ saved: number }>>` - `requireCompany("tours")`, `cleanOrderIds`, upsert `lead_board_orders` on `company_id,user_id`; `missingTable` -> `UserError("Your order is kept after the system update - try again in a few minutes.")`.
  - `listBoard` answers `viewer`, `order` (the viewer's `lead_ids`, `[]` on a missing table or no row), `known` (per VISIBLE card, computed over EVERY card of its customer: group all records by `customer_id`, map to the `knownFrom` history shape used in `getCustomerPage:1685`), and only visible `cards` / `orders`.
  - `listCases` answers `viewer` and visible rows only.
  - `getCustomerPage` answers visible `cards` / `orders` / `known`, `hiddenCards` = cards filtered out, `travelled` = any card of the customer (hidden ones too) with `isPaidStatus(status)` and a departure date before today.
  - `bulkUpdateCases`: `assignedTo !== undefined && !viewer.manager` -> `UserError("Only a manager assigns cards in bulk.")`; for a rep, read `id, assigned_to` of the ids first and throw `UserError("A selected card belongs to another rep - reload the screen.")` when any fails `canSeeCard`.
  - `exportCases`: `records` filtered by `canSeeCard`.
  - `findMergeCandidates`: `others` filtered by `canSeeCard` (select gains `assigned_to`).
  - Dashboard count: for a rep, `.or(\`assigned_to.eq.${session.sub},assigned_to.is.null\`)` on the "new leads" head count (the action already has `session` - check `:150`; if it holds only `company`, read the session where `requireCompany` is called).

- [ ] **Step 1: Write `lib/services/tours-board-viewer.ts`** (`boardViewerFor`).

- [ ] **Step 2: Thread the viewer through the actions** as the Interfaces block says. In `listBoard`, read the order row and the membership in the same `Promise.all` as the cases.

- [ ] **Step 3: Type-check and run the selftest**

Run: `npx tsc --noEmit 2>&1 | grep -E "tours-cases-actions|tours-dashboard-actions|tours-board-viewer|lib/tours/" ; npx tsx scripts/tours-cases-selftest.ts`
Expected: no tsc lines for those files; `tours-cases selftest: ok`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(tours): a manager sees every card, a rep their own and the unassigned ones - on every list and action; bulk assign is the manager's; a rep's own TODAY order is saved" -- lib/services/tours-board-viewer.ts lib/actions/tours-cases-actions.ts lib/actions/tours-dashboard-actions.ts lib/tours/cases.ts
```

---

### Task 4: `DataTable` row reorder (dnd-kit)

**Files:**
- Modify: `components/data-table.tsx` - props (`:62-110`), row loop (`:583-633`), `ROW_CLICK_IGNORE` (`:120`: add `[data-drag-handle]`)

**Interfaces:**
- Produces: `DataTableProps.rowReorder?: { enabled: boolean; orderColumnId: string; onMove: (activeId: string, overId: string) => void }`.
  - Drag is LIVE only when `rowReorder.enabled` AND the table's own search is empty AND `sorting` is `[]` or exactly `[{ id: orderColumnId, desc: false }]`.
  - When `rowReorder` is set a handle column is prepended (before `select`): header empty, cell = a `<button type="button" data-drag-handle aria-label="Drag to reorder" title=...>` with `GripVertical` (lucide), `cursor-grab`; greyed (`opacity-40 cursor-not-allowed`, title "Clear the search and sort by # to drag") while not live.
  - The `<Table>` is wrapped in `DndContext` (sensors: `PointerSensor` distance 6, `TouchSensor` delay 180 / tolerance 6, `KeyboardSensor` with `sortableKeyboardCoordinates`; `collisionDetection={closestCenter}`; `onDragEnd` -> `rowReorder.onMove(String(active.id), String(over.id))` when `over && active.id !== over.id`), the body rows in `SortableContext` (`items` = the page rows' ids, `verticalListSortingStrategy`), each row rendered by a `SortableRow` that calls `useSortable({ id: row.id, disabled: !live })` and puts `transform` / `transition` (via `CSS.Transform.toString`) on the `<TableRow>` and `setActivatorNodeRef` / `listeners` / `attributes` on the handle. The row keeps its `data-state`, class names, `onClick` and the expanded-row logic exactly as now.
  - Screens that pass no `rowReorder` render exactly as before (no DndContext).

- [ ] **Step 1: Implement** as above (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` are installed - see `app/(dashboard)/homepage/row-editor.tsx:5-20` for the import shape).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "components/data-table" ; echo done`
Expected: no lines.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(data-table): optional row reorder by drag (dnd-kit), live only in the order column's own sort" -- components/data-table.tsx
```

---

### Task 5: Board screens - TODAY, LEADS, RESERVATIONS, ALL

**Files:**
- Modify: `components/tours/cases/case-ui.tsx` - `CardWho` (`:54-71`: drop the phone line), new `PhoneCell`, `MailButton`, `KnownLine`, `BulkAssignSelect`, `TODAY_ROW_CLASSES`, `TodayBadge` (`:154-162`: a late one reads `Late N day(s)`)
- Modify: `components/tours/cases/board-screen.tsx` (whole TODAY column set, `getRowClassName`, order state, bulk bar, LEADS / RESERVATIONS phone column, `NewCaseDialog.onCreated`)
- Modify: `components/tours/cases/cases-screen.tsx` - Phone column after Customer (`:198-205`), bulk rep `Select` (`:451-462`) rendered only for `data.viewer.manager`, `onCreated` (`:506-509`)
- Modify: `components/tours/cases/new-case-dialog.tsx` - `onCreated: (id: string, handedTo: string | null) => void` (`handedTo` = the picked rep id when it is neither null nor `currentUserId`)

**Interfaces:**
- Consumes: `orderBoard`, `moveInOrder`, `placeInOrder`, `noteLine`, `writtenToday` (Task 1); `BoardPage.viewer / order / known` (Task 3); `saveBoardOrder` (Task 3); `DataTable.rowReorder` (Task 4).
- Produces (in `case-ui.tsx`):
  - `PhoneCell({ phone }: { phone: string | null })` - `<span dir="ltr" className="tabular text-sm">` or `EMPTY`.
  - `MailButton({ email, iconOnly }: { email: string | null; iconOnly?: boolean })` - `<a href={\`mailto:${email}\`}>` as an outline icon button (`Mail` icon), nothing when `email` is null.
  - `KnownLine({ known, statuses })` - the violet "Known customer · was X · reason" line (moved out of the Why column, same markup as `board-screen.tsx:169-178`).
  - `BulkAssignSelect({ reps, disabled, onAssign }: { reps: CaseRep[]; disabled: boolean; onAssign: (id: string | null) => void })` - the rep `Select` from `cases-screen.tsx:451-462` (`NOBODY` = unassigned); `cases-screen.tsx` uses it too.
  - `TODAY_ROW_CLASSES: Record<TodayReason, string>` - per reason: `bg-<colour>-500/10 [&>td:first-child]:border-s-4 [&>td:first-child]:border-s-<colour>-500` (colours as `REASON_CLASSES`; spell every class out in full - Tailwind only reads literals).

- [ ] **Step 1: `case-ui.tsx`** - the five pieces + the late label.

- [ ] **Step 2: `board-screen.tsx` TODAY** - in this order of columns: `#` (`id: "place"`, `accessorFn: (r) => r.position`, header `SortableHeader label="#"`, cell = the number as a button; click -> an `<input inputMode="numeric">` in place, Enter -> `placeInOrder`, Esc cancels) · `why` (badge + payment answer only, wrapper `max-w-[9rem]`) · `who` (`CardWho`) · `phone` (`PhoneCell`) · `what` (`CardWhat` + `KnownLine` from `data.known[card.id]`) · `status` · `notes` (`noteLine`; class `font-semibold text-foreground` + a `today` dot when `writtenToday(card.notesAt, today)`, else `text-muted-foreground`; `title` = full notes) · `followUp` · `rep` · `actions` (`WhatsAppButton`, `MailButton iconOnly`, then the existing buttons).
  - `TodayRow` gains `position: number`. Rows: `orderBoard(unfilteredTodayCards, orderIds)` first (every card the viewer may see that has a reason - BEFORE `q` / `mine`), then the search / Mine filter is applied to that numbered list, so `#` keeps the full-list place.
  - `orderIds` = `useState<string[]>` seeded from `data.order` (resync in an effect when `data` changes); `onMove = (a, b) => commit(moveInOrder(fullIds, a, b))`, `onPlace = (id, n) => commit(placeInOrder(fullIds, id, n))`, where `fullIds` = the numbered list's ids in order and `commit` sets state then calls `saveBoardOrder(ids)` through `run` (a failure toasts, the local order stays).
  - `<DataTable rowReorder={{ enabled: !q.trim() && !mine, orderColumnId: "place", onMove }} defaultSorting={[{ id: "place", desc: false }]} defaultPageSize={500} pageSizeOptions={[500]} stateKey="tours-board-today-v2" getRowClassName={(row) => TODAY_ROW_CLASSES[row.original.reason]} enableRowSelection={viewer.manager} rowSelection onRowSelectionChange bulkActions={<BulkAssignSelect .../>} />` (the new `stateKey` resets the page size a browser remembered as 50).
  - Bulk assign on TODAY and LEADS = `bulkUpdateCases(selectedIds, { assignedTo })` then `reload({ quiet: true })` and clear the selection.
  - LEADS and RESERVATIONS: `phone` column after `who`.
  - `onCreated={(id, handedTo) => { void reload({ quiet: true }); if (handedTo && !viewer.manager) toast "Card opened and handed to <name>" else router.push(\`/tours/reservations/${id}\`); }}`.

- [ ] **Step 3: `cases-screen.tsx`** - Phone column; `BulkAssignSelect` only when `data.viewer.manager`; `onCreated` as above (read `viewer` from `data`).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "components/tours/cases" ; echo done`
Expected: no lines.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(tours): TODAY numbered and dragged into the rep's own order, coloured by reason, phone / notes / mail columns, bulk assign for managers (Alon 21.10)" -- components/tours/cases/case-ui.tsx components/tours/cases/board-screen.tsx components/tours/cases/cases-screen.tsx components/tours/cases/new-case-dialog.tsx
```

---

### Task 6: Customer page - folded cards, Email, hidden cards

**Files:**
- Modify: `components/tours/cases/customer-page.tsx` - `open` default (`:338`), `CardRow` (`:171-265`: `id={\`card-${card.id}\`}` on the `<article>` + a flash class), header buttons (`:388-404`), the cards list (`:513-520`), header counts (`:420-424`), `travelled` (`:351`)

**Interfaces:**
- Consumes: `CustomerPageData.hiddenCards / travelled` (Task 3); `MailButton` (Task 5).

- [ ] **Step 1: Folded by default** - `open` starts as `opened ?? new Set()` (no `wanted`, no `openCardId`); `fileInquiry`'s `setOpened(new Set([cardId]))` stays. After the data loads, an effect scrolls `document.getElementById(\`card-${wanted}\`)` into view (`block: "center"`) and sets `flashId = wanted` for 1600 ms; `CardRow` adds `ring-2 ring-primary/60` while `flash`.

- [ ] **Step 2: Header** - `MailButton email={customer.email}` beside Call (label "Email", not icon-only); `travelled` chip reads `data.travelled`; counts stay over the listed cards; under the open cards, when `data.hiddenCards > 0`: `<p className="text-xs text-muted-foreground">{n} cards of other reps are not shown</p>` (singular "1 card of another rep is not shown").

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "customer-page" ; echo done`
Expected: no lines.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(tours): the customer page opens its cards folded and flashes the one you came from; Email button; other reps' cards are counted, not shown" -- components/tours/cases/customer-page.tsx
```

---

### Task 7: Guide + CLAUDE.md

**Files:**
- Modify: `app/(dashboard)/guide/guide-content-tours.ts:204-292` (section `tours-reservations`) - ANOTHER SESSION HAS UNCOMMITTED EDITS IN THIS FILE: edit only inside the `tours-reservations` section and commit with a private index (`GIT_INDEX_FILE`, see memory `shared-index-commit-scope`) or `git add -p` limited to your hunks.
- Modify: `CLAUDE.md:174` area - one paragraph after the 20.10 drawing paragraph.

- [ ] **Step 1: Guide** - in "TODAY, RESERVATIONS, LEADS": replace the first step (the reason ORDER sentence) with: TODAY numbered `#` in YOUR order - default by arrival (oldest first, the newest lead last); drag a row or click its number and type a place; the order is yours alone; every row is coloured by its reason (list the seven colours); the search / "Mine" keeps the numbers but turns dragging off. Add steps: Phone and Notes columns (a note written today is bold); the mail icon opens your mail app (an order confirmation, receipt or trip material will go from the company mailbox with you in CC when those sends exist); who sees what (a manager everything, a rep their own + unassigned; a customer is found by anyone); managers tick rows on TODAY / LEADS and "Set rep…" in bulk. In "The customer page": cards open folded - the one you came from is highlighted; "Email" beside "Call"; "N cards of other reps are not shown". Replace `C-1041` / "C-number" wording with the bare number ("customer number, 1041"). Both languages.

- [ ] **Step 2: CLAUDE.md** - one paragraph `**Alon's TODAY round (21.10.2026, same tab; spec ..., migration <ts>_tours_board_round.sql).**` naming: `lib/tours/board.ts` + what each rule is, `boardViewerFor`, `caseRecord(viewer)`, `lead_board_orders`, `notes_at`, `DataTable.rowReorder`, cards folded, bare customer number, the mail rule (company mailbox + CC rep for confirmation / receipt / material - not built, no system send yet), and the pre-deploy step: a superadmin gives Mega Family's managers `admin` on /users or they see only their own cards.

- [ ] **Step 3: Guide selftest**

Run: `npx tsx scripts/guide-selftest.ts`
Expected: ok.

- [ ] **Step 4: Commit** (guide file through a private index so the other session's hunks stay out)

```bash
git commit -m "docs(tours): guide + CLAUDE.md for the TODAY round (order, colours, who sees what, bulk assign, folded cards)" -- CLAUDE.md "app/(dashboard)/guide/guide-content-tours.ts"
```

---

### Task 8: Verification

- [ ] **Step 1:** `npx tsx scripts/tours-cases-selftest.ts && npx tsx scripts/tours-payments-selftest.ts && npx tsx scripts/guide-selftest.ts` - all ok.
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | grep -E "lib/tours/|tours-cases-actions|tours-dashboard-actions|tours-board-viewer|components/tours/cases|components/data-table|guide-content-tours"` - empty.
- [ ] **Step 3:** Browser: `preview_start` the dev server (`.claude/launch.json`; memory `one-dev-server-per-folder` - reuse a running one), open `/tours/reservations` in the Mega Family company. If the pane has no session, ask Dor to sign in once (never type a password). Check: TODAY rows coloured, `#` column, drag two rows and reload (order kept), type a place, Notes column, Phone column, mail icon, bulk bar as a manager; a row opens the customer with the card folded and highlighted; `C-` gone. Screenshot for the report.
- [ ] **Step 4:** `git log --oneline -8` and `git status` - only the planned files committed; the other sessions' files untouched.

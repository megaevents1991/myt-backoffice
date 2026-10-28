# Tours board round 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/tours/reservations` the TODAY row's tint reaches its last cell, a card's fields are edited from its row on TODAY / LEADS / RESERVATIONS, the board's columns get Excel-style header filters (built once in `DataTable`), and a waiting-list form stops folding into a card that is already in another status.

**Architecture:** Three client-only parts over the existing server actions (`updateCase`, `markOfferSent`, `withdrawOffer` - unchanged) and one SQL part. Filters: pure rules in `lib/table-filters.ts`, opt-in per column through TanStack `ColumnMeta`, the popover in `components/data-table-header-filter.tsx`, state in `DataTable` (session-remembered). Routing: the TS twin `routeInquiry` + one migration re-creating `public.leads_fill` and `tours.booking_create` from their latest definitions with the new conditions.

**Tech Stack:** Next 15 / React 19, `@tanstack/react-table` v8, shadcn/ui (Popover, Checkbox, Input), Tailwind 3.4, Postgres plpgsql, `npx tsx` selftests with `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-10-28-tours-board-round-4-design.md`

## Global Constraints

- Server unchanged for the row editors: no new action, no new column. The only migration is the routing one.
- Card fields only from the row: status, rep, follow-up, notes, booking link, ACC. Never name / phone / e-mail / tour.
- A cancelled order's row keeps its "Cancelled" / "Payment failed" chip (no editor). No editors on a "to file" row.
- Filters: OR inside a column, AND across columns and with the search box; live (an edited row that stops matching leaves, with a toast); remembered per browser tab; TODAY drag off while any filter is set; a double-click never changes the sort.
- Waiting-list card = opened by a `waitlist` / `notify` form AND still at `new`.
- Migration: `create or replace`, written after `git fetch`, timestamp after `20261028114031`; nothing in either function moves but the named conditions.
- Commit by explicit path only (`git commit -- <paths>`); no push; no AI co-author line (Dor's rule overrides the harness).

## Review Focus

- A remembered filter on a column the table no longer has (or a malformed stored value) must not crash or hide rows - `cleanStoredFilters` drops it.
- A values filter whose remembered value no longer occurs in the rows must still show as a chip and be removable (and match nothing, not everything).
- A save that fails must not toast "no longer matches the filter" - the row did not change; only rows still present in the data and gone from the filtered set count.
- The pinned actions cell of a TINTED row must stay opaque - a row scrolled sideways must not show text through it - and an untinted table's pinned cell must look exactly as before.
- A `lead` form for a tour with only a waiting-list card open must still join it (the deal-card preference never leaves a form with nowhere to go).

---

### Task 1: The whole TODAY row wears its tint

**Files:**
- Modify: `components/data-table.tsx` (`PINNED_CELL`, ~line 179)
- Modify: `components/tours/cases/case-ui.tsx` (`TODAY_ROW_CLASSES`, ~line 243)

**Interfaces:**
- Produces: a row class may set `--row-wash` / `--row-wash-hover` (a translucent colour) and `--row-pin-hover` (an opaque colour); the pinned `actions` cell paints `--row-wash` (hover: `--row-wash-hover`) as a `background-image` linear-gradient over its opaque fill, so it composites exactly like the translucent row over the card. Unset vars = today's look.

- [ ] **Step 1:** `PINNED_CELL` gains `[background-image:linear-gradient(var(--row-wash,transparent),var(--row-wash,transparent))]` and the hover twin with `--row-wash-hover`; its hover fill becomes `var(--row-pin-hover, <today's muted mix>)`.
- [ ] **Step 2:** each `TODAY_ROW_CLASSES` entry sets the three vars with rgb literals of its hue (e.g. red: `[--row-wash:rgb(239_68_68/0.10)] [--row-wash-hover:rgb(239_68_68/0.15)] [--row-pin-hover:hsl(var(--card))]`) and paints itself with `bg-[var(--row-wash)] hover:bg-[var(--row-wash-hover)]`; the marker bar on the first cell stays. Hues = Tailwind 500 of violet / emerald / orange / amber / blue / red / slate / teal.
- [ ] **Step 3:** `npx tsc --noEmit -p .` - no new errors in the two files.
- [ ] **Step 4:** Commit `fix(tours): the TODAY row tint reaches the pinned actions cell`.

### Task 2: Pure filter rules

**Files:**
- Create: `lib/table-filters.ts`
- Create: `scripts/table-filters-selftest.ts`

**Interfaces:**
- Produces:
  - `type HeaderFilterKind = "values" | "text" | "date"`
  - `type HeaderFilterValue = { kind: "values"; values: string[] } | { kind: "text"; text: string } | { kind: "date"; from: string | null; to: string | null }`
  - `matchesHeaderFilter(cell: string, filter: HeaderFilterValue): boolean` - values: `cell` is one of `values`; text: `matchesSearch(text, cell)`; date: the first 10 chars of `cell` within `from..to` inclusive, an empty cell never matches a bounded range.
  - `isActiveFilter(filter: HeaderFilterValue): boolean` - false for `values: []`, blank text, no bounds.
  - `distinctValues(cells: readonly string[]): { value: string; count: number }[]` - count desc, then value asc (`localeCompare` "he").
  - `cleanStoredFilters(raw: unknown, kinds: Readonly<Record<string, HeaderFilterKind>>): { id: string; value: HeaderFilterValue }[]` - keeps only known column ids whose stored kind equals the column's, valid shapes, YYYY-MM-DD bounds, strings; drops inactive ones.
  - `filterSummary(filter: HeaderFilterValue, label?: (value: string) => string): string` - values: labels joined ", " (first 3, then "+N"); text: `"…"` quoted; date: `dd.mm.yyyy – dd.mm.yyyy` / `from dd.mm.yyyy` / `until dd.mm.yyyy`.
  - `rowsLeftFilter(shownBefore: readonly string[], shownNow: readonly string[], allNow: readonly string[]): string[]` - ids shown before, still in the data, no longer shown.

- [ ] **Step 1: Write the selftest** (`assert` from `node:assert/strict`), at least:
  - `matchesHeaderFilter("new", { kind: "values", values: ["new", "no_answer"] })` true; `"paid"` false; `""` with `values: [""]` true.
  - text `"Alon Samnon"` matches `{ text: "samnon alon" }`; date `"2026-10-22"` in `{ from: "2026-10-22", to: "2026-10-22" }`; `"2026-10-21T23:30:00Z"` compares as `"2026-10-21"`; `""` not in `{ from: "2026-10-01", to: null }`.
  - `isActiveFilter({ kind: "values", values: [] })` false; `{ kind: "text", text: "  " }` false.
  - `distinctValues(["b", "a", "b", ""])` deep-equals `[{ value: "b", count: 2 }, { value: "", count: 1 }, { value: "a", count: 1 }]`.
  - `cleanStoredFilters([{ id: "status", value: { kind: "values", values: ["new"] } }, { id: "gone", value: { kind: "text", text: "x" } }, { id: "followUp", value: { kind: "date", from: "22/10/2026", to: null } }, "junk"], { status: "values", followUp: "date" })` deep-equals the status entry alone; a non-array -> `[]`; a stored kind that differs from the column's -> dropped.
  - `filterSummary({ kind: "values", values: ["new", "no_answer", "paid", "future"] }, (v) => v.toUpperCase())` = `"NEW, NO_ANSWER, PAID +1"`.
  - `rowsLeftFilter(["a", "b", "c"], ["a"], ["a", "b"])` deep-equals `["b"]` (c left the DATA, not the filter).
- [ ] **Step 2:** `npx tsx scripts/table-filters-selftest.ts` fails (module missing).
- [ ] **Step 3:** Implement `lib/table-filters.ts` (pure, imports `matchesSearch` from `@/lib/search` only).
- [ ] **Step 4:** the selftest prints `table-filters selftest: ok`.
- [ ] **Step 5:** Commit `feat(table): pure header-filter rules + selftest`.

### Task 3: Header filters in `DataTable`

**Files:**
- Create: `components/data-table-header-filter.tsx`
- Modify: `components/data-table.tsx`

**Interfaces:**
- Consumes: Task 2's exports.
- Produces: column opt-in `meta: { filter: { kind: HeaderFilterKind; label: string; value?: (row: TData) => string; valueLabel?: (value: string) => string } }` - declared by augmenting `ColumnMeta<TData extends RowData, TValue>` of `@tanstack/react-table` (in `data-table.tsx`). `value` defaults to `String(getValue() ?? "")`.

- [ ] **Step 1:** In `DataTable`: column filters move to `useSessionState(`${memory}:filters`, [])`, read through `cleanStoredFilters` against the opt-in columns' kinds; every opt-in column gets `filterFn` = `matchesHeaderFilter(spec.value?.(row.original) ?? String(row.getValue(id) ?? ""), filter)` (do not override a column's own `filterFn`); add `getFacetedRowModel()`; a filter change resets to page 1.
- [ ] **Step 2:** `HeaderFilterPopover` (`data-table-header-filter.tsx`): a funnel button (visible on header hover, always visible + primary-tinted while the column is filtered) that opens a Popover. `values`: a search box over the list, "All" / "Clear", checkboxes with `valueLabel(value)` (empty value -> its `valueLabel("")`, default "None") and the count from `distinctValues` over `column.getFacetedRowModel()` rows, plus any filtered value no longer present (count 0). `text`: one input, applied as typed. `date`: two `type="date"` inputs (from / to) + Clear. An inactive result removes the filter.
- [ ] **Step 3:** In the header cell: render the popover button beside the header content for opt-in columns; `onMouseDown` with `event.detail === 1` snapshots `sorting`, `onDoubleClick` restores that snapshot and opens the popover (controlled `open` state per column).
- [ ] **Step 4:** Above the table (below the toolbar), while any header filter is active: one chip per filter `"<label>: <filterSummary>"` with an × that removes it, then "Clear all"; the footer count reads "of N (M in all)" when filters are active.
- [ ] **Step 5:** `reorderLive` also requires no active column filter.
- [ ] **Step 6:** Left-filter toast: a ref keeps the previous `{ data, columnFilters, globalFilter, shownIds }`; when `data` changed and both filters did not, `rowsLeftFilter(prevShown, nowShown, nowAllIds)` non-empty and a header filter is active -> `toast({ title: "<n> row(s) no longer match the filter" })` (`@/hooks/use-toast`).
- [ ] **Step 7:** `npx tsc --noEmit -p .` - no new errors.
- [ ] **Step 8:** Commit `feat(table): Excel-style header filters, opt-in per column`.

### Task 4: Row editors + filters on the board

**Files:**
- Modify: `components/tours/cases/board-screen.tsx` (todayColumns, orderColumns, leadColumns)
- Modify: `components/tours/cases/card-quick-actions.tsx` (two cell popovers)

**Interfaces:**
- Consumes: `StatusSelect`, `RepSelect`, `FollowUpInput`, `InRow`, `GHOST_FIELD` (case-ui), `NotesEditor`, `OfferPanel`, `CardActionHost` (card-quick-actions), the board's `save` / `hostFor`, Task 3's `meta.filter`.
- Produces: `NotesCell({ card, host, today })` and `OfferCell({ card, host })` in `card-quick-actions.tsx` - a button that prints the cell (notes: `noteLine`, bold + dot when `writtenToday`, "+ Note" ghost when empty; offer: none -> "—", unsent -> "Ready", sent -> "Sent dd.mm" from the offer's sent stamp, booked -> "Booked") and opens a Popover with `NotesEditor` / `OfferPanel` (closes on done).

- [ ] **Step 1:** TODAY: Status cell = `StatusSelect` (as cases-screen.tsx's: `future`, `deposit`, `onChange` -> `save(card, { status, closeReason, packageId/season, followUpDate })`) + the StageBar under it; Rep = `RepSelect ghost` -> `save(card, { assignedTo })`; Follow-up = `FollowUpInput ghost` (`due` = late or today) -> `save(card, { followUpDate })`; Notes = `NotesCell`; new "Link" column (after Notes) = `OfferCell`; the Card cell prints `↔ #<relatedCaseNo>` (Chip tone info, the ALL table's title) when set. A `file` row keeps read-only cells. Each editor inside `InRow`.
- [ ] **Step 2:** LEADS: Status = `StatusSelect` keeping the close-reason line under it; Follow-up = `FollowUpInput ghost`; Rep = `RepSelect ghost`; new Notes (`NotesCell`) and Link (`OfferCell`) columns; the `↔ #` chip in the Tour cell.
- [ ] **Step 3:** RESERVATIONS: Status = `StatusSelect` on live / past rows (the cancelled chip stays); Rep = `RepSelect ghost`; ACC = a ghost `Input` (`dir="ltr"`, `maxLength` 40 = `ACC_MAX` - check the action's constant) saved on Enter / blur when changed -> `save(card, { accNum })`.
- [ ] **Step 4:** `meta.filter` on the columns listed in spec section 3 (labels = the header text; Status `valueLabel` = `statusOf(key, statuses)?.label`; Why = `value: r => r.reason`, `valueLabel` = `TODAY_REASON_LABELS`; Rep `valueLabel("")` = "Unassigned"; dates: follow-up / departure = the stored day, Since = `israelDayOf(createdAt)`; Seats `value` = the seats state, labels Seats held / No seats).
- [ ] **Step 5:** `npx tsc --noEmit -p .` - no new errors; `npx tsx scripts/tours-cases-selftest.ts` still ok.
- [ ] **Step 6:** Commit `feat(tours): edit a card from its board row + header filters on the board`.

### Task 5: Waiting-list routing

**Files:**
- Modify: `lib/tours/cases.ts` (`RouteCard`, `routeInquiry`, new `isWaitingListCard`)
- Modify: `scripts/tours-cases-selftest.ts`
- Create: `supabase/migrations/<YYYYMMDDHHMMSS>_tours_waitlist_routing.sql` (`npm run db:new tours_waitlist_routing` after `git fetch`)

**Interfaces:**
- Produces: `RouteCard.kind?: string`; `isWaitingListCard(card: Pick<RouteCard, "kind" | "status">): boolean` = kind in `waitlist` / `notify` AND status `new`; `InquiryRoute` `new` may carry `relatedCardId?: string`.

- [ ] **Step 1: Selftest cases** (after the existing routing block):
  - waitlist onto `card({ status: "new" })` -> `{ kind: "join", cardId: "k1" }`.
  - waitlist onto `card({ status: "offer_sent" })` -> `{ kind: "new", relatedCardId: "k1" }`; same for `no_answer`, `future`, `pending_payment`, `paid` ahead.
  - waitlist with `[card({ status: "new" }), card({ id: "k2", status: "offer_sent", createdAt: later })]` -> join `k1`.
  - `notify` behaves as `waitlist`.
  - lead with `[card({ status: "offer_sent" }), card({ id: "k2", kind: "waitlist", status: "new", createdAt: later })]` -> join `k1`; with only the waitlist card -> join `k2`.
  - unchanged: lead onto `offer_sent` joins; the existing waitlist "newest open card" case is rewritten to the new rule.
- [ ] **Step 2:** the selftest fails.
- [ ] **Step 3:** `routeInquiry`: for `waitlist` / `notify` with a package -> the newest open same-tour card at `new` joins, else `{ kind: "new", relatedCardId: <newest open same-tour card> }` (no open card -> plain new); for other kinds with a package -> the newest open same-tour card that is not `isWaitingListCard`, else the newest open same-tour card. Update its doc comment.
- [ ] **Step 4:** the selftest prints its ok line.
- [ ] **Step 5: Migration.** Header comment (why, Dor 28.10, twin = `routeInquiry`). Copy `public.leads_fill()` verbatim from `20261021172647_whatsapp_phase1.sql` (lines 121-294, revokes included) and change only the `new.package_id is not null` branch: a `waitlist` / `notify` form selects with `and l.status = 'new'` added; when none is found it looks up the newest open same-tour card and sets `new.related_lead_id` to it (only if `new.related_lead_id` is null); any other kind orders `order by (l.kind in ('waitlist','notify') and l.status = 'new') asc, l.created_at desc`. Copy `tours.booking_create(uuid, text, jsonb)` verbatim from `20261019180000_tours_customers.sql` (lines 396-595 incl. its revoke) and change only the contact-match ordering to `order by (l.kind in ('waitlist','notify') and l.status = 'new') asc, (l.package_id is not null) desc, l.created_at desc`. Re-apply that file's grants for the function if it has any after 595.
- [ ] **Step 6:** `diff` each pasted function against its source - only the named lines differ.
- [ ] **Step 7:** Commit `fix(tours): a waiting-list form joins only a card still at New; later forms and bookings prefer the deal card`.

### Task 6: Docs, checks, review

**Files:**
- Modify: `app/(dashboard)/guide/guide-content-tours.ts` (the board section: editing from the row, header filters, the waiting-list rule)
- Modify: `CLAUDE.md` (a paragraph "Alon's round 4 (28.10.2026)" after round 3)

- [ ] **Step 1:** Guide text EN + HE; `npx tsx scripts/guide-selftest.ts` ok.
- [ ] **Step 2:** CLAUDE.md paragraph: the rules, the files, the migration, "UI checked by tsc + selftests; check on prod".
- [ ] **Step 3:** All selftests touched: `table-filters`, `tours-cases`, `guide`, `view-state`; `npx tsc --noEmit -p .` - no error in touched files.
- [ ] **Step 4:** Commit `docs(tours): guide + CLAUDE.md for board round 4`.
- [ ] **Step 5:** One fresh reviewer over `git diff <base>..HEAD` of this round's commits; fix what it confirms; commit.

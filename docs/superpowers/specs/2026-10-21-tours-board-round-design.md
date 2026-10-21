# Tours board: Alon's TODAY round (2026-10-21)

Source: Alon's doc tab `t.kw44n12anc02` (ROAD MAP MEGATR), rewritten after the 20.10 round - nine numbered notes on
the TODAY table of `/tours/reservations`, one line "בפנים: סגורים הקארדים בפנים" with a screenshot of the customer
page, and a screenshot of TODAY as it stands. Dor answered seven questions on 21.10; his answers are the decisions
below. Builds on `2026-10-19-tours-customer-cards-design.md` (customer + deal cards) and the 20.10 round (payments
log, cancellation rules, gift, card shortcuts) - nothing of those changes.

## Intent

TODAY is the rep's working list. Alon wants it to read at a glance (colour per reason, a narrow "why", the phone
where the eye looks for it, the note he wrote this morning), to be HIS list (his own order, dragged; only his cards
and the unassigned ones), and the manager's tool for handing out leads (bulk assign). The customer page stays tidy:
a card opens only when the rep opens it.

## Decisions (Dor, 21.10) - note by note

1. **Row colour per reason.** Every TODAY row is tinted in its reason's colour, stronger than today's faint pink,
   with a marker bar on the start edge - the seven `TodayReason`s keep the colours their badge already has
   (returned violet, payment orange, file amber, new blue, late red, today slate, confirmation teal).
2. **WHY is narrow.** The column holds the badge alone (a late one reads "Late 2 days"); the payment answer stays
   under it as a short line. "Known customer · was X · reason" leaves WHY and sits under the Card column as a small
   violet line.
3. **No "C-".** The customer number prints bare (`1004`) everywhere it printed `C-1004` - board, customer header,
   dialogs, toasts, export. The search still matches `C-1004` typed by habit.
4. **Customer and phone are two columns.** Customer = name over the bare number; Phone = its own column (`ltr`,
   tabular), so a phone is read and copied without the name in the way. Same two columns on LEADS and RESERVATIONS.
5. **Mail shortcut.** A mail icon at the end of a TODAY row and an "Email" button in the customer header open the
   rep's own mail app (`mailto:` the card's / customer's e-mail, no subject). Dor's rule, recorded for the sends that
   come later: an order confirmation, a receipt or trip material goes out from the COMPANY mailbox with the assigned
   rep in CC; an offer or support correspondence goes from the rep's own mailbox. Nothing today sends a confirmation,
   receipt or material by itself ("Send the confirmation" is a checkbox), so this round builds the rep side only.
6. **Notes on the row.** A Notes column on TODAY shows the first line of the card's notes (the whole text as a
   tooltip). A note written TODAY (Israel day) is highlighted - bold, in the foreground colour - so a rep who wrote
   "call back at 15:00" this morning sees it while the customer is still on the list. Needs `leads.notes_at`.
7. **Bulk assign - the manager's.** TODAY and LEADS get row selection and a bulk bar with "Assign to" (the ALL tab
   keeps its full bar). Assigning in bulk is a MANAGER's action (server-enforced): the admin sorts a pile of new leads
   straight to reps. A rep still changes the rep of one card they can see (unchanged).
8. **Numbered, private order.** TODAY's first column is `#` (1..N). The order is the viewer's OWN - each rep has
   theirs, the manager has theirs - and is kept per user and company. The default order is ARRIVAL: the oldest card
   first, the newest lead last ("ליד אחרון - פריוריטי אחרון"). A rep drags a row (mouse, touch, keyboard) to any
   place and the list keeps it. There is no separate priority flag - the number is the priority. Column sorting still
   works; dragging is on only while the table is in `#` order. TODAY has NO pagination (every row on one page, so a
   card is dragged from place 80 to place 3 in one move) and the number is also a control: click it, type a place,
   Enter (the homepage board's way). While a search or "Mine" narrows the list, `#` keeps each card's place in the
   FULL list and dragging is off (the handle is greyed, "clear the search to drag") - a saved order is always the
   whole list, never a filtered slice. **Arrival** = when the card last came to the rep: the newest joined inquiry's
   time (`payload.inquiries[].at`) when there is one, else the card's creation - so a customer who wrote again
   yesterday sits by yesterday, not by the day their card was opened two years ago. The reason grouping (returned ·
   payment · file · new · late · today · confirmation) is no longer the default order - the colour says why; a late
   follow-up and a new lead interleave by arrival. Sorting by the Why column brings the grouping back for a look.
9. **Who sees what.** A MANAGER sees every card of the company. A REP sees the cards assigned to them AND the
   unassigned ones (a new lead nobody took yet), never another rep's. Manager = a session in `ADMIN_ROLES`
   (superadmin / admin) or a `company_members.role = 'admin'` membership in the active company; everyone else on the
   staff list is a rep. Enforced on the server on every list (TODAY / RESERVATIONS / LEADS / ALL), on the customer
   page (hidden cards are counted in one muted line, never listed) and on every single-card action.
   **Cards are filtered, customers are not** (my call): a rep must find the person who is calling by phone whatever
   cards they hold, or they open a duplicate customer - so `searchCustomers`, the same-e-mail suggestion,
   `mergeCustomers` and opening `/tours/customers/<id>` by URL show the PERSON (names, phones, e-mail, id, "Travelled
   with us", card counts) to every rep; only the other reps' cards stay folded away behind the count. A rep's
   merge / move / export / bulk / recheck sees only cards they can see: `findMergeCandidates` lists visible cards,
   `mergeCases` / `moveCardToCustomer` refuse a hidden other card, `exportCases` and `bulkUpdateCases` drop to
   "a selected card belongs to another rep" when an id is not theirs, and the tours dashboard's "new leads" count
   follows the same filter so it matches the LEADS tab the rep lands on. **Facts about the customer stay whole**
   (my call): "Known customer · was X · reason" (`knownFrom`), "Travelled with us" and the header counts are
   computed on the SERVER over every card of the customer and shipped per card (`BoardPage.known`), for a rep and a
   manager alike - they describe the person, not another rep's work, and Nir asked for them; the hint is the only
   place a hidden card's tour and status show, in one line. **Handing a card away:** the visibility check runs
   BEFORE a write, never on the re-read after it - a rep who reassigns a card to someone else, or opens a new card
   for someone else, gets the saved row back, a toast "handed to X" and the row leaves their list; `NewCaseDialog`
   does not navigate to a card the creator cannot see.
10. **Cards closed by default.** On the customer page every card opens folded, even when the page was reached from
    a board row: the row's card is scrolled into view and flashed, not opened - "the user opens what they want, for
    tidiness". Filing an inquiry still opens the card it made (that is the rep's own action).

## Data

- `leads.notes_at timestamptz` (null = never written since the column exists). `updateCase` stamps it when `notes`
  changes to a non-empty text, `createCase` when the new card has notes; a merge keeps the kept card's stamp. The
  migration does not backfill (an old note is not "written today").
- `public.lead_board_orders` - one row per (company, user): `company_id`, `user_id`, `lead_ids uuid[]`,
  `updated_at`; PK `(company_id, user_id)`; RLS on, no policy (service role only, like every tours table). At most
  `BOARD_ORDER_MAX` (500) ids; the row is replaced whole on every drag.
- Migration via `npm run db:new tours_board_round`, idempotent (`add column if not exists`, `create table if not
  exists`). Every read tolerates the migration not applied yet: `notes_at` through `LEGACY_CASE_COLUMNS` (42703 /
  PGRST204 -> re-read without it, `notesAt: null`), the order table through `missingTable` (arrival order; a drag
  answers "available after the system update").

## Rules - pure, in `lib/tours/board.ts` (new, small), tested in `scripts/tours-cases-selftest.ts`

- `BoardViewer = { id, manager }`; `boardViewerOf(role, membershipRole)`.
- `canSeeCard(card, viewer)` = manager, or `assignedTo === viewer.id`, or `assignedTo === null`.
- `visibleCards(cards, viewer)` - the list filter; `hiddenCount`.
- `arrivalOf(card)` - the newest inquiry's `at`, else `createdAt`.
- `orderBoard(rows, savedIds, arrivalOf)` - rows whose id is in `savedIds` first, in that order; then the rest by
  arrival ascending (then id, for a stable tie); answers `{ id, position }[]` 1..N.
- `placeInOrder(ids, id, place)` - "type a place": the id moved to the 1-based place, clamped.
- `moveInOrder(ids, activeId, overId)` - the array after a drag (dnd-kit's arrayMove semantics), unknown ids
  untouched; `cleanOrderIds(ids)` - uuids only, deduped, capped at `BOARD_ORDER_MAX`.
- `noteLine(notes)` - the first non-empty line, trimmed, at most `NOTE_LINE_MAX` (80) chars with an ellipsis.
- `writtenToday(notesAt, today)` - the stamp's Israel day equals `today`.
- `customerLabel(no)` (in `lib/tours/cases.ts`) now answers the bare number; `caseMatches` also matches `C-<no>`.
- `TODAY_ROW_CLASSES` lives beside `REASON_CLASSES` in `case-ui.tsx` (design, not a rule).

## Actions (`lib/actions/tours-cases-actions.ts`)

- `boardViewerFor(session, company)` reads the membership role once (one small query; a failed read = rep, never
  manager). `listBoard` / `listCases` answer `viewer` and only the cards the viewer may see (RESERVATIONS rows follow
  their cards). `getCustomerPage` filters the same way and answers `hiddenCards`. `caseRecord` (the one single-card
  reader every action goes through) refuses a card the viewer may not see with a plain "This card belongs to another
  rep", so every single-card action is covered at once.
- `bulkUpdateCases` with `assignedTo` requires a manager (status changes in bulk stay as they are).
- `saveBoardOrder(ids)` upserts the viewer's row (`cleanOrderIds`); `listBoard` answers `order: string[]`, `viewer`
  and `known` (per card, over every card of its customer).
- The tours dashboard's leads count (`tours-dashboard-actions.ts`) applies `visibleCards` too.
- `updateCase` / `createCase` write `notes_at` (fall back on a missing column: the note saves, the stamp waits).
- Audit: bulk assign rows carry `bulk: true` as today; the order is not audited (a rep's private list).

## Screens

- `board-screen.tsx` TODAY: columns `#` (drag handle + number, sortable) · Why · Customer · Phone · Card · Status ·
  Notes · Follow-up · Rep · actions (WhatsApp, Mail, No answer / Confirm / Check / File it). Row class per reason.
  Row selection + bulk "Assign to" for managers. `defaultSorting = [# asc]`; the drag handle is live only then and
  only with no search / "Mine" active; no pagination; the number is a "type a place" control.
  LEADS: Customer / Phone split, selection + bulk assign for managers. RESERVATIONS and ALL: Customer / Phone split.
  The "Mine" button stays (for a rep it hides the unassigned ones).
- `components/data-table.tsx` gains one optional prop, `rowReorder: { enabled, onMove(activeId, overId) }`: when
  set, the body is a dnd-kit `SortableContext` over the page's row ids, each row a `useSortable` row, and a handle
  cell (`GripVertical`, `ROW_CLICK_IGNORE`) is prepended; sensors = pointer, touch (with a short delay), keyboard.
  Nothing else in the table changes; screens that pass nothing render exactly as before.
- `customer-page.tsx`: no auto-open; `id="card-<id>"` on each card row, the wanted one scrolled to and flashed
  (`deep-link-scroll` style); the "Email" button beside Call; "N cards of other reps are not shown" under the cards
  when `hiddenCards > 0`; bare customer number in the header chip.
- `case-ui.tsx`: `CardWho` prints name + bare number only (phone moves out); `PhoneCell`; `MailButton`;
  `TODAY_ROW_CLASSES`.

## Guide + CLAUDE.md

`guide-content-tours.ts` (Reservations section): the numbered private order and dragging, the colours, who sees what,
bulk assign for managers, the mail rule. CLAUDE.md tours block: one paragraph for this round.

## Not this round (told to Dor)

- Company-mailbox sends with the rep in CC (confirmation / receipt / material) - there is no system send to attach
  the rule to yet; built when those sends are.
- A bulk bar on RESERVATIONS (its rows are orders, two rows can be one card).
- A position that survives a card leaving TODAY and coming back (it re-enters by arrival).
- The mega-family site: nothing changes.

## Builder check (21.10) - what it asked and how it was settled

- Other server paths (search, merge, export, bulk, dashboard count): settled above - cards filtered, customers not.
- Facts derived from hidden cards: kept whole, computed on the server (above).
- Handing a card away: check before the write only (above).
- Drag across pages / under a filter: no pagination, type-a-place, drag off under a filter (above).
- Arrival: newest inquiry, else creation; the reason grouping is no longer the default order (above) - Dor to confirm.
- Who is a manager in Mega Family today: Dor to say which accounts are `admin` (a company membership is given by a
  superadmin on /users); a global Mega Events admin IS a manager in every company (ADMIN_ROLES already means that
  everywhere else in the backoffice).
- A bare number matches both a customer and a card number in the search - accepted (both rows are shown).

## Left to the builder

- Exact tints and the marker bar's width; the `#` column's width; the Notes column's width and where it sits.
- Whether the drag handle is the whole `#` cell or the grip alone.
- The toast texts.

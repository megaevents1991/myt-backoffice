# Tours board: Alon's round 4 - whole-row colour, edit in the row, header filters, waiting list (2026-10-28)

Source: Alon's doc tab `t.kw44n12anc02` (ROAD MAP MEGATR) as of 28.10 - six notes and two screenshots of the TODAY
table. Dor answered four questions on 28.10 (each time the recommended option); his answers are the decisions below.
Builds on `2026-10-21-tours-board-round-design.md` (TODAY in the rep's own order, row tint by reason, who sees what)
and `2026-10-22-tours-board-round-3-design.md` (shortcuts in place, the "⋯" row menu, "Take it", ACC per card).
Nothing of those changes unless said here.

## Intent

Alon works the board all day from `/tours/reservations` (TODAY | RESERVATIONS | LEADS | ALL). He wants:

1. "שיצבע את כל השורה בצבע החדש אחרי הוספת לייבל או שינוי סטטוס" - the row tint stops before the buttons at the
   row's end (screenshot: "Take it" / "No answer" / ⋯ sit on white), so the row does not read as one coloured line.
2. "לערוך את כל השדות כבר במסך רזרויישן, לא רוצה להיכנס פנימה לתוך הקארד" - change a card's fields from its row,
   booking link and notes included, without opening the card. And "דאבל קליק על השורה הראשונה עם השדות ולפלטר לפי
   דברים שיש שם, בהקלדה / בגלילה תלוי בשדה, אפשרות לסינון מרובה" - Excel-style filters on the header row.
3. "ליד רשימת המתנה צריך לפתוח קארד חדש, לא לשייך לקארד שכבר יש לו סטטוס אחר" - a waiting-list form was folded
   into the customer's existing card of the same tour although that card was already in another status.

Notes 4-6 (WhatsApp API, mails, card clearing) are NOT in this round - see "Out of scope".

## Decisions (Dor, 28.10)

### 1. The whole row wears its WHY colour

- **The colour rule does not change.** A TODAY row is tinted by its reason (`todayReason` -> `TODAY_ROW_CLASSES`:
  late = red, new = blue, returned = violet, ...) with the marker bar on the first cell. Dor chose this over tinting
  by status.
- **What changes: the pinned actions cell takes the row's tint.** `DataTable` pins a last column with id `actions` to
  the trailing edge and gives it an opaque `bg-card` so scrolled columns hide under it; that is why the tint stops
  there. The pinned cell must show the SAME hue as the rest of its row in every state - plain, hover, selected,
  expanded - in light and dark, and stay OPAQUE (nothing that scrolls under it may show through). Mechanism is the
  builder's (e.g. the row class sets a CSS variable with its wash and the pinned cell paints that colour mixed over
  the card colour). Rows that set no tint keep today's pinned look - no other table changes unless it opts in.
- **"After a status change"**: the row already recolours at once whenever the change changes the reason (the board
  patches the saved card and recomputes `todayReason`) - a New card set to "No answer" for tomorrow leaves TODAY, a
  late card given a future day leaves it. A change that keeps the reason (a card 6 days late moved to "Offer sent"
  keeps its past day, so it is still "late") keeps its colour. That is the rule Dor chose; nothing to build here
  beyond checking it still holds with the inline editors of section 2.

### 2. Edit the card from its row

Dor: **card fields only**. On TODAY, RESERVATIONS and LEADS a row edits, in place:

| Field | Where | Editor | Saved by |
|---|---|---|---|
| Status | TODAY, LEADS, RESERVATIONS (live / past order rows) | `StatusSelect` (as on ALL) with its Future / Deposit / Close-reason dialogs | `updateCase({ status, closeReason, packageId, season, followUpDate })` |
| Rep | TODAY, LEADS, RESERVATIONS | `RepSelect ghost` (as on ALL) | `updateCase({ assignedTo })` |
| Follow-up | TODAY, LEADS | `FollowUpInput ghost` (as on ALL) | `updateCase({ followUpDate })` |
| Notes | TODAY (column exists), LEADS (new column) | a click on the cell opens a popover with `NotesEditor` | `updateCase({ notes })` |
| Booking link | TODAY and LEADS (new column "Link") | the cell names where the offer stands (none / ready / sent dd.mm / booked); a click opens a popover with `OfferPanel` | `markOfferSent` / `withdrawOffer`; "Build an offer" / "Edit and resend" still open the card at its link section (the builder needs the date picker and the quote) |
| ACC | RESERVATIONS (column exists) | a ghost text box, saved on Enter / blur | `updateCase({ accNum })` |

- **Not editable from the row:** the customer's name / phone / e-mail (customer-wide: one edit changes every card of
  that customer - it stays on the customer page) and the card's tour / departure (card page). The order's own fields on
  RESERVATIONS (travellers, amount, seats) stay read-only.
- **A cancelled order's row** on RESERVATIONS keeps its "Cancelled" / "Payment failed" chip in the Status column (it
  describes the ORDER, not the card) - no editor there.
- **The server does not change.** `updateCase` / `markOfferSent` / `withdrawOffer` already take every one of these
  fields with the viewer gate (`caseRecord(company, id, viewer)`), the status rules (close reason, `closeBlockedBy`,
  `followUpAfterStatus`, `canClearFollowUp`) and the audit. No new action, no migration for this part.
- **Saving goes through the board's one door** (`apply` -> `afterSave` patch of the live list): the row updates in
  place, recolours / leaves TODAY by its new reason, and a card a rep hands to someone else leaves that rep's list with
  "Card handed to X" - as today. One spinner per row while a save is in flight.
- **Clicks:** a click on an editor never opens the customer page (the row click does, elsewhere on the row). Popovers
  render in a portal so the table's scroll box never clips them.
- **The "⋯" menu and "Take it" stay** as they are (the same bodies; a keyboard / phone way in).

### 3. Header filters - built once in `DataTable`

- **Opt-in per column** through the column's `meta`: `filter: "values"` (a checkbox list of the column's distinct
  values with a count each, a search box over the list, multi-select, "All" / "Clear"), `filter: "text"` (the cell
  contains the typed words - the same token search as `matchesSearch`), `filter: "date"` (from / to, inclusive). A
  values column may name how a value prints (`filterLabel`: a status key -> its Hebrew label; an empty value ->
  "None" / "Unassigned").
- **Opening it:** a double-click on the header cell (Alon's gesture), AND a small funnel button in the header - shown
  on hover, always shown while that column is filtered - because a double-click alone is invisible. **A double-click
  must never change the sort** of a sortable header (its two clicks would toggle the sort twice); the builder makes
  the double-click leave the sort exactly as it was before the first click.
- **Combining:** OR inside a column (Status = New or No answer), AND across columns and with the search box.
- **Always visible when narrowed:** while any column filter is set, a line above the table lists them as removable
  chips ("Status: חדש, אין מענה ×") with "Clear all", and the count reads "N of M". A narrowed list must never look like
  the whole list.
- **Remembered** for the browser tab like the table's search / sort / page (`useSessionState`, under the table's
  memory key). A remembered value that no longer occurs in the rows still shows as a chip (so it can be removed).
- **The filter is live:** a row edited so that it no longer matches leaves the filtered list as soon as the save
  lands (as a TODAY row already leaves when its reason changes), and the save's toast says so ("... - no longer
  matches the filter"). Not Excel's "stays until re-applied": the list and its "N of M" always tell the truth.
- **TODAY's drag-to-order is off while any column filter is set** - the same rule as the search: a filtered slice is
  never saved as the rep's order.
- **Switched on, this round, on the board's three tabs only:**
  - TODAY: Why (values), Customer (text), Phone (text), Card / tour (values), Status (values), Notes (text),
    Follow-up (date), Rep (values).
  - RESERVATIONS: Order (text), Customer (text), Phone (text), Tour (values), Departure (date), ACC (text),
    Status (values), Seats (values), Rep (values).
  - LEADS: Customer (text), Phone (text), Tour (values), Status (values), Today (values), Follow-up (date),
    Source (values), Rep (values), Since (date).
  ALL keeps its own filters; other backoffice tables get the ability but none is switched on now.
- **Pure rules** live in one module (e.g. `lib/table-filters.ts`: the value predicate per kind, the distinct values
  with counts, cleaning a remembered filter) with a selftest under `scripts/`.

### 4. A waiting-list form joins only a card still at "New"

- **The rule** (SQL `public.leads_fill`, TS twin `routeInquiry` in `lib/tours/cases.ts`): a form of kind `waitlist`
  (and `notify` - see "Calls I made") whose tour the customer has an open card for joins that card **only when the
  card's status is `new`** (the newest such card of that tour). Any other open card of that tour - no answer, offer
  sent, future, pending payment, deposit, paid ahead - does not take it: the form opens a NEW card. Every other form
  kind routes exactly as today (same tour -> join, no tour + open cards -> to file, a WhatsApp message -> the newest
  open card).
- The new card is an ordinary one: type `potential` (from its kind, unchanged), the customer's last rep (the existing
  known-customer rule), its own departure from `payload.date.productId` (unchanged). It shows on the customer page
  next to the other card.
- **A migration** re-creates `public.leads_fill` from its latest definition (`20261021172647_whatsapp_phase1.sql`)
  with only that condition added - `create or replace`, idempotent, nothing else in the function moves. Written after
  `git fetch` so its timestamp lands after every applied migration (another session added
  `20261028114031_uploader_alon_round_2.sql` today).
- **The new card points at the deal it sits beside:** it is opened with `leads.related_lead_id` = the open card of
  the tour it did not join (the newest one), so it wears the existing "↔ #<case>" chip - which TODAY and LEADS now print
  in the Card cell too (until now only the ALL table did) - and the rep does not call about the waiting list blind to
  an offer that is out.
- **Afterwards, the deal card wins (Dor 28.10).** While the customer has another open card of the same tour, a
  waiting-list card is passed over by everything that is not itself a waiting-list form. A **waiting-list card** = a
  card opened by a `waitlist` / `notify` form that is still at `new`; once a rep moves its status it is a deal like any
  other (my call):
  - a later site form of that tour (`leads_fill`, `routeInquiry`) joins the newest open card of the tour that is NOT a
    waiting-list card - so the deal card is the one that turns "returned" and gets today's follow-up; only when every
    open card of the tour is a waiting-list card does the form join the newest of them;
  - a site booking matched by phone / e-mail (`tours.booking_create`, no link token) prefers, among the cards it may
    take, one that is not a waiting-list card, before the existing order (a card with a tour first, then the newest).
    `booking_create` is re-created in the same migration from its latest definition (`20261019180000_tours_customers.sql`)
    with only that ordering added. A booking through a link token is unchanged (the token names its card).
  - a waiting-list form still follows the rule above (joins a `new` card, else a new card).
  Selftest: a `lead` form with an `offer_sent` card and a newer waiting-list card of the tour joins the `offer_sent`
  card; with only waiting-list cards open it joins the newest of them.
- **No backfill:** waiting-list inquiries already folded into a card stay there (they are listed in its inquiries).
- Selftest cases in `scripts/tours-cases-selftest.ts`: a waitlist onto a `new` card joins; onto a `no_answer` /
  `offer_sent` / `paid`-ahead card opens new; two cards of the tour, the older `new` and the newer `offer_sent` -> joins
  the `new` one; a `lead` form onto an `offer_sent` card still joins (unchanged).

## Out of scope (notes 4-6)

- **WhatsApp API** - built and on prod since 22.10; waiting for Tom's Meta steps and three secrets
  (`NEXT_SECRET_WHATSAPP_APP_SECRET`, `NEXT_SECRET_WHATSAPP_CONFIG_ID`, `NEXT_SECRET_WHATSAPP_TOKEN`). No code.
- **Mails** - waiting for Dor to verify `megafamily.co.il` in ZeptoMail; then its own round (company mailbox, the rep
  in CC, templates, a "sent" stamp).
- **Card clearing** - the site charges through CreditGuard; the backoffice has no CreditGuard connection. A payment
  link / phone charge from the card is a separate design, started on its own.

## Constraints

- RTL Hebrew data inside an English-labelled admin (as the rest of the board). shadcn/ui + Tailwind, no new UI
  library (`@tanstack/react-table` faceting is available).
- Local `next dev` cannot sign in with the prod password and there is no local database - the UI is checked by
  `tsc --noEmit`, the selftests and the build, then on prod. On prod, row editors write REAL cards: a check there
  opens editors and cancels, or uses a card Dor names.
- `/guide` (tours section) and the CLAUDE.md tours paragraph are updated in the same change.
- Other sessions work in this checkout: commit by explicit path only.

## Calls I made (Dor to check)

- `notify` ("tell me when tours open") follows the same rule as `waitlist` - it is the same kind of form (a
  `potential` lead about a tour), and Alon's case would repeat with it.
- The "Link" column on TODAY and LEADS only; on RESERVATIONS (an order already exists) the booking link stays in "⋯".
- The funnel button beside the double-click.
- No filters on ALL this round.
- Live filters (an edited row that stops matching leaves the list, with a toast), not Excel's keep-until-reapplied.
- The new waiting-list card carries `related_lead_id` to the open card beside it, and TODAY / LEADS print its
  "↔ #" chip.
- No editors on a "to file" row (an inquiry with no tour is filed first, as today).
- "Waiting-list card" (the one later forms and bookings pass over) = opened by a waitlist / notify form AND still at
  `new`; once a rep moves it, it counts as a deal.

## Left to the builder

The tint mechanism, the popover layout and widths, the offer-state wording in the Link cell, the filter popover
layout, the empty-value label wording, and the order of the new columns.

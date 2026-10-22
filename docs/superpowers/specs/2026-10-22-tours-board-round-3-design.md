# Tours board: Alon's round 3 - paid cards, a sales-agent role, shortcuts in place (2026-10-22)

Source: Alon's feedback on the 21.10 deploy of the TODAY board (relayed 22.10), three notes. Dor answered four
questions on 22.10 ("1א 2א 3א 4א"); his answers are the decisions below. Builds on
`2026-10-21-tours-board-round-design.md` (TODAY in the rep's own order, who sees what, folded cards with three
shortcuts) and `2026-10-19-tours-customer-cards-design.md` (customers + deal cards). Nothing of those changes.

## Intent

Three things Alon saw on the first days with the new board:

1. A card that was PAID still came back to TODAY on an old follow-up day. Paid = done, unless the rep set
   themself a day to come back on something else. A DEPOSIT is the opposite: the balance is still owed, so a
   follow-up day is mandatory.
2. The reps were given the `editor` role, so the whole sidebar is theirs. A rep needs three screens - Dashboard,
   Reservations, Tasks - and the ability to take an unassigned lead or order for themself.
3. ACC NUM belongs to the deal, not the person (a customer has one per order). And the three shortcuts on a
   folded card (Booking link / Notes / Follow-up) should WORK from the outside, not open the card - and the same
   three should be reachable on a TODAY row.

## Decisions (Dor, 22.10)

### 1. Paid drops the follow-up; a deposit needs one

- **Paid clears the day.** When a card's status becomes `paid` - by the rep (`updateCase`, the TODAY "Confirm →
  שולם" button, the bulk bar) or by a booking staff moved `review → paid` (the trigger
  `tours.bookings_status_to_case`) - `leads.follow_up_date` is set to null. A site card payment never sets `paid`
  (the card stays `pending_payment` for the rep to confirm), so that path is untouched.
- **A day the rep sets AFTER that is theirs** and counts: `todayReason` keeps reading a `paid` card's follow-up
  day as "late" / "today" (unchanged) - what changes is that nothing stale survives the transition. A status
  change that carries a follow-up day in the same request keeps that day (the rep chose it with the status).
- **A deposit asks for the day.** Moving a card to `deposit_paid` opens a dialog (the `future` pattern: tour +
  season) with ONE field, the follow-up day, prefilled with the suggestion and three quick picks (tomorrow / a
  week / the suggestion); without a day the status is not saved - server-enforced: `deposit_paid` with no day in
  the request and no stored day of today or later answers "Pick the day to follow up on the balance."; a day in
  the past is refused. **Suggestion** = 30 days before the card's departure, never before today; a card with
  no departure date = a week from today. In bulk `deposit_paid` is refused like `future` ("names a follow-up
  day - set it on each card").
- **One-time backfill** (my call, said to Dor): the migration clears `follow_up_date` on every `paid` card whose
  day is already past (Israel calendar) - those are the stale rows Alon saw. A future day on a paid card stays
  (it may be the rep's own).

### 2. The sales-agent role = `tours_agent`, widened

- **No new role.** `tours_agent` (01.10: a read-only viewer of the departures board) becomes the sales agent of a
  tours company. Its label is "Sales agent" / "נציג מכירות" everywhere a label prints (sidebar, /users). Both role
  CHECKs (`user_profiles.role`, `company_members.role`, migration `20261001100600`) already list the value - **no
  migration for the role.**
- **Menu = three screens:** Dashboard (`/tours`), Reservations (`/tours/reservations`, and the customer pages
  `/tours/customers/*` + `/tours/reservations/*` it opens), Tasks (`/tasks`). The departures board
  (`/tours/departures`) stays REACHABLE read-only (the dashboard's "Departures" card links to it; the role's
  existing screen keeps working) but is not in the menu. Everything else redirects home (`/tours`), as middleware
  does today for the role. The Guide stays hidden for the role (as today).
- **Admitted as a REP** (never a manager: `boardViewerOf` reads a `tours_agent` membership as a rep) in every
  action and page the three screens call (the `/tours` dashboard page itself included - its "Publish to site"
  button is hidden for the role): the whole of `tours-cases-actions.ts` EXCEPT `saveCaseStatuses` (the company's
  status list stays staff's; the "Statuses" button is hidden for the role), `tours-payments-actions.ts` (the
  payment log; `saveCancellationRules` stays staff), `updateBooking`, `createToursReservation` / the two reads the
  case page and the New dialog use, `tours-dashboard-actions.ts`, the WhatsApp thread actions, and the tasks
  board (`requireTaskBoard`, the task people list for a tours company). A new guard, `requireCompanyRep(product)`
  in `lib/company.ts`: staff pass exactly as `requireCompany` does; a `tours_agent` passes when the active company
  (its own memberships only) sells the product. `requireCompany()` is unchanged and keeps refusing the role
  everywhere else (tours editor, flights, site, settings, approvals, users).
- **Tasks and cases - a person of the company:** `taskPeopleOf` (the one people list: task assignee / reviewer /
  @mention pickers AND `repsOf`, the reps a card can be given to) reads staff roles only; it must read
  `tours_agent` too, and `pickTaskPeople` keeps such a profile for a company other than Mega Events when it is a
  member - without this "Take it" fails with "A case can be assigned only to a member of the company's staff". On
  the board a `tours_agent` edits like an editor (`lib/tasks/permissions.ts` reads "not a manager" - no change).
  Never on the Mega Events board (`listCompaniesFor` gives the role tours companies only).
- **"Take it":** an UNASSIGNED card shows a "Take it" button - on a TODAY row and a LEADS row (the actions
  column), on a folded card of the customer page and in the actions menu. One click, no confirmation, for a rep and
  a manager alike: `updateCase(id, { assignedTo: me })`. A rep can never take another rep's card: it is not on
  their lists, and the viewer gate refuses the id. Handing a card BACK (rep → nobody) stays what it is: the Rep
  select on the open card.
- **Dor's part after the deploy:** on /users (company Mega Family) move each rep from `editor` to "Sales agent"
  (a superadmin's action - the account's role changes with the membership); the managers stay / become `admin`
  (21.10 checklist).

### 3. ACC NUM on the card; shortcuts that act in place; the same actions on a TODAY row

- **ACC NUM is the card's** (`leads.acc_num`, which exists). The customer header loses its ACC NUM field;
  `updateCustomer` stops copying it to every card and `createCase` stops seeding it from the customer;
  `customers.acc_num` stays as a column nobody writes. It is edited on the folded card (a small inline box beside
  Follow-up, saved on blur like the header fields) and on the open card (the "ACC NUM" field it already has), and
  printed on the RESERVATIONS tab (a column, searchable - `caseMatches` already reads it). National id stays on
  the customer.
- **Shortcuts act in place** (customer page, folded card):
  - **Notes** opens a popover with the notes text (textarea, 4000 chars, the same `updateCase({ notes })`);
    Save / Cancel. The card's note line updates.
  - **Booking link** opens a popover with the offer as it stands: the summary (tour · date · rooms · price ·
    follow-up · sent on … / not sent yet), the SEND buttons (WhatsApp app / e-mail / WhatsApp Web / copy -
    the same rule: a click on WhatsApp or e-mail records it sent), "Send again", "Withdraw" (confirm). "Edit and
    resend" and - with no offer - "Build an offer" are the one thing that opens the card, at its Booking link
    section (the builder needs the date picker and the quote). The pieces are `booking-link-card.tsx`'s own
    `OfferSummary` / `SendButtons` (plain functions today - this round exports them) - never a second
    implementation.
  - **Follow-up** stays the inline date box (already in place).
  - **Take it** when unassigned (above).
- **The same on a TODAY row and a LEADS row:** TODAY's actions column gets a "⋯" menu; LEADS gets a NEW actions
  column (Take it + the menu only) - Notes, Booking link,
  Follow-up (+ Take it when unassigned). Each item opens the same body in a dialog (a table row cannot host a
  popover from a menu); Follow-up's dialog is the date box with the quick picks (tomorrow / 2 days / a week).
  "Edit and resend" / "Build an offer" navigate to the card (`/tours/reservations/<id>?focus=link`), and the
  customer page opens that card at that section. The row is patched in place from the action's answer (`afterSave`
  - a sent offer turns the status "הצעה נשלחה" on the row at once). The existing row buttons (WhatsApp, mail,
  "No answer", "Confirm → שולם", "Check the booking", "File it") stay.

## Data

- `leads.follow_up_date`, `leads.acc_num`, `leads.assigned_to` - all exist. No new column.
- Migration `tours_board_round_3` (idempotent): (1) the one-time backfill of stale days on paid cards;
  (2) `tours.bookings_status_to_case` re-created with `follow_up_date = null` when it moves a card to `paid`
  that is NOT already `paid` (a second booking confirmed on a paid card must not wipe the day the rep set);
  `create or replace`, the whole function as in `20261019180000` plus that one line; (3) a one-time copy of
  `customers.acc_num` onto that customer's cards whose `acc_num` is null (my call - a number typed on the
  header before this round was the deal's; a card born later from a site form never inherited it and would lose
  it from view; staff clear a wrong one on the card).
- `customers.acc_num` stays a column: the backoffice UI no longer writes it; `leads_fill` still seeds it from a
  lead's own `acc_num` when it makes the customer and a merge coalesces it - harmless, nothing on screen reads it.

## Rules - pure, in `lib/tours/cases.ts`, tested in `scripts/tours-cases-selftest.ts`

- `followUpAfterStatus({ from, to, requested, stored, today })` → `{ ok: true, followUpDate }` (undefined =
  untouched, null = cleared, a day = written) or `{ ok: false, error }`:
  - `to === "paid"` and no day in the request → `null`; a day in the request → that day.
  - `to === "deposit_paid"` → the request's day, else the stored day when it is today or later, else an error;
    a requested day before today → an error.
  - anything else → the request's day as sent (the validation of its shape stays where it is).
- `suggestDepositFollowUp(departureDate, today)`: `max(today, departure − DEPOSIT_FOLLOW_UP_DAYS_BEFORE (30))`,
  or `today + DEPOSIT_FOLLOW_UP_DEFAULT_DAYS (7)` with no departure (or a departure already past → the same
  week-ahead default).
- `bulkStatusBlocker(key)`: `"future"` and `"deposit_paid"` name a per-card value → the message the bulk bar
  shows; else null.
- `canTakeCard(card)`: `assignedTo === null` (a manager or a rep alike; the server's viewer gate does the rest).
- `todayReason` is unchanged (a paid card with a day the rep set is "today" / "late" on that day).

## Guards (`lib/company.ts`, `lib/auth/tours-agent.ts`, `lib/nav.ts`)

- `requireCompanyRep(productType?)`: `session.role === tours_agent` → `getActiveCompany(session)` (throws
  `COMPANY_UNASSIGNED_ERROR` with no membership), the product check, `{ session, company }`; anyone else →
  `requireCompany(productType)`.
- `lib/auth/tours-agent.ts`: `TOURS_AGENT_HOME = "/tours"`; `TOURS_AGENT_MENU = ["/tours", "/tours/reservations",
  "/tasks"]` (exact hrefs the sidebar / palette show); the allowed roots = the menu's three + `/tours/customers`
  + `/tours/departures` - `/tours` itself matches EXACTLY (a prefix would open the whole tours area). `visibleGroups`
  filters by the menu list; middleware and the topbar keep `isToursAgentPath`.
- `task-people.ts` `pickTaskPeople`: a `tours_agent` profile counts for a company other than Mega Events when it is
  a member; never for Mega Events. `requireTaskBoard` takes `requireCompanyRep()`.

## Screens

- `case-ui.tsx`: `DepositDialog` (one date field, suggestion + quick picks); `StatusSelect` asks it for
  `deposit_paid` and hands the day back as a fourth argument of `onChange`; callers (case page ×2, ALL tab) pass
  it into `updateCase` as `followUpDate`.
- New `components/tours/cases/card-quick-actions.tsx`: `NotesEditor`, `OfferPanel` (wraps the exported
  `OfferSummary` / `SendButtons`; "Edit and resend" / "Build an offer" call `onOpenCard`), `FollowUpPicker`,
  `TakeCardButton`, and two shells - `CardShortcutPopover` (customer page) and `CardActionsMenu` (a dropdown whose
  items open the same bodies in dialogs; `stopPropagation` on the dialog content so the row's click does not fire).
- `customer-page.tsx`: the ACC NUM header field goes; `CardRow`'s Booking link / Notes shortcuts open the popovers;
  an inline ACC box; "Take it" when unassigned; `?focus=link|notes` on the URL opens the wanted card at that section
  (the TODAY menu's way in).
- `board-screen.tsx`: TODAY and LEADS actions columns get `TakeCardButton` + `CardActionsMenu`; RESERVATIONS gets
  an "ACC" column; the "Statuses" header button is hidden for a `tours_agent`.
- `app/(dashboard)/tours/page.tsx` takes the new guard; `tours-dashboard.tsx`: for a `tours_agent` the "Tours on
  Sale" and "Seats Left" cards carry no link (their screens redirect it home) and "Publish to site" is not drawn;
  `NeedsAttention` is already the manager's.
- `/users`: the picker shows "Sales agent" (`ROLE_LABELS`); nothing else changes.

## Guide + CLAUDE.md

- `guide-content-tours.ts`: Reservations section - paid drops the follow-up, a deposit asks for one, "Take it", the
  shortcuts and the row menu, ACC NUM on the card; Users section - "Sales agent" replaces "Tours agent" and names
  its three screens; Tasks section - a sales agent works their own tasks like an editor.
- CLAUDE.md tours block: a paragraph "Alon's round 3 (22.10)" after the TODAY round's, naming the rules, the guard,
  the role, the migration and Dor's /users step.

## Not this round (told to Dor)

- A manager taking a card FOR someone (the Rep select / bulk assign do it); a "Hand back" button.
- A sales agent on the Mega Events board, the Guide, or any screen beyond the three + the read-only departures board.
- Building an offer from the popover (the builder stays on the card).
- ACC NUM per booking (`tours.bookings`) - per card was Dor's pick; a card with two orders carries one number.

## Builder check (22.10) - what it asked and how it was settled

- Reps who work in MORE than one company keep the account role `editor` (`updateUser` changes the account role
  only for a member of this company alone) and so the full sidebar - the system's existing rule; Mega Family's
  reps are its own. Said to Dor in the report, not built around.
- Accounts that hold `tours_agent` today (read-only viewers) become reps on the deploy - that IS the decision.
  A role change ends the person's live session (they sign in again) - in Dor's /users step.
- `customers.acc_num` typed before this round → copied onto the cards (Data, my call).
- The trigger clears the day only when the card was not already `paid` (Data).
- `taskPeopleOf`'s query is the real gate of the people list, not `pickTaskPeople` alone (Decisions 2).
- LEADS has no actions column today - it gets one; the dashboard PAGE guard and its publish button; the two
  booking-link pieces are exported by this round (Screens).

## Left to the builder

- The exact look of the popovers / dialogs (shadcn `Popover`, `Dialog`, `DropdownMenu`, `Textarea`); the quick-pick
  labels; where the inline ACC box sits on the folded card.
- Whether `exportCases` admits the role (it already exports the viewer's cards only) - admit it, so the ALL tab's
  Export never errors for a rep.
- The wording of the deposit dialog and of the "Take it" toast.

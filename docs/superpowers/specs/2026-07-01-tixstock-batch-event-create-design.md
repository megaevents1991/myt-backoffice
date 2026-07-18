# Multi-Select Batch Event Creation from TixStock Events

**Date:** 2026-07-01
**Status:** Implemented — see Revision note (pivoted to Approach C)
**Area:** `app/(dashboard)/tixstock-events/` (backoffice)

## Revision (2026-07-01) — FINAL: Approach D — batch mode on the real create page

The sections below describe two superseded designs (Approach B: in-page tabbed
overlay; a brief Approach C: N real browser tabs). Both were dropped:

- Approach B (lean overlay) duplicated the form and omitted the ticket UI.
- Approach C (real tabs) was popup-blocked (only one tab opened) **and** made the
  admin repeat the expensive ticket-adding step once per tab — the opposite of the
  goal.

**What actually shipped — Approach D as a stepwise review wizard:** the shared
"form" IS the real create page, run in **batch mode** as a per-event wizard. You
configure/review each event on the real form; **Save & Next** creates the current
one and loads the next with the shared config carried over. This adds the mandatory
**per-event confirmation** (not all fields are the same — venue/prices/tickets differ).

Flow:
1. TixStock page: multi-select (scoped to one performer) → sticky "Create N events".
2. Click stashes the selected `TixStockEventDB[]` in `localStorage["tx_batch_create"]`
   and opens `/events/new?batch=1` (a single `window.open` — not popup-blocked).
3. The create page detects `batch=1`, reads the list, and pre-fills from event 1
   (`tixstockToEvent(list[batchIndex])`), so its Source Tickets load via
   `txEventId = list[batchIndex].event_id`. A banner shows "reviewing event X of N"
   with the list (done / now / pending).
4. Admin configures event 1 fully (this sets the shared baseline) incl. adding ticket
   **categories** from the Source list, then reviews.
5. **Save & Next** (`handleBatchStepSave`): `createEvent(current)`, then
   `loadBatchEvent(next)` which carries the current (shared) form forward but swaps
   the per-event identity (name/name_english/date/def_dates/location/map_image_url via
   `tixstockToEvent(nextEv)`) and **re-prices the carried ticket categories** from the
   next event's own live listings. Admin reviews the pre-filled next event and can
   tweak anything before saving it. Repeat until the last, which is **Save & Finish**.
   - **Per-event live ticket prices** (`repriceCategoryForEvent`): per category, fetch
     that event's `getTixStockTickets(event_id)`, cheapest eligible (qty ≥ 2), same
     currency markup → USD (GBP +35, EUR +40, ILS +150, else +40), round, stamp
     `eid = event_id`. Falls back to the carried price if the category is absent.
   - **Skip this event** (`handleBatchSkip`): advance without creating.
   - Offline flight/hotel staging is not applied in batch mode (per-event inventory).
6. On finish/skip-past-last: clears the localStorage key, toasts, redirects to `/events`.
   A per-event create failure toasts and does not advance (admin can retry that event).

Files after this revision:
- **`tixstock-to-event.ts`** — kept (`tixstockToEvent`, `calculateSmartDates`). The
  `mergeShared`/`SharedDraft` helpers were removed (only used by the dropped shared form).
- **Modified `events/[id]/page.tsx`** — additive batch branch: `batchIndex` state,
  batch load + representative prefill, `tixStockEventId` follows the step, banner,
  `repriceCategoryForEvent` + `loadBatchEvent` + `handleBatchStepSave` + `handleBatchSkip`,
  `handleSubmit` batch branch, step-aware Save/Skip buttons.
- **Modified `tixstock-events-content.tsx`** — selection + `openBatchCreate` launcher.
- **Deleted:** `batch-create-overlay.tsx`, `batch-shared-form.tsx`, `batch-event-fields.tsx`.

Consequences: full real-flow parity with **zero** form duplication; ticket categories
are entered once and re-priced live per event; **every event is reviewed before it is
created.** Trade-off: creation is sequential (one event saved per step), not a single
bulk insert.

## Problem

Admin creates events one at a time. When the same artist / football team plays
several dates, that means opening the create form N times and re-typing the same
shared values (type, description, artwork, tags, markup policy) on every one.

We want: select multiple TixStock events (same artist/team), fill the shared
values **once**, then open all N events in tabs, each pre-filled, and finish only
the per-event differences before saving each.

## User Flow

```
tixstock-events page
  pick performer (existing hierarchical filter)
     -> events list shows that artist/team's events
  NEW: checkbox on each event card
  select 3 -> sticky bar: "3 selected  [Create 3 events]"
        |
        v
SHARED FORM (dialog) -- fill once, applies to all
  every shareable field, all optional, empty-start
  [Continue ->]
        |
        v
BATCH TABS (full-screen overlay, no page navigation)
  [Event 1 *][Event 2][Event 3]
  each tab pre-filled: shared values (filled ones) + that event's TixStock data
  admin fills per-event differences (prices, tweaks)
  [Save this event] -> green check, calls createEvent()
  close when done (confirm if unsaved tabs remain)
```

No page navigation. The overlay opens on the tixstock page; selected events and
shared values live in React state — nothing serialized to URL or sessionStorage.

## Core Mechanism — "blank = per-event, filled = forced on all"

The shared form exposes **every shareable field** (not a fixed shared subset).
The admin decides what is shared for *this* batch by what they type. Merge rule,
evaluated per field, per tab:

```
tab.field =
   shared.field                      if the admin filled it in the shared form   (wins)
   else the TixStock value for THAT event   (name / date / venue / coords / map / tickets)
   else empty
-- and the admin can still override any field inside the tab before saving
```

"Filled" = key present and non-empty in the shared partial. The shared form emits
`shared: Partial<Event>` containing only filled keys, so blank fields never
overwrite a per-event TixStock value.

### Fixed exceptions (never in the shared form — inherently per-event)

- `tickets_and_rates` — each TixStock event has its own tickets; per-tab only,
  sourced from that event.
- Offline flight/hotel **link panels** (link an existing offline flight/hotel to
  the event) — linking one specific flight to all N events is meaningless. Not in
  the shared form and not in the tabs; done later via normal event edit if ever.
  Note: flight/hotel **base price + Search buttons** ARE included and shareable —
  only the link-existing-inventory panels are dropped.

## Field Inventory

Everything below is available in **both** the shared form and each tab (same
field component). Per-event defaults come from the existing TixStock mapping
(`handleCreateEventFromTixStock` in `tixstock-events-content.tsx`).

| Field | Type | Per-event TixStock default |
|---|---|---|
| `name` | string | `event_name` |
| `name_english` | string | `event_name` |
| `type` | EventType | `tx_event` |
| `description` | string | `"{event_name} at {venue_name}"` |
| `date` | ISO date | `show_date` |
| `def_date_depart` / `def_date_return` | ISO date | auto via `calculateSmartDates(date)` |
| `location.{name,city_iata,latitude,longitude,country_code}` | object | `venue_name`, `venue_data.latitude/longitude` (city_iata blank — admin fills) |
| `map_image_url` | string | `venue_map_url` |
| `card_image_url` / `art_image_url` | string | empty |
| `usual_price` | number | 0 |
| `base_flight_price` | number (+ Search Flights) | 0 |
| `base_hotel_price` | number (+ Search Hotels) | 0 |
| `is_prioritized` | boolean | false |
| `skip_flight` (+ `skip_flight_markup`) | boolean / number\|null | false / null |
| `event_additional_markup` | number \| null | null |
| `tags` | string | empty |
| `tx_excluded_sections` | string[] | empty |
| `tickets_and_rates` | EventTicket[] | that event's TixStock tickets (per-tab only) |

`is_deleted` is forced to `null` by `createEvent`; not shown.

## Architecture — Approach B (lean batch form, in-page tabs)

Chosen over: (A) extract the full ~1300-line `events/[id]/page.tsx` form and render
N heavy instances — big refactor, real regression risk on the live new/edit page;
(C) open N real browser tabs at `/events/new` — the messy multi-window UX we
rejected. B contains blast radius and keeps flight/hotel price parity.

**Reuse insight:** the shared form and every tab render the *same* field
component, so they stay in parity by construction. One field set, two uses:
empty-start to collect `shared`, merged-init to save an event.

### New files — `app/(dashboard)/tixstock-events/batch/`

| File | Role |
|---|---|
| `batch-event-fields.tsx` | Presentational lean field set (all shareable fields + flight/hotel Search buttons). Controlled via `value` / `onChange`. Reused by shared form and each tab. |
| `batch-shared-form.tsx` | Dialog wrapping the field set, empty-start. `Continue` emits `shared: Partial<Event>` (only filled keys). |
| `batch-create-overlay.tsx` | Full-screen Radix Tabs container. Holds per-tab form state + per-tab save status. One tab per selected event. Per-tab `Save` calls `createEvent()`. |
| `tixstock-to-event.ts` | Maps `TixStockEventDB` -> `Partial<Event>`. Extracted from the existing `handleCreateEventFromTixStock` mapping + `calculateSmartDates` so single- and batch-create share one mapping. |

### Modified file

- `app/(dashboard)/tixstock-events/tixstock-events-content.tsx`
  - Add `selectedEventIds: Set<string>` selection state (scoped to the currently
    performer-filtered events list — this is what enforces "same artist/team").
  - Add a checkbox to each event card.
  - Add a sticky bar: selection count + `Create N events`.
  - Mount `batch-shared-form` -> `batch-create-overlay`.
  - Refactor the existing single-create to call the shared `tixstock-to-event.ts`
    mapping (no behavior change).

### Reused, unchanged

- `createEvent(event: Omit<Event,"id">)` in `lib/actions/event-actions.ts` — one
  call per tab. **No new bulk server action.**
- Existing pickers (`ImageFilePicker`, `ArtBlobPicker`), tag select, and the
  flight/hotel search endpoints the current form uses.

## Data Flow

```
selectedEvents: TixStockEventDB[]   +   shared: Partial<Event>
  -> per event: init = { ...tixstockToEvent(ev), ...definedKeys(shared) }   // shared wins
  -> each tab holds isolated local form state
  -> Save tab: validate required -> createEvent(init) -> status 'saved' (lock tab, green check)
```

Each save carries the same `tx_event` linkage the current single-create uses
(TixStock event id + `tickets_and_rates` + `tx_excluded_sections`). Exact
columns confirmed during planning against the single-create path.

## State

- All in-memory on the tixstock page / overlay (React `useState` / `useReducer`).
  No URL params, no sessionStorage.
- `saveStatus: Record<eventId, 'idle' | 'saving' | 'saved' | 'error'>` drives tab
  badges (check / spinner / error).
- A saved tab locks (read-only) to prevent double-insert.

## Error Handling

- **Shared form:** nothing required — blank simply means "not shared."
- **Tab save:** validate the same required fields the single form enforces
  (`name`, `name_english`, `date`, `location` coords, `usual_price`,
  `base_flight_price`, `base_hotel_price`). On failure: block, inline errors, tab
  stays open.
- **`createEvent` throws:** catch, toast on that tab, set status `error`, allow
  retry. Other tabs are unaffected (independent inserts).
- **Close overlay with unsaved tabs:** confirm dialog — "N events not saved,
  discard?".

## Cross-Project Impact

**None.** No DB schema change, no shared-type change (`types/app.types.ts`
untouched), no price-chain change — same `createEvent`, same fields, same
per-currency markups. The main app (`../myt-main`) is unaffected.

## Out of Scope (YAGNI)

- Linking existing offline flights/hotels at batch-create time (do it later via
  edit).
- Save-all / all-or-nothing commit (explicitly chose per-tab save).
- A middle "review table" screen.
- A name-template generator (each tab pre-fills `name` from TixStock `event_name`).
- Batch create from any source other than TixStock.

## Testing

No automated test suite in the repo. Verification:
- `npx tsc --noEmit` type gate (build ignores TS errors, so this is the real gate).
- Manual QA: select 3 events for one performer -> fill a few shared fields ->
  confirm each tab merges shared + TixStock correctly -> save one, error one
  (force a failure), leave one unsaved -> confirm independent behavior and the
  unsaved-close confirm.

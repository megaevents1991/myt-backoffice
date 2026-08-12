# Offline Flights Expansion - Design

**Date:** 2026-07-28
**Repos:** `myt-backoffice` (owner) + `myt-main` (consumer)
**Status:** approved, ready for implementation planning

---

## Problem

The offline-flights feature is live with three capabilities: upload a flight, link it
to events, and auto-decrement inventory when a reservation consumes it. Seven gaps
remain, spanning inventory semantics, bulk authoring, and ticketing operations.

| #   | Gap                                                                      | Touches main app                |
| --- | ------------------------------------------------------------------------ | ------------------------------- |
| 1   | Create a whole series of flights at once                                 | no                              |
| 2   | Edit every field from the list view + multi-edit one field across rows   | no                              |
| 3   | Allocate seats per package (e.g. 10 to Ariana, 10 to the organized trip) | **yes**                         |
| 4   | Table shows ORG / TAKEN / AVAILABLE                                      | **yes** (per-event enforcement) |
| 5   | Add the fields that exist in the operations Excel                        | **yes** (bag kg, stops)         |
| 6   | Export an Excel per airline for ticketing                                | no                              |
| 7   | LOCKFLIGHT - a package locked to one offline flight, no online search    | **yes**                         |

## Current state (as built)

- `flights` table: one row per round-trip, global `initial_quantity` /
  `consumed_quantity`, `event_ids integer[]` linking to events.
- `lib/actions/offline-flight-actions.ts` - CRUD + event linking. Pushes
  `base_flight_price` and `def_date_depart` / `def_date_return` onto linked events.
- Main app `app/api/flights/search/route.ts` merges offline flights with Amadeus
  results. `transformDbFlightToFlight` returns `null` when
  `initial_quantity - consumed_quantity < num_of_travelers`, hiding the flight.
- Main app `app/api/confirm-order/route.ts` (`holdOfflineInventory`) increments
  `flights.consumed_quantity` after a booking.
- `lib/actions/reservation-actions.ts` `reconcileFlightInventory` recomputes
  `consumed_quantity` from active reservations on every flight page view - the
  counter is known to drift.
- Released statuses (reservation no longer holds inventory): `Cancelled`, `Lost`.
- `db.schema.sql` constraint `flights_stops_check` forces `stops = 0` - connecting
  flights cannot be stored at all today.

---

## Part 1 - Data model

### 1.1 New table `flight_event_allocations`

```sql
create table flight_event_allocations (
  id              bigint generated always as identity primary key,
  flight_id       bigint not null references flights(id) on delete cascade,
  event_id        bigint not null references events(id) on delete cascade,
  allocated_seats integer not null check (allocated_seats >= 0),
  created_at      timestamptz not null default now(),
  unique (flight_id, event_id)
);
create index on flight_event_allocations (event_id);
```

### 1.2 Consumed seats are derived, never stored

There is deliberately **no `consumed_seats` column**. `flights.consumed_quantity`
already drifts (hence `reconcileFlightInventory`); a second per-event counter would
be a second source of drift, updated from a different repo. Instead, a view:

```sql
create view flight_event_consumed as
select offline_flight_id as flight_id,
       event_id,
       sum(coalesce((flight_order_info->>'numOfTravelers')::int, 0)) as consumed_seats
from reservations
where offline_flight_id is not null
  and status not in ('Cancelled','Lost')
group by 1, 2;
```

The status filter mirrors `ACTIVE_RESERVATION_STATUSES_FILTER` in
`lib/actions/reservation-actions.ts`. `numOfTravelers` is read the same way
`reconcileFlightInventory` reads it. The migration grants `select` on the view to the
roles both apps connect with, since the main app reads it during flight search.

**Consequence: `confirm-order` in the main app needs no change at all.** The purchase
path keeps updating only the global counter. Zero risk introduced on the money path.

### 1.3 ORG / TAKEN / AVAILABLE semantics

| Level                | ORG                        | TAKEN                                  | AVAILABLE   |
| -------------------- | -------------------------- | -------------------------------------- | ----------- |
| Flight (main row)    | `flights.initial_quantity` | `flights.consumed_quantity`            | ORG − TAKEN |
| Event (expanded row) | `allocated_seats`          | `flight_event_consumed.consumed_seats` | ORG − TAKEN |

- **Unallocated pool** = `initial_quantity − sum(allocated_seats)`, rendered as its
  own "unallocated" row inside the expansion.
- Server actions reject any write where `sum(allocated_seats) > initial_quantity`,
  and any write that lowers an event's `allocated_seats` below the seats that event
  has already consumed.
- **An event with no allocation row falls back to the global pool** - exactly
  today's behaviour. No backfill migration. Existing flight↔event links keep working
  untouched; hard-cap enforcement applies only where an allocation row exists.
- Hard cap (approved): when an allocation is exhausted the flight disappears for
  that event, even if unallocated seats remain on the flight.

### 1.4 New columns on `flights`

All nullable - existing rows are unaffected.

| Group      | Columns                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Supplier   | `cost_price numeric(10,2)`, `cost_currency varchar(3)`, `supplier text`, `pnr text`, `group_code text`                                     |
| Deadlines  | `ticketing_deadline date`, `last_cancellation_date date`, `payment_deadline date`, `option_expiry date`                                    |
| Operations | `checked_bag_kg integer`, `cabin_bag_kg integer`, `cabin_class text`, `aircraft_type text`, `block_status text`                            |
| Misc       | `notes text`, `handled_by text`                                                                                                            |
| Series     | `series_id uuid`, `series_name text`                                                                                                       |
| Stopover   | `outbound_stop_airport varchar(3)`, `outbound_stop_duration interval`, `inbound_stop_airport varchar(3)`, `inbound_stop_duration interval` |

`block_status` is a text column with a check constraint allowing `option`,
`confirmed`, `ticketed` or `null`. No database default - existing rows stay `null`;
the new-flight form preselects `confirmed`.

`series_id` is generated in `createOfflineFlightSeries` with `crypto.randomUUID()`,
one value shared by every flight in the batch.

**Drop `flights_stops_check`.** Stopover support is meaningless while the constraint
forces `stops = 0`. `stops` becomes a plain non-negative integer.

Existing `price` stays the **selling** price. `cost_price` is what we pay the
supplier - the two together give per-flight margin. `cost_price` is never part of the
customer price chain and never leaves the backoffice.

### 1.5 `events.locked_flight_id`

```sql
alter table events add column locked_flight_id bigint references flights(id);
```

Semantics (all approved):

- Set → the main app skips Amadeus entirely for that event and offers only this flight.
- `skip_flight` still applies: the customer may still choose "no flight".
- Sold out → main returns no flight options plus a `lockedSoldOut` flag; the package
  renders as sold out. **No fallback to Amadeus** - a fallback would silently change
  the price and defeat the point of locking.
- On lock, `def_date_depart` / `def_date_return` are forced to the flight's dates.
- Locking the hotel too is explicitly **out of scope** for this spec.

### 1.6 Passenger identity fields

Each element of the existing `reservations.more_pax_info` JSON array gains optional
`passport_number`, `passport_expiry`, `date_of_birth`, `gender`, `nationality`.
The main app keeps writing only `first_name` / `last_name` at checkout and is
unaffected; staff complete the rest in the backoffice. The same fields are captured
for the main contact.

---

## Part 2 - Backoffice implementation

### 2.1 Shared editable flights table

`components/flights-editable-table.tsx` - one client component used in two places:
the `/offline-flights` list and the flights block inside
`app/(dashboard)/events/[id]/page.tsx` (~line 2569). That page is already 2,500+
lines; the block is replaced by a single component call rather than grown further.

- **Inline cell editing** - click a cell, it becomes an input/select; Enter or blur
  saves, Esc cancels. Optimistic update with rollback and a toast on failure.
- **Drawer** (shadcn `Sheet`) - clicking the row id opens every field of the detail
  screen without leaving the list.
- **Column picker** - ~15 new fields cannot all fit; visible columns persist in
  `localStorage`.
- **Expandable row** - per-event ORG/TAKEN/AVAILABLE, an input to change the
  allocation, and the unallocated remainder.
- **Bulk toolbar** on selected rows: set a uniform value, adjust price by ±amount or
  ±percent (percent results round to the nearest whole dollar), add/remove an event
  link, soft-delete/restore.
- **Filters**: airline, date range, event, series, `block_status`.

### 2.2 Server actions - `lib/actions/offline-flight-bulk-actions.ts`

A new file so the existing CRUD file stays focused.

`bulkUpdateOfflineFlights` · `bulkAdjustPrice` · `bulkSetEventLink` ·
`bulkSoftDelete` / `bulkRestore` · `createOfflineFlightSeries` ·
`getFlightAllocations` / `setFlightAllocation` / `removeFlightAllocation` ·
`lockEventFlight` / `unlockEventFlight`.

Every action maps columns explicitly against an allowlist - no spreading a client
object into an update. This also closes the mass-assignment issue `CLAUDE.md` flags
on `offline-flight-actions.ts`: bulk edit would otherwise multiply that exposure
across every selected row. `createOfflineFlight` and `updateOfflineFlight` are
converted to explicit mapping in the same pass.

All actions call `requireStaff()` and revalidate `/offline-flights` plus every
affected `/events/{id}`.

### 2.3 Series builder - `/offline-flights/series/new`

Four steps:

1. **Shared form** - every field except dates (reuses the field groups from
   `components/inline-flight-form.tsx`).
2. **Dates** - multi-select calendar of departure dates plus one "number of days"
   input; the return date of each flight is derived from it.
3. **Editable preview table** - one row per date. Times, price, quantity and flight
   numbers are editable per row; relevant events are suggested via the existing
   `getRelevantEventsForFlight` and pre-checked; rows can be removed.
4. **Create** - one action inserts every row with a shared `series_id` and
   `series_name`.

Times are entered once and concatenated onto each date. The columns are `timestamp
without time zone`, so this is pure string composition - no timezone or DST maths.

### 2.4 LOCKFLIGHT UI

In the event editor: a "locked package" toggle, then a picker limited to flights
already linked to this event. Saving writes `locked_flight_id`, forces the event's
default dates from the flight, and warns when the event has no allocation on that
flight. The event page shows a persistent banner while locked.

### 2.5 Excel exports

New dependency: `exceljs` (nothing comparable exists in the project today).

| Route                         | Content                                        |
| ----------------------------- | ---------------------------------------------- |
| `GET /api/exports/flights`    | Inventory report - one worksheet per airline   |
| `GET /api/exports/flight-pax` | Ticketing manifest - one worksheet per airline |

Both call `guardAdminRoute()`. Filters arrive as query params mirroring the table
filters, so "export what I'm looking at" and "export the selected rows" are the same
code path. The manifest builds on the existing `getReservationsForFlight` plus the
new passport fields. Trigger buttons live in the table toolbar and on the event page.

### 2.6 Passenger identity editor

The reservation detail page gains passport / date-of-birth / gender / nationality
inputs per passenger, written into `more_pax_info`.

---

## Part 3 - Main app changes (`myt-main`)

1. `app/api/flights/search/route.ts`
   - Read `flight_event_allocations` + `flight_event_consumed` for the event; apply
     the per-event hard cap in addition to the existing global check.
   - LOCKFLIGHT branch: when `event.locked_flight_id` is set, skip the Amadeus call
     entirely and return only that flight; return `lockedSoldOut` when its allocation
     is exhausted.
   - Map the new stopover columns into the `stops[]` array.
   - Pass `checked_bag_kg` / `cabin_bag_kg` through to the flight card.
2. `lib/app.types.ts` - add `Event.locked_flight_id`, the `more_pax_info` identity
   fields, and the bag-weight fields on `Flight`. Mirrors `types/app.types.ts`.
3. Flight-card / package UI - locked state and sold-out state.
4. `app/api/confirm-order/route.ts` - **unchanged.**

---

## Part 4 - Phasing, git, and deploy order

| Phase | Content                                                                                                             | Backoffice         | Main                             |
| ----- | ------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------- |
| **A** | New columns, series builder, editable table + bulk edit, exports, passport fields, flight-level ORG/TAKEN/AVAILABLE | commit to `master` | -                                |
| **B** | Allocations table + view, per-event ORG/TAKEN/AVAILABLE                                                             | commit to `master` | branch `feat/offline-flights-v2` |
| **C** | LOCKFLIGHT                                                                                                          | commit to `master` | same branch, second commit       |

Backoffice work goes straight to `master` (Dor's call). Main app work goes on one
branch, `feat/offline-flights-v2`, merged via PR.

**Deploy ordering matters:**

- Phase B is safe to ship backoffice-first - the main app ignores a table it does not
  query, so allocations simply have no effect until its branch merges.
- Phase C is **not**. If an event is locked in production before the main branch
  merges, the main app keeps showing Amadeus flights for it. Do not lock any event in
  production until the main PR is merged.

**Migrations** follow the repo workflow: `npm run db:new <name>` per phase, commit the
file with the feature, then apply via `npm run db:push` or the "Apply DB Migrations"
GitHub Action, then `npm run db:types`. Dor runs the migration workflow - the plan
will call out each point where a migration is ready to apply.

---

## Part 5 - Verification

The project has no test suite, so verification is explicit and manual:

- `npx tsc --noEmit` and `npm run build` in both repos (the build ignores TS errors,
  so `tsc` is the real gate).
- `/sync-types` after touching `types/app.types.ts`.
- Manual dev-server passes: create a series and confirm every row lands; inline edit
  and bulk edit a field; attempt an allocation exceeding `initial_quantity` and
  confirm it is rejected; exhaust an event allocation and confirm the flight
  disappears for that event but stays for another; lock an event and confirm the main
  app offers only that flight; download both exports and confirm one worksheet per
  airline with readable Hebrew.

## Out of scope

- Locking the hotel component of a package (`locked_hotel_id`).
- Collecting passport data from the customer at checkout.
- Multi-segment itineraries beyond a single stopover per leg.
- Backfilling allocations for existing flight↔event links.

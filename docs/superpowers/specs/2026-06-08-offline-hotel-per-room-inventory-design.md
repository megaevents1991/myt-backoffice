# Offline Hotel — Per-Room Inventory (Phase 1)

**Date:** 2026-06-08
**Project:** MYT-backoffice-app (sibling: ../myt---main)
**Status:** Approved design, ready for implementation plan

## Problem

Today one `offline_hotels` row = a batch of N identical rooms, tracked by
`num_rooms` / `consumed_rooms` counters. A real batch (e.g. 5 rooms in one
hotel) shares some attributes but differs per room: room type, price, meal
plan, cancellation policy, supplier. After a room is booked into a paid
reservation, an order number and accounting number (Acc No / "doket") must be
recorded against that specific room.

We need per-room detail in the DB + UI. The room↔reservation auto-link
(a specific room pulled into a paid reservation, hotel showing which order took
it) is **Phase 2** — Phase 1 builds the data structure, UI, and manual entry of
the post-booking fields.

## Decisions (locked)

| Topic | Decision |
|---|---|
| DB model | New child table `offline_hotel_rooms`; parent keeps shared fields |
| Scope | Phase 1: data + UI + manual order_no/acc_no/supplier. Auto-link = Phase 2 |
| Price → event | Push **cheapest available** (unbooked) room price, recomputed |
| Existing data | Backfill child rooms from batches; keep parent counters as derived mirror |
| Room entry UX | Template + per-room override |
| Post-book edit | Inline on the detail-page rooms table |

## Data Model

### New table: `offline_hotel_rooms`

```sql
create table offline_hotel_rooms (
  id                     bigint generated always as identity primary key,
  hotel_id               bigint not null references offline_hotels(id) on delete cascade,
  room_type              text not null,
  price                  numeric not null,          -- total per room for the stay (USD)
  meal_plan              text,
  last_cancellation_date date,
  supplier               text,
  is_booked              boolean not null default false,
  -- post-booking (manual in Phase 1, auto in Phase 2):
  order_no               text,                       -- supplier order number
  acc_no                 text,                       -- accounting number ("doket"), set after Paid
  reservation_id         bigint,                     -- reservation that took this room (manual Phase 1)
  notes                  text,
  created_at             timestamptz not null default now()
);
create index on offline_hotel_rooms (hotel_id);
```

`offline_hotel_rooms` is not in Supabase generated types — server actions cast
via `(supabase as any).from("offline_hotel_rooms")`, matching the existing
`offline_hotels` pattern.

### Parent `offline_hotels` — unchanged columns

Shared fields stay on the parent: `hotel_name, city, check_in, check_out, hid,
event_ids, flight_ids, guest_rating, guest_review_count, notes,
last_cancellation_date, is_deleted, created_at`.

`num_rooms` and `consumed_rooms` are **kept as a derived mirror**:
- `num_rooms = COUNT(rooms for hotel)`
- `consumed_rooms = COUNT(rooms where is_booked = true)`

Recomputed whenever rooms change. This keeps the existing reservation-consume
logic (`reconcileHotelInventory`, status-release counters) and the main app
working unchanged in Phase 1.

The parent's own `room_type` / `price` / `meal_plan` columns become legacy —
no longer the source of truth. Left in place and untouched to avoid breaking
any reader; the price→event push reads from rooms, not these columns.

## Migration

For every existing non-deleted `offline_hotels` row:
1. Insert `num_rooms` child rows into `offline_hotel_rooms`, each cloned from
   the parent's `room_type, price, meal_plan, last_cancellation_date`.
2. Mark `consumed_rooms` of them `is_booked = true` (which specific ones is
   arbitrary — counter parity is what matters in Phase 1).

Idempotent guard: skip hotels that already have child rooms.

## Server Actions (`lib/actions/offline-hotel-actions.ts`)

New:
- `getOfflineHotelRooms(hotelId: number): Promise<OfflineHotelRoom[]>`
- `createOfflineHotelRooms(hotelId, rooms: NewRoom[])`
- `updateOfflineHotelRoom(roomId, patch: Partial<OfflineHotelRoom>)` — used by
  inline edits on the detail page (order_no / acc_no / supplier).
- `deleteOfflineHotelRoom(roomId)`
- internal `recomputeHotelMirror(hotelId)` — recounts rooms → updates parent
  `num_rooms` / `consumed_rooms`, then runs the price→event push.

Changed:
- `createOfflineHotel` / `updateOfflineHotel` accept a `rooms[]` payload; write
  children, then `recomputeHotelMirror`.

### Price → event push

Currently `updateOfflineHotel` pushes `price / capacity` → `base_hotel_price`.
New rule, runs inside `recomputeHotelMirror`:

1. Candidate rooms = `is_booked = false`.
2. For each, per-person price = `price / getOfflineRoomCapacity(room_type)`.
3. `base_hotel_price = round(min(per-person price))`.
4. If no available rooms, leave `base_hotel_price` as-is (don't zero it).
5. Apply the existing date-match / flight-owns-dates guards unchanged.

`getOfflineRoomCapacity` now keys off the **per-room** `room_type`, not the
parent's.

## UI

### New / Edit form (`offline-hotels/new`, `offline-hotels/[id]/edit`)

Shared section (hotel search, name, city, check-in/out, event/flight links,
guest rating) stays once at top. Then:

- **Room template** block: room_type, price, meal_plan, last_cancellation_date,
  supplier.
- "Number of Rooms" `[N]` + **Generate rooms** → produces N room cards
  prefilled from the template.
- N collapsible **room cards**, each editable: room_type, price, meal_plan,
  last_cancellation_date, supplier. (order_no / acc_no / reservation_id are NOT
  in create — they're post-booking, edited on the detail page.)
- On submit, `rooms[]` goes to the server action.

Validation mirrors the existing zod schema per room (price positive, room_type
required, cancel date format).

### Detail view (`offline-hotels/[id]`)

Replace the single Room Type / Meal / Price rows with a **Rooms table**:

| # | Room Type | Price | Meal | Cancel | Supplier | Status | Order No | Acc No |
|---|-----------|-------|------|--------|----------|--------|----------|--------|

- Status = `Booked` (red) / `Available` (green) from `is_booked`.
- Inventory summary line above: `X available / N total · M booked` (derived
  from rooms, matches today's wording).
- `Order No`, `Acc No`, `Supplier` cells are **inline-editable** (click → input
  → save via `updateOfflineHotelRoom`). This is the "after Paid, update doket"
  flow.

Reservations section (`ReservationsForInventory`) unchanged — it already
excludes `Lost` and `Cancelled` (`getReservationsForHotel` filters via
`ACTIVE_RESERVATION_STATUSES_FILTER`), so lost reservations don't show.

## Types (`types/offline-hotel.types.ts`)

Add:
```ts
export interface OfflineHotelRoom {
  id: number;
  hotel_id: number;
  room_type: string;
  price: number;
  meal_plan: string | null;
  last_cancellation_date: string | null;
  supplier: string | null;
  is_booked: boolean;
  order_no: string | null;
  acc_no: string | null;
  reservation_id: number | null;
  notes: string | null;
  created_at: string;
}
```
`OfflineHotel` unchanged.

## Cross-Project Impact

**Zero main app (`../myt---main`) changes in Phase 1.**
- Main app reads `events.base_hotel_price` — still pushed (now cheapest
  available room).
- Main app reads parent `num_rooms` / `consumed_rooms` — still maintained as a
  mirror.
- `offline_hotel_rooms` is backoffice-only.

Phase 2 (out of scope) will touch the booking flow to consume a specific room
and auto-stamp `order_no` / `acc_no` / `reservation_id`.

## Out of Scope (Phase 2)

- Reservation booking a specific room id.
- Auto-filling `order_no` / `acc_no` / `reservation_id` on payment.
- Dropping the parent counter mirror entirely.
- Main app per-room display.

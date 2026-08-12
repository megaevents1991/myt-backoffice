# Offline Flights Phase B - Per-Event Seat Allocation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each flight↔event link its own seat quota - 10 seats to Ariana, 10 to the organised trip - enforced as a hard cap in the customer-facing app, and shown as ORG / TAKEN / AVAILABLE per event in the backoffice.

**Architecture:** A `flight_event_allocations` table holds only the quota. Consumed seats are never stored - a `flight_event_consumed` view derives them from active reservations, so the purchase path in `myt-main` needs no change and there is no second counter to drift. The main app's flight search reads both and hides a flight from an event whose quota is exhausted.

**Tech Stack:** Supabase (PostgreSQL view + table), Next.js Server Actions, React 19 client table, `myt-main` API route.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-offline-flights-expansion-design.md`, §1.1–1.3 and §3.
- **Prerequisite: Phase A is merged**, in particular `components/flights-editable-table.tsx` and `lib/actions/offline-flight-columns.ts`.
- **No backfill.** An event with no allocation row keeps using the global pool - today's exact behaviour. The hard cap applies only where a row exists.
- `flights.consumed_quantity` and `app/api/confirm-order/route.ts` in `myt-main` stay **exactly as they are**. Do not add a per-event counter anywhere.
- Backoffice commits go to `master`. Main-app work goes on the branch `feat/offline-flights-v2` and is merged by PR - never `git merge` locally.
- Shared types edited in `types/app.types.ts` must be mirrored into `../myt-main/lib/app.types.ts`.
- Every Server Action starts with `await requireStaff()`. Every route starts with its guard.
- No test suite: the gate is `npx tsc --noEmit` in each repo plus the stated manual check.
- Conventional commits. **Never add an AI co-author line.**
- Do not apply migrations. Commit them and ask Dor.

## Deploy order

Backoffice ships first and is safe on its own: `myt-main` does not query a table it does not know about, so allocations sit inert until its branch merges. Nothing in this phase can oversell before main catches up - it can only fail to _restrict_, which is today's behaviour.

---

## File Structure

| File                                                        | Responsibility                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `supabase/migrations/<ts>_add_flight_event_allocations.sql` | Table, view, grant                                                  |
| `types/offline-flight.types.ts`                             | `FlightEventAllocation`, `FlightAllocationRow`                      |
| `lib/actions/flight-allocation-actions.ts`                  | Read/write allocations with quota validation                        |
| `components/flight-allocations-panel.tsx`                   | The expanded-row panel: per-event ORG/TAKEN/AVAILABLE + unallocated |
| `components/flights-editable-table.tsx`                     | Gains the expand toggle that renders the panel                      |
| `../myt-main/lib/flights/offlineSeatQuota.ts`               | Pure cap logic (`buildSeatQuota`, `hasSeatsForEvent`)               |
| `../myt-main/lib/flights/offlineStops.ts`                   | Pure stopover shaping (`buildOfflineStops`)                         |
| `../myt-main/lib/flights/__tests__/`                        | Vitest cover for both helpers                                       |
| `../myt-main/app/api/flights/search/route.ts`               | Applies the cap; renders stopovers and bag weights                  |
| `types/app.types.ts` + `../myt-main/lib/app.types.ts`       | `FlightSegment` baggage-weight fields (shared)                      |

---

### Task 1: Schema - allocations table and derived-consumed view

**Files:**

- Create: `supabase/migrations/<timestamp>_add_flight_event_allocations.sql`
- Modify: `types/offline-flight.types.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: table `flight_event_allocations(id, flight_id, event_id, allocated_seats, created_at)`; view `flight_event_consumed(flight_id, event_id, consumed_seats)`; TypeScript types `FlightEventAllocation` and `FlightAllocationRow`.

- [ ] **Step 1: Create the migration file**

```bash
npm run db:new add_flight_event_allocations
```

- [ ] **Step 2: Write the migration SQL**

```sql
create table if not exists "public"."flight_event_allocations" (
  "id"              bigint generated always as identity primary key,
  "flight_id"       bigint not null references "public"."flights"("id") on delete cascade,
  "event_id"        bigint not null references "public"."events"("id") on delete cascade,
  "allocated_seats" integer not null check ("allocated_seats" >= 0),
  "created_at"      timestamptz not null default now(),
  unique ("flight_id", "event_id")
);

create index if not exists "flight_event_allocations_event_id_idx"
  on "public"."flight_event_allocations" ("event_id");

-- Consumed seats are DERIVED, never stored. flights.consumed_quantity already
-- drifts (hence reconcileFlightInventory); a second counter written from the
-- other repo would be a second source of drift. Reservations are the one truth.
-- The status list mirrors ACTIVE_RESERVATION_STATUSES_FILTER in
-- lib/actions/reservation-actions.ts.
create or replace view "public"."flight_event_consumed" as
select
  "offline_flight_id" as "flight_id",
  "event_id",
  sum(coalesce(("flight_order_info"->>'numOfTravelers')::int, 0))::int as "consumed_seats"
from "public"."reservations"
where "offline_flight_id" is not null
  and "status" not in ('Cancelled', 'Lost')
group by 1, 2;

-- Both apps connect with the service role.
grant select on "public"."flight_event_consumed" to "service_role";
grant select, insert, update, delete on "public"."flight_event_allocations" to "service_role";
```

- [ ] **Step 3: Add the types**

Append to `types/offline-flight.types.ts`:

```ts
export interface FlightEventAllocation {
  id: number;
  flight_id: number;
  event_id: number;
  allocated_seats: number;
  created_at: string;
}

/** One row of the allocations panel: the quota joined with derived consumption. */
export interface FlightAllocationRow {
  event_id: number;
  event_name: string;
  event_date: string;
  /** null = no allocation row; this event draws on the global pool. */
  allocated_seats: number | null;
  consumed_seats: number;
}
```

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add supabase/migrations types/offline-flight.types.ts
git commit -m "feat(offline-flights): per-event seat allocations table and derived-consumed view"
```

- [ ] **Step 5: STOP - ask Dor to apply the migration**

Tell Dor: _"Migration B is committed. Run `npm run db:push`, or GitHub → Actions → 'Apply DB Migrations'. It creates `flight_event_allocations` and the `flight_event_consumed` view - nothing existing is altered."_

Wait for confirmation, then:

```bash
npm run db:types
git add types/database.types.ts
git commit -m "chore(types): regenerate database types after allocations"
```

---

### Task 2: Allocation server actions

**Files:**

- Create: `lib/actions/flight-allocation-actions.ts`

**Interfaces:**

- Consumes: `requireStaff`, `supabase`, `logAudit`, `FlightAllocationRow`.
- Produces:
  - `getFlightAllocations(flightId: number): Promise<{ rows: FlightAllocationRow[]; initial_quantity: number; unallocated: number }>`
  - `setFlightAllocation(flightId: number, eventId: number, seats: number): Promise<void>`
  - `removeFlightAllocation(flightId: number, eventId: number): Promise<void>`

**Validation rules (both writes):**

1. `sum(allocated_seats) across the flight` must not exceed `flights.initial_quantity`.
2. An event's `allocated_seats` must not drop below the seats that event has already consumed.

- [ ] **Step 1: Write the module**

Create `lib/actions/flight-allocation-actions.ts`:

```ts
"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import type { FlightAllocationRow } from "@/types/offline-flight.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

type ConsumedRow = {
  flight_id: number;
  event_id: number;
  consumed_seats: number;
};
type AllocRow = { event_id: number; allocated_seats: number };

async function loadFlightState(flightId: number): Promise<{
  initialQuantity: number;
  eventIds: number[];
  allocations: Map<number, number>;
  consumed: Map<number, number>;
}> {
  const { data: flight, error: flightError } = await db()
    .from("flights")
    .select("initial_quantity, event_ids")
    .eq("id", flightId)
    .single();
  if (flightError) throw flightError;

  const { data: allocRows, error: allocError } = await db()
    .from("flight_event_allocations")
    .select("event_id, allocated_seats")
    .eq("flight_id", flightId);
  if (allocError) throw allocError;

  const { data: consumedRows, error: consumedError } = await db()
    .from("flight_event_consumed")
    .select("flight_id, event_id, consumed_seats")
    .eq("flight_id", flightId);
  if (consumedError) throw consumedError;

  return {
    initialQuantity: Number(flight?.initial_quantity ?? 0),
    eventIds: (flight?.event_ids ?? []) as number[],
    allocations: new Map(
      (allocRows ?? []).map((r: AllocRow) => [r.event_id, r.allocated_seats]),
    ),
    consumed: new Map(
      (consumedRows ?? []).map((r: ConsumedRow) => [
        r.event_id,
        r.consumed_seats,
      ]),
    ),
  };
}

export async function getFlightAllocations(flightId: number): Promise<{
  rows: FlightAllocationRow[];
  initial_quantity: number;
  unallocated: number;
}> {
  await requireStaff();
  const { initialQuantity, eventIds, allocations, consumed } =
    await loadFlightState(flightId);

  let rows: FlightAllocationRow[] = [];
  if (eventIds.length > 0) {
    const { data: events, error } = await supabase
      .from("events")
      .select("id, name, date")
      .in("id", eventIds);
    if (error) throw error;
    rows = (events ?? []).map((event) => ({
      event_id: event.id as number,
      event_name: event.name as string,
      event_date: event.date as string,
      allocated_seats: allocations.get(event.id as number) ?? null,
      consumed_seats: consumed.get(event.id as number) ?? 0,
    }));
    rows.sort((a, b) => a.event_date.localeCompare(b.event_date));
  }

  const allocatedTotal = Array.from(allocations.values()).reduce(
    (sum, n) => sum + n,
    0,
  );
  return {
    rows,
    initial_quantity: initialQuantity,
    unallocated: initialQuantity - allocatedTotal,
  };
}

export async function setFlightAllocation(
  flightId: number,
  eventId: number,
  seats: number,
): Promise<void> {
  await requireStaff();
  if (!Number.isInteger(seats) || seats < 0)
    throw new Error("Seats must be a non-negative integer");

  const { initialQuantity, allocations, consumed } =
    await loadFlightState(flightId);

  const alreadyConsumed = consumed.get(eventId) ?? 0;
  if (seats < alreadyConsumed) {
    throw new Error(
      `Cannot allocate ${seats} seats - this event has already sold ${alreadyConsumed}`,
    );
  }

  const otherAllocated = Array.from(allocations.entries())
    .filter(([id]) => id !== eventId)
    .reduce((sum, [, n]) => sum + n, 0);
  if (otherAllocated + seats > initialQuantity) {
    throw new Error(
      `Cannot allocate ${seats} seats - only ${initialQuantity - otherAllocated} of ${initialQuantity} remain unallocated`,
    );
  }

  const { error } = await db()
    .from("flight_event_allocations")
    .upsert(
      { flight_id: flightId, event_id: eventId, allocated_seats: seats },
      { onConflict: "flight_id,event_id" },
    );
  if (error) throw error;

  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: flightId,
    changes: { allocated_seats: seats },
    metadata: { event_id: eventId },
  });
  revalidatePath("/offline-flights");
  revalidatePath(`/offline-flights/${flightId}`);
  revalidatePath(`/events/${eventId}`);
}

export async function removeFlightAllocation(
  flightId: number,
  eventId: number,
): Promise<void> {
  await requireStaff();
  const { error } = await db()
    .from("flight_event_allocations")
    .delete()
    .eq("flight_id", flightId)
    .eq("event_id", eventId);
  if (error) throw error;

  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: flightId,
    metadata: { event_id: eventId, allocation_removed: true },
  });
  revalidatePath("/offline-flights");
  revalidatePath(`/events/${eventId}`);
}
```

Note: removing an allocation returns that event to the global pool - it does **not** block it. That is the documented no-row fallback, not a bug.

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/actions/flight-allocation-actions.ts
git commit -m "feat(offline-flights): read and write per-event seat allocations with quota guards"
```

---

### Task 3: Allocations panel in the table

**Files:**

- Create: `components/flight-allocations-panel.tsx`
- Modify: `components/flights-editable-table.tsx`

**Interfaces:**

- Consumes: `getFlightAllocations`, `setFlightAllocation`, `removeFlightAllocation` (Task 2).
- Produces:

```tsx
export type FlightAllocationsPanelProps = {
  flightId: number;
  /** Highlights this event's row; passed by the event page. */
  highlightEventId?: number;
  onChanged?: () => void;
};
export function FlightAllocationsPanel(
  props: FlightAllocationsPanelProps,
): JSX.Element;
```

- [ ] **Step 1: Build the panel**

Create `components/flight-allocations-panel.tsx` as a `"use client"` component. On mount, call `getFlightAllocations(flightId)`. Render a small table:

| Event             | ORG                                                                     | TAKEN            | AVAILABLE                                                            |                              |
| ----------------- | ----------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------- | ---------------------------- |
| event name + date | editable number input, or "global pool" when `allocated_seats === null` | `consumed_seats` | `allocated_seats − consumed_seats`, green above zero and red at zero | remove button when allocated |

Below the rows, one summary line: `Unallocated: {unallocated} of {initial_quantity}`, rendered red when `unallocated < 0` (possible only if `initial_quantity` was lowered after allocating).

Committing the ORG input calls `setFlightAllocation(flightId, eventId, seats)`. Because the action throws a human-readable message on both quota violations, surface it directly:

```tsx
try {
  await setFlightAllocation(flightId, row.event_id, seats);
  await reload();
  onChanged?.();
} catch (error) {
  console.error("Failed to set allocation:", error);
  toast.error(error instanceof Error ? error.message : "Allocation failed");
}
```

An event with no allocation shows a "Allocate" button that seeds the input with the flight's remaining unallocated seats.

- [ ] **Step 2: Add the expand toggle to the table**

In `components/flights-editable-table.tsx` add a leading chevron column. Track `expandedId: number | null`. When set, render an extra `TableRow` beneath that flight whose single `TableCell` spans every column and contains:

```tsx
<FlightAllocationsPanel
  flightId={flight.id}
  highlightEventId={eventId}
  onChanged={onChanged}
/>
```

- [ ] **Step 3: Typecheck and manual acceptance**

Run: `npx tsc --noEmit` - expected: no new errors.

`npm run dev` → `/offline-flights`. On a flight with `initial_quantity = 20` linked to two events:

- expand it, confirm both events appear as "global pool";
- allocate 10 to the first - unallocated drops to 10;
- allocate 15 to the second - **rejected** with "only 10 of 20 remain unallocated";
- allocate 10 to the second - unallocated becomes 0;
- on an event that has a live reservation, try to allocate fewer seats than it has sold - **rejected** with the "already sold" message;
- remove an allocation and confirm the row returns to "global pool".

- [ ] **Step 4: Commit**

```bash
git add components/flight-allocations-panel.tsx components/flights-editable-table.tsx
git commit -m "feat(offline-flights): per-event ORG/TAKEN/AVAILABLE in the expanded row"
```

---

### Task 4: Main app - enforce the per-event cap

**Files:**

- Create: `../myt-main/lib/flights/offlineSeatQuota.ts`
- Create: `../myt-main/lib/flights/__tests__/offlineSeatQuota.test.ts`
- Modify: `../myt-main/app/api/flights/search/route.ts` (`getOfflineFlightsFromDB` ~line 161, `transformDbFlightToFlight` ~line 93, the POST handler's call site ~line 290)

**Interfaces:**

- Consumes: the `flight_event_allocations` table and `flight_event_consumed` view from Task 1.
- Produces:
  - `buildSeatQuota(allocations, consumed): Map<number, number>`
  - `hasSeatsForEvent(quota, flightId, travelers): boolean`
  - No exported API change on the route - its response shape is unchanged; some flights are simply absent.

Unlike the backoffice, `myt-main` has vitest with unit tests under `lib/**/__tests__/`. The cap decision is pure logic, so it is extracted into `lib/` and tested there rather than being buried in the route.

- [ ] **Step 1: Create the branch**

```bash
cd ../myt-main
git checkout -b feat/offline-flights-v2
```

- [ ] **Step 2: Write the failing test**

Create `lib/flights/__tests__/offlineSeatQuota.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSeatQuota, hasSeatsForEvent } from "../offlineSeatQuota";

describe("buildSeatQuota", () => {
  it("subtracts consumed seats from the allocation", () => {
    const quota = buildSeatQuota(
      [{ flight_id: 1, allocated_seats: 10 }],
      [{ flight_id: 1, consumed_seats: 4 }],
    );
    expect(quota.get(1)).toBe(6);
  });

  it("treats a flight with no consumption as fully available", () => {
    const quota = buildSeatQuota([{ flight_id: 2, allocated_seats: 8 }], []);
    expect(quota.get(2)).toBe(8);
  });

  it("omits flights that have no allocation row", () => {
    const quota = buildSeatQuota([], [{ flight_id: 3, consumed_seats: 2 }]);
    expect(quota.has(3)).toBe(false);
  });
});

describe("hasSeatsForEvent", () => {
  const quota = new Map<number, number>([
    [1, 2],
    [2, 0],
  ]);

  it("allows a party that fits the allocation", () => {
    expect(hasSeatsForEvent(quota, 1, 2)).toBe(true);
  });

  it("rejects a party larger than the allocation", () => {
    expect(hasSeatsForEvent(quota, 1, 3)).toBe(false);
  });

  it("rejects every party size once the allocation is exhausted", () => {
    expect(hasSeatsForEvent(quota, 2, 1)).toBe(false);
  });

  it("falls back to the global pool when the flight has no allocation", () => {
    expect(hasSeatsForEvent(quota, 99, 50)).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run lib/flights/__tests__/offlineSeatQuota.test.ts`
Expected: FAIL - cannot resolve `../offlineSeatQuota`.

- [ ] **Step 4: Write the helper**

Create `lib/flights/offlineSeatQuota.ts`:

```ts
export type AllocationRow = { flight_id: number; allocated_seats: number };
export type ConsumedRow = { flight_id: number; consumed_seats: number };

/**
 * Seats still sellable to ONE event, keyed by flight id. A flight absent from
 * the map has no allocation row and draws on the global pool - the
 * pre-allocation behaviour, deliberately preserved so existing links keep working.
 */
export function buildSeatQuota(
  allocations: AllocationRow[],
  consumed: ConsumedRow[],
): Map<number, number> {
  const consumedByFlight = new Map<number, number>(
    consumed.map((row) => [row.flight_id, row.consumed_seats]),
  );
  return new Map(
    allocations.map((allocation) => [
      allocation.flight_id,
      allocation.allocated_seats -
        (consumedByFlight.get(allocation.flight_id) ?? 0),
    ]),
  );
}

/** Hard cap: an event with its own allocation may not sell past it, even when
 *  the flight still has unallocated seats. No allocation → no extra restriction. */
export function hasSeatsForEvent(
  quota: Map<number, number>,
  flightId: number,
  travelers: number,
): boolean {
  const remaining = quota.get(flightId);
  if (remaining === undefined) return true;
  return remaining >= travelers;
}
```

- [ ] **Step 5: Run the test again**

Run: `npx vitest run lib/flights/__tests__/offlineSeatQuota.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Load the quota in the route**

In `app/api/flights/search/route.ts`, import the helper and add above `getOfflineFlightsFromDB`:

```ts
import {
  buildSeatQuota,
  hasSeatsForEvent,
} from "@/lib/flights/offlineSeatQuota";

const getEventSeatQuota = async (
  eventId: number,
): Promise<Map<number, number>> => {
  const { data: allocations, error: allocError } = await supabase
    .from("flight_event_allocations")
    .select("flight_id, allocated_seats")
    .eq("event_id", eventId);
  if (allocError) throw allocError;
  if (!allocations || allocations.length === 0) return new Map();

  const { data: consumed, error: consumedError } = await supabase
    .from("flight_event_consumed")
    .select("flight_id, consumed_seats")
    .eq("event_id", eventId);
  if (consumedError) throw consumedError;

  return buildSeatQuota(allocations, consumed ?? []);
};
```

Both queries throw on error, which the existing `try/catch` in `getOfflineFlightsFromDB` already turns into "no offline flights this search". That is the safe direction: a transient database error must never let a sold-out block oversell.

- [ ] **Step 7: Apply the cap in the transform**

Give `transformDbFlightToFlight` a fifth parameter and extend the existing guard:

```ts
const transformDbFlightToFlight = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbFlight: any,
  id: number,
  num_of_travelers: number,
  eventSeatQuota: Map<number, number>,
): Flight | null => {
  // Not enough remaining inventory for this party size - hide the flight
  // entirely. Returning a placeholder ({}) here would propagate an invalid
  // Flight to the client and crash flight rendering.
  if (dbFlight.initial_quantity - dbFlight.consumed_quantity < num_of_travelers) {
    return null;
  }
  // Hard cap: when this event has its own allocation, it may not sell past it
  // even if the flight still has unallocated seats.
  if (!hasSeatsForEvent(eventSeatQuota, dbFlight.id, num_of_travelers)) {
    return null;
  }
  return {
    // ...unchanged body
```

- [ ] **Step 8: Thread it through**

In `getOfflineFlightsFromDB`, call `getEventSeatQuota(eventId)` inside the existing `try` before the `flights` query, then pass the map into each `transformDbFlightToFlight(flight, index + indexShift, num_of_travelers, quota)` call. The POST handler's call site needs no change.

- [ ] **Step 9: Typecheck, unit tests, manual acceptance**

```bash
cd ../myt-main && npx tsc --noEmit && npx vitest run
```

Expected: no new type errors; the whole unit suite passes, including the 7 new tests.

Then, against the shared database:

- pick an event with an offline flight and **no** allocation row; search flights on the site and confirm the offline flight still appears (unchanged behaviour);
- in the backoffice allocate 1 seat to that event; search for 2 travellers and confirm the flight disappears; search for 1 traveller and confirm it appears;
- allocate 0 seats and confirm it disappears for every party size;
- remove the allocation and confirm it comes back.

- [ ] **Step 10: Commit and open the PR**

```bash
git add lib/flights app/api/flights/search/route.ts
git commit -m "feat(flights): honour per-event offline seat allocations"
git push -u origin feat/offline-flights-v2
```

Open a PR against `master` describing the hard-cap behaviour and the no-allocation fallback. Do not merge - Dor merges.

---

### Task 5: Main app - surface the stopover and baggage weights

**Files:**

- Create: `../myt-main/lib/flights/offlineStops.ts`
- Create: `../myt-main/lib/flights/__tests__/offlineStops.test.ts`
- Modify: `../myt-main/lib/app.types.ts` and `types/app.types.ts` (both `FlightSegment` copies)
- Modify: `../myt-main/app/api/flights/search/route.ts` (`transformDbFlightToFlight`)

**Interfaces:**

- Consumes: the `outbound_stop_airport` / `outbound_stop_duration` / `inbound_stop_*` / `checked_bag_kg` / `cabin_bag_kg` columns from Phase A Task 1.
- Produces: `buildOfflineStops(arrivalAirport, stopAirport, stopDurationHours): { iataCode: string; duration: number | null }[]`.

**Why this belongs here:** Phase A added the columns and made them editable, but the main app still renders every offline flight as non-stop and shows only a yes/no bag flag. Until this task ships, an offline flight with a stopover would be sold to the customer as direct.

- [ ] **Step 1: Mirror the segment type in both repos**

Add to `FlightSegment` in `../myt-main/lib/app.types.ts` and to the same type in `types/app.types.ts`:

```ts
  // Offline flights only: the weight allowance behind checkBagsIncluded /
  // cabinBagsIncluded, when the supplier gave us one.
  checkedBagKg?: number | null;
  cabinBagKg?: number | null;
```

- [ ] **Step 2: Write the failing test**

Create `../myt-main/lib/flights/__tests__/offlineStops.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildOfflineStops } from "../offlineStops";

describe("buildOfflineStops", () => {
  it("returns just the destination for a non-stop leg", () => {
    expect(buildOfflineStops("BCN", null, null)).toEqual([
      { iataCode: "BCN", duration: null },
    ]);
  });

  it("puts the stopover before the destination", () => {
    expect(buildOfflineStops("BCN", "VIE", 2)).toEqual([
      { iataCode: "VIE", duration: 2 },
      { iataCode: "BCN", duration: null },
    ]);
  });

  it("keeps a stopover with an unknown duration", () => {
    expect(buildOfflineStops("BCN", "VIE", null)).toEqual([
      { iataCode: "VIE", duration: null },
      { iataCode: "BCN", duration: null },
    ]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run lib/flights/__tests__/offlineStops.test.ts`
Expected: FAIL - cannot resolve `../offlineStops`.

- [ ] **Step 4: Write the module**

Create `../myt-main/lib/flights/offlineStops.ts`:

```ts
export type FlightStop = { iataCode: string; duration: number | null };

/**
 * Mirrors the Amadeus shape built in the search route: one entry per segment
 * arrival, so the final entry is always the destination and any earlier entry
 * is a layover carrying its duration in hours.
 */
export function buildOfflineStops(
  arrivalAirport: string,
  stopAirport: string | null,
  stopDurationHours: number | null,
): FlightStop[] {
  const destination: FlightStop = { iataCode: arrivalAirport, duration: null };
  if (!stopAirport) return [destination];
  return [{ iataCode: stopAirport, duration: stopDurationHours }, destination];
}
```

- [ ] **Step 5: Run the test again**

Run: `npx vitest run lib/flights/__tests__/offlineStops.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Use it in the transform**

In `transformDbFlightToFlight`, replace the two hardcoded single-entry `stops` arrays and add the bag weights:

```ts
    outbound: {
      stops: buildOfflineStops(
        dbFlight.outbound_arrival_airport,
        dbFlight.outbound_stop_airport ?? null,
        isoDurationToHours(dbFlight.outbound_stop_duration),
      ),
      // ...existing fields unchanged...
      checkedBagKg: dbFlight.checked_bag_kg ?? null,
      cabinBagKg: dbFlight.cabin_bag_kg ?? null,
    },
```

and the same for `inbound` using `inbound_arrival_airport` / `inbound_stop_airport` / `inbound_stop_duration`. Also set the top-level `stops` from the data instead of trusting the old `stops = 0` constraint:

```ts
    stops: Number(dbFlight.stops) || 0,
```

Add the small parser next to `PTfunction` in the same file - Postgres renders `interval` as `HH:MM:SS`, which is what `PTfunction` already assumes:

```ts
const isoDurationToHours = (
  value: string | null | undefined,
): number | null => {
  if (!value) return null;
  const [hours, minutes] = String(value).split(":").map(Number);
  if (!Number.isFinite(hours)) return null;
  return (
    Math.round((hours + (Number.isFinite(minutes) ? minutes : 0) / 60) * 10) /
    10
  );
};
```

- [ ] **Step 7: Typecheck, tests, manual acceptance**

```bash
cd ../myt-main && npx tsc --noEmit && npx vitest run
```

Expected: no new type errors; the unit suite passes.

In the backoffice set `outbound_stop_airport = VIE` and `outbound_stop_duration = 02:00:00` on an offline flight, then search that event on the site: the flight card must show one stop rather than "direct", and the existing long-layover and stop-count rules must not have changed for Amadeus results.

- [ ] **Step 8: Commit**

```bash
git add lib/app.types.ts lib/flights app/api/flights/search/route.ts
git commit -m "feat(flights): render offline stopovers and baggage weights"
cd ../../myt-backoffice && git add types/app.types.ts && git commit -m "chore(types): mirror flight segment baggage weight fields"
```

---

### Task 6: Phase B wrap-up

- [ ] **Step 1: Typecheck and build both repos**

```bash
npx tsc --noEmit && npm run build
cd ../myt-main && npx tsc --noEmit && npm run build && npx vitest run
```

Expected: all succeed.

- [ ] **Step 2: Confirm confirm-order is untouched**

```bash
cd ../myt-main && git diff master...feat/offline-flights-v2 --stat
```

Expected: `app/api/flights/search/route.ts`, `lib/app.types.ts`, and the new files under `lib/flights/`. If `app/api/confirm-order/route.ts` appears, revert that file - the derived-consumed design depends on it staying as it is.

- [ ] **Step 3: Report to Dor**

State that the backoffice side is on `master` and inert until the main PR merges, link the PR, and confirm the migration was applied. Phase C is the next plan.

---

## Self-Review

**Spec coverage.** §1.1 allocations table → Task 1. §1.2 derived consumed view and the "no confirm-order change" guarantee → Task 1 plus the Task 6 diff check. §1.3 ORG/TAKEN/AVAILABLE per event, the unallocated pool, both validation rules and the no-row fallback → Tasks 2 and 3. §3.1 per-event hard cap → Task 4; stopover mapping and baggage-weight passthrough → Task 5. §3.2 shared-type mirror for the segment fields → Task 5 Step 1. §4 deploy ordering → the "Deploy order" section and Task 4's branch/PR steps.

**Placeholders.** None: the migration, the actions module, the pure helper, its test and every main-app edit are pasted in full; the one described component (Task 3) has its exact props, its table columns, its error path and six numbered acceptance checks.

**Type consistency.** `FlightAllocationRow` (Task 1) is the return element of `getFlightAllocations` (Task 2) and the row type the panel renders (Task 3). `setFlightAllocation(flightId, eventId, seats)` keeps that argument order in both the action and the panel. The view's column names - `flight_id`, `event_id`, `consumed_seats` - are used identically in Task 2's `loadFlightState`, Task 4's `getEventSeatQuota`, and the `AllocationRow` / `ConsumedRow` types in `offlineSeatQuota.ts`. `buildSeatQuota` and `hasSeatsForEvent` are called under those exact names in the route.

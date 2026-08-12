# Offline Flights Phase C - LOCKFLIGHT

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an event be locked to exactly one offline flight - no Amadeus search, fixed dates, and a sold-out state when that flight's seats run out.

**Architecture:** One nullable column, `events.locked_flight_id`. The backoffice writes it from the event editor and forces the event's default dates from the flight. The main app's flight search branches on it: when set, it skips Amadeus entirely and offers only that flight, still honouring the Phase B per-event allocation; when the allocation is exhausted it returns no flights plus a `lockedSoldOut` flag that the order flow renders as sold out.

**Tech Stack:** Supabase, Next.js Server Actions, `myt-main` API route + `app/order/FlightSelection.tsx`, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-offline-flights-expansion-design.md`, §1.5 and §3.
- **Prerequisite: Phases A and B are merged**, including the main-app branch - the lock relies on the per-event allocation for its sold-out signal.
- **No Amadeus fallback when a locked flight sells out.** A fallback would silently change the customer's price and defeat the point of locking. Sold out means sold out.
- `skip_flight` keeps working on a locked event: the customer may still choose "no flight".
- Locking the hotel is **out of scope**. Do not add `locked_hotel_id`.
- Backoffice → `master`. Main app → the existing branch `feat/offline-flights-v2`, merged by PR. Never `git merge` locally.
- `Event` is a shared type: every edit to `types/app.types.ts` must be mirrored in `../myt-main/lib/app.types.ts`.
- No test suite in the backoffice - the gate is `npx tsc --noEmit` plus the stated manual check. `myt-main` has vitest; the pure logic added here is unit-tested.
- Conventional commits. **Never add an AI co-author line.**
- Do not apply migrations. Commit and ask Dor.

## Deploy order - read before shipping

Phase C is the one part of this project that is **not** safe to ship backoffice-first. If an event is locked in production before the main PR merges, `myt-main` keeps showing Amadeus flights for it and the "locked package" is a lie. Therefore:

1. Ship the backoffice side (Tasks 1–3) - the toggle exists but **lock nothing in production**.
2. Merge the main-app PR (Tasks 4–5).
3. Only then lock real events.

Task 6 makes this an explicit hand-off to Dor.

---

## File Structure

| File                                                       | Responsibility                                     |
| ---------------------------------------------------------- | -------------------------------------------------- |
| `supabase/migrations/<ts>_add_events_locked_flight_id.sql` | The column                                         |
| `types/app.types.ts`                                       | `Event.locked_flight_id` (shared - mirror to main) |
| `lib/actions/event-flight-lock-actions.ts`                 | Lock / unlock with validation and date forcing     |
| `app/(dashboard)/events/[id]/page.tsx`                     | Lock toggle + banner in the flights block          |
| `../myt-main/lib/app.types.ts`                             | Mirrored `Event.locked_flight_id`                  |
| `../myt-main/lib/flights/lockedFlight.ts`                  | Pure lock-resolution logic                         |
| `../myt-main/lib/flights/__tests__/lockedFlight.test.ts`   | Vitest cover                                       |
| `../myt-main/app/api/flights/search/route.ts`              | Lock branch, `lockedSoldOut` flag                  |
| `../myt-main/app/order/FlightSelection.tsx`                | Locked + sold-out rendering                        |

---

### Task 1: Schema - `events.locked_flight_id`

**Files:**

- Create: `supabase/migrations/<timestamp>_add_events_locked_flight_id.sql`
- Modify: `types/app.types.ts`

**Interfaces:**

- Consumes: `flights.id`.
- Produces: `Event.locked_flight_id?: number | null` - read by the backoffice editor (Task 3) and the main-app search (Task 5).

- [ ] **Step 1: Create the migration**

```bash
npm run db:new add_events_locked_flight_id
```

- [ ] **Step 2: Write the SQL**

```sql
-- A locked package sells exactly one offline flight and never queries Amadeus.
-- ON DELETE SET NULL: hard-deleting a flight row must not take the event with
-- it - the event simply reverts to a normal, searchable package.
alter table "public"."events"
  add column "locked_flight_id" bigint
  references "public"."flights"("id") on delete set null;

create index if not exists "events_locked_flight_id_idx"
  on "public"."events" ("locked_flight_id");

comment on column "public"."events"."locked_flight_id" is
  'When set, the main app offers only this offline flight and skips Amadeus. Sold out = no flights, no fallback.';
```

- [ ] **Step 3: Add the field to the shared type**

In `types/app.types.ts`, inside `Event`, directly after `skip_flight_markup`:

```ts
  // LOCKFLIGHT: when set, the main app offers ONLY this offline flight and
  // never calls Amadeus for this event. skip_flight still applies. When the
  // flight's allocation for this event is exhausted the package is sold out -
  // there is deliberately no fallback to a dynamic search.
  locked_flight_id?: number | null;
```

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add supabase/migrations types/app.types.ts
git commit -m "feat(events): add locked_flight_id for locked flight packages"
```

- [ ] **Step 5: STOP - ask Dor to apply the migration**

Tell Dor: _"Migration C is committed - it adds one nullable column to `events`. Run `npm run db:push` or the 'Apply DB Migrations' Action."_

Then:

```bash
npm run db:types
git add types/database.types.ts
git commit -m "chore(types): regenerate database types after locked_flight_id"
```

---

### Task 2: Lock / unlock server actions

**Files:**

- Create: `lib/actions/event-flight-lock-actions.ts`

**Interfaces:**

- Consumes: `requireStaff`, `supabase`, `logAudit`, `getFlightAllocations` (Phase B).
- Produces:
  - `lockEventFlight(eventId: number, flightId: number): Promise<{ warning: string | null }>`
  - `unlockEventFlight(eventId: number): Promise<void>`
  - `getLockableFlights(eventId: number): Promise<Array<{ id: number; label: string; allocated_seats: number | null }>>`

**Rules enforced on lock:**

1. The flight must already be linked to the event (`flights.event_ids` contains it). Locking to an unlinked flight would produce a package whose only flight the search cannot find.
2. The flight must not be soft-deleted.
3. The event's `def_date_depart` / `def_date_return` are overwritten from the flight - departure from `outbound_departure_time`, return from `inbound_departure_time` (the takeoff of the return leg, matching `updateOfflineFlight`, **not** the landing time).
4. If the event has no allocation on that flight, the action still succeeds but returns a `warning` - the caller shows it. A locked event without an allocation draws on the global pool, which is legal but rarely what you want for a locked package.

- [ ] **Step 1: Write the module**

Create `lib/actions/event-flight-lock-actions.ts`:

```ts
"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import type { OfflineFlight } from "@/types/offline-flight.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

export async function getLockableFlights(
  eventId: number,
): Promise<
  Array<{ id: number; label: string; allocated_seats: number | null }>
> {
  await requireStaff();
  const { data: flights, error } = await db()
    .from("flights")
    .select(
      "id, airline_code, outbound_flight_number, outbound_departure_airport, outbound_arrival_airport, outbound_departure_time, inbound_departure_time",
    )
    .contains("event_ids", [eventId])
    .eq("is_deleted", false)
    .order("outbound_departure_time", { ascending: true });
  if (error) throw error;

  const { data: allocations, error: allocError } = await db()
    .from("flight_event_allocations")
    .select("flight_id, allocated_seats")
    .eq("event_id", eventId);
  if (allocError) throw allocError;

  const allocated = new Map<number, number>(
    (allocations ?? []).map(
      (a: { flight_id: number; allocated_seats: number }) => [
        a.flight_id,
        a.allocated_seats,
      ],
    ),
  );

  return (flights ?? []).map((f: OfflineFlight) => ({
    id: f.id,
    label: `${f.airline_code} ${f.outbound_flight_number} · ${f.outbound_departure_airport}→${f.outbound_arrival_airport} · ${f.outbound_departure_time.slice(0, 10)} → ${f.inbound_departure_time.slice(0, 10)}`,
    allocated_seats: allocated.get(f.id) ?? null,
  }));
}

export async function lockEventFlight(
  eventId: number,
  flightId: number,
): Promise<{ warning: string | null }> {
  await requireStaff();

  const { data: flight, error: flightError } = await db()
    .from("flights")
    .select(
      "id, event_ids, is_deleted, outbound_departure_time, inbound_departure_time",
    )
    .eq("id", flightId)
    .single();
  if (flightError) throw flightError;
  if (flight.is_deleted) throw new Error("Cannot lock to a deleted flight");
  if (!((flight.event_ids as number[]) ?? []).includes(eventId)) {
    throw new Error("Link the flight to this event before locking it");
  }

  // Return date = takeoff of the return leg, NOT the landing-back time -
  // same rule as updateOfflineFlight.
  const { error: updateError } = await db()
    .from("events")
    .update({
      locked_flight_id: flightId,
      def_date_depart: (flight.outbound_departure_time as string).slice(0, 10),
      def_date_return: (flight.inbound_departure_time as string).slice(0, 10),
    })
    .eq("id", eventId);
  if (updateError) throw updateError;

  const { data: allocation, error: allocError } = await db()
    .from("flight_event_allocations")
    .select("allocated_seats")
    .eq("flight_id", flightId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (allocError) throw allocError;

  await logAudit({
    action: "update",
    entityType: "event",
    entityId: eventId,
    changes: { locked_flight_id: flightId },
  });
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/offline-flights");

  return {
    warning: allocation
      ? null
      : "This event has no seat allocation on the locked flight - it draws on the flight's global pool.",
  };
}

export async function unlockEventFlight(eventId: number): Promise<void> {
  await requireStaff();
  const { error } = await db()
    .from("events")
    .update({ locked_flight_id: null })
    .eq("id", eventId);
  if (error) throw error;

  await logAudit({
    action: "update",
    entityType: "event",
    entityId: eventId,
    changes: { locked_flight_id: null },
  });
  revalidatePath(`/events/${eventId}`);
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/actions/event-flight-lock-actions.ts
git commit -m "feat(events): lock and unlock an event to a single offline flight"
```

---

### Task 3: Lock UI in the event page

**Files:**

- Modify: `app/(dashboard)/events/[id]/page.tsx` (the flights card that Task 6 of Phase A replaced with `FlightsEditableTable`)

**Interfaces:**

- Consumes: `getLockableFlights`, `lockEventFlight`, `unlockEventFlight` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Add the control**

Above the `FlightsEditableTable` in the flights card, add a "Locked package" `Switch` (`components/ui/switch.tsx`).

- Off → on: load `getLockableFlights(event.id)` and show them in a `Select`. Choosing one calls `lockEventFlight(event.id, flightId)`. On success `toast.success("Package locked")`, and when `warning` is non-null also `toast(warning)` so the missing allocation is visible.
- On → off: confirm first ("Unlock this package? Customers will see live Amadeus search again."), then `unlockEventFlight(event.id)`.
- Errors: `toast.error(error instanceof Error ? error.message : "Lock failed")` - the action's messages are written to be shown as-is.

- [ ] **Step 2: Add the banner**

When `event.locked_flight_id` is set, render an amber banner at the top of the flights card: _"Locked package - customers see only flight #{id}. No Amadeus search. Dates fixed to {def_date_depart} → {def_date_return}."_ Include a note that the lock only takes effect on the site once the main-app release is live.

- [ ] **Step 3: Typecheck and manual acceptance**

Run: `npx tsc --noEmit` - expected: no new errors.

`npm run dev` → open an event with at least one linked offline flight:

- lock it, confirm the banner appears and `def_date_depart` / `def_date_return` changed to the flight's dates;
- lock an event that has no allocation on the flight and confirm the warning toast;
- try to lock a flight not linked to the event (temporarily unlink it first) and confirm the "Link the flight to this event before locking it" error;
- unlock and confirm the banner disappears.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/events/[id]/page.tsx"
git commit -m "feat(events): lock a package to one offline flight from the event page"
```

---

### Task 4: Main app - pure lock resolution

**Files:**

- Create: `../myt-main/lib/flights/lockedFlight.ts`
- Create: `../myt-main/lib/flights/__tests__/lockedFlight.test.ts`
- Modify: `../myt-main/lib/app.types.ts`

**Interfaces:**

- Consumes: `hasSeatsForEvent` from `lib/flights/offlineSeatQuota.ts` (Phase B).
- Produces:
  - `type LockedFlightOutcome = { mode: "unlocked" } | { mode: "locked"; flightId: number } | { mode: "sold_out"; flightId: number }`
  - `resolveLockedFlight(lockedFlightId, quota, travelers): LockedFlightOutcome`

- [ ] **Step 1: Mirror the shared type**

On the existing branch:

```bash
cd ../myt-main
git checkout feat/offline-flights-v2
```

Add to `Event` in `lib/app.types.ts`, in the same position and with the same comment as the backoffice copy from Task 1:

```ts
  // LOCKFLIGHT: when set, the main app offers ONLY this offline flight and
  // never calls Amadeus for this event. skip_flight still applies. When the
  // flight's allocation for this event is exhausted the package is sold out -
  // there is deliberately no fallback to a dynamic search.
  locked_flight_id?: number | null;
```

- [ ] **Step 2: Write the failing test**

Create `lib/flights/__tests__/lockedFlight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveLockedFlight } from "../lockedFlight";

describe("resolveLockedFlight", () => {
  it("reports unlocked when the event has no locked flight", () => {
    expect(resolveLockedFlight(null, new Map(), 2)).toEqual({
      mode: "unlocked",
    });
    expect(resolveLockedFlight(undefined, new Map(), 2)).toEqual({
      mode: "unlocked",
    });
  });

  it("reports locked when the allocation covers the party", () => {
    const quota = new Map([[7, 4]]);
    expect(resolveLockedFlight(7, quota, 4)).toEqual({
      mode: "locked",
      flightId: 7,
    });
  });

  it("reports sold out when the allocation cannot cover the party", () => {
    const quota = new Map([[7, 1]]);
    expect(resolveLockedFlight(7, quota, 2)).toEqual({
      mode: "sold_out",
      flightId: 7,
    });
  });

  it("reports sold out when the allocation is exhausted", () => {
    const quota = new Map([[7, 0]]);
    expect(resolveLockedFlight(7, quota, 1)).toEqual({
      mode: "sold_out",
      flightId: 7,
    });
  });

  it("stays locked when the flight has no allocation row at all", () => {
    // No allocation means the global pool applies; the flight-level check in
    // the route still decides, so this must not be pre-emptively sold out.
    expect(resolveLockedFlight(7, new Map(), 9)).toEqual({
      mode: "locked",
      flightId: 7,
    });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run lib/flights/__tests__/lockedFlight.test.ts`
Expected: FAIL - cannot resolve `../lockedFlight`.

- [ ] **Step 4: Write the module**

Create `lib/flights/lockedFlight.ts`:

```ts
import { hasSeatsForEvent } from "./offlineSeatQuota";

export type LockedFlightOutcome =
  | { mode: "unlocked" }
  | { mode: "locked"; flightId: number }
  | { mode: "sold_out"; flightId: number };

/**
 * Decides how a search should behave for one event.
 *  - unlocked  → normal Amadeus + offline merge
 *  - locked    → offer ONLY this flight, no Amadeus call
 *  - sold_out  → offer nothing; deliberately NO Amadeus fallback, because a
 *                fallback would change the package price behind the customer.
 * A locked flight with no allocation row stays "locked": the global
 * inventory check in the route is then the only gate, exactly as before.
 */
export function resolveLockedFlight(
  lockedFlightId: number | null | undefined,
  quota: Map<number, number>,
  travelers: number,
): LockedFlightOutcome {
  if (!lockedFlightId) return { mode: "unlocked" };
  return hasSeatsForEvent(quota, lockedFlightId, travelers)
    ? { mode: "locked", flightId: lockedFlightId }
    : { mode: "sold_out", flightId: lockedFlightId };
}
```

- [ ] **Step 5: Run the test again**

Run: `npx vitest run lib/flights/__tests__/lockedFlight.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/app.types.ts lib/flights
git commit -m "feat(flights): resolve locked-package flight availability"
```

---

### Task 5: Main app - branch the search on the lock

**Files:**

- Modify: `../myt-main/app/api/flights/search/route.ts`
- Modify: `../myt-main/app/order/FlightSelection.tsx`

**Interfaces:**

- Consumes: `resolveLockedFlight` (Task 4), `getEventSeatQuota` (Phase B).
- Produces: the search response gains two optional fields - `locked?: boolean`, `lockedSoldOut?: boolean`. `flights` keeps its existing shape.

- [ ] **Step 1: Restrict the offline query when locked**

Give `getOfflineFlightsFromDB` an extra parameter `lockedFlightId: number | null` and, when it is set, add `.eq("id", lockedFlightId)` to the existing Supabase query. Everything else in that function - the `event_ids` containment, the date windows, the `is_deleted` filter, the quota cap from Phase B - stays exactly as it is. Locking narrows the result; it never loosens a check.

- [ ] **Step 2: Branch the POST handler**

In the `try` block of `POST`, before the Amadeus call:

```ts
const seatQuota = await getEventSeatQuota(event.id);
const lock = resolveLockedFlight(
  event.locked_flight_id,
  seatQuota,
  adults || 1,
);

if (lock.mode === "sold_out") {
  // No Amadeus fallback by design: falling back would quietly re-price the
  // package and defeat the point of locking it.
  return NextResponse.json({
    flights: [],
    locked: true,
    lockedSoldOut: true,
    debug: { departureDate: departureDateFromUi, returnDate: returnDateFromUi },
  });
}

if (lock.mode === "locked") {
  const lockedFlights = await getOfflineFlightsFromDB(
    event.id,
    departureDate,
    returnDate,
    0,
    adults || 1,
    lock.flightId,
  );
  return NextResponse.json({
    flights: lockedFlights,
    locked: true,
    lockedSoldOut: lockedFlights.length === 0,
    debug: { departureDate: departureDateFromUi, returnDate: returnDateFromUi },
  });
}
```

The unlocked path below is untouched, except that its existing `getOfflineFlightsFromDB(...)` call gains a trailing `null` argument.

Note the second `lockedSoldOut`: the flight can still vanish on the flight-level global check or the date window even when the per-event allocation looks healthy. Reporting it as sold out is correct - there is nothing to sell.

- [ ] **Step 3: Render the locked and sold-out states**

In `app/order/FlightSelection.tsx`, the response is consumed around line 250–310. Read `locked` and `lockedSoldOut` alongside `flights`:

- `lockedSoldOut` → replace the flight list with a sold-out panel: "This package is sold out." Keep the "continue without a flight" path visible when the event has `skip_flight`, since a locked package still allows skipping.
- `locked` with flights → render the single flight card as already selected and hide the sort/filter controls; there is nothing to choose between.
- Neither → unchanged behaviour.

- [ ] **Step 4: Typecheck, tests, manual acceptance**

```bash
cd ../myt-main && npx tsc --noEmit && npx vitest run
```

Expected: no new type errors; the full unit suite passes.

Then, with the backoffice pointing at the same database:

- lock an event to a flight with seats and confirm the order flow shows exactly that one flight and no Amadeus results;
- allocate 0 seats to that event and confirm the sold-out panel, with no Amadeus results appearing;
- with `skip_flight` on, confirm "continue without a flight" still works while sold out;
- unlock the event and confirm Amadeus results return.

- [ ] **Step 5: Commit and update the PR**

```bash
git add app/api/flights/search/route.ts app/order/FlightSelection.tsx
git commit -m "feat(flights): serve locked packages without Amadeus and mark them sold out"
git push
```

The PR from Phase B now carries both commits. Do not merge - Dor merges.

---

### Task 6: Phase C wrap-up and the ordered hand-off

- [ ] **Step 1: Verify both repos**

```bash
npx tsc --noEmit && npm run build
cd ../myt-main && npx tsc --noEmit && npm run build && npx vitest run
```

Expected: all succeed.

- [ ] **Step 2: Check the shared type really matches**

```bash
diff <(grep -n "locked_flight_id" types/app.types.ts) <(grep -n "locked_flight_id" ../myt-main/lib/app.types.ts)
```

Line numbers will differ; the field declaration must not. If anything else drifted, run `/sync-types`.

- [ ] **Step 3: Confirm confirm-order is still untouched**

```bash
cd ../myt-main && git diff master...feat/offline-flights-v2 --stat
```

Expected files: `lib/app.types.ts`, `lib/flights/*`, `app/api/flights/search/route.ts`, `app/order/FlightSelection.tsx`. `app/api/confirm-order/route.ts` must **not** appear.

- [ ] **Step 4: Hand off to Dor in order**

Tell him explicitly:

1. The backoffice lock toggle is live on `master` - **do not lock any production event yet**.
2. Review and merge `feat/offline-flights-v2` in `myt-main`, and wait for the Vercel deploy.
3. After the deploy, lock events freely; verify the first one on the live site before locking more.

---

## Self-Review

**Spec coverage.** §1.5 `locked_flight_id`, Amadeus skip, `skip_flight` preserved, no sold-out fallback, dates forced from the flight → Tasks 1, 2, 4, 5. §3.1 lock branch in the search route → Task 5. §3.2 shared-type mirror → Tasks 1 and 4, verified in Task 6 Step 2. §3.3 locked and sold-out UI → Task 5 Step 3. §3.4 `confirm-order` untouched → Task 6 Step 3. §4 deploy ordering → the "Deploy order" section and Task 6 Step 4. Explicitly out of scope per the spec: `locked_hotel_id`.

**Placeholders.** None: the migration, both actions, the pure module and its test are pasted in full; the two described UI surfaces (Tasks 3 and 5 Step 3) each list their exact states, their exact copy, and numbered acceptance checks.

**Type consistency.** `locked_flight_id` is declared identically in both repos' `Event`. `resolveLockedFlight(lockedFlightId, quota, travelers)` keeps that argument order between its definition, its test and the route. `LockedFlightOutcome.mode` values - `unlocked` / `locked` / `sold_out` - are the exact strings the route branches on. `getOfflineFlightsFromDB`'s new sixth parameter `lockedFlightId` is passed at both call sites, `null` on the unlocked path. `hasSeatsForEvent` is reused from Phase B rather than reimplemented.

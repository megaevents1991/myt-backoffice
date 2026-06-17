# Offline Hotel Per-Room Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an offline-hotel batch hold per-room detail (room_type, price, meal, cancellation, supplier) in a new `offline_hotel_rooms` child table, edited via a room-card form, with post-booking fields (order_no, acc_no, supplier) inline-editable on the detail page.

**Architecture:** New child table `offline_hotel_rooms` (1 row per physical room) hangs off `offline_hotels`. Parent keeps shared fields + `num_rooms`/`consumed_rooms` as a derived mirror so existing reservation/consume logic and the main app keep working unchanged. Server actions own room CRUD and recompute the mirror + the cheapest-available-room price push to `events.base_hotel_price`. UI: a reusable `RoomsEditor` client component in new/edit forms; a `HotelRoomsTable` with inline cell edit on the detail page.

**Tech Stack:** Next.js 15 App Router, Server Actions, Supabase (service-role), shadcn/ui + Tailwind, react-hook-form + zod, react-hot-toast.

**Note on testing:** This repo has **no test suite** and ignores TS/ESLint at build (`next.config.mjs`). Verification per task = `npm run build` passing + manual checks in `npm run dev`. There is no `pytest`/`jest`. Do NOT invent a test runner.

**Note on DB:** `offline_hotels` exists only in Supabase, not in `db.schema.sql`, and there is no migrations runner. DDL ships as a SQL file the user runs manually in the Supabase SQL editor.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `db/migrations/2026-06-08-offline-hotel-rooms.sql` | DDL for table + backfill, run manually in Supabase | Create |
| `db.schema.sql` | Document the new table (append) | Modify |
| `types/offline-hotel.types.ts` | Add `OfflineHotelRoom` + `NewOfflineHotelRoom` | Modify |
| `lib/actions/offline-hotel-room-actions.ts` | Room CRUD + `recomputeHotelMirror` + price push | Create |
| `lib/actions/offline-hotel-actions.ts` | Call mirror recompute; accept `rooms[]` on create/update | Modify |
| `components/offline-hotels/rooms-editor.tsx` | Client: template block + N room cards (used by new & edit) | Create |
| `components/offline-hotels/hotel-rooms-table.tsx` | Client: detail-page rooms table w/ inline edit | Create |
| `app/(dashboard)/offline-hotels/new/page.tsx` | Wire `RoomsEditor` into create form | Modify |
| `app/(dashboard)/offline-hotels/[id]/edit/page.tsx` | Wire `RoomsEditor` into edit form | Modify |
| `app/(dashboard)/offline-hotels/[id]/page.tsx` | Replace single room rows with `HotelRoomsTable` | Modify |

---

## Task 1: Database — create `offline_hotel_rooms` + backfill

**Files:**
- Create: `db/migrations/2026-06-08-offline-hotel-rooms.sql`
- Modify: `db.schema.sql` (append documentation block at end)

- [ ] **Step 1: Write the migration SQL file**

Create `db/migrations/2026-06-08-offline-hotel-rooms.sql`:

```sql
-- Offline Hotel Per-Room Inventory (2026-06-08)
-- Run manually in the Supabase SQL editor. offline_hotels lives only in Supabase.

-- 1. Child table: one row per physical room in an offline_hotels batch.
create table if not exists offline_hotel_rooms (
  id                     bigint generated always as identity primary key,
  hotel_id               bigint not null references offline_hotels(id) on delete cascade,
  room_type              text   not null,
  price                  numeric not null,            -- total per room for the stay (USD)
  meal_plan              text,
  last_cancellation_date date,
  supplier               text,
  is_booked              boolean not null default false,
  order_no               text,                        -- supplier order number (post-booking)
  acc_no                 text,                        -- accounting number / "doket" (post-booking)
  reservation_id         bigint,                      -- reservation that took this room (manual in phase 1)
  notes                  text,
  created_at             timestamptz not null default now()
);

create index if not exists idx_offline_hotel_rooms_hotel_id on offline_hotel_rooms(hotel_id);
create index if not exists idx_offline_hotel_rooms_is_booked on offline_hotel_rooms(is_booked);

-- 2. Backfill: clone each existing batch into num_rooms child rooms.
--    Skip hotels that already have rooms (idempotent).
do $$
declare
  h record;
  i int;
begin
  for h in
    select id, room_type, price, meal_plan, last_cancellation_date,
           coalesce(num_rooms, 0) as num_rooms, coalesce(consumed_rooms, 0) as consumed_rooms
    from offline_hotels
    where not exists (select 1 from offline_hotel_rooms r where r.hotel_id = offline_hotels.id)
  loop
    for i in 1..greatest(h.num_rooms, 0) loop
      insert into offline_hotel_rooms
        (hotel_id, room_type, price, meal_plan, last_cancellation_date, is_booked)
      values
        (h.id,
         coalesce(h.room_type, 'Double'),
         coalesce(h.price, 0),
         h.meal_plan,
         h.last_cancellation_date,
         i <= h.consumed_rooms);   -- first consumed_rooms rooms flagged booked for counter parity
    end loop;
  end loop;
end $$;
```

- [ ] **Step 2: Run the migration in Supabase**

Open the Supabase SQL editor for the shared project, paste the file contents, run it. Verify with:

```sql
select hotel_id, count(*) total, count(*) filter (where is_booked) booked
from offline_hotel_rooms group by hotel_id order by hotel_id limit 20;
```

Expected: each existing hotel has `total = num_rooms` and `booked = consumed_rooms`.

- [ ] **Step 3: Append documentation to `db.schema.sql`**

At the very end of `db.schema.sql`, append:

```sql

-- ─────────────────────────────────────────────────────────────
-- offline_hotel_rooms — per-room detail for offline_hotels batches
-- (created 2026-06-08; see db/migrations/2026-06-08-offline-hotel-rooms.sql)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offline_hotel_rooms (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hotel_id               BIGINT NOT NULL REFERENCES offline_hotels(id) ON DELETE CASCADE,
  room_type              TEXT NOT NULL,
  price                  NUMERIC NOT NULL,
  meal_plan              TEXT,
  last_cancellation_date DATE,
  supplier               TEXT,
  is_booked              BOOLEAN NOT NULL DEFAULT false,
  order_no               TEXT,
  acc_no                 TEXT,
  reservation_id         BIGINT,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_offline_hotel_rooms_hotel_id ON offline_hotel_rooms(hotel_id);
CREATE INDEX IF NOT EXISTS idx_offline_hotel_rooms_is_booked ON offline_hotel_rooms(is_booked);
```

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-06-08-offline-hotel-rooms.sql db.schema.sql
git commit -m "feat(offline-hotels): add offline_hotel_rooms table + backfill migration"
```

---

## Task 2: Types — `OfflineHotelRoom`

**Files:**
- Modify: `types/offline-hotel.types.ts`

- [ ] **Step 1: Add the room types**

Append to `types/offline-hotel.types.ts` (after the existing `OfflineHotel` interface):

```ts
export interface OfflineHotelRoom {
  id: number;
  hotel_id: number;
  room_type: string;
  price: number;
  meal_plan: string | null;
  last_cancellation_date: string | null; // DATE "YYYY-MM-DD"
  supplier: string | null;
  is_booked: boolean;
  order_no: string | null;
  acc_no: string | null;
  reservation_id: number | null;
  notes: string | null;
  created_at: string;
}

// Shape sent from the form to create/replace a hotel's rooms.
// No id/hotel_id/is_booked/created_at — server owns those.
export type NewOfflineHotelRoom = {
  room_type: string;
  price: number;
  meal_plan: string | null;
  last_cancellation_date: string | null;
  supplier: string | null;
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds (no type errors referencing the new file).

- [ ] **Step 3: Commit**

```bash
git add types/offline-hotel.types.ts
git commit -m "feat(offline-hotels): add OfflineHotelRoom types"
```

---

## Task 3: Server actions — room CRUD + mirror recompute + price push

**Files:**
- Create: `lib/actions/offline-hotel-room-actions.ts`
- Modify: `lib/actions/offline-hotel-actions.ts`

Context: the existing price→event push lives in `updateOfflineHotel`
(`lib/actions/offline-hotel-actions.ts:88-184`). We extract the
"compute base_hotel_price and push to linked events" into a reusable step that
reads the **cheapest available room** instead of the parent's single `price`.

- [ ] **Step 1: Create the room-actions file**

Create `lib/actions/offline-hotel-room-actions.ts`:

```ts
"use server";

import { supabase } from "@/lib/supabase-server";
import { getOfflineRoomCapacity } from "@/lib/offlineRoomCapacity";
import { revalidatePath } from "next/cache";
import type { OfflineHotelRoom, NewOfflineHotelRoom } from "@/types/offline-hotel.types";

// Neither offline_hotels nor offline_hotel_rooms is in Supabase generated types.
const roomsTable = () => (supabase as any).from("offline_hotel_rooms");
const hotelsTable = () => (supabase as any).from("offline_hotels");

export async function getOfflineHotelRooms(hotelId: number): Promise<OfflineHotelRoom[]> {
  const { data, error } = await roomsTable()
    .select("*")
    .eq("hotel_id", hotelId)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OfflineHotelRoom[];
}

// Replace ALL rooms for a hotel with the supplied set, preserving booked rooms.
// Booked rooms (is_booked=true) are NOT deleted — they may be tied to a paid
// reservation. Only unbooked rooms are swapped out for the new list.
export async function replaceOfflineHotelRooms(
  hotelId: number,
  rooms: NewOfflineHotelRoom[]
): Promise<void> {
  // Delete only the unbooked rooms; keep booked ones intact.
  const { error: delErr } = await roomsTable()
    .delete()
    .eq("hotel_id", hotelId)
    .eq("is_booked", false);
  if (delErr) throw delErr;

  if (rooms.length > 0) {
    const payload = rooms.map((r) => ({
      hotel_id: hotelId,
      room_type: r.room_type,
      price: r.price,
      meal_plan: r.meal_plan,
      last_cancellation_date: r.last_cancellation_date,
      supplier: r.supplier,
      is_booked: false,
    }));
    const { error: insErr } = await roomsTable().insert(payload);
    if (insErr) throw insErr;
  }

  await recomputeHotelMirror(hotelId);
}

// Patch one room (used by inline edit of order_no / acc_no / supplier / is_booked).
export async function updateOfflineHotelRoom(
  roomId: number,
  patch: Partial<Pick<OfflineHotelRoom,
    "room_type" | "price" | "meal_plan" | "last_cancellation_date" |
    "supplier" | "is_booked" | "order_no" | "acc_no" | "reservation_id" | "notes">>
): Promise<OfflineHotelRoom> {
  const { data, error } = await roomsTable()
    .update(patch)
    .eq("id", roomId)
    .select()
    .single();
  if (error) throw error;
  const room = data as OfflineHotelRoom;
  // is_booked or price changes affect the mirror + cheapest-available price.
  await recomputeHotelMirror(room.hotel_id);
  revalidatePath(`/(dashboard)/offline-hotels/${room.hotel_id}`);
  return room;
}

export async function deleteOfflineHotelRoom(roomId: number): Promise<void> {
  const { data: room } = await roomsTable().select("hotel_id, is_booked").eq("id", roomId).single();
  if (room?.is_booked) throw new Error("Cannot delete a booked room.");
  const { error } = await roomsTable().delete().eq("id", roomId);
  if (error) throw error;
  if (room?.hotel_id) {
    await recomputeHotelMirror(room.hotel_id);
    revalidatePath(`/(dashboard)/offline-hotels/${room.hotel_id}`);
  }
}

// Recompute parent num_rooms / consumed_rooms from rooms, then push the
// cheapest AVAILABLE room's per-person price onto linked events.
export async function recomputeHotelMirror(hotelId: number): Promise<void> {
  const { data: rooms, error } = await roomsTable()
    .select("price, room_type, is_booked")
    .eq("hotel_id", hotelId);
  if (error) throw error;

  const list = (rooms ?? []) as Pick<OfflineHotelRoom, "price" | "room_type" | "is_booked">[];
  const numRooms = list.length;
  const consumed = list.filter((r) => r.is_booked).length;

  await hotelsTable().update({ num_rooms: numRooms, consumed_rooms: consumed }).eq("id", hotelId);

  // Cheapest available room → per-person price → base_hotel_price on linked events.
  const available = list.filter((r) => !r.is_booked);
  if (available.length === 0) return; // keep existing event price; don't zero it

  const perPersonPrices = available.map((r) =>
    Number(r.price) / getOfflineRoomCapacity(r.room_type)
  );
  const baseHotelPrice = Math.round(Math.min(...perPersonPrices));

  const { data: hotel } = await hotelsTable()
    .select("event_ids, check_in, check_out")
    .eq("id", hotelId)
    .single();
  const eventIds: number[] = hotel?.event_ids ?? [];
  const checkIn: string = hotel?.check_in;
  const checkOut: string = hotel?.check_out;

  await Promise.all(
    eventIds.map(async (eventId) => {
      // Only push price if the hotel stay matches the event's default dates,
      // otherwise the hotel won't show in the customer flow and the price lies.
      const { data: event } = await (supabase as any)
        .from("events")
        .select("def_date_depart, def_date_return")
        .eq("id", eventId)
        .single();
      const datesMatch =
        (event?.def_date_depart ?? "").slice(0, 10) === checkIn &&
        (event?.def_date_return ?? "").slice(0, 10) === checkOut;
      if (!datesMatch) return;
      const { error: evErr } = await (supabase as any)
        .from("events")
        .update({ base_hotel_price: baseHotelPrice })
        .eq("id", eventId);
      if (evErr) throw evErr;
    })
  );

  revalidatePath("/(dashboard)/offline-hotels");
  revalidatePath(`/(dashboard)/offline-hotels/${hotelId}`);
  for (const eventId of eventIds) revalidatePath(`/(dashboard)/events/${eventId}`);
}
```

- [ ] **Step 2: Wire create/update to rooms in `offline-hotel-actions.ts`**

In `lib/actions/offline-hotel-actions.ts`, add an import at the top (after the existing imports):

```ts
import { replaceOfflineHotelRooms, recomputeHotelMirror } from "./offline-hotel-room-actions";
import type { NewOfflineHotelRoom } from "../../types/offline-hotel.types";
```

Change `createOfflineHotel` to accept and persist rooms. Replace the existing
`createOfflineHotel` (`lib/actions/offline-hotel-actions.ts:73-86`) with:

```ts
export async function createOfflineHotel(
  hotel: Omit<OfflineHotel, "id" | "consumed_rooms" | "is_deleted" | "created_at">,
  rooms?: NewOfflineHotelRoom[]
): Promise<OfflineHotel> {
  const { data, error } = await hotelsTable()
    .insert({ ...hotel, consumed_rooms: 0, is_deleted: false })
    .select();

  if (error) throw error;
  const created = data[0] as OfflineHotel;

  if (rooms && rooms.length > 0) {
    await replaceOfflineHotelRooms(created.id, rooms); // also recomputes mirror + price push
  }

  revalidatePath("/(dashboard)/offline-hotels");
  for (const id of hotel.event_ids ?? []) {
    revalidatePath(`/(dashboard)/events/${id}`);
  }
  return created;
}
```

In `updateOfflineHotel`, add an optional `rooms` param and persist it. Change
the signature and add a rooms-write near the end. Replace the signature line
(`lib/actions/offline-hotel-actions.ts:88-91`):

```ts
export async function updateOfflineHotel(
  id: number,
  hotel: Partial<Omit<OfflineHotel, "id" | "consumed_rooms" | "created_at">>,
  rooms?: NewOfflineHotelRoom[]
): Promise<OfflineHotel> {
```

Then, immediately before the final `return data[0] as OfflineHotel;` of
`updateOfflineHotel`, insert:

```ts
  if (rooms) {
    await replaceOfflineHotelRooms(id, rooms); // recomputes mirror + cheapest-available price push
  }
```

> The existing in-function price push (based on the parent `price`) stays for
> backward compatibility with batches that have no rooms yet. When `rooms` are
> supplied, `replaceOfflineHotelRooms` → `recomputeHotelMirror` overwrites
> `base_hotel_price` with the cheapest-available value, which is the intended
> source of truth going forward.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/offline-hotel-room-actions.ts lib/actions/offline-hotel-actions.ts
git commit -m "feat(offline-hotels): room CRUD actions + cheapest-available price push"
```

---

## Task 4: `RoomsEditor` component + wire into new/edit forms

**Files:**
- Create: `components/offline-hotels/rooms-editor.tsx`
- Modify: `app/(dashboard)/offline-hotels/new/page.tsx`
- Modify: `app/(dashboard)/offline-hotels/[id]/edit/page.tsx`

UX (from ui-ux-pro-max): dense admin layout; tabular numbers for price;
visible labels per field; remove-room uses danger color and is separated;
"Apply template to all" is a secondary action; price input `type="number"`;
8px spacing rhythm; each card has a visible header with its index.

- [ ] **Step 1: Create the `RoomsEditor` component**

Create `components/offline-hotels/rooms-editor.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Plus, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { NewOfflineHotelRoom } from "@/types/offline-hotel.types";

const ROOM_TYPES = [
  "Standard", "Double", "Twin", "Triple", "Deluxe",
  "Junior Suite", "Suite", "Family Room", "Studio",
] as const;

const MEAL_PLANS = [
  "Room Only", "Bed & Breakfast", "Half Board", "Full Board", "All Inclusive",
] as const;

export type RoomDraft = NewOfflineHotelRoom;

const blankRoom = (): RoomDraft => ({
  room_type: "Double",
  price: 100,
  meal_plan: null,
  last_cancellation_date: null,
  supplier: null,
});

export function RoomsEditor({
  rooms,
  onChange,
}: {
  rooms: RoomDraft[];
  onChange: (rooms: RoomDraft[]) => void;
}) {
  // Template row used to generate / bulk-apply rooms.
  const [template, setTemplate] = useState<RoomDraft>(blankRoom());
  const [genCount, setGenCount] = useState(1);

  const update = (i: number, patch: Partial<RoomDraft>) =>
    onChange(rooms.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const generate = () => {
    const n = Math.max(1, Math.floor(genCount));
    onChange(Array.from({ length: n }, () => ({ ...template })));
  };

  const applyTemplateToAll = () =>
    onChange(rooms.map(() => ({ ...template })));

  const addRoom = () => onChange([...rooms, { ...template }]);
  const removeRoom = (i: number) => onChange(rooms.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {/* Template block */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Room Template</h3>
          <p className="text-xs text-muted-foreground">
            Fill once, generate rooms, then tweak the ones that differ.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Room Type</label>
            <Select value={template.room_type}
              onValueChange={(v) => setTemplate({ ...template, room_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROOM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Price (USD)</label>
            <Input type="number" step="1" className="tabular-nums"
              value={template.price}
              onChange={(e) => setTemplate({ ...template, price: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Meal</label>
            <Select value={template.meal_plan ?? "__none__"}
              onValueChange={(v) => setTemplate({ ...template, meal_plan: v === "__none__" ? null : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {MEAL_PLANS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Cancel by</label>
            <Input type="date" value={template.last_cancellation_date ?? ""}
              onChange={(e) => setTemplate({ ...template, last_cancellation_date: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Supplier</label>
            <Input value={template.supplier ?? ""}
              onChange={(e) => setTemplate({ ...template, supplier: e.target.value || null })} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-medium">Generate</label>
            <Input type="number" min={1} className="w-24 tabular-nums" value={genCount}
              onChange={(e) => setGenCount(Number(e.target.value))} />
          </div>
          <Button type="button" onClick={generate}>Generate rooms</Button>
          {rooms.length > 0 && (
            <Button type="button" variant="outline" onClick={applyTemplateToAll}>
              <Copy className="mr-2 h-4 w-4" /> Apply template to all
            </Button>
          )}
        </div>
      </div>

      {/* Per-room cards */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Rooms ({rooms.length})</h3>
        <Button type="button" variant="outline" size="sm" onClick={addRoom}>
          <Plus className="mr-2 h-4 w-4" /> Add room
        </Button>
      </div>

      {rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground border rounded-lg p-4">
          No rooms yet. Fill the template and click “Generate rooms”.
        </p>
      ) : (
        <div className="space-y-2">
          {rooms.map((r, i) => (
            <div key={i} className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground">Room {i + 1}</span>
                <Button type="button" variant="ghost" size="sm"
                  className="text-red-500 hover:text-red-600"
                  onClick={() => removeRoom(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Select value={r.room_type} onValueChange={(v) => update(i, { room_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROOM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" step="1" className="tabular-nums" value={r.price}
                  onChange={(e) => update(i, { price: Number(e.target.value) })} />
                <Select value={r.meal_plan ?? "__none__"}
                  onValueChange={(v) => update(i, { meal_plan: v === "__none__" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {MEAL_PLANS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="date" value={r.last_cancellation_date ?? ""}
                  onChange={(e) => update(i, { last_cancellation_date: e.target.value || null })} />
                <Input placeholder="Supplier" value={r.supplier ?? ""}
                  onChange={(e) => update(i, { supplier: e.target.value || null })} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire `RoomsEditor` into the NEW form**

In `app/(dashboard)/offline-hotels/new/page.tsx`:

Add imports near the other component imports:

```tsx
import { RoomsEditor, type RoomDraft } from "@/components/offline-hotels/rooms-editor";
```

Add room state inside `NewOfflineHotelPage`, next to the other `useState` hooks
(after the `linkedHotel` state around line 90):

```tsx
  const [rooms, setRooms] = useState<RoomDraft[]>([]);
```

Keep `num_rooms` in the schema for validation but drive it from rooms. In
`onSubmit`, pass rooms and derive `num_rooms` from them. Replace the
`createOfflineHotel(hotelData);` call (around line 178) with:

```tsx
        await createOfflineHotel(
          { ...hotelData, num_rooms: rooms.length || values.num_rooms },
          rooms.length > 0 ? rooms : undefined
        );
```

Add the editor to the JSX. Immediately after the closing `</div>` of the
"Hotel Details" grid (right before the `<h2>Link to Events` heading around
line 400), insert:

```tsx
          <h2 className="text-xl font-semibold border-b pb-2">Rooms</h2>
          <RoomsEditor rooms={rooms} onChange={setRooms} />
```

- [ ] **Step 3: Wire `RoomsEditor` into the EDIT form**

In `app/(dashboard)/offline-hotels/[id]/edit/page.tsx`:

Add imports:

```tsx
import { RoomsEditor, type RoomDraft } from "@/components/offline-hotels/rooms-editor";
import { getOfflineHotelRooms } from "@/lib/actions/offline-hotel-room-actions";
```

Add state next to the other hooks (after `linkedHotel`, around line 106):

```tsx
  const [rooms, setRooms] = useState<RoomDraft[]>([]);
```

Load existing rooms in the existing data-load effect. Inside the
`getOfflineHotel(parsedId).then(...)` chain (after `form.reset({...})`, around
line 144), add a follow-up load:

```tsx
        getOfflineHotelRooms(parsedId)
          .then((existing) =>
            setRooms(existing.map((r) => ({
              room_type: r.room_type,
              price: Number(r.price),
              meal_plan: r.meal_plan,
              last_cancellation_date: r.last_cancellation_date,
              supplier: r.supplier,
            })))
          )
          .catch(console.error);
```

In `onSubmit`, pass rooms to `updateOfflineHotel`. Replace the
`updateOfflineHotel(hotelId, {...})` call (around line 198-206) so it passes
rooms as the third arg and derives `num_rooms`:

```tsx
        await updateOfflineHotel(
          hotelId,
          {
            ...values,
            num_rooms: rooms.length || values.num_rooms,
            hid: values.hid ? Number(values.hid) : null,
            meal_plan: values.meal_plan || null,
            notes: values.notes || null,
            last_cancellation_date: values.last_cancellation_date || null,
            guest_rating: values.guest_rating === "" ? null : Number(values.guest_rating),
            guest_review_count: values.guest_review_count === "" ? null : Number(values.guest_review_count),
          } as Partial<Omit<OfflineHotel, "id" | "consumed_rooms" | "created_at">>,
          rooms.length > 0 ? rooms : undefined
        );
```

Add the editor to the JSX, right before the `<h2>Link to Events` heading
(around line 437):

```tsx
          <h2 className="text-xl font-semibold border-b pb-2">Rooms</h2>
          <RoomsEditor rooms={rooms} onChange={setRooms} />
```

- [ ] **Step 4: Verify build + manual check**

Run: `npm run build`
Expected: build succeeds.

Then `npm run dev` and at `/offline-hotels/new`: fill template → Generate 3 →
edit room 2's price → confirm 3 cards render and edits stick. (Don't submit yet
unless you want a test row.)

- [ ] **Step 5: Commit**

```bash
git add components/offline-hotels/rooms-editor.tsx "app/(dashboard)/offline-hotels/new/page.tsx" "app/(dashboard)/offline-hotels/[id]/edit/page.tsx"
git commit -m "feat(offline-hotels): RoomsEditor with template + per-room cards in create/edit forms"
```

---

## Task 5: `HotelRoomsTable` with inline edit on the detail page

**Files:**
- Create: `components/offline-hotels/hotel-rooms-table.tsx`
- Modify: `app/(dashboard)/offline-hotels/[id]/page.tsx`

UX (from ui-ux-pro-max): tabular-nums for price/acc columns; Booked rows use a
distinct (red/secondary) badge and are visually separated from Available
(green); inline edit saves on blur with a brief success toast and no layout
shift (input occupies the cell). order_no / acc_no / supplier are the
post-booking editable cells.

- [ ] **Step 1: Create the `HotelRoomsTable` component**

Create `components/offline-hotels/hotel-rooms-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { updateOfflineHotelRoom } from "@/lib/actions/offline-hotel-room-actions";
import type { OfflineHotelRoom } from "@/types/offline-hotel.types";

type EditableField = "order_no" | "acc_no" | "supplier";

function InlineCell({
  room, field, placeholder, onSaved,
}: {
  room: OfflineHotelRoom;
  field: EditableField;
  placeholder: string;
  onSaved: (room: OfflineHotelRoom) => void;
}) {
  const [value, setValue] = useState(room[field] ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = value.trim() || null;
    if (next === (room[field] ?? null)) return; // no change
    setSaving(true);
    try {
      const updated = await updateOfflineHotelRoom(room.id, { [field]: next });
      onSaved(updated);
      toast.success(`Room ${room.id} ${field.replace("_", " ")} saved`);
    } catch (e) {
      toast.error((e as Error)?.message || "Save failed");
      setValue(room[field] ?? ""); // revert
    } finally {
      setSaving(false);
    }
  };

  return (
    <Input
      value={value}
      placeholder={placeholder}
      disabled={saving}
      className="h-8 tabular-nums"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export function HotelRoomsTable({ initialRooms }: { initialRooms: OfflineHotelRoom[] }) {
  const [rooms, setRooms] = useState(initialRooms);
  const onSaved = (u: OfflineHotelRoom) =>
    setRooms((rs) => rs.map((r) => (r.id === u.id ? u : r)));

  if (rooms.length === 0) {
    return (
      <p className="text-sm text-muted-foreground px-6 py-4">
        No rooms recorded for this hotel yet. Add them on the Edit page.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Room Type</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead>Meal</TableHead>
          <TableHead>Cancel by</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead>Order No</TableHead>
          <TableHead>Acc No</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rooms.map((r, i) => (
          <TableRow key={r.id} className={r.is_booked ? "bg-muted/30" : undefined}>
            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
            <TableCell className="font-medium">{r.room_type}</TableCell>
            <TableCell className="text-right tabular-nums">${Number(r.price).toFixed(2)}</TableCell>
            <TableCell>{r.meal_plan ?? "—"}</TableCell>
            <TableCell>{r.last_cancellation_date ?? "—"}</TableCell>
            <TableCell>
              {r.is_booked
                ? <Badge variant="secondary">Booked</Badge>
                : <Badge variant="default" className="bg-green-600 hover:bg-green-600">Available</Badge>}
            </TableCell>
            <TableCell className="min-w-[8rem]">
              <InlineCell room={r} field="supplier" placeholder="—" onSaved={onSaved} />
            </TableCell>
            <TableCell className="min-w-[8rem]">
              <InlineCell room={r} field="order_no" placeholder="—" onSaved={onSaved} />
            </TableCell>
            <TableCell className="min-w-[8rem]">
              <InlineCell room={r} field="acc_no" placeholder="doket…" onSaved={onSaved} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Wire it into the detail page**

In `app/(dashboard)/offline-hotels/[id]/page.tsx`:

Add imports near the top:

```tsx
import { getOfflineHotelRooms } from "@/lib/actions/offline-hotel-room-actions";
import { HotelRoomsTable } from "@/components/offline-hotels/hotel-rooms-table";
```

Load rooms after the reconcile/refetch (after line 62 `const reservations = ...`):

```tsx
  const rooms = await getOfflineHotelRooms(hotelIdAsNumber);
```

Remove the now-redundant single-room rows in the "General Information" block.
Delete these three lines (around lines 109-114):

```tsx
              <HotelDetailItem label="Room Type" value={hotel.room_type} />
              <HotelDetailItem label="Meal Plan" value={hotel.meal_plan} />
              <HotelDetailItem
                label="Price"
                value={`$${Number(hotel.price).toFixed(2)}`}
              />
```

Add a Rooms section. Immediately after the closing `</div>` of the "Links"
block and before `</dl>` (around line 173-174), this is inside the card; instead
add the rooms table as its own card AFTER the main details card. Insert right
before `<ReservationsForInventory ... />` (line 178):

```tsx
      <div className="mt-6 bg-card shadow overflow-hidden sm:rounded-lg border">
        <div className="px-4 py-5 sm:px-6">
          <h3 className="text-2xl leading-6 font-bold text-card-foreground">Rooms</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {rooms.length} room{rooms.length === 1 ? "" : "s"} in this batch ·
            {" "}{rooms.filter((r) => !r.is_booked).length} available.
            Edit Supplier / Order No / Acc No inline after a booking.
          </p>
        </div>
        <div className="border-t border-border overflow-x-auto">
          <HotelRoomsTable initialRooms={rooms} />
        </div>
      </div>
```

- [ ] **Step 3: Verify build + manual check**

Run: `npm run build`
Expected: build succeeds.

Then `npm run dev`, open an existing hotel at `/offline-hotels/<id>`: confirm
the Rooms table renders one row per backfilled room, Available/Booked badges
show, and editing an Acc No cell + blurring shows a success toast and persists
on reload.

- [ ] **Step 4: Commit**

```bash
git add components/offline-hotels/hotel-rooms-table.tsx "app/(dashboard)/offline-hotels/[id]/page.tsx"
git commit -m "feat(offline-hotels): per-room table with inline order_no/acc_no/supplier edit on detail page"
```

---

## Task 6: Full build + cross-project sanity

**Files:** none (verification only)

- [ ] **Step 1: Full production build**

Run: `npm run build`
Expected: build succeeds with no new errors.

- [ ] **Step 2: Manual end-to-end check**

In `npm run dev`:
1. `/offline-hotels/new` — create a hotel, generate 4 rooms, set one room cheaper, link an event whose dates match check-in/out, submit.
2. Open the new hotel `/offline-hotels/<id>` — 4 rooms show, all Available.
3. Open the linked event in the dashboard — `base_hotel_price` equals the
   cheapest room's price ÷ its capacity.
4. On the hotel detail, set a room's Acc No inline — toast + persists on reload.

- [ ] **Step 3: Cross-project note (no code change)**

Confirm no `../myt---main` change is needed: main app reads
`events.base_hotel_price` (still pushed) and parent `num_rooms`/`consumed_rooms`
(still mirrored). `offline_hotel_rooms` is backoffice-only. Record this in the
PR description.

- [ ] **Step 4: Final commit (if any docs changed)**

```bash
git add -A
git commit -m "chore(offline-hotels): per-room inventory phase 1 verification notes"
```

---

## Self-Review Notes

- **Spec coverage:** child table (T1) ✓, types (T2) ✓, room CRUD + cheapest-available price push (T3) ✓, template+cards UI (T4) ✓, detail rooms table + inline edit (T5) ✓, backfill + counter mirror (T1+T3) ✓, lost reservations already hidden (no change needed — noted in spec) ✓, zero main-app change (T6) ✓.
- **Booked-room safety:** `replaceOfflineHotelRooms` deletes only `is_booked=false` rooms, so a future phase-2 booked room survives an edit.
- **Naming consistency:** `recomputeHotelMirror`, `replaceOfflineHotelRooms`, `updateOfflineHotelRoom`, `getOfflineHotelRooms`, `deleteOfflineHotelRoom` used identically across tasks.
- **No automated tests** by design (repo has none); verification is build + manual.

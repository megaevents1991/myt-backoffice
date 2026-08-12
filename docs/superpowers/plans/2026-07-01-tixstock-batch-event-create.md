# TixStock Batch Event Creation - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin multi-select TixStock events for one performer, fill shared field values once, then finish and save each event in its own pre-filled tab - one insert per tab.

**Architecture:** Approach B. A single lean field component (`BatchEventFields`) is rendered twice: once empty in a shared-form dialog to collect `shared: Partial<Event>`, and once per selected event inside a full-screen tabbed overlay. Per-field merge rule: shared value wins if filled, else the event's TixStock-derived value, else empty. Each tab saves independently via the existing `createEvent()` server action. No new bulk action, no DB/type/price changes.

**Tech Stack:** Next.js 15 App Router, React 19 (client components), TypeScript, shadcn/ui (Radix Dialog, Tabs, Checkbox), Tailwind. Existing server actions `createEvent`, `searchFlightPrices`, `searchHotelPrices`.

## Global Constraints

- No automated test suite in this repo; build ignores TS/ESLint errors. **The real gate is `npx tsc --noEmit`** plus manual QA - every task ends with a type-check + a manual check, not a unit test.
- **No `any`.** Type provider data via existing `TixStockEventDB` / `Event`; cast once at boundaries.
- **Soft-delete/insert rules unchanged** - reuse `createEvent` (it forces `is_deleted` null). Never spread unknown objects into inserts beyond the `Omit<Event,"id">` shape.
- **shadcn/ui only** - reuse `components/ui/*` (Dialog, Tabs, Checkbox, Button, Input, Label, Textarea, Card). No new UI libs.
- **No cross-project impact allowed** - do not touch `types/app.types.ts`, DB schema, or markup logic. If a change seems to need that, stop and flag.
- **Commits are Dor's call** - each task ends by _staging_ changes for review; Dor commits via `/commit-push`. Do not run `git commit` yourself.
- Client components that use hooks/handlers must start with `"use client"`.
- All new batch files live under `app/(dashboard)/tixstock-events/batch/`.

---

## File Structure

| File                                                                   | Responsibility                                                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `app/(dashboard)/tixstock-events/batch/tixstock-to-event.ts`           | Pure mapping `TixStockEventDB -> Omit<Event,"id">` + `calculateSmartDates`. Shared by single- and batch-create.               |
| `app/(dashboard)/tixstock-events/batch/batch-event-fields.tsx`         | Controlled lean field set (all shareable fields + flight/hotel price Search). Rendered by shared form and each tab.           |
| `app/(dashboard)/tixstock-events/batch/batch-shared-form.tsx`          | Dialog wrapping `BatchEventFields` empty-start; emits `shared: Partial<Event>` (filled keys only).                            |
| `app/(dashboard)/tixstock-events/batch/batch-create-overlay.tsx`       | Full-screen tabbed overlay; per-tab state, merge, per-tab save + status, unsaved-close guard.                                 |
| `app/(dashboard)/tixstock-events/tixstock-events-content.tsx` (modify) | Selection state, card checkboxes, sticky bar, mount shared form -> overlay; single-create refactored onto the shared mapping. |

Merge helper `mergeShared(base, shared)` and the `SharedDraft` type live in `tixstock-to-event.ts` so both the overlay and shared form import one source of truth.

---

### Task 1: Shared TixStock→Event mapping helper

**Files:**

- Create: `app/(dashboard)/tixstock-events/batch/tixstock-to-event.ts`
- Modify: `app/(dashboard)/tixstock-events/tixstock-events-content.tsx` (single-create `handleCreateEventFromTixStock` reuses the helper)

**Interfaces:**

- Produces:
  - `calculateSmartDates(dateISO: string): { departure: string; return: string }`
  - `tixstockToEvent(event: TixStockEventDB): Omit<Event, "id">`
  - `type SharedDraft = Partial<Omit<Event, "id">>`
  - `mergeShared(base: Omit<Event,"id">, shared: SharedDraft): Omit<Event,"id">` - copies only keys whose `shared` value is defined AND non-empty (`"" `, `null`, `undefined` skipped; `false`/`0` skipped too since they equal the base default and must not clobber a per-event value - see Step 3 predicate).

- [ ] **Step 1: Create the mapping module**

Copy the existing `calculateSmartDates` body (currently in `tixstock-events-content.tsx` ~lines 285-314) and the `handleCreateEventFromTixStock` mapping (lines 316-353) into a pure module. No React, no toast, no `window`.

```ts
// app/(dashboard)/tixstock-events/batch/tixstock-to-event.ts
import type { Event } from "@/types/app.types";
import type { TixStockEventDB } from "@/types/tixstock.types";

export function calculateSmartDates(dateISO: string): {
  departure: string;
  return: string;
} {
  const event = new Date(dateISO);
  const departure = new Date(event);
  departure.setDate(event.getDate() - 1); // day before
  if (departure.getDay() === 6) departure.setDate(departure.getDate() - 1); // avoid Saturday
  const returnDate = new Date(event);
  returnDate.setDate(event.getDate() + 1);
  if (returnDate.getDay() === 6) returnDate.setDate(returnDate.getDate() + 1); // move to Sunday
  return {
    departure: departure.toISOString().split("T")[0],
    return: returnDate.toISOString().split("T")[0],
  };
}
```

> NOTE: mirror the ACTUAL departure logic from the current `calculateSmartDates` (read lines 285-314 before writing - the snippet above shows the shape; use the real day-offset rules verbatim so single-create behavior is unchanged).

```ts
export function tixstockToEvent(event: TixStockEventDB): Omit<Event, "id"> {
  const dateISO = new Date(event.show_date).toISOString().split("T")[0];
  const smart = calculateSmartDates(dateISO);
  return {
    name: event.event_name,
    name_english: event.event_name,
    type: "tx_event",
    date: dateISO,
    location: {
      latitude: event.venue_data?.latitude || 0,
      longitude: event.venue_data?.longitude || 0,
      name: event.venue_name || "Unknown Venue",
      city_iata: "",
      country_code: undefined,
    },
    map_image_url: event.venue_map_url || "",
    description: `${event.event_name} at ${event.venue_name}`,
    card_image_url: "",
    tickets_and_rates: [],
    def_date_depart: smart.departure,
    def_date_return: smart.return,
    usual_price: 0,
    base_flight_price: 0,
    base_hotel_price: 0,
    is_prioritized: false,
    event_additional_markup: null,
    is_deleted: "",
    tags: "",
  };
}
```

- [ ] **Step 2: Add the shared-draft type and merge helper**

```ts
export type SharedDraft = Partial<Omit<Event, "id">>;

// A shared value overrides the per-event base only when the admin actually
// entered something. Empty string / null / undefined never clobber a base value.
// Booleans and numbers ARE meaningful only when the field is not a default-zero
// field, so we treat 0 and false as "not set" for the always-shareable scalar
// toggles (is_prioritized, skip_flight) and for price/markup fields - the tab
// still shows the base, and the admin can override inside the tab.
function isSet(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return v !== 0;
  if (typeof v === "boolean") return v === true;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function mergeShared(
  base: Omit<Event, "id">,
  shared: SharedDraft,
): Omit<Event, "id"> {
  const out = { ...base };
  (Object.keys(shared) as (keyof SharedDraft)[]).forEach((k) => {
    const val = shared[k];
    if (isSet(val)) {
      // @ts-expect-error index write across the union of Event value types
      out[k] = val;
    }
  });
  return out;
}
```

- [ ] **Step 3: Refactor single-create to use the helper**

In `tixstock-events-content.tsx`, replace the inline mapping in `handleCreateEventFromTixStock` with `const eventData = tixstockToEvent(event);` then keep the existing `encodeURIComponent(JSON.stringify(eventData))` + `window.open('/events/new?...')` + toast. Delete the now-duplicated local `calculateSmartDates` and inline mapping. Import from `./batch/tixstock-to-event`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `tixstock-to-event.ts` or `tixstock-events-content.tsx`.

- [ ] **Step 5: Manual check**

`npm run dev`, open `/tixstock-events`, pick a performer, click a single event's **Create Event** button. Expected: same behavior as before - new tab at `/events/new?data=...&txEventId=...` pre-filled identically. (Regression guard for the extraction.)

- [ ] **Step 6: Stage for review**

```bash
git add "app/(dashboard)/tixstock-events/batch/tixstock-to-event.ts" "app/(dashboard)/tixstock-events/tixstock-events-content.tsx"
```

Tell Dor it's ready; he commits via `/commit-push`.

---

### Task 2: `BatchEventFields` - controlled lean field component

**Files:**

- Create: `app/(dashboard)/tixstock-events/batch/batch-event-fields.tsx`

**Interfaces:**

- Consumes: `Omit<Event,"id">` value shape from Task 1.
- Produces:
  - `type BatchFieldsValue = Omit<Event, "id">`
  - `function BatchEventFields(props: { value: BatchFieldsValue; onChange: (next: BatchFieldsValue) => void; mode: "shared" | "tab"; disabled?: boolean }): JSX.Element`

- [ ] **Step 1: Scaffold the client component and change helpers**

```tsx
"use client";
import type { Event } from "@/types/app.types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ImageFilePicker } from "@/components/image-file-picker"; // confirm exact path/name used in events/[id]/page.tsx imports
import { ArtBlobPicker } from "@/components/art-blob-picker"; // confirm exact path/name

export type BatchFieldsValue = Omit<Event, "id">;

export function BatchEventFields({
  value,
  onChange,
  mode,
  disabled,
}: {
  value: BatchFieldsValue;
  onChange: (next: BatchFieldsValue) => void;
  mode: "shared" | "tab";
  disabled?: boolean;
}) {
  const set = <K extends keyof BatchFieldsValue>(
    k: K,
    v: BatchFieldsValue[K],
  ) => onChange({ ...value, [k]: v });
  const setLoc = (patch: Partial<BatchFieldsValue["location"]>) =>
    onChange({ ...value, location: { ...value.location, ...patch } });
  // ...fields below
}
```

> Before writing the JSX, read `app/(dashboard)/events/[id]/page.tsx` lines 1189-1560 and 1621-1724. Mirror each field's markup exactly (labels, shadcn components, `ImageFilePicker`/`ArtBlobPicker` props, the `type` `<select>` options, the tags `<select>` options) - but drive them from `value`/`set(...)` instead of that page's `setEvent`. This keeps parity without importing the page.

- [ ] **Step 2: Add the fields (drive every one from `value`/`set`)**

Include exactly these, each controlled: `name`, `name_english`, `type` (select), `description` (Textarea), `date` (+ recompute `def_date_depart`/`def_date_return` via `calculateSmartDates` on change, mirroring the page), `def_date_depart`, `def_date_return`, `location.name`, `location.city_iata` (uppercase), `location.latitude`, `location.longitude`, `usual_price`, `base_flight_price`, `base_hotel_price`, `map_image_url` (ImageFilePicker), `card_image_url` (ImageFilePicker), `art_image_url`+`art_color_index`+`art_shape_index` (ArtBlobPicker), `is_prioritized` (Switch), `skip_flight` (Switch) + `skip_flight_markup` (number, only when `skip_flight`), `event_additional_markup` (number), `tags` (select). Representative field:

```tsx
<div className="space-y-2">
  <Label htmlFor="name">Name</Label>
  <Input
    id="name"
    value={value.name}
    disabled={disabled}
    onChange={(e) => set("name", e.target.value)}
  />
</div>
```

Do NOT include here: `tickets_and_rates`, `tx_excluded_sections`, offline flight/hotel link panels. (Tickets/tx-sections are handled in the tab in Task 5; link panels are out of scope.)

- [ ] **Step 3: In `shared` mode, add empty-friendly placeholders**

When `mode === "shared"`, show a one-line hint at top: _"Fill only the fields shared by all selected events. Blank = each event keeps its own value."_ Numeric fields default to `0` and boolean toggles to `off` - those are treated as "not set" by `mergeShared` (Task 1), so leaving them is safe.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `batch-event-fields.tsx`. Fix any picker prop mismatches by matching the exact props used in `events/[id]/page.tsx`.

- [ ] **Step 5: Stage for review**

```bash
git add "app/(dashboard)/tixstock-events/batch/batch-event-fields.tsx"
```

---

### Task 3: Flight/hotel price Search buttons inside `BatchEventFields`

**Files:**

- Modify: `app/(dashboard)/tixstock-events/batch/batch-event-fields.tsx`

**Interfaces:**

- Consumes: existing server actions `searchFlightPrices`, `searchHotelPrices` (same imports used by `events/[id]/page.tsx`), util `isValidIATACode`.
- Produces: Search buttons that write `base_flight_price` / `base_hotel_price` into `value` via `onChange`.

- [ ] **Step 1: Import the existing actions/util**

Match the import paths used at the top of `events/[id]/page.tsx` for `searchFlightPrices`, `searchHotelPrices`, `isValidIATACode`, and `useToast`.

- [ ] **Step 2: Add local searching state + handlers (thin wrappers of the page logic, lines 469-595)**

```tsx
const { toast } = useToast();
const [searchingFlights, setSearchingFlights] = useState(false);
const [searchingHotels, setSearchingHotels] = useState(false);

const searchFlights = async () => {
  const { city_iata } = value.location;
  if (
    !city_iata ||
    !value.def_date_depart ||
    !value.def_date_return ||
    !isValidIATACode(city_iata)
  )
    return;
  setSearchingFlights(true);
  try {
    const r = await searchFlightPrices({
      originLocationCode: "TLV",
      destinationLocationCode: city_iata,
      departureDate: value.def_date_depart,
      returnDate: value.def_date_return,
      adults: 1,
      currencyCode: "USD",
    });
    if (r.success && r.cheapestPrice) {
      set("base_flight_price", Math.round(r.cheapestPrice));
      toast({
        title: "Flight Prices Updated",
        description: `From TLV to ${city_iata}: $${Math.round(r.cheapestPrice)}`,
      });
    } else if (!r.success) {
      toast({
        variant: "destructive",
        title: "Flight Search Error",
        description: r.message || "Could not fetch flight prices",
      });
    }
  } catch {
    toast({
      variant: "destructive",
      title: "Flight Search Error",
      description: "Failed to search for flight prices",
    });
  } finally {
    setSearchingFlights(false);
  }
};
```

Add `searchHotels` the same way, mirroring `searchHotelPricesForEvent` (lines 534-595): guard on `location.latitude/longitude` + `def_date_depart/return`, call `searchHotelPrices({ lat, lon, checkin, checkout })`, write `base_hotel_price`.

- [ ] **Step 3: Wire the buttons next to the price inputs**

Mirror the existing Search button markup at lines 1309-1343 (flights) and 1356-1402 (hotels): `disabled={searchingFlights}` etc., `Loader2` spinner label while searching.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Stage for review**

```bash
git add "app/(dashboard)/tixstock-events/batch/batch-event-fields.tsx"
```

---

### Task 4: `BatchSharedForm` dialog

**Files:**

- Create: `app/(dashboard)/tixstock-events/batch/batch-shared-form.tsx`

**Interfaces:**

- Consumes: `BatchEventFields`, `SharedDraft`, `tixstockToEvent` (for an empty base skeleton).
- Produces: `function BatchSharedForm(props: { open: boolean; count: number; onCancel: () => void; onContinue: (shared: SharedDraft) => void }): JSX.Element`

- [ ] **Step 1: Build an empty base and diff against it to extract filled keys**

```tsx
"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BatchEventFields, type BatchFieldsValue } from "./batch-event-fields";
import type { SharedDraft } from "./tixstock-to-event";

const EMPTY_BASE: BatchFieldsValue = {
  name: "",
  name_english: "",
  type: "tx_event",
  date: "",
  location: {
    latitude: 0,
    longitude: 0,
    name: "",
    city_iata: "",
    country_code: undefined,
  },
  map_image_url: "",
  description: "",
  card_image_url: "",
  tickets_and_rates: [],
  def_date_depart: "",
  def_date_return: "",
  usual_price: 0,
  base_flight_price: 0,
  base_hotel_price: 0,
  is_prioritized: false,
  event_additional_markup: null,
  is_deleted: "",
  tags: "",
};

export function BatchSharedForm({
  open,
  count,
  onCancel,
  onContinue,
}: {
  open: boolean;
  count: number;
  onCancel: () => void;
  onContinue: (shared: SharedDraft) => void;
}) {
  const [draft, setDraft] = useState<BatchFieldsValue>(EMPTY_BASE);
  const toShared = (): SharedDraft => {
    const out: SharedDraft = {};
    (Object.keys(EMPTY_BASE) as (keyof BatchFieldsValue)[]).forEach((k) => {
      if (JSON.stringify(draft[k]) !== JSON.stringify(EMPTY_BASE[k])) {
        // @ts-expect-error union index write
        out[k] = draft[k];
      }
    });
    return out;
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Shared values for {count} events</DialogTitle>
        </DialogHeader>
        <BatchEventFields value={draft} onChange={setDraft} mode="shared" />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onContinue(toShared())}>Continue →</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Note: `toShared` sends only keys the admin changed from `EMPTY_BASE`; `mergeShared` (Task 1) then applies its own `isSet` guard as a second safety net.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Stage for review**

```bash
git add "app/(dashboard)/tixstock-events/batch/batch-shared-form.tsx"
```

---

### Task 5: `BatchCreateOverlay` - tabs, merge, per-tab save

**Files:**

- Create: `app/(dashboard)/tixstock-events/batch/batch-create-overlay.tsx`

**Interfaces:**

- Consumes: `BatchEventFields`, `tixstockToEvent`, `mergeShared`, `SharedDraft`, `createEvent` (`@/lib/actions/event-actions`), `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `Dialog`, `TixStockEventDB`.
- Produces: `function BatchCreateOverlay(props: { open: boolean; events: TixStockEventDB[]; shared: SharedDraft; onClose: () => void }): JSX.Element`

- [ ] **Step 1: Build per-tab initial state from merge**

```tsx
"use client";
import { useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { BatchEventFields, type BatchFieldsValue } from "./batch-event-fields";
import {
  tixstockToEvent,
  mergeShared,
  type SharedDraft,
} from "./tixstock-to-event";
import { createEvent } from "@/lib/actions/event-actions";
import { useToast } from "@/components/ui/use-toast";
import type { TixStockEventDB } from "@/types/tixstock.types";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function BatchCreateOverlay({
  open,
  events,
  shared,
  onClose,
}: {
  open: boolean;
  events: TixStockEventDB[];
  shared: SharedDraft;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const initial = useMemo<BatchFieldsValue[]>(
    () => events.map((e) => mergeShared(tixstockToEvent(e), shared)),
    [events, shared],
  );
  const [forms, setForms] = useState<BatchFieldsValue[]>(initial);
  const [status, setStatus] = useState<SaveStatus[]>(() =>
    events.map(() => "idle"),
  );
  const [active, setActive] = useState("0");
  // ...
}
```

Note: keep the `tx_excluded_sections` and `tickets_and_rates` from `tixstockToEvent` (empty by default). If the tab needs the TixStock ticket picker later, that is a follow-up; batch tabs save with the mapped defaults unless the admin edits.

- [ ] **Step 2: Per-tab validation + save handler (reuse `createEvent`)**

```tsx
const validate = (f: BatchFieldsValue): string | null => {
  if (!f.name.trim()) return "Name is required";
  if (!f.name_english.trim()) return "English name is required";
  if (!f.date) return "Date is required";
  if (!f.location.latitude || !f.location.longitude)
    return "Location coordinates are required";
  if (!f.usual_price) return "Usual price is required";
  if (!f.base_flight_price) return "Base flight price is required";
  if (!f.base_hotel_price) return "Base hotel price is required";
  return null;
};

const saveOne = async (i: number) => {
  const err = validate(forms[i]);
  if (err) {
    toast({ variant: "destructive", title: "Missing field", description: err });
    return;
  }
  setStatus((s) => s.map((v, idx) => (idx === i ? "saving" : v)));
  try {
    await createEvent(forms[i]); // is_deleted forced null inside the action
    setStatus((s) => s.map((v, idx) => (idx === i ? "saved" : v)));
    toast({ title: "Event created", description: forms[i].name });
  } catch (e) {
    console.error("Batch create failed:", JSON.stringify(e));
    setStatus((s) => s.map((v, idx) => (idx === i ? "error" : v)));
    toast({
      variant: "destructive",
      title: "Create failed",
      description: forms[i].name,
    });
  }
};
```

- [ ] **Step 3: Render tabs with status badges and a locked saved state**

```tsx
<Tabs value={active} onValueChange={setActive}>
  <TabsList className="flex-wrap">
    {events.map((e, i) => (
      <TabsTrigger key={e.event_id} value={String(i)} className="gap-1">
        {status[i] === "saved" && <Check className="h-3 w-3 text-green-600" />}
        {status[i] === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
        {status[i] === "error" && (
          <AlertCircle className="h-3 w-3 text-red-600" />
        )}
        {forms[i].name || `Event ${i + 1}`}
      </TabsTrigger>
    ))}
  </TabsList>
  {events.map((e, i) => (
    <TabsContent key={e.event_id} value={String(i)}>
      <BatchEventFields
        value={forms[i]}
        onChange={(next) =>
          setForms((all) => all.map((f, idx) => (idx === i ? next : f)))
        }
        mode="tab"
        disabled={status[i] === "saved" || status[i] === "saving"}
      />
      <div className="flex justify-end pt-4">
        <Button
          onClick={() => saveOne(i)}
          disabled={status[i] === "saved" || status[i] === "saving"}
        >
          {status[i] === "saved"
            ? "Saved ✓"
            : status[i] === "saving"
              ? "Saving…"
              : "Save this event"}
        </Button>
      </div>
    </TabsContent>
  ))}
</Tabs>
```

- [ ] **Step 4: Unsaved-close guard**

Wrap the overlay in `<Dialog open={open} onOpenChange={handleOpenChange}>` where:

```tsx
const unsaved = status.filter((s) => s !== "saved").length;
const handleOpenChange = (o: boolean) => {
  if (o) return;
  if (
    unsaved > 0 &&
    !window.confirm(`${unsaved} event(s) not saved. Discard and close?`)
  )
    return;
  onClose();
};
```

Use `DialogContent` with `className="max-w-5xl max-h-[90vh] overflow-y-auto"`.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Stage for review**

```bash
git add "app/(dashboard)/tixstock-events/batch/batch-create-overlay.tsx"
```

---

### Task 6: Selection UI + wiring on the TixStock page

**Files:**

- Modify: `app/(dashboard)/tixstock-events/tixstock-events-content.tsx`

**Interfaces:**

- Consumes: `BatchSharedForm`, `BatchCreateOverlay`, existing `filteredEvents`/events-list render, `Checkbox` from `components/ui/checkbox`.
- Produces: selection UX that ends by opening the shared form then the overlay.

- [ ] **Step 1: Add selection state (scoped to the performer-filtered events list)**

```tsx
const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(
  new Set(),
);
const [sharedFormOpen, setSharedFormOpen] = useState(false);
const [overlayOpen, setOverlayOpen] = useState(false);
const [sharedDraft, setSharedDraft] = useState<SharedDraft>({});

const toggleSelected = (id: string) =>
  setSelectedEventIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

const selectedEvents = useMemo(
  () => filteredEvents.filter((e) => selectedEventIds.has(e.event_id)),
  [filteredEvents, selectedEventIds],
);
```

When `selectedPerformer` changes, clear selection: add an effect `useEffect(() => setSelectedEventIds(new Set()), [selectedPerformer])` so a batch never mixes performers.

- [ ] **Step 2: Add a checkbox to each event card**

In the event-card render (around lines 647-700), add a `Checkbox` (stop propagation so it doesn't trigger the card's select-event click):

```tsx
<Checkbox
  checked={selectedEventIds.has(event.event_id)}
  onCheckedChange={() => toggleSelected(event.event_id)}
  onClick={(e) => e.stopPropagation()}
  aria-label={`Select ${event.event_name}`}
/>
```

- [ ] **Step 3: Add the sticky selection bar**

Above/below the events list, when `selectedEventIds.size > 0`:

```tsx
{
  selectedEventIds.size > 0 && (
    <div className="sticky bottom-0 z-10 flex items-center justify-between rounded-md border bg-background p-3 shadow">
      <span>{selectedEventIds.size} selected</span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => setSelectedEventIds(new Set())}
        >
          Clear
        </Button>
        <Button onClick={() => setSharedFormOpen(true)}>
          Create {selectedEventIds.size} events
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount the shared form and overlay**

```tsx
<BatchSharedForm
  open={sharedFormOpen}
  count={selectedEventIds.size}
  onCancel={() => setSharedFormOpen(false)}
  onContinue={(shared) => {
    setSharedDraft(shared);
    setSharedFormOpen(false);
    setOverlayOpen(true);
  }}
/>;
{
  overlayOpen && (
    <BatchCreateOverlay
      open={overlayOpen}
      events={selectedEvents}
      shared={sharedDraft}
      onClose={() => {
        setOverlayOpen(false);
        setSelectedEventIds(new Set());
      }}
    />
  );
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Stage for review**

```bash
git add "app/(dashboard)/tixstock-events/tixstock-events-content.tsx"
```

---

### Task 7: End-to-end manual QA + polish

**Files:** none new (fix-ups only, in the files above)

- [ ] **Step 1: Full type gate**

Run: `npx tsc --noEmit`
Expected: no errors across all new/modified files.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors in `app/(dashboard)/tixstock-events/**`.

- [ ] **Step 3: Manual E2E**

`npm run dev` → `/tixstock-events`:

1. Pick a performer; confirm checkboxes appear only on that performer's events.
2. Select 3 events; sticky bar shows "3 selected".
3. Click **Create 3 events**; in the shared form fill `type`, `description`, a `tag`, and `event_additional_markup`; leave `date`/location blank; **Continue**.
4. Overlay opens with 3 tabs. Confirm each tab shows: shared `type`/`description`/`tag`/`markup` applied, AND its own TixStock `name`/`date`/`venue`/coords.
5. In tab 1 run **Search Flights** and **Search Hotels**; prices populate. Fill `usual_price`. **Save this event** → green check, tab locks.
6. In tab 2 leave `usual_price` blank and Save → blocked with "Usual price is required".
7. Switch performer → confirm selection resets (no cross-performer batch).
8. Close overlay with an unsaved tab → confirm discard prompt.
9. Verify in `/events` the saved event(s) exist with the shared values.

- [ ] **Step 4: Fix any issues found, re-run Step 1.**

- [ ] **Step 5: Stage for review**

```bash
git add -A "app/(dashboard)/tixstock-events"
```

Hand off to Dor for `/commit-push`.

---

## Self-Review

**Spec coverage:**

- Multi-select scoped to performer → Task 6 Step 1 (effect clears on performer change) + Step 2 checkboxes. ✓
- Shared form = all shareable fields, blank=not shared → Task 2 (fields) + Task 4 (`toShared` diff) + Task 1 (`mergeShared`/`isSet`). ✓
- Merge rule (shared wins, else TixStock, else empty) → Task 1 `mergeShared` + Task 5 Step 1 `initial`. ✓
- Tabs, per-tab pre-fill → Task 5 Steps 1,3. ✓
- Per-tab save via `createEvent`, no bulk action → Task 5 Step 2. ✓
- Save status badges + locked saved tab → Task 5 Steps 2,3. ✓
- Fixed exceptions (tickets per-tab, no link panels) → Task 2 Step 2 exclusions; Task 5 Step 1 note. ✓
- Error handling (validation block, createEvent throw isolated, unsaved-close confirm) → Task 5 Steps 2,4; Task 7 Step 3.6/3.8. ✓
- Flight/hotel Search parity → Task 3. ✓
- No cross-project/DB/type/price change → Global Constraints; reuse-only tasks. ✓

**Placeholder scan:** No TBD/TODO. JSX-heavy fields reference exact existing line ranges to mirror (DRY) with a representative concrete example each - intentional to avoid pasting the 300-line field block, not a placeholder. Every logic step has real code.

**Type consistency:** `SharedDraft`, `BatchFieldsValue = Omit<Event,"id">`, `tixstockToEvent`, `mergeShared`, `calculateSmartDates` names used consistently across Tasks 1,2,4,5. `createEvent(event: Omit<Event,"id">)` matches `lib/actions/event-actions.ts`. `TixStockEventDB` fields (`event_id`, `event_name`, `show_date`, `venue_name`, `venue_data.latitude/longitude`, `venue_map_url`) match `types/tixstock.types.ts`.

**Known follow-ups (out of scope, flagged):** TixStock per-tab ticket picker + `tx_excluded_sections` editing in the batch tab (batch tabs save with mapped defaults); linking existing offline flights/hotels at create time.

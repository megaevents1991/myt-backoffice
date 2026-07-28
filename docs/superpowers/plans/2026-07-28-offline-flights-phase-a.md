# Offline Flights Phase A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the operational fields, the series builder, list-view editing (inline + drawer + bulk), the ticketing Excel exports, and passenger identity fields — all inside `myt-backoffice`, with zero changes to `myt-main`.

**Architecture:** One shared client component (`flights-editable-table.tsx`) renders every flight list in the app — the `/offline-flights` page and the flights block inside the event page. All writes go through Server Actions that map columns against an explicit allowlist. The series builder is a four-step page that composes many `flights` rows from one shared template plus a set of departure dates.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, shadcn/ui (Radix), Tailwind, Supabase (service-role, server-side), `react-hook-form` + `zod`, `exceljs` (new dependency).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-offline-flights-expansion-design.md`.
- **This phase is backoffice-only.** Do not edit anything under `../myt-main`.
- All new columns are nullable; no data backfill; existing rows keep working unchanged.
- Every Server Action starts with `await requireStaff()` and maps columns explicitly — never spread a client object into `.insert()` / `.update()`.
- Every API route starts with `await guardAdminRoute()` and returns its `NextResponse` when non-null.
- Soft delete only: `flights.is_deleted` is a boolean on this table (unlike `events.is_deleted`, which is an `MM-DD-YYYY` string). Never hard-delete.
- `price` stays the **selling** price. `cost_price` is what we pay the supplier, backoffice-only, and never enters the customer price chain.
- The project has **no test suite**. The verification gate for every task is `npx tsc --noEmit` (the build ignores TS errors, so `tsc` is the real gate) plus the stated manual check on `npm run dev`.
- Commit style: conventional commits. **Never add an AI co-author line.**
- Do not run `npm run db:push` or the migrations GitHub Action. Migrations are committed and then **Dor applies them**; the plan says exactly where to stop and ask.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_add_flight_ops_fields.sql` | New `flights` columns, `block_status` check, drop `flights_stops_check` |
| `types/offline-flight.types.ts` | `OfflineFlight` gains the new optional fields |
| `lib/actions/offline-flight-columns.ts` | Column allowlist + `pickFlightColumns` — shared by every write path |
| `lib/actions/offline-flight-actions.ts` | Existing CRUD, converted to explicit column mapping |
| `lib/actions/offline-flight-bulk-actions.ts` | Bulk update / price adjust / event link / delete / restore / series create |
| `components/flights-editable-table.tsx` | The one flight table: inline edit, drawer, column picker, bulk toolbar, filters |
| `components/flight-field-groups.tsx` | Field definitions (label, type, group) driving both the drawer and the column picker |
| `app/(dashboard)/offline-flights/offline-flights-table.tsx` | Thin wrapper — fetches and renders the shared table |
| `app/(dashboard)/offline-flights/series/new/page.tsx` | Four-step series builder |
| `lib/exports/flight-workbook.ts` | Pure workbook builders (inventory + manifest) |
| `app/api/exports/flights/route.ts` | Inventory xlsx download |
| `app/api/exports/flight-pax/route.ts` | Ticketing manifest xlsx download |
| `types/reservation.types.ts` | `more_pax_info` gains identity fields |

---

### Task 1: Schema — new flight columns

**Files:**
- Create: `supabase/migrations/<timestamp>_add_flight_ops_fields.sql`
- Modify: `types/offline-flight.types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `OfflineFlight` optional fields every later task reads and writes — `cost_price`, `cost_currency`, `supplier`, `pnr`, `group_code`, `ticketing_deadline`, `last_cancellation_date`, `payment_deadline`, `option_expiry`, `checked_bag_kg`, `cabin_bag_kg`, `cabin_class`, `aircraft_type`, `block_status`, `notes`, `handled_by`, `series_id`, `series_name`, `outbound_stop_airport`, `outbound_stop_duration`, `inbound_stop_airport`, `inbound_stop_duration`.

- [ ] **Step 1: Create the migration file**

```bash
npm run db:new add_flight_ops_fields
```

- [ ] **Step 2: Write the migration SQL**

Put this in the generated file:

```sql
alter table "public"."flights"
  add column "cost_price"             numeric(10,2),
  add column "cost_currency"          varchar(3),
  add column "supplier"               text,
  add column "pnr"                    text,
  add column "group_code"             text,
  add column "ticketing_deadline"     date,
  add column "last_cancellation_date" date,
  add column "payment_deadline"       date,
  add column "option_expiry"          date,
  add column "checked_bag_kg"         integer,
  add column "cabin_bag_kg"           integer,
  add column "cabin_class"            text,
  add column "aircraft_type"          text,
  add column "block_status"           text,
  add column "notes"                  text,
  add column "handled_by"             text,
  add column "series_id"              uuid,
  add column "series_name"            text,
  add column "outbound_stop_airport"  varchar(3),
  add column "outbound_stop_duration" interval,
  add column "inbound_stop_airport"   varchar(3),
  add column "inbound_stop_duration"  interval;

alter table "public"."flights"
  add constraint "flights_block_status_check"
  check ("block_status" is null or "block_status" in ('option','confirmed','ticketed'));

-- Connecting flights were impossible to store while this held stops at 0.
alter table "public"."flights" drop constraint if exists "flights_stops_check";
alter table "public"."flights"
  add constraint "flights_stops_check" check ("stops" >= 0);

create index if not exists "flights_series_id_idx" on "public"."flights" ("series_id");
```

- [ ] **Step 3: Extend the TypeScript type**

Append to the `OfflineFlight` interface in `types/offline-flight.types.ts`, before the closing brace:

```ts
  // --- supplier / commercial (backoffice-only, never in the customer price chain)
  cost_price?: number | null;      // NUMERIC(10,2) — what we pay the supplier
  cost_currency?: string | null;   // VARCHAR(3)
  supplier?: string | null;
  pnr?: string | null;
  group_code?: string | null;

  // --- deadlines
  ticketing_deadline?: string | null;     // DATE "YYYY-MM-DD"
  last_cancellation_date?: string | null; // DATE
  payment_deadline?: string | null;       // DATE
  option_expiry?: string | null;          // DATE

  // --- operations
  checked_bag_kg?: number | null;
  cabin_bag_kg?: number | null;
  cabin_class?: string | null;
  aircraft_type?: string | null;
  block_status?: "option" | "confirmed" | "ticketed" | null;

  // --- misc
  notes?: string | null;
  handled_by?: string | null;

  // --- series (set by createOfflineFlightSeries; shared by one batch)
  series_id?: string | null;   // uuid
  series_name?: string | null;

  // --- single stopover per leg (null = non-stop)
  outbound_stop_airport?: string | null;   // VARCHAR(3)
  outbound_stop_duration?: string | null;  // INTERVAL, e.g. "PT2H30M"
  inbound_stop_airport?: string | null;
  inbound_stop_duration?: string | null;
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations types/offline-flight.types.ts
git commit -m "feat(offline-flights): add supplier, deadline, ops and series columns"
```

- [ ] **Step 6: STOP — ask Dor to apply the migration**

Tell Dor: *"Migration A is committed. Run `npm run db:push`, or GitHub → Actions → 'Apply DB Migrations' → Run workflow. Then I'll regenerate `types/database.types.ts`."*

Do not continue to Task 2 until he confirms it applied.

- [ ] **Step 7: Regenerate database types and commit**

```bash
npm run db:types
git add types/database.types.ts
git commit -m "chore(types): regenerate database types after flight ops fields"
```

---

### Task 2: Column allowlist + explicit mapping in the CRUD actions

**Files:**
- Create: `lib/actions/offline-flight-columns.ts`
- Modify: `lib/actions/offline-flight-actions.ts` (`createOfflineFlight` ~line 37, `updateOfflineFlight` ~line 60)

**Interfaces:**
- Consumes: `OfflineFlight` from Task 1.
- Produces: `FLIGHT_WRITABLE_COLUMNS`, `pickFlightColumns(input)`, `FlightWritableColumn` — used by every write path in Tasks 4, 7 and by the table in Task 5.

**Why:** `CLAUDE.md` flags `offline-flight-actions.ts` for mass assignment — it spreads a whole client object into the update. Bulk editing (Task 4) applies one payload to many rows, so leaving that unfixed multiplies the exposure across every selected row.

- [ ] **Step 1: Write the allowlist module**

Create `lib/actions/offline-flight-columns.ts`:

```ts
import type { OfflineFlight } from "@/types/offline-flight.types";

// Every column a client is allowed to write. `id`, `consumed_quantity`,
// `is_deleted` and `series_id` are deliberately absent: they are set by the
// server or by a dedicated action, never by a form payload.
export const FLIGHT_WRITABLE_COLUMNS = [
  "initial_quantity", "price", "duration", "stops", "airline_code",
  "outbound_departure_time", "outbound_departure_airport",
  "outbound_arrival_airport", "outbound_arrival_time", "outbound_duration",
  "outbound_check_bags_included", "outbound_cabin_bags_included",
  "outbound_flight_number",
  "inbound_departure_time", "inbound_departure_airport",
  "inbound_arrival_airport", "inbound_arrival_time", "inbound_duration",
  "inbound_check_bags_included", "inbound_cabin_bags_included",
  "inbound_flight_number",
  "metadata_iata", "metadata_name", "metadata_logo",
  "event_ids",
  "cost_price", "cost_currency", "supplier", "pnr", "group_code",
  "ticketing_deadline", "last_cancellation_date", "payment_deadline",
  "option_expiry",
  "checked_bag_kg", "cabin_bag_kg", "cabin_class", "aircraft_type",
  "block_status",
  "notes", "handled_by", "series_name",
  "outbound_stop_airport", "outbound_stop_duration",
  "inbound_stop_airport", "inbound_stop_duration",
] as const satisfies readonly (keyof OfflineFlight)[];

export type FlightWritableColumn = (typeof FLIGHT_WRITABLE_COLUMNS)[number];

const WRITABLE = new Set<string>(FLIGHT_WRITABLE_COLUMNS);

/** Drops every key that is not an allowed column. Undefined values are skipped
 *  so a partial update never blanks a column the caller did not mention. */
export function pickFlightColumns(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (WRITABLE.has(key) && value !== undefined) out[key] = value;
  }
  return out;
}

/** Numeric/positive guards for the money and inventory columns. Throws so the
 *  action fails loudly instead of writing a NaN price. */
export function assertFlightValues(row: Record<string, unknown>): void {
  for (const key of ["price", "cost_price"] as const) {
    if (row[key] == null) continue;
    const n = Number(row[key]);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number`);
  }
  for (const key of ["initial_quantity", "stops", "checked_bag_kg", "cabin_bag_kg"] as const) {
    if (row[key] == null) continue;
    const n = Number(row[key]);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a non-negative integer`);
  }
}
```

- [ ] **Step 2: Use it in `createOfflineFlight`**

In `lib/actions/offline-flight-actions.ts`, add the import and replace the insert body:

```ts
import { pickFlightColumns, assertFlightValues } from "./offline-flight-columns";

export async function createOfflineFlight(
  flight: Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted">,
) {
  await requireStaff();
  const row = pickFlightColumns(flight as Record<string, unknown>);
  assertFlightValues(row);
  const { data, error } = await flightsTable()
    .insert({ ...row, consumed_quantity: 0, is_deleted: false })
    .select();
  // ...rest of the function is unchanged
```

- [ ] **Step 3: Use it in `updateOfflineFlight`**

Same file. Immediately after `await requireStaff();`, replace every later use of the raw `flight` argument in the database write with a sanitised copy:

```ts
  const patch = pickFlightColumns(flight as Record<string, unknown>);
  assertFlightValues(patch);
```

Then change the update call from `.update(flight)` to `.update(patch)`. Leave the audit call reading `flight` (auditing the caller's intent is correct) and leave the event-id / price push logic below it untouched — it reads from the returned row, not from the input.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual check**

Run `npm run dev`, open `/offline-flights`, edit an existing flight's price on `/offline-flights/<id>/edit`, save. Confirm the price changed on the list and the linked events' `base_flight_price` still updated.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/offline-flight-columns.ts lib/actions/offline-flight-actions.ts
git commit -m "fix(offline-flights): map columns explicitly instead of spreading client payloads"
```

---

### Task 3: Field-group metadata

**Files:**
- Create: `components/flight-field-groups.tsx`

**Interfaces:**
- Consumes: `OfflineFlight`, `FlightWritableColumn`.
- Produces: `FLIGHT_FIELDS: FlightField[]`, `FLIGHT_FIELD_GROUPS: string[]`, `DEFAULT_VISIBLE_COLUMNS: FlightWritableColumn[]`, `formatFlightValue(field, value)` — the single description of every editable field, consumed by the drawer, the column picker, the inline editor and the bulk-edit field selector.

**Why a separate module:** four different UI surfaces need "what fields exist, what type is each, what group does it belong to". Duplicating that list four times guarantees drift.

- [ ] **Step 1: Write the module**

Create `components/flight-field-groups.tsx`:

```tsx
import type { FlightWritableColumn } from "@/lib/actions/offline-flight-columns";

export type FlightFieldType =
  | "text" | "number" | "money" | "date" | "datetime"
  | "boolean" | "iata" | "duration" | "select";

export type FlightField = {
  key: FlightWritableColumn;
  label: string;
  group: string;
  type: FlightFieldType;
  options?: string[];   // only for type "select"
  bulkEditable: boolean; // false for per-flight identity fields like flight number
};

export const FLIGHT_FIELD_GROUPS = [
  "Inventory", "Outbound", "Inbound", "Airline", "Supplier", "Deadlines",
  "Operations", "Misc",
] as const;

export const FLIGHT_FIELDS: FlightField[] = [
  { key: "initial_quantity", label: "ORG (seats)", group: "Inventory", type: "number", bulkEditable: true },
  { key: "price", label: "Price (USD)", group: "Inventory", type: "money", bulkEditable: true },

  { key: "airline_code", label: "Airline code", group: "Airline", type: "text", bulkEditable: true },
  { key: "metadata_name", label: "Airline name", group: "Airline", type: "text", bulkEditable: true },
  { key: "metadata_iata", label: "Airline IATA", group: "Airline", type: "iata", bulkEditable: true },
  { key: "metadata_logo", label: "Airline logo URL", group: "Airline", type: "text", bulkEditable: true },

  { key: "outbound_flight_number", label: "Out flight no.", group: "Outbound", type: "text", bulkEditable: false },
  { key: "outbound_departure_airport", label: "Out from", group: "Outbound", type: "iata", bulkEditable: true },
  { key: "outbound_arrival_airport", label: "Out to", group: "Outbound", type: "iata", bulkEditable: true },
  { key: "outbound_departure_time", label: "Out departure", group: "Outbound", type: "datetime", bulkEditable: false },
  { key: "outbound_arrival_time", label: "Out arrival", group: "Outbound", type: "datetime", bulkEditable: false },
  { key: "outbound_duration", label: "Out duration", group: "Outbound", type: "duration", bulkEditable: false },
  { key: "outbound_check_bags_included", label: "Out checked bag", group: "Outbound", type: "boolean", bulkEditable: true },
  { key: "outbound_cabin_bags_included", label: "Out cabin bag", group: "Outbound", type: "boolean", bulkEditable: true },
  { key: "outbound_stop_airport", label: "Out stopover", group: "Outbound", type: "iata", bulkEditable: true },
  { key: "outbound_stop_duration", label: "Out stop duration", group: "Outbound", type: "duration", bulkEditable: true },

  { key: "inbound_flight_number", label: "In flight no.", group: "Inbound", type: "text", bulkEditable: false },
  { key: "inbound_departure_airport", label: "In from", group: "Inbound", type: "iata", bulkEditable: true },
  { key: "inbound_arrival_airport", label: "In to", group: "Inbound", type: "iata", bulkEditable: true },
  { key: "inbound_departure_time", label: "In departure", group: "Inbound", type: "datetime", bulkEditable: false },
  { key: "inbound_arrival_time", label: "In arrival", group: "Inbound", type: "datetime", bulkEditable: false },
  { key: "inbound_duration", label: "In duration", group: "Inbound", type: "duration", bulkEditable: false },
  { key: "inbound_check_bags_included", label: "In checked bag", group: "Inbound", type: "boolean", bulkEditable: true },
  { key: "inbound_cabin_bags_included", label: "In cabin bag", group: "Inbound", type: "boolean", bulkEditable: true },
  { key: "inbound_stop_airport", label: "In stopover", group: "Inbound", type: "iata", bulkEditable: true },
  { key: "inbound_stop_duration", label: "In stop duration", group: "Inbound", type: "duration", bulkEditable: true },

  { key: "cost_price", label: "Cost price", group: "Supplier", type: "money", bulkEditable: true },
  { key: "cost_currency", label: "Cost currency", group: "Supplier", type: "select", options: ["USD","EUR","GBP","ILS"], bulkEditable: true },
  { key: "supplier", label: "Supplier", group: "Supplier", type: "text", bulkEditable: true },
  { key: "pnr", label: "PNR", group: "Supplier", type: "text", bulkEditable: false },
  { key: "group_code", label: "Contract / group", group: "Supplier", type: "text", bulkEditable: true },

  { key: "ticketing_deadline", label: "Ticketing deadline", group: "Deadlines", type: "date", bulkEditable: true },
  { key: "last_cancellation_date", label: "Cancellation deadline", group: "Deadlines", type: "date", bulkEditable: true },
  { key: "payment_deadline", label: "Payment deadline", group: "Deadlines", type: "date", bulkEditable: true },
  { key: "option_expiry", label: "Option expiry", group: "Deadlines", type: "date", bulkEditable: true },

  { key: "checked_bag_kg", label: "Checked bag kg", group: "Operations", type: "number", bulkEditable: true },
  { key: "cabin_bag_kg", label: "Cabin bag kg", group: "Operations", type: "number", bulkEditable: true },
  { key: "cabin_class", label: "Cabin class", group: "Operations", type: "select", options: ["economy","premium","business"], bulkEditable: true },
  { key: "aircraft_type", label: "Aircraft", group: "Operations", type: "text", bulkEditable: true },
  { key: "block_status", label: "Block status", group: "Operations", type: "select", options: ["option","confirmed","ticketed"], bulkEditable: true },

  { key: "notes", label: "Notes", group: "Misc", type: "text", bulkEditable: true },
  { key: "handled_by", label: "Handled by", group: "Misc", type: "text", bulkEditable: true },
  { key: "series_name", label: "Series", group: "Misc", type: "text", bulkEditable: true },
];

// What the list shows before the user touches the column picker — matches the
// columns the old table displayed, plus block status.
export const DEFAULT_VISIBLE_COLUMNS: FlightWritableColumn[] = [
  "airline_code", "outbound_flight_number", "outbound_departure_airport",
  "outbound_arrival_airport", "outbound_departure_time", "inbound_departure_time",
  "price", "initial_quantity", "block_status",
];

export function formatFlightValue(field: FlightField, value: unknown): string {
  if (value == null || value === "") return "—";
  switch (field.type) {
    case "money":    return `$${Number(value).toFixed(2)}`;
    case "boolean":  return value ? "Yes" : "No";
    case "datetime": return new Date(String(value)).toLocaleString();
    default:         return String(value);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. If `as const satisfies` complains that a key is missing from `OfflineFlight`, the Task 1 type edit is incomplete — fix it there, not here.

- [ ] **Step 3: Commit**

```bash
git add components/flight-field-groups.tsx
git commit -m "feat(offline-flights): describe flight fields once for every editing surface"
```

---

### Task 4: Bulk server actions

**Files:**
- Create: `lib/actions/offline-flight-bulk-actions.ts`

**Interfaces:**
- Consumes: `pickFlightColumns`, `assertFlightValues`, `flightsTable` pattern from `offline-flight-actions.ts`, `logAudit` from `@/lib/audit`.
- Produces:
  - `bulkUpdateOfflineFlights(ids: number[], patch: Record<string, unknown>): Promise<number>` — returns rows updated
  - `bulkAdjustPrice(ids: number[], adj: PriceAdjustment): Promise<number>`
  - `bulkSetEventLink(ids: number[], eventId: number, op: "add" | "remove"): Promise<number>`
  - `bulkSoftDeleteOfflineFlights(ids: number[]): Promise<number>`
  - `bulkRestoreOfflineFlights(ids: number[]): Promise<number>`
  - `type PriceAdjustment = { mode: "set" | "delta" | "percent"; value: number }`

- [ ] **Step 1: Write the module**

Create `lib/actions/offline-flight-bulk-actions.ts`:

```ts
"use server";

import { requireStaff } from "@/lib/auth/guards";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { pickFlightColumns, assertFlightValues } from "./offline-flight-columns";
import type { OfflineFlight } from "@/types/offline-flight.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const flightsTable = () => (supabase as any).from("flights");

export type PriceAdjustment = {
  mode: "set" | "delta" | "percent";
  value: number;
};

function assertIds(ids: number[]): void {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("No flights selected");
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error("Invalid flight id");
}

async function revalidateFlights(eventIds: number[] = []): Promise<void> {
  revalidatePath("/offline-flights");
  for (const id of new Set(eventIds)) revalidatePath(`/events/${id}`);
}

export async function bulkUpdateOfflineFlights(
  ids: number[],
  patch: Record<string, unknown>,
): Promise<number> {
  await requireStaff();
  assertIds(ids);
  const row = pickFlightColumns(patch);
  // event_ids is set through bulkSetEventLink, which merges instead of replacing.
  delete row.event_ids;
  if (Object.keys(row).length === 0) throw new Error("Nothing to update");
  assertFlightValues(row);

  const { data, error } = await flightsTable().update(row).in("id", ids).select("id, event_ids");
  if (error) throw error;

  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: null,
    changes: row,
    metadata: { ids, count: ids.length, bulk: true },
  });
  await revalidateFlights((data ?? []).flatMap((f: OfflineFlight) => f.event_ids ?? []));
  return (data ?? []).length;
}

export async function bulkAdjustPrice(
  ids: number[],
  adj: PriceAdjustment,
): Promise<number> {
  await requireStaff();
  assertIds(ids);
  if (!Number.isFinite(adj.value)) throw new Error("Invalid price value");

  const { data: rows, error } = await flightsTable().select("id, price, event_ids").in("id", ids);
  if (error) throw error;

  const touchedEvents: number[] = [];
  await Promise.all(
    (rows ?? []).map(async (row: { id: number; price: number; event_ids: number[] | null }) => {
      const current = Number(row.price) || 0;
      const next =
        adj.mode === "set"     ? adj.value
      : adj.mode === "delta"   ? current + adj.value
      : /* percent */            Math.round(current * (1 + adj.value / 100));
      if (next < 0) throw new Error(`Flight ${row.id}: adjusted price would be negative`);
      touchedEvents.push(...(row.event_ids ?? []));
      const { error: upErr } = await flightsTable().update({ price: next }).eq("id", row.id);
      if (upErr) throw upErr;
    }),
  );

  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: null,
    changes: { price: adj },
    metadata: { ids, count: ids.length, bulk: true },
  });
  await revalidateFlights(touchedEvents);
  return (rows ?? []).length;
}

export async function bulkSetEventLink(
  ids: number[],
  eventId: number,
  op: "add" | "remove",
): Promise<number> {
  await requireStaff();
  assertIds(ids);
  if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("Invalid event id");

  const { data: rows, error } = await flightsTable().select("id, event_ids").in("id", ids);
  if (error) throw error;

  await Promise.all(
    (rows ?? []).map(async (row: { id: number; event_ids: number[] | null }) => {
      const existing = row.event_ids ?? [];
      const next =
        op === "add"
          ? existing.includes(eventId) ? existing : [...existing, eventId]
          : existing.filter((id) => id !== eventId);
      if (next.length === existing.length && op === "add") return;
      const { error: upErr } = await flightsTable().update({ event_ids: next }).eq("id", row.id);
      if (upErr) throw upErr;
    }),
  );

  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: null,
    metadata: { ids, count: ids.length, event_id: eventId, op, bulk: true },
  });
  await revalidateFlights([eventId]);
  return (rows ?? []).length;
}

async function bulkSetDeleted(ids: number[], isDeleted: boolean): Promise<number> {
  await requireStaff();
  assertIds(ids);
  const { data, error } = await flightsTable()
    .update({ is_deleted: isDeleted })
    .in("id", ids)
    .select("id, event_ids");
  if (error) throw error;
  await logAudit({
    action: isDeleted ? "delete" : "update",
    entityType: "offline_flight",
    entityId: null,
    metadata: { ids, count: ids.length, bulk: true, restored: !isDeleted },
  });
  await revalidateFlights((data ?? []).flatMap((f: OfflineFlight) => f.event_ids ?? []));
  return (data ?? []).length;
}

export async function bulkSoftDeleteOfflineFlights(ids: number[]): Promise<number> {
  return bulkSetDeleted(ids, true);
}

export async function bulkRestoreOfflineFlights(ids: number[]): Promise<number> {
  return bulkSetDeleted(ids, false);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/offline-flight-bulk-actions.ts
git commit -m "feat(offline-flights): bulk update, price adjust, event link and delete actions"
```

---

### Task 5: The shared editable flights table

**Files:**
- Create: `components/flights-editable-table.tsx`
- Modify: `app/(dashboard)/offline-flights/offline-flights-table.tsx` (replace its body — it becomes a thin wrapper)

**Interfaces:**
- Consumes: `FLIGHT_FIELDS`, `DEFAULT_VISIBLE_COLUMNS`, `formatFlightValue` (Task 3); `updateOfflineFlight`, `softDeleteOfflineFlight`, `restoreOfflineFlight` (existing); every export of Task 4.
- Produces:

```tsx
export type FlightsEditableTableProps = {
  flights: OfflineFlight[];
  /** When set, the table is scoped to one event: the event filter is hidden and
   *  bulk event-link actions default to this id. */
  eventId?: number;
  /** Rendered under the toolbar; used by the event page to add its own actions. */
  toolbarExtra?: React.ReactNode;
  onChanged?: () => void;
};
export function FlightsEditableTable(props: FlightsEditableTableProps): JSX.Element;
```

**Behaviour to build (each is a manual acceptance check in Step 3):**

1. **Inline cell edit.** Every visible cell whose field is in `FLIGHT_FIELDS` becomes an editor on click — `Input` for text/number/money/date/datetime, `Select` for `select`, `Checkbox` for `boolean`. Enter or blur commits via `updateOfflineFlight(id, { [key]: value })`; Escape cancels. Apply the new value to local state immediately and revert it plus `toast.error` if the action rejects.
2. **Drawer.** Clicking the row id opens a shadcn `Sheet` listing every field grouped by `FLIGHT_FIELD_GROUPS`, each editable with the same commit path. `components/ui/sheet.tsx` already exists.
3. **Column picker.** A `DropdownMenu` of checkboxes over `FLIGHT_FIELDS`, seeded from `DEFAULT_VISIBLE_COLUMNS`, persisted under `localStorage["flights-table-columns"]`. Guard the read with `typeof window !== "undefined"`.
4. **ORG / TAKEN / AVAILABLE.** Three fixed columns, always visible, never editable except ORG: `ORG = initial_quantity`, `TAKEN = consumed_quantity`, `AVAILABLE = ORG − TAKEN` — green when positive, red at zero or below. This replaces the current combined `Qty` cell at `offline-flights-table.tsx:172-181`.
5. **Selection + bulk toolbar.** Keep the existing checkbox column. When at least one row is selected show: a field selector limited to `bulkEditable` fields plus a value input → `bulkUpdateOfflineFlights`; a price control with set/±$/±% → `bulkAdjustPrice`; an event picker with add/remove → `bulkSetEventLink`; delete and restore → `bulkSoftDeleteOfflineFlights` / `bulkRestoreOfflineFlights`. Confirm before delete. Clear the selection after any bulk action succeeds.
6. **Filters.** Airline (`airline_code`), departure date range, event, series (`series_name`), `block_status`, and a "show deleted" toggle that is off by default. Filtering is client-side over the `flights` prop.
7. **Deadline warning.** When `ticketing_deadline` or `option_expiry` is within 7 days and `block_status !== "ticketed"`, render the row id with an amber dot and a `title` naming the deadline. This is the reason those columns exist.

Reuse the table markup already in `app/(dashboard)/offline-flights/offline-flights-table.tsx` — `Table`/`TableHeader`/`TableRow` from `@/components/ui/table`, `Badge` for status, `toast` from `react-hot-toast`, `useTransition` for pending state. Keep the row `key` as `flight.id` (never the index — the table is sortable and filterable).

- [ ] **Step 1: Build the component**

Create `components/flights-editable-table.tsx` implementing the seven behaviours above. Mark it `"use client"`. Hold `flights` in `useState` seeded from props so optimistic edits render immediately, and re-seed with a `useEffect` keyed on the prop identity.

The commit path every editor shares:

```tsx
const commit = (id: number, key: string, value: unknown) => {
  const before = flights.find((f) => f.id === id);
  setFlights((prev) => prev.map((f) => (f.id === id ? { ...f, [key]: value } : f)));
  startTransition(async () => {
    try {
      await updateOfflineFlight(id, { [key]: value } as Partial<OfflineFlight>);
      onChanged?.();
    } catch (error) {
      console.error("Failed to update flight:", error);
      setFlights((prev) => prev.map((f) => (f.id === id && before ? before : f)));
      toast.error("Update failed");
    }
  });
};
```

- [ ] **Step 2: Reduce the page table to a wrapper**

Rewrite `app/(dashboard)/offline-flights/offline-flights-table.tsx` so it keeps its existing `getOfflineFlights()` fetch and loading state, then renders:

```tsx
<FlightsEditableTable flights={flights} onChanged={fetchFlights} />
```

Add a "New series" link to `/offline-flights/series/new` next to the existing new-flight action (the page it points at arrives in Task 7; a 404 until then is expected).

- [ ] **Step 3: Typecheck and manual acceptance**

Run: `npx tsc --noEmit` — expected: no new errors.

Then `npm run dev` → `/offline-flights` and confirm each of the seven behaviours:
- edit a price inline, reload, value persisted;
- open the drawer from the row id, change `supplier`, reload, persisted;
- hide a column, reload the page, it stays hidden;
- ORG/TAKEN/AVAILABLE match the numbers on `/offline-flights/<id>`;
- select two rows, apply `+10%`, confirm both prices rose and rounded to whole dollars;
- filter by airline and confirm the row count drops;
- set a `ticketing_deadline` of tomorrow on a non-ticketed flight and confirm the amber dot.

- [ ] **Step 4: Commit**

```bash
git add components/flights-editable-table.tsx "app/(dashboard)/offline-flights/offline-flights-table.tsx"
git commit -m "feat(offline-flights): inline + drawer + bulk editing in one shared table"
```

---

### Task 6: Use the same table inside the event page

**Files:**
- Modify: `app/(dashboard)/events/[id]/page.tsx` (the offline-flights block around line 2569)

**Interfaces:**
- Consumes: `FlightsEditableTable` (Task 5), `getFlightsByEventId` (existing).
- Produces: nothing new.

**Why:** the page is already 2,500+ lines. The block is *replaced*, not extended — the whole point is that the event page and the flights page share one implementation.

- [ ] **Step 1: Locate the current block**

Run: `grep -n "seats left" "app/(dashboard)/events/[id]/page.tsx"`
That line (~2569) renders `${flight.price} · {flight.initial_quantity - flight.consumed_quantity} seats left` inside the event's flight list. Read ~60 lines around it to find the enclosing card and the state holding the flights.

- [ ] **Step 2: Replace the list markup**

Swap the hand-rolled list for:

```tsx
<FlightsEditableTable
  flights={eventFlights}
  eventId={event.id}
  onChanged={reloadEventFlights}
/>
```

Keep the surrounding card, heading and the existing "attach flight" control. Keep whatever state variable already holds the event's flights and whatever function already reloads them — only the rendering changes.

- [ ] **Step 3: Typecheck and manual acceptance**

Run: `npx tsc --noEmit` — expected: no new errors.

`npm run dev` → open an event that has offline flights. Confirm the flights render in the new table, that inline editing a price there works, and that the event filter is hidden (the table is already scoped to this event).

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/events/[id]/page.tsx"
git commit -m "feat(events): reuse the editable flights table in the event page"
```

---

### Task 7: Series builder

**Files:**
- Modify: `lib/actions/offline-flight-bulk-actions.ts` (append the series action)
- Create: `app/(dashboard)/offline-flights/series/new/page.tsx`

**Interfaces:**
- Consumes: `pickFlightColumns`, `assertFlightValues`, `getRelevantEventsForFlight` (existing, `offline-flight-actions.ts:241`).
- Produces:

```ts
export type SeriesFlightDraft = Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted" | "series_id">;

export async function createOfflineFlightSeries(
  seriesName: string,
  drafts: SeriesFlightDraft[],
): Promise<{ series_id: string; created: number }>;
```

- [ ] **Step 1: Append the series action**

Add to `lib/actions/offline-flight-bulk-actions.ts`:

```ts
export type SeriesFlightDraft = Omit<
  OfflineFlight,
  "id" | "consumed_quantity" | "is_deleted" | "series_id"
>;

export async function createOfflineFlightSeries(
  seriesName: string,
  drafts: SeriesFlightDraft[],
): Promise<{ series_id: string; created: number }> {
  await requireStaff();
  if (!seriesName.trim()) throw new Error("Series name is required");
  if (drafts.length === 0) throw new Error("No flights to create");
  if (drafts.length > 200) throw new Error("A series is limited to 200 flights");

  const series_id = crypto.randomUUID();
  const rows = drafts.map((draft) => {
    const row = pickFlightColumns(draft as unknown as Record<string, unknown>);
    assertFlightValues(row);
    return {
      ...row,
      series_id,
      series_name: seriesName.trim(),
      consumed_quantity: 0,
      is_deleted: false,
    };
  });

  const { data, error } = await flightsTable().insert(rows).select("id, event_ids");
  if (error) throw error;

  await logAudit({
    action: "create",
    entityType: "offline_flight",
    entityId: null,
    metadata: { series_id, series_name: seriesName.trim(), count: rows.length },
  });
  await revalidateFlights((data ?? []).flatMap((f: OfflineFlight) => f.event_ids ?? []));
  return { series_id, created: (data ?? []).length };
}
```

- [ ] **Step 2: Build the four-step page**

Create `app/(dashboard)/offline-flights/series/new/page.tsx` as a `"use client"` page with a `step` state of `1 | 2 | 3 | 4`.

**Step 1 — shared template.** Every field except the dates. Reuse `inlineFlightSchema` from `components/inline-flight-form.tsx` (exported at line 40) with the date fields omitted, and capture departure/arrival **times** as four `HH:mm` strings: `outboundDepartureTime`, `outboundArrivalTime`, `inboundDepartureTime`, `inboundArrivalTime`. Also capture a series name.

**Step 2 — dates.** A multi-select `Calendar` (`components/ui/calendar.tsx`, `mode="multiple"`) for departure dates, plus a `nights` number input. Each selected date `d` produces a flight with return date `d + nights`.

**Step 3 — editable preview.** One row per selected date. Build each draft with pure string composition — the columns are `timestamp without time zone`, so no timezone maths:

```ts
const pad = (n: number) => String(n).padStart(2, "0");
const addDays = (isoDate: string, days: number): string => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
// outbound arrival may land the next day when the arrival time is earlier than departure
const sameOrNextDay = (date: string, depart: string, arrive: string): string =>
  arrive >= depart ? date : addDays(date, 1);

const departDate = "2026-09-10";            // one selected calendar date
const returnDate = addDays(departDate, nights);
const draft: SeriesFlightDraft = {
  ...template,
  outbound_departure_time: `${departDate}T${times.outboundDepartureTime}:00`,
  outbound_arrival_time:   `${sameOrNextDay(departDate, times.outboundDepartureTime, times.outboundArrivalTime)}T${times.outboundArrivalTime}:00`,
  inbound_departure_time:  `${returnDate}T${times.inboundDepartureTime}:00`,
  inbound_arrival_time:    `${sameOrNextDay(returnDate, times.inboundDepartureTime, times.inboundArrivalTime)}T${times.inboundArrivalTime}:00`,
  event_ids: [],
};
```

Render the drafts in a table where `price`, `initial_quantity`, `outbound_flight_number`, `inbound_flight_number` and the four times are editable per row, and each row can be removed. For every draft call `getRelevantEventsForFlight(template.outbound_arrival_airport, departDate, returnDate)` and show the returned events as checkboxes, **all checked by default**, writing into that draft's `event_ids`.

**Step 4 — create.** A summary line ("12 flights, 3 events each") and a button calling `createOfflineFlightSeries(seriesName, drafts)`. On success `toast.success` and `router.push("/offline-flights")`.

- [ ] **Step 3: Typecheck and manual acceptance**

Run: `npx tsc --noEmit` — expected: no new errors.

`npm run dev` → `/offline-flights/series/new`. Build a series of 3 departure dates with 4 nights. Confirm in the preview that each return date is exactly 4 days after its departure date, edit one row's price, uncheck one suggested event, then create. On `/offline-flights`, filter by the series name and confirm exactly 3 flights exist with the edited price on the right one and the right event links.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/offline-flight-bulk-actions.ts "app/(dashboard)/offline-flights/series/new/page.tsx"
git commit -m "feat(offline-flights): build a whole series of flights from one template"
```

---

### Task 8: Passenger identity fields

**Files:**
- Modify: `types/reservation.types.ts` (the `more_pax_info` shape)
- Modify: `lib/actions/reservation-actions.ts` (add the update action)
- Modify: the reservation detail page under `app/(dashboard)/reservations/`

**Interfaces:**
- Consumes: `requireStaff`, `supabase`, `logAudit`.
- Produces: `updateReservationPaxInfo(reservationId: number, pax: PaxInfo[]): Promise<void>` and the exported `PaxInfo` type.

- [ ] **Step 1: Extend the type**

In `types/reservation.types.ts`, replace the inline `more_pax_info` shape with a named type:

```ts
export type PaxInfo = {
  first_name: string;
  last_name: string;
  // Completed by staff in the backoffice for ticketing. The main app writes
  // only first/last name at checkout, so every field below is optional.
  passport_number?: string | null;
  passport_expiry?: string | null;  // "YYYY-MM-DD"
  date_of_birth?: string | null;    // "YYYY-MM-DD"
  gender?: "M" | "F" | "X" | null;
  nationality?: string | null;      // ISO-3166 alpha-2
};
```

and change the field on `Reservation` to `more_pax_info: PaxInfo[]`.

- [ ] **Step 2: Add the action**

Append to `lib/actions/reservation-actions.ts`:

```ts
export async function updateReservationPaxInfo(
  reservationId: number,
  pax: PaxInfo[],
): Promise<void> {
  await requireStaff();
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    throw new Error("Invalid reservation id");
  }
  const clean: PaxInfo[] = pax.map((p) => ({
    first_name: String(p.first_name ?? ""),
    last_name: String(p.last_name ?? ""),
    passport_number: p.passport_number || null,
    passport_expiry: p.passport_expiry || null,
    date_of_birth: p.date_of_birth || null,
    gender: p.gender ?? null,
    nationality: p.nationality || null,
  }));

  const { error } = await supabase
    .from("reservations")
    .update({ more_pax_info: clean })
    .eq("id", reservationId);
  if (error) throw error;

  await logAudit({
    action: "update",
    entityType: "reservation",
    entityId: reservationId,
    metadata: { pax_count: clean.length, field: "more_pax_info" },
  });
  revalidatePath(`/reservations/${reservationId}`);
}
```

Import `PaxInfo` from `@/types/reservation.types` at the top of the file.

- [ ] **Step 3: Add the editor to the reservation page**

Run: `ls "app/(dashboard)/reservations"` to find the detail page. Add a "Passengers" card listing one row per entry in `more_pax_info` with inputs for first name, last name, passport number, passport expiry, date of birth, gender (`Select` of M/F/X) and nationality. A single Save button calls `updateReservationPaxInfo`.

- [ ] **Step 4: Typecheck and manual acceptance**

Run: `npx tsc --noEmit` — expected: no new errors. If existing code assumed `more_pax_info` had only two fields, the named type surfaces it here; fix those call sites.

`npm run dev` → open a reservation with more than one passenger, fill a passport number, save, reload, confirm it persisted and the names were not lost.

- [ ] **Step 5: Commit**

```bash
git add types/reservation.types.ts lib/actions/reservation-actions.ts "app/(dashboard)/reservations"
git commit -m "feat(reservations): capture passenger identity details for ticketing"
```

---

### Task 9: Excel exports

**Files:**
- Modify: `package.json` (add `exceljs`)
- Create: `lib/exports/flight-workbook.ts`
- Create: `app/api/exports/flights/route.ts`
- Create: `app/api/exports/flight-pax/route.ts`
- Modify: `components/flights-editable-table.tsx` (two toolbar buttons)

**Interfaces:**
- Consumes: `OfflineFlight`, `PaxInfo`, `getReservationsForFlight` (existing, `reservation-actions.ts:246`), `guardAdminRoute`.
- Produces:
  - `buildInventoryWorkbook(flights: OfflineFlight[]): Promise<Buffer>`
  - `buildManifestWorkbook(rows: ManifestRow[]): Promise<Buffer>`
  - `type ManifestRow` (declared below)

- [ ] **Step 1: Install the dependency**

```bash
npm install exceljs
```

- [ ] **Step 2: Write the workbook builders**

Create `lib/exports/flight-workbook.ts`:

```ts
import ExcelJS from "exceljs";
import type { OfflineFlight } from "@/types/offline-flight.types";

export type ManifestRow = {
  airline_code: string;
  flight_id: number;
  outbound_flight_number: string;
  outbound_departure_time: string;
  inbound_flight_number: string;
  inbound_departure_time: string;
  route: string;
  pnr: string | null;
  reservation_id: number;
  reservation_status: string;
  first_name: string;
  last_name: string;
  passport_number: string | null;
  passport_expiry: string | null;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  contact_email: string;
  contact_phone: string;
};

// Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars.
function safeSheetName(name: string): string {
  const cleaned = (name || "UNKNOWN").replace(/[:\\/?*[\]]/g, "-");
  return cleaned.slice(0, 31);
}

function addSheet<T extends Record<string, unknown>>(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: { header: string; key: string; width: number }[],
  rows: T[],
): void {
  const sheet = workbook.addWorksheet(safeSheetName(name));
  sheet.columns = columns;
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

export async function buildInventoryWorkbook(flights: OfflineFlight[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const columns = [
    { header: "ID", key: "id", width: 8 },
    { header: "Flight no.", key: "outbound_flight_number", width: 12 },
    { header: "From", key: "outbound_departure_airport", width: 8 },
    { header: "To", key: "outbound_arrival_airport", width: 8 },
    { header: "Departure", key: "outbound_departure_time", width: 20 },
    { header: "Return", key: "inbound_departure_time", width: 20 },
    { header: "ORG", key: "initial_quantity", width: 8 },
    { header: "TAKEN", key: "consumed_quantity", width: 8 },
    { header: "AVAILABLE", key: "available", width: 11 },
    { header: "Sell price", key: "price", width: 12 },
    { header: "Cost price", key: "cost_price", width: 12 },
    { header: "Currency", key: "cost_currency", width: 10 },
    { header: "Supplier", key: "supplier", width: 18 },
    { header: "PNR", key: "pnr", width: 12 },
    { header: "Contract", key: "group_code", width: 14 },
    { header: "Ticketing deadline", key: "ticketing_deadline", width: 18 },
    { header: "Cancellation deadline", key: "last_cancellation_date", width: 20 },
    { header: "Status", key: "block_status", width: 12 },
    { header: "Series", key: "series_name", width: 18 },
    { header: "Notes", key: "notes", width: 30 },
  ];

  const byAirline = new Map<string, OfflineFlight[]>();
  for (const flight of flights) {
    const key = flight.airline_code || "UNKNOWN";
    byAirline.set(key, [...(byAirline.get(key) ?? []), flight]);
  }
  for (const [airline, group] of byAirline) {
    addSheet(
      workbook,
      airline,
      columns,
      group.map((f) => ({
        ...f,
        available: f.initial_quantity - f.consumed_quantity,
      })),
    );
  }
  if (byAirline.size === 0) addSheet(workbook, "EMPTY", columns, []);
  return (await workbook.xlsx.writeBuffer()) as Buffer;
}

export async function buildManifestWorkbook(rows: ManifestRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const columns = [
    { header: "Last name", key: "last_name", width: 18 },
    { header: "First name", key: "first_name", width: 18 },
    { header: "Passport", key: "passport_number", width: 16 },
    { header: "Passport expiry", key: "passport_expiry", width: 16 },
    { header: "Date of birth", key: "date_of_birth", width: 14 },
    { header: "Gender", key: "gender", width: 8 },
    { header: "Nationality", key: "nationality", width: 12 },
    { header: "Flight no.", key: "outbound_flight_number", width: 12 },
    { header: "Departure", key: "outbound_departure_time", width: 20 },
    { header: "Return flight", key: "inbound_flight_number", width: 13 },
    { header: "Return", key: "inbound_departure_time", width: 20 },
    { header: "Route", key: "route", width: 12 },
    { header: "PNR", key: "pnr", width: 12 },
    { header: "Reservation", key: "reservation_id", width: 12 },
    { header: "Status", key: "reservation_status", width: 12 },
    { header: "Contact email", key: "contact_email", width: 26 },
    { header: "Contact phone", key: "contact_phone", width: 16 },
  ];

  const byAirline = new Map<string, ManifestRow[]>();
  for (const row of rows) {
    const key = row.airline_code || "UNKNOWN";
    byAirline.set(key, [...(byAirline.get(key) ?? []), row]);
  }
  for (const [airline, group] of byAirline) addSheet(workbook, airline, columns, group);
  if (byAirline.size === 0) addSheet(workbook, "EMPTY", columns, []);
  return (await workbook.xlsx.writeBuffer()) as Buffer;
}
```

- [ ] **Step 3: Write the inventory route**

Create `app/api/exports/flights/route.ts`:

```ts
import { NextResponse } from "next/server";
import { guardAdminRoute } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { buildInventoryWorkbook } from "@/lib/exports/flight-workbook";
import type { OfflineFlight } from "@/types/offline-flight.types";

export async function GET(request: Request) {
  const denied = await guardAdminRoute();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const airline = searchParams.get("airline");
    const from = searchParams.get("from");   // YYYY-MM-DD, inclusive
    const to = searchParams.get("to");       // YYYY-MM-DD, inclusive
    const eventId = searchParams.get("eventId");
    const ids = searchParams.get("ids");     // comma-separated flight ids

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any).from("flights").select("*").eq("is_deleted", false);
    if (airline) query = query.eq("airline_code", airline);
    if (from) query = query.gte("outbound_departure_time", `${from}T00:00:00`);
    if (to) query = query.lte("outbound_departure_time", `${to}T23:59:59`);
    if (eventId) query = query.contains("event_ids", [Number(eventId)]);
    if (ids) query = query.in("id", ids.split(",").map(Number).filter(Number.isInteger));
    query = query.order("outbound_departure_time", { ascending: true });

    const { data, error } = await query;
    if (error) {
      console.error("Flight export query failed:", JSON.stringify(error));
      return NextResponse.json({ error: "Failed to load flights" }, { status: 500 });
    }

    const buffer = await buildInventoryWorkbook((data ?? []) as OfflineFlight[]);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="flights-inventory.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Flight export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Write the manifest route**

Create `app/api/exports/flight-pax/route.ts` with the same guard, the same filter parsing, and this body once the flights are loaded:

```ts
    const flights = (data ?? []) as OfflineFlight[];
    const rows: ManifestRow[] = [];
    for (const flight of flights) {
      const reservations = await getReservationsForFlight(flight.id);
      const route = `${flight.outbound_departure_airport}-${flight.outbound_arrival_airport}`;
      for (const reservation of reservations) {
        const pax = [
          {
            first_name: reservation.main_contact_first_name,
            last_name: reservation.main_contact_last_name,
          } as PaxInfo,
          ...(reservation.more_pax_info ?? []),
        ];
        for (const person of pax) {
          rows.push({
            airline_code: flight.airline_code,
            flight_id: flight.id,
            outbound_flight_number: flight.outbound_flight_number,
            outbound_departure_time: flight.outbound_departure_time,
            inbound_flight_number: flight.inbound_flight_number,
            inbound_departure_time: flight.inbound_departure_time,
            route,
            pnr: flight.pnr ?? null,
            reservation_id: reservation.id,
            reservation_status: reservation.status,
            first_name: person.first_name,
            last_name: person.last_name,
            passport_number: person.passport_number ?? null,
            passport_expiry: person.passport_expiry ?? null,
            date_of_birth: person.date_of_birth ?? null,
            gender: person.gender ?? null,
            nationality: person.nationality ?? null,
            contact_email: reservation.main_contact_email,
            contact_phone: reservation.main_contact_phone_number,
          });
        }
      }
    }
    const buffer = await buildManifestWorkbook(rows);
```

with the response filename `flights-manifest.xlsx`.

`getReservationsForFlight` already excludes `Cancelled` and `Lost`, so released bookings never reach the manifest. Note the main contact is a passenger too — that is why they are prepended to `more_pax_info`.

- [ ] **Step 5: Add the toolbar buttons**

In `components/flights-editable-table.tsx`, add two buttons that build a query string from the active filters (and `ids` when rows are selected) and open it:

```tsx
const exportHref = (path: string) => {
  const params = new URLSearchParams();
  if (filters.airline) params.set("airline", filters.airline);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (eventId) params.set("eventId", String(eventId));
  if (selectedRows.size > 0) params.set("ids", Array.from(selectedRows).join(","));
  return `${path}?${params.toString()}`;
};
```

labelled "Export inventory" (`/api/exports/flights`) and "Export for ticketing" (`/api/exports/flight-pax`).

- [ ] **Step 6: Typecheck and manual acceptance**

Run: `npx tsc --noEmit` — expected: no new errors.

`npm run dev` → `/offline-flights`. Download both files. Confirm: one worksheet per airline, bold frozen header row, AVAILABLE equals ORG − TAKEN, and the manifest contains the main contact plus every extra passenger for a flight that has a reservation. Filter to one airline and confirm the download narrows to a single sheet.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/exports components/flights-editable-table.tsx app/api/exports
git commit -m "feat(offline-flights): export inventory and ticketing manifest as xlsx per airline"
```

---

### Task 10: Phase A wrap-up

- [ ] **Step 1: Full typecheck and build**

```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed. `npm run build` ignores TS errors by config, so a clean `tsc` is the real gate — do not skip it.

- [ ] **Step 2: Lint**

```bash
npm run lint
```
Fix anything new that this phase introduced. Pre-existing warnings elsewhere are out of scope.

- [ ] **Step 3: Report to Dor**

Summarise what shipped, confirm nothing under `../myt-main` was touched (`git -C ../myt-main status` should be clean), and confirm the migration was applied. Phase B is the next plan.

---

## Self-Review

**Spec coverage.** Spec §1.4 new columns → Task 1. §2.2 explicit mapping → Task 2. §2.1 shared table, inline edit, drawer, column picker, bulk toolbar, filters → Tasks 3, 5, 6. §1.3 flight-level ORG/TAKEN/AVAILABLE → Task 5 behaviour 4 (per-event detail is Phase B). §2.3 series builder → Task 7. §1.6 passenger identity → Task 8. §2.5 exports → Task 9. §5 verification → every task's typecheck step plus Task 10. Spec items deferred by design: allocations and per-event columns (Phase B), LOCKFLIGHT (Phase C).

**Placeholders.** None: every code step carries runnable code, every verification step names a command and its expected result, and the one place work is described rather than pasted (the table component, Task 5) enumerates seven individually checkable behaviours with the shared commit path written out.

**Type consistency.** `pickFlightColumns` / `assertFlightValues` (Task 2) are used with those exact names in Tasks 4 and 7. `FLIGHT_FIELDS`, `DEFAULT_VISIBLE_COLUMNS`, `formatFlightValue` (Task 3) are consumed under those names in Task 5. `SeriesFlightDraft` (Task 7) derives from `OfflineFlight` as extended in Task 1. `PaxInfo` (Task 8) is what `ManifestRow` (Task 9) reads. `ManifestRow.airline_code` is the sheet-splitting key in `buildManifestWorkbook`, and it is populated in the route.

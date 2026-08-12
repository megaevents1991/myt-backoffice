"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import {
  pickFlightColumns,
  assertFlightValues,
} from "./offline-flight-columns";
import type { OfflineFlight } from "@/types/offline-flight.types";

// The `flights` table is not in db.schema.sql so Supabase's generated types
// don't include it - all .from("flights") calls are cast to bypass `never`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const flightsTable = () => (supabase as any).from("flights");

export type PriceAdjustment = {
  mode: "set" | "delta" | "percent";
  value: number;
};

type FlightIdEvents = { id: number; event_ids: number[] | null };

function assertIds(ids: number[]): void {
  if (!Array.isArray(ids) || ids.length === 0)
    throw new Error("No flights selected");
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("Invalid flight id");
  }
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

  const { data, error } = await flightsTable()
    .update(row)
    .in("id", ids)
    .select("id, event_ids");
  if (error) throw error;

  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: null,
    changes: row,
    metadata: { ids, count: ids.length, bulk: true },
  });
  await revalidateFlights(
    ((data ?? []) as FlightIdEvents[]).flatMap((f) => f.event_ids ?? []),
  );
  return ((data ?? []) as FlightIdEvents[]).length;
}

export async function bulkAdjustPrice(
  ids: number[],
  adj: PriceAdjustment,
): Promise<number> {
  await requireStaff();
  assertIds(ids);
  if (!Number.isFinite(adj.value)) throw new Error("Invalid price value");

  const { data, error } = await flightsTable()
    .select("id, price, event_ids")
    .in("id", ids);
  if (error) throw error;
  const rows = (data ?? []) as (FlightIdEvents & { price: number })[];

  const touchedEvents: number[] = [];
  await Promise.all(
    rows.map(async (row) => {
      const current = Number(row.price) || 0;
      const next =
        adj.mode === "set"
          ? adj.value
          : adj.mode === "delta"
            ? current + adj.value
            : Math.round(current * (1 + adj.value / 100));
      if (next < 0) {
        throw new Error(`Flight ${row.id}: adjusted price would be negative`);
      }
      touchedEvents.push(...(row.event_ids ?? []));
      const { error: upErr } = await flightsTable()
        .update({ price: next })
        .eq("id", row.id);
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
  return rows.length;
}

export async function bulkSetEventLink(
  ids: number[],
  eventId: number,
  op: "add" | "remove",
): Promise<number> {
  await requireStaff();
  assertIds(ids);
  if (!Number.isInteger(eventId) || eventId <= 0)
    throw new Error("Invalid event id");

  const { data, error } = await flightsTable()
    .select("id, event_ids")
    .in("id", ids);
  if (error) throw error;
  const rows = (data ?? []) as FlightIdEvents[];

  await Promise.all(
    rows.map(async (row) => {
      const existing = row.event_ids ?? [];
      const next =
        op === "add"
          ? existing.includes(eventId)
            ? existing
            : [...existing, eventId]
          : existing.filter((id) => id !== eventId);
      if (next.length === existing.length && op === "add") return;
      const { error: upErr } = await flightsTable()
        .update({ event_ids: next })
        .eq("id", row.id);
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
  return rows.length;
}

async function bulkSetDeleted(
  ids: number[],
  isDeleted: boolean,
): Promise<number> {
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
  await revalidateFlights(
    ((data ?? []) as FlightIdEvents[]).flatMap((f) => f.event_ids ?? []),
  );
  return ((data ?? []) as FlightIdEvents[]).length;
}

export async function bulkSoftDeleteOfflineFlights(
  ids: number[],
): Promise<number> {
  return bulkSetDeleted(ids, true);
}

export async function bulkRestoreOfflineFlights(
  ids: number[],
): Promise<number> {
  return bulkSetDeleted(ids, false);
}

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
  if (drafts.length > 200)
    throw new Error("A series is limited to 200 flights");

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

  const { data, error } = await flightsTable()
    .insert(rows)
    .select("id, event_ids");
  if (error) throw error;

  await logAudit({
    action: "create",
    entityType: "offline_flight",
    entityId: null,
    metadata: { series_id, series_name: seriesName.trim(), count: rows.length },
  });
  await revalidateFlights(
    ((data ?? []) as FlightIdEvents[]).flatMap((f) => f.event_ids ?? []),
  );
  return { series_id, created: ((data ?? []) as FlightIdEvents[]).length };
}

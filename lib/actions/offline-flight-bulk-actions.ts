"use server";

import { requireStaff } from "@/lib/auth/guards";
import { requireCompany } from "@/lib/company";
import {
  flightsOf,
  megaEventsFlights,
  sellsEvents,
  sellsTours,
} from "@/lib/flights-scope";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import {
  pickFlightColumns,
  withoutLifecycleStatus,
  assertFlightValues,
} from "./offline-flight-columns";
import {
  pushFlightsToEvents,
  type FlightForEvents,
} from "./offline-flight-event-sync";
import type { OfflineFlight } from "@/types/offline-flight.types";
import { syncSubToursFromFlights } from "@/lib/tours/flight-sync";

// `flights` is shared by every company, so nothing here touches the table
// directly (lib/flights-scope.ts). The bulk edits work in the ACTIVE company:
// an id of another company in `ids` matches no row and is skipped. Linking to
// an event is a Mega Events feature and stays on Mega Events flights.

export type PriceAdjustment = {
  mode: "set" | "delta" | "percent";
  value: number;
};

type FlightIdEvents = { id: number; event_ids: number[] | null };
// What pushFlightsToEvents needs besides the id and links.
type FlightForPush = FlightIdEvents & FlightForEvents;
const PUSH_COLUMNS =
  "id, event_ids, price, outbound_departure_time, inbound_departure_time";

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
  const { company, session } = await requireCompany();
  assertIds(ids);
  const mode = { tours: sellsTours(company) };
  const row = withoutLifecycleStatus(pickFlightColumns(patch, mode), mode);
  // event_ids is set through bulkSetEventLink, which merges instead of replacing.
  delete row.event_ids;
  if (Object.keys(row).length === 0) throw new Error("Nothing to update");
  assertFlightValues(row, mode);

  // A bulk "Price" set reprices the linked events like a single edit does -
  // only on the flights whose price actually moves, so read those first.
  const setsPrice = row.price !== undefined;
  const oldPrice = new Map<number, number>();
  if (setsPrice) {
    const { data: before, error: beforeError } = await flightsOf(company)
      .select("id, price")
      .in("id", ids);
    if (beforeError) throw beforeError;
    for (const f of (before ?? []) as { id: number; price: number }[]) {
      oldPrice.set(f.id, Math.round(Number(f.price)));
    }
  }

  const { data, error } = await flightsOf(company)
    .update(row)
    .in("id", ids)
    .select(PUSH_COLUMNS);
  if (error) throw error;

  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: null,
    changes: row,
    metadata: { ids, count: ids.length, bulk: true },
  });
  if (setsPrice && sellsEvents(company)) {
    await pushFlightsToEvents(
      ((data ?? []) as FlightForPush[])
        .filter((f) => oldPrice.get(f.id) !== Math.round(Number(f.price)))
        .map((f) => ({ flight: f, repriced: f.event_ids ?? [] })),
    );
  }
  // New dates on tours blocks: their sub-tours follow, unless they have customers.
  if (
    sellsTours(company) &&
    (row.outbound_departure_time !== undefined || row.inbound_departure_time !== undefined)
  ) {
    const synced = await syncSubToursFromFlights(
      company,
      session.sub,
      (data ?? []) as FlightForPush[],
    );
    if (synced.moved.length) revalidatePath("/tours/departures");
  }
  await revalidateFlights(
    ((data ?? []) as FlightIdEvents[]).flatMap((f) => f.event_ids ?? []),
  );
  return ((data ?? []) as FlightIdEvents[]).length;
}

export async function bulkAdjustPrice(
  ids: number[],
  adj: PriceAdjustment,
): Promise<number> {
  const { company } = await requireCompany();
  assertIds(ids);
  if (!Number.isFinite(adj.value)) throw new Error("Invalid price value");

  // Ordered so "two selected flights share an event" resolves the same way
  // every time (pushFlightsToEvents: the later flight wins).
  const { data, error } = await flightsOf(company)
    .select(PUSH_COLUMNS)
    .in("id", ids)
    .order("id", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as FlightForPush[];

  const touchedEvents: number[] = [];
  const repriced: FlightForPush[] = [];
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
      const { error: upErr } = await flightsOf(company)
        .update({ price: next })
        .eq("id", row.id);
      if (upErr) throw upErr;
      if (Math.round(next) !== Math.round(current)) {
        repriced.push({ ...row, price: next });
      }
    }),
  );

  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: null,
    changes: { price: adj },
    metadata: { ids, count: ids.length, bulk: true },
  });
  // Linked events follow the new price, like a single-flight price edit.
  // `repriced` fills in completion order - put it back in id order first.
  if (sellsEvents(company)) {
    await pushFlightsToEvents(
      repriced
        .sort((a, b) => a.id - b.id)
        .map((row) => ({ flight: row, repriced: row.event_ids ?? [] })),
    );
  }
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

  // Keyed by an event, so Mega Events flights only: a group block of a tours
  // company must never carry an event id (the customer site sells by it).
  // Ordered: when several selected flights newly take this event, the last
  // one (highest id) sets its price and dates - see pushFlightsToEvents.
  const { data, error } = await megaEventsFlights()
    .select(PUSH_COLUMNS)
    .in("id", ids)
    .order("id", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as FlightForPush[];

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
      const { error: upErr } = await megaEventsFlights()
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
  // A newly linked event takes the flight's price + default dates, as when
  // it is linked through updateOfflineFlight. Unlinking leaves the event as is
  // (same as a single edit).
  if (op === "add") {
    await pushFlightsToEvents(
      rows
        .filter((row) => !(row.event_ids ?? []).includes(eventId))
        .map((row) => ({ flight: row, added: [eventId] })),
    );
  }
  await revalidateFlights([eventId]);
  return rows.length;
}

async function bulkSetDeleted(
  ids: number[],
  isDeleted: boolean,
): Promise<number> {
  const { company } = await requireCompany();
  assertIds(ids);
  const { data, error } = await flightsOf(company)
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
  const { company } = await requireCompany();
  if (!seriesName.trim()) throw new Error("Series name is required");
  if (drafts.length === 0) throw new Error("No flights to create");
  if (drafts.length > 200)
    throw new Error("A series is limited to 200 flights");

  const mode = { tours: sellsTours(company) };
  const linksEvents = sellsEvents(company);
  const series_id = crypto.randomUUID();
  const rows = drafts.map((draft) => {
    const row = pickFlightColumns(
      draft as unknown as Record<string, unknown>,
      mode,
    );
    assertFlightValues(row, mode);
    // Same rule as createOfflineFlight: only an events company links events.
    if (
      !linksEvents &&
      Array.isArray(row.event_ids) &&
      row.event_ids.length > 0
    ) {
      throw new Error(`Flights of ${company.name} cannot be linked to events`);
    }
    return {
      ...row,
      series_id,
      series_name: seriesName.trim(),
      consumed_quantity: 0,
      is_deleted: false,
    };
  });

  const { data, error } = await flightsOf(company)
    .insert(rows)
    .select(PUSH_COLUMNS);
  if (error) throw error;

  await logAudit({
    action: "create",
    entityType: "offline_flight",
    entityId: null,
    metadata: { series_id, series_name: seriesName.trim(), count: rows.length },
  });
  // Every event on a new flight is newly linked (price + default dates), as
  // in createOfflineFlight. An event two flights of the series share takes
  // the later one - the same as creating the flights one by one.
  if (linksEvents) {
    await pushFlightsToEvents(
      ((data ?? []) as FlightForPush[]).map((f) => ({
        flight: f,
        added: f.event_ids ?? [],
      })),
    );
  }
  await revalidateFlights(
    ((data ?? []) as FlightIdEvents[]).flatMap((f) => f.event_ids ?? []),
  );
  return { series_id, created: ((data ?? []) as FlightIdEvents[]).length };
}

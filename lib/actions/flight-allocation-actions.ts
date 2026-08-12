"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import type { FlightAllocationRow } from "@/types/offline-flight.types";

// Neither `flights` nor the phase-B allocation table/view are in the generated
// Supabase types, so these calls are cast to bypass `never` inference.
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
      ((allocRows ?? []) as AllocRow[]).map((r) => [
        r.event_id,
        r.allocated_seats,
      ]),
    ),
    consumed: new Map(
      ((consumedRows ?? []) as ConsumedRow[]).map((r) => [
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
    const eventRows = (events ?? []) as unknown as {
      id: number;
      name: string;
      date: string;
    }[];
    rows = eventRows.map((event) => ({
      event_id: event.id,
      event_name: event.name,
      event_date: event.date,
      allocated_seats: allocations.get(event.id) ?? null,
      consumed_seats: consumed.get(event.id) ?? 0,
    }));
    rows.sort((a, b) =>
      String(a.event_date).localeCompare(String(b.event_date)),
    );
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
  if (!Number.isInteger(seats) || seats < 0) {
    throw new Error("Seats must be a non-negative integer");
  }

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

/**
 * Removing an allocation returns that event to the flight's global pool - it
 * does not block it. That is the documented no-row fallback, not a bug.
 */
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

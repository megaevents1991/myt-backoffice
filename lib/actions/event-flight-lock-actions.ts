"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import type { OfflineFlight } from "@/types/offline-flight.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

export type LockableFlight = {
  id: number;
  label: string;
  allocated_seats: number | null;
};

export async function getLockableFlights(
  eventId: number,
): Promise<LockableFlight[]> {
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
    (
      (allocations ?? []) as { flight_id: number; allocated_seats: number }[]
    ).map((a) => [a.flight_id, a.allocated_seats]),
  );

  return ((flights ?? []) as OfflineFlight[]).map((f) => ({
    id: f.id,
    label: `${f.airline_code} ${f.outbound_flight_number} · ${f.outbound_departure_airport}→${f.outbound_arrival_airport} · ${f.outbound_departure_time.slice(0, 10)} → ${f.inbound_departure_time.slice(0, 10)}`,
    allocated_seats: allocated.get(f.id) ?? null,
  }));
}

/**
 * Locks an event to one offline flight and pins the package dates to it.
 *
 * Returns a warning (rather than failing) when the event has no seat allocation
 * on that flight: legal - it then draws on the flight's global pool - but rarely
 * what you want for a package you are calling "locked".
 */
export async function lockEventFlight(
  eventId: number,
  flightId: number,
): Promise<{ warning: string | null }> {
  await requireStaff();
  if (!Number.isInteger(eventId) || eventId <= 0)
    throw new Error("Invalid event id");
  if (!Number.isInteger(flightId) || flightId <= 0)
    throw new Error("Invalid flight id");

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

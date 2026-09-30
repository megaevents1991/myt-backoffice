"use server";

import { requireStaff } from "@/lib/auth/guards";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { supabase } from "@/lib/supabase-server";
import type { OfflineFlight } from "../../types/offline-flight.types";
import type { Event } from "../../types/app.types";
import { revalidatePath } from "next/cache";
import { airportsInSameCity } from "@/lib/airport-cities";
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit";
import {
  pickFlightColumns,
  assertFlightValues,
} from "./offline-flight-columns";
import { pushFlightsToEvents } from "./offline-flight-event-sync";

// The `flights` table is not in db.schema.sql so Supabase's generated types don't
// include it - all .from("flights") calls are cast to bypass the `never` inference.
const flightsTable = () => (supabase as any).from("flights");

export async function getOfflineFlights() {
  await requireStaff();
  const { data, error } = await flightsTable()
    .select("*")
    .order("outbound_departure_time", { ascending: true });

  if (error) throw error;
  return data as OfflineFlight[];
}

export async function getOfflineFlight(id: number) {
  await requireStaff();
  const { data, error } = await flightsTable()
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as OfflineFlight;
}

export async function createOfflineFlight(
  flight: Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted">,
) {
  await requireStaff();
  const row = pickFlightColumns(flight as unknown as Record<string, unknown>);
  assertFlightValues(row);
  const { data, error } = await flightsTable()
    .insert({ ...row, consumed_quantity: 0, is_deleted: false })
    .select();

  if (error) throw error;
  const created = data[0] as OfflineFlight;
  await logAudit({
    action: "create",
    entityType: "offline_flight",
    entityId: created.id,
    changes: flight,
  });
  // Every event on a new flight is newly linked: price + default dates, the
  // same as linking it through updateOfflineFlight.
  await pushFlightsToEvents([
    { flight: created, added: created.event_ids ?? [] },
  ]);
  revalidatePath("/offline-flights");
  return created;
}

export async function updateOfflineFlight(
  id: number,
  flight: Partial<Omit<OfflineFlight, "id" | "consumed_quantity">>,
) {
  await requireStaff();
  const patch = pickFlightColumns(flight as Record<string, unknown>);
  assertFlightValues(patch);
  const auditBefore = await fetchBefore("flights", "id", id, flight);
  const { data: current } = await flightsTable()
    .select("event_ids, price")
    .eq("id", id)
    .single();
  const oldEventIds: number[] = current?.event_ids ?? [];
  const oldPrice = Number(current?.price ?? 0);
  const newEventIds: number[] = flight.event_ids ?? oldEventIds;
  const addedEventIds = newEventIds.filter((eid) => !oldEventIds.includes(eid));

  const { data, error } = await flightsTable()
    .update(patch)
    .eq("id", id)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: id,
    changes: diffChanges(auditBefore, flight),
  });

  const updated = data[0] as OfflineFlight;
  const priceChanged =
    Math.round(Number(updated.price)) !== Math.round(oldPrice);

  // Newly added events take price + default dates; already-linked ones take
  // the price only, and only when it moved.
  await pushFlightsToEvents([
    {
      flight: updated,
      added: addedEventIds,
      repriced: priceChanged ? newEventIds : [],
    },
  ]);

  revalidatePath("/offline-flights");
  revalidatePath(`/offline-flights/${id}/edit`);
  revalidatePath(`/offline-flights/${id}`);
  return data[0] as OfflineFlight;
}

export async function softDeleteOfflineFlight(id: number) {
  await requireStaff();
  const { data, error } = await flightsTable()
    .update({ is_deleted: true })
    .eq("id", id)
    .select();

  if (error) throw error;
  await logAudit({
    action: "delete",
    entityType: "offline_flight",
    entityId: id,
  });
  revalidatePath("/offline-flights");
  revalidatePath(`/offline-flights/${id}`);
  return data[0] as OfflineFlight;
}

export async function restoreOfflineFlight(id: number) {
  await requireStaff();
  const { data, error } = await flightsTable()
    .update({ is_deleted: false })
    .eq("id", id)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: id,
    metadata: { restored: true },
  });
  revalidatePath("/offline-flights");
  revalidatePath(`/offline-flights/${id}`);
  return data[0] as OfflineFlight;
}

export async function getFlightsByEventId(
  eventId: number,
): Promise<OfflineFlight[]> {
  await requireStaff();
  const { data, error } = await flightsTable()
    .select("*")
    .contains("event_ids", [eventId])
    .eq("is_deleted", false)
    .order("outbound_departure_time", { ascending: true });

  if (error) throw error;
  return (data ?? []) as OfflineFlight[];
}

export async function removeEventFromFlight(
  flightId: number,
  eventId: number,
): Promise<OfflineFlight> {
  await requireStaff();
  const { data: current, error: fetchError } = await flightsTable()
    .select("event_ids")
    .eq("id", flightId)
    .single();
  if (fetchError) throw fetchError;

  const existing = (current.event_ids as number[]) ?? [];
  if (!existing.includes(eventId)) return getOfflineFlight(flightId);

  const { data, error } = await flightsTable()
    .update({ event_ids: existing.filter((id) => id !== eventId) })
    .eq("id", flightId)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: flightId,
    metadata: { event_id: eventId },
  });
  revalidatePath("/offline-flights");
  revalidatePath(`/events/${eventId}`);
  return data[0] as OfflineFlight;
}

export async function addEventToFlight(
  flightId: number,
  eventId: number,
): Promise<OfflineFlight> {
  await requireStaff();
  const { data: current, error: fetchError } = await flightsTable()
    .select("event_ids")
    .eq("id", flightId)
    .single();

  if (fetchError) throw fetchError;

  const existing = (current.event_ids as number[]) ?? [];
  if (existing.includes(eventId)) {
    return getOfflineFlight(flightId);
  }

  const { data, error } = await flightsTable()
    .update({ event_ids: [...existing, eventId] })
    .eq("id", flightId)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: flightId,
    metadata: { event_id: eventId },
  });
  revalidatePath("/offline-flights");
  revalidatePath(`/events/${eventId}`);
  return data[0] as OfflineFlight;
}

export async function getRelevantEventsForFlight(
  destinationIata: string,
  departureDate: string,
  returnDate: string,
): Promise<Pick<Event, "id" | "name" | "date">[]> {
  await requireStaff();
  const cityCodes = airportsInSameCity(destinationIata);
  const { data, error } = await supabase
    .from("events")
    .select("id, name, date")
    .is("is_deleted", null)
    .in("location->>city_iata", cityCodes)
    .gt("date", departureDate)
    .lt("date", returnDate)
    .order("date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Pick<Event, "id" | "name" | "date">[];
}

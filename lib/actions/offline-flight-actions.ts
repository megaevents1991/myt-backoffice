"use server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { supabase } from "@/lib/supabase-server";
import type { OfflineFlight } from "../../types/offline-flight.types";
import type { Event } from "../../types/app.types";
import { revalidatePath } from "next/cache";

// The `flights` table is not in db.schema.sql so Supabase's generated types don't
// include it — all .from("flights") calls are cast to bypass the `never` inference.
const flightsTable = () => (supabase as any).from("flights");

export async function getOfflineFlights() {
  const { data, error } = await flightsTable()
    .select("*")
    .order("outbound_departure_time", { ascending: true });

  if (error) throw error;
  return data as OfflineFlight[];
}

export async function getOfflineFlight(id: number) {
  const { data, error } = await flightsTable()
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as OfflineFlight;
}

export async function createOfflineFlight(
  flight: Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted">
) {
  const { data, error } = await flightsTable()
    .insert({ ...flight, consumed_quantity: 0, is_deleted: false })
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-flights");
  for (const id of flight.event_ids ?? []) {
    revalidatePath(`/(dashboard)/events/${id}`);
  }
  return data[0] as OfflineFlight;
}

export async function updateOfflineFlight(
  id: number,
  flight: Partial<Omit<OfflineFlight, "id" | "consumed_quantity">>
) {
  const { data, error } = await flightsTable()
    .update(flight)
    .eq("id", id)
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-flights");
  revalidatePath(`/(dashboard)/offline-flights/${id}/edit`);
  revalidatePath(`/(dashboard)/offline-flights/${id}`);
  return data[0] as OfflineFlight;
}

export async function softDeleteOfflineFlight(id: number) {
  const { data, error } = await flightsTable()
    .update({ is_deleted: true })
    .eq("id", id)
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-flights");
  return data[0] as OfflineFlight;
}

export async function getFlightsByEventId(eventId: number): Promise<OfflineFlight[]> {
  const { data, error } = await flightsTable()
    .select("*")
    .contains("event_ids", [eventId])
    .eq("is_deleted", false)
    .order("outbound_departure_time", { ascending: true });

  if (error) throw error;
  return (data ?? []) as OfflineFlight[];
}

export async function addEventToFlight(flightId: number, eventId: number): Promise<OfflineFlight> {
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
  revalidatePath("/(dashboard)/offline-flights");
  revalidatePath(`/(dashboard)/events/${eventId}`);
  return data[0] as OfflineFlight;
}

export async function getRelevantEventsForFlight(
  destinationIata: string,
  departureDate: string,
  returnDate: string
): Promise<Pick<Event, "id" | "name" | "date">[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, date")
    .is("is_deleted", null)
    .filter("location->>city_iata", "eq", destinationIata)
    .gt("date", departureDate)
    .lt("date", returnDate)
    .order("date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Pick<Event, "id" | "name" | "date">[];
}

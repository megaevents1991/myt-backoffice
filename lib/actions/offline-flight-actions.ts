"use server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { supabase } from "@/lib/supabase-server";
import type { OfflineFlight } from "../../types/offline-flight.types";
import type { Event } from "../../types/app.types";
import { revalidatePath } from "next/cache";
import { airportsInSameCity } from "@/lib/airport-cities";

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
  flight: Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted">,
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
  flight: Partial<Omit<OfflineFlight, "id" | "consumed_quantity">>,
) {
  const { data: current } = await flightsTable()
    .select("event_ids, price")
    .eq("id", id)
    .single();
  const oldEventIds: number[] = current?.event_ids ?? [];
  const oldPrice = Number(current?.price ?? 0);
  const newEventIds: number[] = flight.event_ids ?? oldEventIds;
  const addedEventIds = newEventIds.filter((eid) => !oldEventIds.includes(eid));

  const { data, error } = await flightsTable()
    .update(flight)
    .eq("id", id)
    .select();

  if (error) throw error;

  const updated = data[0] as OfflineFlight;
  const defDepart = updated.outbound_departure_time.slice(0, 10);
  // Return date = takeoff of the return leg (inbound_departure_time),
  // NOT the landing-back-in-Israel time (inbound_arrival_time).
  const defReturn = updated.inbound_departure_time.slice(0, 10);
  const baseFlightPrice = Math.round(Number(updated.price));
  const priceChanged = baseFlightPrice !== Math.round(oldPrice);

  // Push price to newly added events; also push to existing events if price changed
  const eventsNeedingPriceUpdate = new Set<number>(addedEventIds);
  if (priceChanged) {
    for (const eid of newEventIds) eventsNeedingPriceUpdate.add(eid);
  }

  if (eventsNeedingPriceUpdate.size > 0) {
    await Promise.all(
      Array.from(eventsNeedingPriceUpdate).map(async (eventId) => {
        const isNewlyAdded = addedEventIds.includes(eventId);
        const eventUpdate: Record<string, unknown> = { base_flight_price: baseFlightPrice };
        if (isNewlyAdded) {
          eventUpdate.def_date_depart = defDepart;
          eventUpdate.def_date_return = defReturn;
        }
        const { error: evErr } = await (supabase as any)
          .from("events")
          .update(eventUpdate)
          .eq("id", eventId);
        if (evErr) throw evErr;
      }),
    );
    for (const eventId of eventsNeedingPriceUpdate) {
      revalidatePath(`/(dashboard)/events/${eventId}`);
    }
  }

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
  revalidatePath(`/(dashboard)/offline-flights/${id}`);
  return data[0] as OfflineFlight;
}

export async function restoreOfflineFlight(id: number) {
  const { data, error } = await flightsTable()
    .update({ is_deleted: false })
    .eq("id", id)
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-flights");
  revalidatePath(`/(dashboard)/offline-flights/${id}`);
  return data[0] as OfflineFlight;
}

export async function getFlightsByEventId(
  eventId: number,
): Promise<OfflineFlight[]> {
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
  revalidatePath("/(dashboard)/offline-flights");
  revalidatePath(`/(dashboard)/events/${eventId}`);
  return data[0] as OfflineFlight;
}

export async function addEventToFlight(
  flightId: number,
  eventId: number,
): Promise<OfflineFlight> {
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
  returnDate: string,
): Promise<Pick<Event, "id" | "name" | "date">[]> {
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

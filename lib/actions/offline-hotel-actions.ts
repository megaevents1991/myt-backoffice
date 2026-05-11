"use server";

import { supabase } from "@/lib/supabase-server";
import type { OfflineHotel } from "../../types/offline-hotel.types";
import type { Event } from "../../types/app.types";
import type { OfflineFlight } from "../../types/offline-flight.types";
import { revalidatePath } from "next/cache";
import { airportsForCityName } from "@/lib/airport-cities";

// offline_hotels is not in Supabase generated types — cast to bypass never inference
const hotelsTable = () => (supabase as any).from("offline_hotels");
const flightsTable = () => (supabase as any).from("flights");

export type HotelSearchResult = {
  hid: number;
  name: string;
  star_rating: number;
  address: string;
};

export async function searchWorldOTAHotels(query: string): Promise<HotelSearchResult[]> {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await supabase
    .from("hotels")
    .select("hid, name, star_rating, address")
    .ilike("name", `%${query.trim()}%`)
    .order("star_rating", { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []) as HotelSearchResult[];
}

export async function getOfflineHotels(): Promise<OfflineHotel[]> {
  const { data, error } = await hotelsTable()
    .select("*")
    .order("check_in", { ascending: true });

  if (error) throw error;
  return (data ?? []) as OfflineHotel[];
}

export type ReservationOfflineRoom = {
  id: number;
  hotel_name: string;
  room_type: string;
  price: string | number;
  check_in: string;
  check_out: string;
  meal_plan: string | null;
};

export async function getOfflineHotelsByIds(ids: number[]): Promise<ReservationOfflineRoom[]> {
  if (!ids.length) return [];
  const unique = Array.from(new Set(ids));
  const { data, error } = await hotelsTable()
    .select("id, hotel_name, room_type, price, check_in, check_out, meal_plan")
    .in("id", unique);
  if (error) throw error;
  return (data ?? []) as ReservationOfflineRoom[];
}

export async function getOfflineHotel(id: number): Promise<OfflineHotel> {
  const { data, error } = await hotelsTable()
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as OfflineHotel;
}

export async function createOfflineHotel(
  hotel: Omit<OfflineHotel, "id" | "consumed_rooms" | "is_deleted" | "created_at">
): Promise<OfflineHotel> {
  const { data, error } = await hotelsTable()
    .insert({ ...hotel, consumed_rooms: 0, is_deleted: false })
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-hotels");
  for (const id of hotel.event_ids ?? []) {
    revalidatePath(`/(dashboard)/events/${id}`);
  }
  return data[0] as OfflineHotel;
}

export async function updateOfflineHotel(
  id: number,
  hotel: Partial<Omit<OfflineHotel, "id" | "consumed_rooms" | "created_at">>
): Promise<OfflineHotel> {
  const { data: current } = await hotelsTable()
    .select("event_ids, price")
    .eq("id", id)
    .single();
  const oldEventIds: number[] = current?.event_ids ?? [];
  const oldPrice = Number(current?.price ?? 0);
  const newEventIds: number[] = hotel.event_ids ?? oldEventIds;
  const addedEventIds = newEventIds.filter((eid) => !oldEventIds.includes(eid));

  const { data, error } = await hotelsTable()
    .update(hotel)
    .eq("id", id)
    .select();

  if (error) throw error;

  const updated = data[0] as OfflineHotel;
  const baseHotelPrice = Math.round(Number(updated.price));
  const priceChanged = baseHotelPrice !== Math.round(oldPrice);

  // Push price to all newly added events; also push to existing events if price changed
  const eventsNeedingPriceUpdate = new Set<number>(addedEventIds);
  if (priceChanged) {
    for (const eid of newEventIds) eventsNeedingPriceUpdate.add(eid);
  }

  if (eventsNeedingPriceUpdate.size > 0) {
    await Promise.all(
      Array.from(eventsNeedingPriceUpdate).map(async (eventId) => {
        const isNewlyAdded = addedEventIds.includes(eventId);
        // Flight wins over hotel for def dates — only set hotel dates on newly-linked events without a flight
        let hasFlight = true;
        if (isNewlyAdded) {
          const { data: flightsForEvent } = await flightsTable()
            .select("id")
            .contains("event_ids", [eventId])
            .eq("is_deleted", false)
            .limit(1);
          hasFlight = (flightsForEvent ?? []).length > 0;
        }
        const eventUpdate: Record<string, unknown> = { base_hotel_price: baseHotelPrice };
        if (isNewlyAdded && !hasFlight) {
          eventUpdate.def_date_depart = updated.check_in;
          eventUpdate.def_date_return = updated.check_out;
        }
        const { error: evErr } = await (supabase as any)
          .from("events")
          .update(eventUpdate)
          .eq("id", eventId);
        if (evErr) throw evErr;
      })
    );
  }

  revalidatePath("/(dashboard)/offline-hotels");
  revalidatePath(`/(dashboard)/offline-hotels/${id}/edit`);
  revalidatePath(`/(dashboard)/offline-hotels/${id}`);
  for (const eventId of hotel.event_ids ?? []) {
    revalidatePath(`/(dashboard)/events/${eventId}`);
  }
  for (const flightId of hotel.flight_ids ?? []) {
    revalidatePath(`/(dashboard)/offline-flights/${flightId}`);
  }
  return data[0] as OfflineHotel;
}

export async function softDeleteOfflineHotel(id: number): Promise<OfflineHotel> {
  const { data, error } = await hotelsTable()
    .update({ is_deleted: true })
    .eq("id", id)
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-hotels");
  return data[0] as OfflineHotel;
}

export async function getHotelsByEventId(eventId: number): Promise<OfflineHotel[]> {
  const { data, error } = await hotelsTable()
    .select("*")
    .contains("event_ids", [eventId])
    .eq("is_deleted", false)
    .order("check_in", { ascending: true });

  if (error) throw error;
  return (data ?? []) as OfflineHotel[];
}

export async function getHotelsByFlightId(flightId: number): Promise<OfflineHotel[]> {
  const { data, error } = await hotelsTable()
    .select("*")
    .contains("flight_ids", [flightId])
    .eq("is_deleted", false)
    .order("check_in", { ascending: true });

  if (error) throw error;
  return (data ?? []) as OfflineHotel[];
}

export async function removeEventFromHotel(hotelId: number, eventId: number): Promise<OfflineHotel> {
  const { data: current, error: fetchError } = await hotelsTable()
    .select("event_ids")
    .eq("id", hotelId)
    .single();
  if (fetchError) throw fetchError;

  const existing = (current.event_ids as number[]) ?? [];
  if (!existing.includes(eventId)) return getOfflineHotel(hotelId);

  const { data, error } = await hotelsTable()
    .update({ event_ids: existing.filter((id) => id !== eventId) })
    .eq("id", hotelId)
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-hotels");
  revalidatePath(`/(dashboard)/events/${eventId}`);
  return data[0] as OfflineHotel;
}

export async function addEventToHotel(hotelId: number, eventId: number): Promise<OfflineHotel> {
  const { data: current, error: fetchError } = await hotelsTable()
    .select("event_ids")
    .eq("id", hotelId)
    .single();

  if (fetchError) throw fetchError;

  const existing = (current.event_ids as number[]) ?? [];
  if (existing.includes(eventId)) return getOfflineHotel(hotelId);

  const { data, error } = await hotelsTable()
    .update({ event_ids: [...existing, eventId] })
    .eq("id", hotelId)
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-hotels");
  revalidatePath(`/(dashboard)/events/${eventId}`);
  return data[0] as OfflineHotel;
}

export async function addFlightToHotel(hotelId: number, flightId: number): Promise<OfflineHotel> {
  const { data: current, error: fetchError } = await hotelsTable()
    .select("flight_ids")
    .eq("id", hotelId)
    .single();

  if (fetchError) throw fetchError;

  const existing = (current.flight_ids as number[]) ?? [];
  if (existing.includes(flightId)) return getOfflineHotel(hotelId);

  const { data, error } = await hotelsTable()
    .update({ flight_ids: [...existing, flightId] })
    .eq("id", hotelId)
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-hotels");
  return data[0] as OfflineHotel;
}

// Returns events whose date falls within the hotel stay (city filter removed — location names are in Hebrew)
export async function getRelevantEventsForHotel(
  city: string,
  checkIn: string,
  checkOut: string
): Promise<Pick<Event, "id" | "name" | "date">[]> {
  const cityCodes = airportsForCityName(city);
  let query = supabase
    .from("events")
    .select("id, name, date")
    .is("is_deleted", null)
    .gte("date", checkIn)
    .lte("date", checkOut);

  if (cityCodes && cityCodes.length > 0) {
    query = query.in("location->>city_iata", cityCodes);
  }

  const { data, error } = await query.order("date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Pick<Event, "id" | "name" | "date">[];
}

// Returns offline flights whose destination airport city matches and dates overlap the hotel stay
export async function getRelevantFlightsForHotel(
  _city: string,
  checkIn: string,
  checkOut: string
): Promise<Pick<OfflineFlight, "id" | "airline_code" | "metadata_name" | "outbound_departure_airport" | "outbound_arrival_airport" | "outbound_departure_time" | "inbound_arrival_time" | "price">[]> {
  const { data, error } = await flightsTable()
    .select("id, airline_code, metadata_name, outbound_departure_airport, outbound_arrival_airport, outbound_departure_time, inbound_arrival_time, price")
    .eq("is_deleted", false)
    .lte("outbound_departure_time", checkOut)
    .gte("inbound_arrival_time", checkIn)
    .order("outbound_departure_time", { ascending: true });

  if (error) throw error;
  return (data ?? []) as any[];
}

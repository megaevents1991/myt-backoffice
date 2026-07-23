"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import type { OfflineHotel } from "../../types/offline-hotel.types";
import type { Event } from "../../types/app.types";
import type { OfflineFlight } from "../../types/offline-flight.types";
import { revalidatePath } from "next/cache";
import { airportsForCityName } from "@/lib/airport-cities";
import { getOfflineRoomCapacity } from "@/lib/offlineRoomCapacity";
import { replaceOfflineHotelRooms } from "./offline-hotel-room-actions";
import type { NewOfflineHotelRoom } from "../../types/offline-hotel.types";
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit";

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
  await requireStaff();
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
  await requireStaff();
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
  await requireStaff();
  if (!ids.length) return [];
  const unique = Array.from(new Set(ids));
  const { data, error } = await hotelsTable()
    .select("id, hotel_name, room_type, price, check_in, check_out, meal_plan")
    .in("id", unique);
  if (error) throw error;
  return (data ?? []) as ReservationOfflineRoom[];
}

export async function getOfflineHotel(id: number): Promise<OfflineHotel> {
  await requireStaff();
  const { data, error } = await hotelsTable()
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as OfflineHotel;
}

export async function createOfflineHotel(
  hotel: Omit<OfflineHotel, "id" | "consumed_rooms" | "is_deleted" | "created_at">,
  rooms?: NewOfflineHotelRoom[]
): Promise<OfflineHotel> {
  await requireStaff();
  const { data, error } = await hotelsTable()
    .insert({ ...hotel, consumed_rooms: 0, is_deleted: false })
    .select();

  if (error) throw error;
  const created = data[0] as OfflineHotel;
  await logAudit({
    action: "create",
    entityType: "offline_hotel",
    entityId: created.id,
    changes: hotel,
  });

  if (rooms && rooms.length > 0) {
    await replaceOfflineHotelRooms(created.id, rooms); // also recomputes mirror + price push
  }

  revalidatePath("/offline-hotels");
  for (const id of hotel.event_ids ?? []) {
    revalidatePath(`/events/${id}`);
  }
  return created;
}

export async function updateOfflineHotel(
  id: number,
  hotel: Partial<Omit<OfflineHotel, "id" | "consumed_rooms" | "created_at">>,
  rooms?: NewOfflineHotelRoom[]
): Promise<OfflineHotel> {
  await requireStaff();
  const auditBefore = await fetchBefore("offline_hotels", "id", id, hotel);
  const { data: current } = await hotelsTable()
    .select("event_ids, price, room_type")
    .eq("id", id)
    .single();
  const oldEventIds: number[] = current?.event_ids ?? [];
  const oldPrice = Number(current?.price ?? 0);
  const oldRoomType = current?.room_type as string | undefined;
  const newEventIds: number[] = hotel.event_ids ?? oldEventIds;
  const addedEventIds = newEventIds.filter((eid) => !oldEventIds.includes(eid));

  const { data, error } = await hotelsTable()
    .update(hotel)
    .eq("id", id)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "offline_hotel",
    entityId: id,
    changes: diffChanges(auditBefore, hotel),
  });

  const updated = data[0] as OfflineHotel;
  // offline `price` is the TOTAL per room; base_hotel_price is consumed
  // per-person by the main app, so divide by the room's headcount capacity
  // (Double -> 2, Triple -> 3, ...). Without this the whole room price is
  // charged per traveler (e.g. a $940 double showed as $940/person, not $470).
  const baseHotelPrice = Math.round(
    Number(updated.price) / getOfflineRoomCapacity(updated.room_type)
  );
  const oldBaseHotelPrice = Math.round(
    oldPrice / getOfflineRoomCapacity(oldRoomType)
  );
  const priceChanged = baseHotelPrice !== oldBaseHotelPrice;

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

        const eventUpdate: Record<string, unknown> = {};
        if (isNewlyAdded && !hasFlight) {
          // We own the event dates → set them from the hotel; price always matches.
          eventUpdate.def_date_depart = updated.check_in;
          eventUpdate.def_date_return = updated.check_out;
          eventUpdate.base_hotel_price = baseHotelPrice;
        } else {
          // Dates owned by a flight (or pre-existing event). Only push the price
          // if the hotel stay matches the event's default dates — otherwise the
          // hotel won't show in the customer flow and the price would be a lie.
          const { data: ev } = await (supabase as any)
            .from("events")
            .select("def_date_depart, def_date_return")
            .eq("id", eventId)
            .single();
          const datesMatch =
            (ev?.def_date_depart ?? "").slice(0, 10) === updated.check_in &&
            (ev?.def_date_return ?? "").slice(0, 10) === updated.check_out;
          if (datesMatch) eventUpdate.base_hotel_price = baseHotelPrice;
        }

        if (Object.keys(eventUpdate).length === 0) return; // nothing to push (date mismatch)
        const { error: evErr } = await (supabase as any)
          .from("events")
          .update(eventUpdate)
          .eq("id", eventId);
        if (evErr) throw evErr;
      })
    );
  }

  revalidatePath("/offline-hotels");
  revalidatePath(`/offline-hotels/${id}/edit`);
  revalidatePath(`/offline-hotels/${id}`);
  for (const eventId of hotel.event_ids ?? []) {
    revalidatePath(`/events/${eventId}`);
  }
  for (const flightId of hotel.flight_ids ?? []) {
    revalidatePath(`/offline-flights/${flightId}`);
  }

  if (rooms) {
    await replaceOfflineHotelRooms(id, rooms); // recomputes mirror + cheapest-available price push
  }

  return data[0] as OfflineHotel;
}

export async function softDeleteOfflineHotel(id: number): Promise<OfflineHotel> {
  await requireStaff();
  const { data, error } = await hotelsTable()
    .update({ is_deleted: true })
    .eq("id", id)
    .select();

  if (error) throw error;
  await logAudit({ action: "delete", entityType: "offline_hotel", entityId: id });
  revalidatePath("/offline-hotels");
  return data[0] as OfflineHotel;
}

export async function getHotelsByEventId(eventId: number): Promise<OfflineHotel[]> {
  await requireStaff();
  const { data, error } = await hotelsTable()
    .select("*")
    .contains("event_ids", [eventId])
    .eq("is_deleted", false)
    .order("check_in", { ascending: true });

  if (error) throw error;
  return (data ?? []) as OfflineHotel[];
}

export async function getHotelsByFlightId(flightId: number): Promise<OfflineHotel[]> {
  await requireStaff();
  const { data, error } = await hotelsTable()
    .select("*")
    .contains("flight_ids", [flightId])
    .eq("is_deleted", false)
    .order("check_in", { ascending: true });

  if (error) throw error;
  return (data ?? []) as OfflineHotel[];
}

export async function removeEventFromHotel(hotelId: number, eventId: number): Promise<OfflineHotel> {
  await requireStaff();
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
  await logAudit({
    action: "update",
    entityType: "offline_hotel",
    entityId: hotelId,
    metadata: { event_id: eventId },
  });
  revalidatePath("/offline-hotels");
  revalidatePath(`/events/${eventId}`);
  return data[0] as OfflineHotel;
}

export async function addEventToHotel(hotelId: number, eventId: number): Promise<OfflineHotel> {
  await requireStaff();
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
  await logAudit({
    action: "update",
    entityType: "offline_hotel",
    entityId: hotelId,
    metadata: { event_id: eventId },
  });
  revalidatePath("/offline-hotels");
  revalidatePath(`/events/${eventId}`);
  return data[0] as OfflineHotel;
}

export async function addFlightToHotel(hotelId: number, flightId: number): Promise<OfflineHotel> {
  await requireStaff();
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
  await logAudit({
    action: "update",
    entityType: "offline_hotel",
    entityId: hotelId,
    metadata: { flight_id: flightId },
  });
  revalidatePath("/offline-hotels");
  return data[0] as OfflineHotel;
}

// Returns events whose date falls strictly between check-in and check-out (excludes same-day arrival/departure)
export async function getRelevantEventsForHotel(
  city: string,
  checkIn: string,
  checkOut: string
): Promise<Pick<Event, "id" | "name" | "date">[]> {
  await requireStaff();
  const cityCodes = airportsForCityName(city);
  let query = supabase
    .from("events")
    .select("id, name, date")
    .is("is_deleted", null)
    .gt("date", checkIn)
    .lt("date", checkOut);

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
  await requireStaff();
  const { data, error } = await flightsTable()
    .select("id, airline_code, metadata_name, outbound_departure_airport, outbound_arrival_airport, outbound_departure_time, inbound_arrival_time, price")
    .eq("is_deleted", false)
    .lte("outbound_departure_time", checkOut)
    .gte("inbound_arrival_time", checkIn)
    .order("outbound_departure_time", { ascending: true });

  if (error) throw error;
  return (data ?? []) as any[];
}

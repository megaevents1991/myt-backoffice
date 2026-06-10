"use server";

import { supabase } from "@/lib/supabase-server";
import { getOfflineRoomCapacity } from "@/lib/offlineRoomCapacity";
import { revalidatePath } from "next/cache";
import type { OfflineHotelRoom, NewOfflineHotelRoom } from "@/types/offline-hotel.types";

// Neither offline_hotels nor offline_hotel_rooms is in Supabase generated types.
const roomsTable = () => (supabase as any).from("offline_hotel_rooms");
const hotelsTable = () => (supabase as any).from("offline_hotels");

// Child rooms linked to a specific reservation (manual link in phase 1).
export async function getRoomsByReservationId(reservationId: number): Promise<OfflineHotelRoom[]> {
  const { data, error } = await roomsTable()
    .select("*")
    .eq("reservation_id", reservationId)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OfflineHotelRoom[];
}

export async function getOfflineHotelRooms(hotelId: number): Promise<OfflineHotelRoom[]> {
  const { data, error } = await roomsTable()
    .select("*")
    .eq("hotel_id", hotelId)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OfflineHotelRoom[];
}

// Replace ALL rooms for a hotel with the supplied set, preserving booked rooms.
// Booked rooms (is_booked=true) are NOT deleted — they may be tied to a paid
// reservation. Only unbooked rooms are swapped out for the new list.
export async function replaceOfflineHotelRooms(
  hotelId: number,
  rooms: NewOfflineHotelRoom[]
): Promise<void> {
  // Delete only the unbooked rooms; keep booked ones intact.
  const { error: delErr } = await roomsTable()
    .delete()
    .eq("hotel_id", hotelId)
    .eq("is_booked", false);
  if (delErr) throw delErr;

  if (rooms.length > 0) {
    const payload = rooms.map((r) => ({
      hotel_id: hotelId,
      room_type: r.room_type,
      price: r.price,
      meal_plan: r.meal_plan,
      last_cancellation_date: r.last_cancellation_date,
      supplier: r.supplier,
      is_booked: false,
    }));
    const { error: insErr } = await roomsTable().insert(payload);
    if (insErr) throw insErr;
  }

  await recomputeHotelMirror(hotelId);
}

// Patch one room (used by inline edit of order_no / acc_no / supplier / is_booked).
export async function updateOfflineHotelRoom(
  roomId: number,
  patch: Partial<Pick<OfflineHotelRoom,
    "room_type" | "price" | "meal_plan" | "last_cancellation_date" |
    "supplier" | "is_booked" | "order_no" | "acc_no" | "reservation_id" | "notes">>
): Promise<OfflineHotelRoom> {
  const { data, error } = await roomsTable()
    .update(patch)
    .eq("id", roomId)
    .select()
    .single();
  if (error) throw error;
  const room = data as OfflineHotelRoom;
  // is_booked or price changes affect the mirror + cheapest-available price.
  await recomputeHotelMirror(room.hotel_id);
  revalidatePath(`/(dashboard)/offline-hotels/${room.hotel_id}`);
  return room;
}

export async function deleteOfflineHotelRoom(roomId: number): Promise<void> {
  const { data: room } = await roomsTable().select("hotel_id, is_booked").eq("id", roomId).single();
  if (room?.is_booked) throw new Error("Cannot delete a booked room.");
  const { error } = await roomsTable().delete().eq("id", roomId);
  if (error) throw error;
  if (room?.hotel_id) {
    await recomputeHotelMirror(room.hotel_id);
    revalidatePath(`/(dashboard)/offline-hotels/${room.hotel_id}`);
  }
}

// Recompute parent num_rooms / consumed_rooms from rooms, then push the
// cheapest AVAILABLE room's per-person price onto linked events.
export async function recomputeHotelMirror(hotelId: number): Promise<void> {
  const { data: rooms, error } = await roomsTable()
    .select("price, room_type, is_booked")
    .eq("hotel_id", hotelId);
  if (error) throw error;

  const list = (rooms ?? []) as Pick<OfflineHotelRoom, "price" | "room_type" | "is_booked">[];
  const numRooms = list.length;
  const consumed = list.filter((r) => r.is_booked).length;

  await hotelsTable().update({ num_rooms: numRooms, consumed_rooms: consumed }).eq("id", hotelId);

  // Cheapest available room → per-person price → base_hotel_price on linked events.
  const available = list.filter((r) => !r.is_booked);
  if (available.length === 0) return; // keep existing event price; don't zero it

  const perPersonPrices = available.map((r) =>
    Number(r.price) / getOfflineRoomCapacity(r.room_type)
  );
  const baseHotelPrice = Math.round(Math.min(...perPersonPrices));

  const { data: hotel } = await hotelsTable()
    .select("event_ids, check_in, check_out")
    .eq("id", hotelId)
    .single();
  const eventIds: number[] = hotel?.event_ids ?? [];
  const checkIn: string = hotel?.check_in;
  const checkOut: string = hotel?.check_out;

  await Promise.all(
    eventIds.map(async (eventId) => {
      // Only push price if the hotel stay matches the event's default dates,
      // otherwise the hotel won't show in the customer flow and the price lies.
      const { data: event } = await (supabase as any)
        .from("events")
        .select("def_date_depart, def_date_return")
        .eq("id", eventId)
        .single();
      const datesMatch =
        (event?.def_date_depart ?? "").slice(0, 10) === checkIn &&
        (event?.def_date_return ?? "").slice(0, 10) === checkOut;
      if (!datesMatch) return;
      const { error: evErr } = await (supabase as any)
        .from("events")
        .update({ base_hotel_price: baseHotelPrice })
        .eq("id", eventId);
      if (evErr) throw evErr;
    })
  );

  revalidatePath("/(dashboard)/offline-hotels");
  revalidatePath(`/(dashboard)/offline-hotels/${hotelId}`);
  for (const eventId of eventIds) revalidatePath(`/(dashboard)/events/${eventId}`);
}

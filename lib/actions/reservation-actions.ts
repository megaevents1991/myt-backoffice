"use server"

import { supabase } from "@/lib/supabase-server"
import type { Reservation } from "@/types/reservation.types"
import { revalidatePath } from "next/cache"

export async function getReservations() {
  const { data, error } = await supabase.from("reservations").select("*").order("created_at", { ascending: false })

  if (error) throw error
  return data as Reservation[]
}

export async function getReservation(id: number) {
  const { data, error } = await supabase.from("reservations").select("*").eq("id", id).single()

  if (error) throw error
  return data as Reservation
}

export async function createReservation(reservation: Omit<Reservation, "id" | "created_at">) {
  const { data, error } = await supabase.from("reservations").insert(reservation).select()

  if (error) throw error
  return data[0] as Reservation
}

export async function updateReservation(id: number, reservation: Partial<Reservation>) {
  const { data, error } = await supabase.from("reservations").update(reservation).eq("id", id).select()

  if (error) throw error
  return data[0] as Reservation
}

export async function updateReservationsStatus(ids: number[], status: string) {
  if (!ids || ids.length === 0) return [] as Reservation[];
  const { data, error } = await supabase
    .from("reservations")
    .update({ status })
    .in("id", ids)
    .select();

  if (error) throw error;
  return data as Reservation[];
}

export async function cancelReservation(id: number): Promise<Reservation> {
  const { data: current, error: fetchError } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError) throw fetchError;

  const reservation = current as Reservation;
  if (reservation.status === "Cancelled") return reservation;

  const { data, error } = await supabase
    .from("reservations")
    .update({ status: "Cancelled" })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  await releaseOfflineInventory(reservation);

  revalidatePath(`/(dashboard)/reservations/${id}`);
  revalidatePath("/(dashboard)/reservations");
  return data as Reservation;
}

async function releaseOfflineInventory(reservation: Reservation) {
  try {
    const flightInfo = reservation.flight_order_info as
      | { offlineId?: number; numOfTravelers?: number }
      | undefined;
    if (flightInfo?.offlineId) {
      const { data: flightRow } = await supabase
        .from("flights")
        .select("consumed_quantity")
        .eq("id", flightInfo.offlineId)
        .single();
      if (flightRow) {
        await supabase
          .from("flights")
          .update({
            consumed_quantity: Math.max(
              0,
              (flightRow.consumed_quantity || 0) - (flightInfo.numOfTravelers || 0)
            ),
          })
          .eq("id", flightInfo.offlineId);
      }
    }

    const offlineHotelIds: number[] =
      reservation.offline_hotel_ids && reservation.offline_hotel_ids.length > 0
        ? reservation.offline_hotel_ids
        : reservation.offline_hotel_id
        ? [reservation.offline_hotel_id]
        : [];

    if (offlineHotelIds.length > 0) {
      const counts = new Map<number, number>();
      for (const rowId of offlineHotelIds) {
        counts.set(rowId, (counts.get(rowId) || 0) + 1);
      }
      for (const [rowId, count] of counts) {
        const { data: hotelRow } = await (supabase as any)
          .from("offline_hotels")
          .select("consumed_rooms")
          .eq("id", rowId)
          .single();
        if (hotelRow) {
          await (supabase as any)
            .from("offline_hotels")
            .update({
              consumed_rooms: Math.max(0, (hotelRow.consumed_rooms || 0) - count),
            })
            .eq("id", rowId);
        }
      }
    }
  } catch (e) {
    console.error("Failed to release offline inventory on cancel:", e);
    throw e;
  }
}


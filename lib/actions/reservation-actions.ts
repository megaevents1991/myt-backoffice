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

// Statuses that release the offline inventory the reservation consumed.
const RELEASED_STATUSES = new Set(["Cancelled", "Lost"]);

export async function updateReservation(id: number, reservation: Partial<Reservation>) {
  // Detect transition into a released status so we can return inventory
  let toRelease: Reservation | null = null;
  if (reservation.status && RELEASED_STATUSES.has(reservation.status)) {
    const { data: current } = await supabase
      .from("reservations")
      .select("*")
      .eq("id", id)
      .single();
    const prev = current as Reservation | null;
    if (prev && !RELEASED_STATUSES.has(prev.status)) toRelease = prev;
  }

  const { data, error } = await supabase.from("reservations").update(reservation).eq("id", id).select()

  if (error) throw error
  if (toRelease) await releaseOfflineInventory(toRelease);
  return data[0] as Reservation
}

export async function updateReservationsStatus(ids: number[], status: string) {
  if (!ids || ids.length === 0) return [] as Reservation[];

  let toRelease: Reservation[] = [];
  if (RELEASED_STATUSES.has(status)) {
    const { data: current } = await supabase
      .from("reservations")
      .select("*")
      .in("id", ids);
    toRelease = ((current ?? []) as Reservation[]).filter(
      (r) => !RELEASED_STATUSES.has(r.status)
    );
  }

  const { data, error } = await supabase
    .from("reservations")
    .update({ status })
    .in("id", ids)
    .select();

  if (error) throw error;

  for (const r of toRelease) {
    await releaseOfflineInventory(r);
  }
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
  if (RELEASED_STATUSES.has(reservation.status)) return reservation;

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
    const offlineFlightId = reservation.offline_flight_id ?? null;
    const flightInfo = reservation.flight_order_info as
      | { numOfTravelers?: number }
      | undefined;
    const numOfTravelers = flightInfo?.numOfTravelers || 0;
    if (offlineFlightId && numOfTravelers > 0) {
      const { data: flightRow } = await (supabase as any)
        .from("flights")
        .select("consumed_quantity")
        .eq("id", offlineFlightId)
        .single();
      if (flightRow) {
        const { error: flErr } = await (supabase as any)
          .from("flights")
          .update({
            consumed_quantity: Math.max(
              0,
              (flightRow.consumed_quantity || 0) - numOfTravelers
            ),
          })
          .eq("id", offlineFlightId);
        if (flErr) throw flErr;
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

export type InventoryReservation = Pick<
  Reservation,
  | "id"
  | "created_at"
  | "main_contact_first_name"
  | "main_contact_last_name"
  | "main_contact_email"
  | "main_contact_phone_number"
  | "status"
  | "more_pax_info"
  | "offline_flight_id"
  | "offline_hotel_id"
  | "offline_hotel_ids"
>;

const INVENTORY_RESERVATION_FIELDS =
  "id, created_at, main_contact_first_name, main_contact_last_name, main_contact_email, main_contact_phone_number, status, more_pax_info, offline_flight_id, offline_hotel_id, offline_hotel_ids";

export async function getReservationsForFlight(flightId: number): Promise<InventoryReservation[]> {
  const { data, error } = await supabase
    .from("reservations")
    .select(INVENTORY_RESERVATION_FIELDS)
    .eq("offline_flight_id", flightId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as InventoryReservation[];
}

export async function getReservationsForHotel(hotelId: number): Promise<InventoryReservation[]> {
  const { data, error } = await supabase
    .from("reservations")
    .select(INVENTORY_RESERVATION_FIELDS)
    .or(`offline_hotel_id.eq.${hotelId},offline_hotel_ids.cs.{${hotelId}}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as InventoryReservation[];
}


"use server"

import { requireAdmin } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server"
import type { Reservation } from "@/types/reservation.types"
import { revalidatePath } from "next/cache"

export async function getReservations() {
  await requireAdmin();
  const { data, error } = await supabase.from("reservations").select("*").order("created_at", { ascending: false })

  if (error) throw error
  return data as Reservation[]
}

export async function getReservation(id: number) {
  await requireAdmin();
  const { data, error } = await supabase.from("reservations").select("*").eq("id", id).single()

  if (error) throw error
  return data as Reservation
}

export async function createReservation(reservation: Omit<Reservation, "id" | "created_at">) {
  await requireAdmin();
  const { data, error } = await supabase.from("reservations").insert(reservation).select()

  if (error) throw error
  return data[0] as Reservation
}

// Statuses that release the offline inventory the reservation consumed.
const RELEASED_STATUSES = new Set(["Cancelled", "Lost"]);

export async function updateReservation(id: number, reservation: Partial<Reservation>) {
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
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

// Lost/Cancelled reservations no longer hold inventory and are hidden from
// the inventory detail pages.
const ACTIVE_RESERVATION_STATUSES_FILTER = "Cancelled,Lost";

// Belt-and-suspenders: the SQL `not.in` filter is case-sensitive and exact, so
// a stored status like "lost" or "Lost " would slip past it. Re-filter in JS
// against RELEASED_STATUSES, normalized, so released reservations never show in
// an inventory view or passenger manifest.
const RELEASED_STATUSES_LOWER = new Set(
  Array.from(RELEASED_STATUSES, (s) => s.toLowerCase())
);
function dropReleased(rows: InventoryReservation[]): InventoryReservation[] {
  return rows.filter(
    (r) => !RELEASED_STATUSES_LOWER.has((r.status ?? "").trim().toLowerCase())
  );
}

export async function getReservationsForFlight(flightId: number): Promise<InventoryReservation[]> {
  await requireAdmin();
  const { data, error } = await supabase
    .from("reservations")
    .select(INVENTORY_RESERVATION_FIELDS)
    .eq("offline_flight_id", flightId)
    .not("status", "in", `(${ACTIVE_RESERVATION_STATUSES_FILTER})`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return dropReleased((data ?? []) as unknown as InventoryReservation[]);
}

export async function getReservationsForHotel(hotelId: number): Promise<InventoryReservation[]> {
  await requireAdmin();
  const { data, error } = await supabase
    .from("reservations")
    .select(INVENTORY_RESERVATION_FIELDS)
    .or(`offline_hotel_id.eq.${hotelId},offline_hotel_ids.cs.{${hotelId}}`)
    .not("status", "in", `(${ACTIVE_RESERVATION_STATUSES_FILTER})`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return dropReleased((data ?? []) as unknown as InventoryReservation[]);
}

// Recomputes consumed_quantity for an offline flight from active reservations.
// Each reservation counts its `flight_order_info.numOfTravelers` (default 1).
// Idempotent — safe to run on every page view.
export async function reconcileFlightInventory(flightId: number): Promise<number> {
  await requireAdmin();
  const { data: rows, error } = await supabase
    .from("reservations")
    .select("flight_order_info, status")
    .eq("offline_flight_id", flightId)
    .not("status", "in", `(${ACTIVE_RESERVATION_STATUSES_FILTER})`);
  if (error) throw error;

  let consumed = 0;
  for (const r of (rows ?? []) as { flight_order_info: { numOfTravelers?: number } | null }[]) {
    const n = r?.flight_order_info?.numOfTravelers;
    consumed += typeof n === "number" && n > 0 ? n : 0;
  }

  const { data: current } = await (supabase as any)
    .from("flights")
    .select("consumed_quantity")
    .eq("id", flightId)
    .single();
  if (current && current.consumed_quantity !== consumed) {
    const { error: upErr } = await (supabase as any)
      .from("flights")
      .update({ consumed_quantity: consumed })
      .eq("id", flightId);
    if (upErr) throw upErr;
  }
  return consumed;
}

// Recomputes consumed_rooms for an offline hotel from active reservations.
// Each occurrence of the hotel id in `offline_hotel_ids` (or `offline_hotel_id`
// fallback) counts as one room.
export async function reconcileHotelInventory(hotelId: number): Promise<number> {
  await requireAdmin();
  const { data: rows, error } = await supabase
    .from("reservations")
    .select("offline_hotel_id, offline_hotel_ids, status")
    .or(`offline_hotel_id.eq.${hotelId},offline_hotel_ids.cs.{${hotelId}}`)
    .not("status", "in", `(${ACTIVE_RESERVATION_STATUSES_FILTER})`);
  if (error) throw error;

  let consumed = 0;
  for (const r of (rows ?? []) as {
    offline_hotel_id: number | null;
    offline_hotel_ids: number[] | null;
  }[]) {
    const ids = r.offline_hotel_ids && r.offline_hotel_ids.length > 0
      ? r.offline_hotel_ids
      : r.offline_hotel_id != null
      ? [r.offline_hotel_id]
      : [];
    consumed += ids.filter((id) => id === hotelId).length;
  }

  const { data: current } = await (supabase as any)
    .from("offline_hotels")
    .select("consumed_rooms")
    .eq("id", hotelId)
    .single();
  if (current && current.consumed_rooms !== consumed) {
    const { error: upErr } = await (supabase as any)
      .from("offline_hotels")
      .update({ consumed_rooms: consumed })
      .eq("id", hotelId);
    if (upErr) throw upErr;
  }
  return consumed;
}


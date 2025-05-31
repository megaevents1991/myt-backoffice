"use server";

import { supabase } from "@/lib/supabase-server";
import type { OfflineFlight } from "../../types/offline-flight.types";
import { revalidatePath } from "next/cache";

export async function getOfflineFlights() {
  const { data, error } = await supabase
    .from("flights")
    .select("*")
    .order("outbound_departure_time", { ascending: true });

  if (error) throw error;
  return data as OfflineFlight[];
}

export async function getOfflineFlight(id: number) {
  const { data, error } = await supabase
    .from("flights")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as OfflineFlight;
}

export async function createOfflineFlight(
  flight: Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted">
) {
  const { data, error } = await supabase
    .from("flights")
    .insert({ ...flight, consumed_quantity: 0, is_deleted: false })
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-flights");
  return data[0] as OfflineFlight;
}

export async function updateOfflineFlight(
  id: number,
  flight: Partial<Omit<OfflineFlight, "id" | "consumed_quantity">>
) {
  const { data, error } = await supabase
    .from("flights")
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
  const { data, error } = await supabase
    .from("flights")
    .update({ is_deleted: true })
    .eq("id", id)
    .select();

  if (error) throw error;
  revalidatePath("/(dashboard)/offline-flights");
  return data[0] as OfflineFlight;
}
"use server"

import { supabase } from "@/lib/supabase-server"
import type { Reservation } from "@/types/reservation.types"

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


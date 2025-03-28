"use server"

import { supabase } from "@/lib/supabase-server"
import type { Event } from "@/types/app.types"

export async function getEvents() {
  const { data, error } = await supabase.from("events").select("*").order("date", { ascending: true })

  if (error) throw error
  return data as Event[]
}

export async function getEvent(id: number) {
  const { data, error } = await supabase.from("events").select("*").eq("id", id).single()

  if (error) throw error
  return data as Event
}

export async function createEvent(event: Omit<Event, "id">) {
  const { data, error } = await supabase.from("events").insert(event).select()

  if (error) throw error
  return data[0] as Event
}

export async function updateEvent(id: number, event: Partial<Event>) {
  const { data, error } = await supabase.from("events").update(event).eq("id", id).select()

  if (error) throw error
  return data[0] as Event
}

export async function softDeleteEvent(id: number) {
  const today = new Date()
  const formattedDate = `${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}-${today.getFullYear()}`

  const { data, error } = await supabase.from("events").update({ is_deleted: formattedDate }).eq("id", id).select()

  if (error) throw error
  return data[0] as Event
}

export async function bulkSoftDeleteEvents(ids: number[]) {
  const today = new Date()
  const formattedDate = `${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}-${today.getFullYear()}`

  const { data, error } = await supabase.from("events").update({ is_deleted: formattedDate }).in("id", ids).select()

  if (error) throw error
  return data as Event[]
}

export async function duplicateEvent(id: number) {
  // First get the event to duplicate
  const { data: eventToDuplicate, error: fetchError } = await supabase.from("events").select("*").eq("id", id).single()

  if (fetchError) throw fetchError

  // Remove the id and modify the name to indicate it's a copy
  const { id: _, ...eventWithoutId } = eventToDuplicate
  const newEvent = {
    ...eventWithoutId,
    name: `${eventWithoutId.name} (Copy)`,
    name_english: `${eventWithoutId.name_english} (Copy)`,
    is_deleted: null, // Ensure the copy is not deleted
  }

  // Insert the new event
  const { data: newEventData, error: insertError } = await supabase.from("events").insert(newEvent).select()

  if (insertError) throw insertError
  return newEventData[0] as Event
}

export async function bulkDuplicateEvents(ids: number[]) {
  const duplicatedEvents: Event[] = []

  // We need to duplicate each event one by one
  for (const id of ids) {
    const duplicatedEvent = await duplicateEvent(id)
    duplicatedEvents.push(duplicatedEvent)
  }

  return duplicatedEvents
}

export async function getActiveEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .is("is_deleted", null)
    .order("date", { ascending: true })

  if (error) throw error
  return data as Event[]
}


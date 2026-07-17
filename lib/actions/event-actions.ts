"use server"

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server"
import type { Event } from "@/types/app.types"
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit"

export async function getEvents() {
  await requireStaff();
  const { data, error } = await supabase.from("events").select("*").order("date", { ascending: true })

  if (error) throw error
  return data as Event[]
}

export async function getEvent(id: number) {
  await requireStaff();
  const { data, error } = await supabase.from("events").select("*").eq("id", id).single()

  if (error) throw error
  return data as Event
}

export async function createEvent(event: Omit<Event, "id">) {
  await requireStaff();
  // Ensure is_deleted is null for new events
  const eventData = {
    ...event,
    is_deleted: event.is_deleted === "" ? null : event.is_deleted,
  }

  const { data, error } = await supabase.from("events").insert(eventData).select()

  if (error) throw error
  const created = data[0] as Event
  await logAudit({ action: "create", entityType: "event", entityId: created.id, changes: eventData })
  return created
}

export async function updateEvent(id: number, event: Partial<Event>) {
  await requireStaff();
  const before = await fetchBefore("events", "id", id, event)
  const { data, error } = await supabase.from("events").update(event).eq("id", id).select()

  if (error) throw error
  await logAudit({ action: "update", entityType: "event", entityId: id, changes: diffChanges(before, event) })
  return data[0] as Event
}

export async function softDeleteEvent(id: number) {
  await requireStaff();
  const today = new Date()
  const formattedDate = `${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}-${today.getFullYear()}`

  const { data, error } = await supabase.from("events").update({ is_deleted: formattedDate }).eq("id", id).select()

  if (error) throw error
  await logAudit({
    action: "delete",
    entityType: "event",
    entityId: id,
    changes: { is_deleted: formattedDate },
  })
  return data[0] as Event
}

export async function bulkSoftDeleteEvents(ids: number[]) {
  await requireStaff();
  const today = new Date()
  const formattedDate = `${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}-${today.getFullYear()}`

  const { data, error } = await supabase.from("events").update({ is_deleted: formattedDate }).in("id", ids).select()

  if (error) throw error
  await logAudit({
    action: "delete",
    entityType: "event",
    entityId: null,
    changes: { is_deleted: formattedDate },
    metadata: { ids, count: ids.length },
  })
  return data as Event[]
}

export async function duplicateEvent(id: number, opts?: { skipAudit?: boolean }) {
  await requireStaff();
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
  const created = newEventData[0] as Event

  // Copy taxonomy links (categories + feed tags) to the duplicate. Tolerant:
  // a link-copy failure must not break duplication itself.
  try {
    const { data: catLinks, error: catErr } = await (supabase as any)
      .from("event_category_links").select("category_id").eq("event_id", id);
    if (catErr) throw catErr;
    if (catLinks?.length) {
      const { error } = await (supabase as any).from("event_category_links")
        .insert(catLinks.map((r: { category_id: number }) => ({ event_id: created.id, category_id: r.category_id })));
      if (error) throw error;
    }
    const { data: tagLinks, error: tagErr } = await (supabase as any)
      .from("event_tag_links").select("tag_id").eq("event_id", id);
    if (tagErr) throw tagErr;
    if (tagLinks?.length) {
      const { error } = await (supabase as any).from("event_tag_links")
        .insert(tagLinks.map((r: { tag_id: number }) => ({ event_id: created.id, tag_id: r.tag_id })));
      if (error) throw error;
    }
  } catch (linkError) {
    console.error("duplicateEvent: taxonomy link copy failed:", JSON.stringify(linkError));
  }
  if (!opts?.skipAudit) {
    await logAudit({
      action: "create",
      entityType: "event",
      entityId: created.id,
      metadata: { duplicated_from: id },
    })
  }
  return created
}

export async function bulkUpdateEvents(ids: number[], update: Partial<Event>) {
  await requireStaff();
  const { data, error } = await supabase.from("events").update(update).in("id", ids).select()

  if (error) throw error
  await logAudit({
    action: "update",
    entityType: "event",
    entityId: null,
    changes: update,
    metadata: { ids, count: ids.length },
  })
  return data as Event[]
}

export async function bulkDuplicateEvents(ids: number[]) {
  await requireStaff();
  const duplicatedEvents: Event[] = []

  // We need to duplicate each event one by one
  for (const id of ids) {
    const duplicatedEvent = await duplicateEvent(id, { skipAudit: true })
    duplicatedEvents.push(duplicatedEvent)
  }

  await logAudit({
    action: "create",
    entityType: "event",
    entityId: null,
    metadata: { ids, count: ids.length },
  })
  return duplicatedEvents
}

export async function getActiveEvents() {
  await requireStaff();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .is("is_deleted", null)
    .order("date", { ascending: true })

  if (error) throw error
  return data as Event[]
}

export async function syncEventPrices(id: number) {
  await requireStaff();
  const { ticketPriceSyncService } = await import("@/lib/services/ticket-price-sync")
  const result = await ticketPriceSyncService.syncSingleEvent(id)
  await logAudit({ action: "sync_triggered", entityType: "event", entityId: id })
  return result
}


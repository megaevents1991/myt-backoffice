"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import type { Event } from "@/types/app.types";
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";
import { applyTagRules } from "@/lib/services/auto-tagger";

// Exactly the columns the events LIST page reads (table cells, filters,
// auto-calc, price-light column). Sole consumer is events-table.tsx; the
// edit/view pages fetch their own full row via getEvent(). Soft-deleted
// rows stay included - the list has a "show deleted" toggle.
const EVENT_LIST_COLUMNS =
  "id,name,name_english,type,date,location,usual_price," +
  "tags,skip_flight,is_prioritized,is_deleted," +
  "tickets_and_rates,def_date_depart,def_date_return," +
  "base_flight_price,base_hotel_price,event_additional_markup," +
  "light_package,light_ticket,light_detail,light_checked_at,light_silenced_until," +
  "price_drop_usd,price_drop_from,price_drop_until";

export async function getEvents() {
  await requireStaff();
  // Paged: PostgREST hard-caps every response at 1000 rows, and the table is
  // closing in on it (878 rows as of 2026-08-19) - a single fetch would then
  // silently drop every event past the cap. id tiebreaks same-date rows so
  // pages never overlap or skip.
  const { rows, truncated, error } = await fetchPaged<Event>(
    () =>
      supabase
        .from("events")
        .select(EVENT_LIST_COLUMNS)
        .order("date", { ascending: true })
        .order("id", { ascending: true }),
    10000,
  );

  if (error) throw error;
  if (truncated) console.error("getEvents: hit the 10k paging cap - raise it");
  return rows as unknown as Event[];
}

export async function getEvent(id: number) {
  await requireStaff();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as Event;
}

export async function createEvent(event: Omit<Event, "id">) {
  await requireStaff();
  // Ensure is_deleted is null for new events
  const eventData = {
    ...event,
    is_deleted: event.is_deleted === "" ? null : event.is_deleted,
    // Card image: fall back to the campaign creative when none was chosen -
    // a manual pick always wins (spec 2026-09-02, form cleanup). Usually both
    // are empty at create time and the nightly creative cron fills later.
    card_image_url: event.card_image_url || event.campaign_image_url || "",
  };

  // `as never`: the shared client is untyped (no generated DB generics yet -
  // see the db:types regen TODO), so PostgREST write params collapse to never.
  const { data, error } = await supabase
    .from("events")
    .insert(eventData as never)
    .select();

  if (error) throw error;
  const created = data[0] as Event;
  await logAudit({
    action: "create",
    entityType: "event",
    entityId: created.id,
    changes: eventData,
  });
  // Auto-tag from tag_rules - tolerant: a tagging failure must not fail the create.
  try {
    await applyTagRules([created.id]);
  } catch (e) {
    console.error("auto-tag on create failed:", e);
  }
  // Price light: match the new event against the stored competitor catalogs right away
  // (seconds, no browsing). Tolerant - the nightly run completes it.
  //
  // `judge: null` - RULE ONLY here, deliberately. This runs inside the user's save request and
  // has no run-wide budget to share (every other AI call site gets one), so leaving the judge on
  // would mean up to one 12s AI call per competitor per scope added to a single save - and the
  // factory's bulk-approve, which calls createEvent once per draft, could fire hundreds of
  // unbudgeted calls from one click. An ambiguous new event simply waits for tonight's pass,
  // where both the ceiling and the timing are accounted for.
  try {
    const { matchAllForEvent } = await import("@/lib/services/price-light-match");
    await matchAllForEvent(created.id, "on_create", { judge: null });
  } catch (e) {
    console.error("price-light on create failed:", e);
  }
  invalidatePriceLight("rows");
  return created;
}

export async function updateEvent(id: number, input: Partial<Event>) {
  await requireStaff();
  // The lights and the price-drop tag are owned by the price-light crons - a
  // form save must never write them back (stale copy from page load).
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    light_package: _lp, light_ticket: _lt, light_detail: _ld, light_checked_at: _lc, light_silenced_until: _ls,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    price_drop_usd: _pu, price_drop_from: _pf, price_drop_until: _pt,
    ...event
  } = input;
  const before = await fetchBefore("events", "id", id, event);
  const { data, error } = await supabase
    .from("events")
    .update(event as never)
    .eq("id", id)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "event",
    entityId: id,
    changes: diffChanges(before, event),
  });
  // /price-light caches its rows; a saved price/date/name must show there at once - the "הוזל"
  // flow edits the base price here and goes straight back to that screen.
  invalidatePriceLight("rows");
  return data[0] as Event;
}

export async function softDeleteEvent(id: number) {
  await requireStaff();
  const today = new Date();
  const formattedDate = `${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}-${today.getFullYear()}`;

  const { data, error } = await supabase
    .from("events")
    .update({ is_deleted: formattedDate } as never)
    .eq("id", id)
    .select();

  if (error) throw error;
  await logAudit({
    action: "delete",
    entityType: "event",
    entityId: id,
    changes: { is_deleted: formattedDate },
  });
  invalidatePriceLight("rows");
  return data[0] as Event;
}

export async function bulkSoftDeleteEvents(ids: number[]) {
  await requireStaff();
  const today = new Date();
  const formattedDate = `${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}-${today.getFullYear()}`;

  const { data, error } = await supabase
    .from("events")
    .update({ is_deleted: formattedDate } as never)
    .in("id", ids)
    .select();

  if (error) throw error;
  await logAudit({
    action: "delete",
    entityType: "event",
    entityId: null,
    changes: { is_deleted: formattedDate },
    metadata: { ids, count: ids.length },
  });
  invalidatePriceLight("rows");
  return data as Event[];
}

export async function duplicateEvent(
  id: number,
  opts?: { skipAudit?: boolean },
) {
  await requireStaff();
  // First get the event to duplicate
  const { data: eventToDuplicate, error: fetchError } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError) throw fetchError;

  // Remove the id and modify the name to indicate it's a copy
  const source = eventToDuplicate as Event;
  const newEvent: Record<string, unknown> = {
    ...source,
    name: `${source.name} (Copy)`,
    name_english: `${source.name_english} (Copy)`,
    is_deleted: null, // Ensure the copy is not deleted
    // The price-light state describes the ORIGINAL's comparison - a copy (usually for another
    // date) must earn its own. Carried over, a manual override would be re-applied to the copy
    // every night, a mute would hide its reds, and the price-drop tag would show on a price
    // that never dropped.
    light_package: null, light_ticket: null, light_detail: null, light_checked_at: null,
    light_silenced_until: null, price_drop_usd: null, price_drop_from: null, price_drop_until: null,
  };
  delete newEvent.id;

  // Insert the new event
  const { data: newEventData, error: insertError } = await supabase
    .from("events")
    .insert(newEvent as never)
    .select();

  if (insertError) throw insertError;
  const created = newEventData[0] as Event;

  // Copy the feed tags to the duplicate - that alone carries its categories
  // too, since a category is composed of tags (event_category_links is a
  // derived view). Tolerant: a copy failure must not break duplication itself.
  try {
    const { data: tagLinks, error: tagErr } = await supabase
      .from("event_tag_links")
      .select("tag_id")
      .eq("event_id", id);
    if (tagErr) throw tagErr;
    const links = ((tagLinks ?? []) as unknown as { tag_id: number }[]).map(
      (r) => ({ event_id: created.id, tag_id: r.tag_id }),
    );
    if (links.length) {
      const { error } = await supabase
        .from("event_tag_links")
        .insert(links as never);
      if (error) throw error;
    }
  } catch (linkError) {
    console.error(
      "duplicateEvent: taxonomy link copy failed:",
      JSON.stringify(linkError),
    );
  }
  if (!opts?.skipAudit) {
    await logAudit({
      action: "create",
      entityType: "event",
      entityId: created.id,
      metadata: { duplicated_from: id },
    });
  }
  return created;
}

export async function bulkUpdateEvents(ids: number[], update: Partial<Event>) {
  await requireStaff();
  const { data, error } = await supabase
    .from("events")
    .update(update as never)
    .in("id", ids)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "event",
    entityId: null,
    changes: update,
    metadata: { ids, count: ids.length },
  });
  return data as Event[];
}

export async function bulkDuplicateEvents(ids: number[]) {
  await requireStaff();
  const duplicatedEvents: Event[] = [];

  // We need to duplicate each event one by one
  for (const id of ids) {
    const duplicatedEvent = await duplicateEvent(id, { skipAudit: true });
    duplicatedEvents.push(duplicatedEvent);
  }

  await logAudit({
    action: "create",
    entityType: "event",
    entityId: null,
    metadata: { ids, count: ids.length },
  });
  return duplicatedEvents;
}

export async function getActiveEvents() {
  await requireStaff();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .is("is_deleted", null)
    .order("date", { ascending: true });

  if (error) throw error;
  return data as Event[];
}

export async function syncEventPrices(id: number) {
  await requireStaff();
  const { ticketPriceSyncService } =
    await import("@/lib/services/ticket-price-sync");
  const result = await ticketPriceSyncService.syncSingleEvent(id);
  await logAudit({
    action: "sync_triggered",
    entityType: "event",
    entityId: id,
  });
  invalidatePriceLight("rows"); // ticket prices moved -> `our_usd_now` on /price-light
  return result;
}

"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { requireCompany, type Company } from "@/lib/company";
import {
  flightsOf,
  megaEventsFlights,
  sellsEvents,
  sellsTours,
} from "@/lib/flights-scope";
import type { OfflineFlight } from "../../types/offline-flight.types";
import type { Event } from "../../types/app.types";
import { revalidatePath } from "next/cache";
import { airportsInSameCity } from "@/lib/airport-cities";
import { logAudit, diffChanges } from "@/lib/audit";
import {
  pickFlightColumns,
  withoutLifecycleStatus,
  assertFlightValues,
} from "./offline-flight-columns";
import { pushFlightsToEvents } from "./offline-flight-event-sync";

// `flights` is shared by every company. Nothing here touches the table
// directly - every query goes through lib/flights-scope.ts:
//   - the Offline Flights screens (list, detail, create, edit, delete) work in
//     the ACTIVE company: flightsOf(company);
//   - anything keyed by an event works on Mega Events flights only, whatever
//     the active company: megaEventsFlights().

/** Far above any company's real inventory; the list pages through PostgREST's 1000-row cap. */
const FLIGHTS_LIST_MAX = 20_000;

const FLIGHT_NOT_FOUND = "Flight not found";

/**
 * Event links exist only in a company that sells events. A tours block must
 * never carry an event id: the customer site sells flights by `event_ids`, so a
 * linked group block would be offered to Mega Events customers.
 */
function assertEventLinksAllowed(
  company: Company,
  row: Record<string, unknown>,
): void {
  if (sellsEvents(company)) return;
  if (Array.isArray(row.event_ids) && row.event_ids.length > 0) {
    throw new Error(`Flights of ${company.name} cannot be linked to events`);
  }
}

/**
 * What the Offline Flights forms offer in the active company: a tours company
 * gets the whole block lifecycle and the operations columns, an events company
 * gets event links. Cosmetic only - every action above and below re-checks the
 * company on the server.
 */
export async function getFlightCompanyMode(): Promise<{
  tours: boolean;
  events: boolean;
}> {
  const { company } = await requireCompany();
  return { tours: sellsTours(company), events: sellsEvents(company) };
}

/** Every flight of one scope, oldest departure first, paged past the 1000-row cap. */
async function listFlights(
  scope: ReturnType<typeof flightsOf>,
  label: string,
): Promise<OfflineFlight[]> {
  const { rows, truncated, error } = await fetchPaged<OfflineFlight>(
    () =>
      scope
        .select("*")
        .order("outbound_departure_time", { ascending: true })
        // Tie-breaker: without it two pages can disagree on the order of
        // flights that leave at the same minute.
        .order("id", { ascending: true }),
    FLIGHTS_LIST_MAX,
  );

  if (error) throw error;
  if (truncated) {
    console.error(
      `${label}: more than ${FLIGHTS_LIST_MAX} flights - list truncated`,
    );
  }
  return rows;
}

/** The Offline Flights list: every flight of the ACTIVE company. */
export async function getCompanyFlights() {
  const { company } = await requireCompany();
  return listFlights(flightsOf(company), `getCompanyFlights(${company.slug})`);
}

/**
 * MEGA EVENTS flights, whatever the active company. This is the list the event
 * page offers under "Link Existing" - an event feature - and it keeps the name
 * and the meaning it had before companies existed: a caller that knows nothing
 * about companies gets Mega Events, never another company's group blocks.
 * The Offline Flights screen itself calls getCompanyFlights().
 */
export async function getOfflineFlights() {
  await requireStaff();
  return listFlights(megaEventsFlights(), "getOfflineFlights");
}

/**
 * null when the id does not exist IN THE ACTIVE COMPANY - a flight of another
 * company is "not found", never returned.
 */
export async function getOfflineFlight(
  id: number,
): Promise<OfflineFlight | null> {
  const { company } = await requireCompany();
  const { data, error } = await flightsOf(company)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as OfflineFlight | null) ?? null;
}

export async function createOfflineFlight(
  flight: Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted">,
) {
  const { company } = await requireCompany();
  const mode = { tours: sellsTours(company) };
  const row = pickFlightColumns(
    flight as unknown as Record<string, unknown>,
    mode,
  );
  assertFlightValues(row, mode);
  assertEventLinksAllowed(company, row);
  const { data, error } = await flightsOf(company)
    .insert({ ...row, consumed_quantity: 0, is_deleted: false })
    .select();

  if (error) throw error;
  const created = data[0] as OfflineFlight;
  await logAudit({
    action: "create",
    entityType: "offline_flight",
    entityId: created.id,
    changes: flight,
  });
  // Every event on a new flight is newly linked: price + default dates, the
  // same as linking it through updateOfflineFlight.
  if (sellsEvents(company)) {
    await pushFlightsToEvents([
      { flight: created, added: created.event_ids ?? [] },
    ]);
  }
  revalidatePath("/offline-flights");
  return created;
}

export async function updateOfflineFlight(
  id: number,
  flight: Partial<Omit<OfflineFlight, "id" | "consumed_quantity">>,
) {
  const { company } = await requireCompany();
  const mode = { tours: sellsTours(company) };
  const patch = withoutLifecycleStatus(
    pickFlightColumns(flight as Record<string, unknown>, mode),
    mode,
  );
  assertFlightValues(patch, mode);
  assertEventLinksAllowed(company, patch);
  // One scoped read serves the audit snapshot and the price/link diff. A
  // flight of another company is not found here, so it is never updated.
  const { data: current, error: currentError } = await flightsOf(company)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw new Error(FLIGHT_NOT_FOUND);
  const auditBefore = current as Record<string, unknown>;
  const oldEventIds: number[] = current.event_ids ?? [];
  const oldPrice = Number(current.price ?? 0);
  const newEventIds: number[] = flight.event_ids ?? oldEventIds;
  const addedEventIds = newEventIds.filter((eid) => !oldEventIds.includes(eid));

  const { data, error } = await flightsOf(company)
    .update(patch)
    .eq("id", id)
    .select();

  if (error) throw error;
  if (!data?.[0]) throw new Error(FLIGHT_NOT_FOUND);
  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: id,
    changes: diffChanges(auditBefore, flight),
  });

  const updated = data[0] as OfflineFlight;
  const priceChanged =
    Math.round(Number(updated.price)) !== Math.round(oldPrice);

  // Newly added events take price + default dates; already-linked ones take
  // the price only, and only when it moved.
  if (sellsEvents(company)) {
    await pushFlightsToEvents([
      {
        flight: updated,
        added: addedEventIds,
        repriced: priceChanged ? newEventIds : [],
      },
    ]);
  }

  revalidatePath("/offline-flights");
  revalidatePath(`/offline-flights/${id}/edit`);
  revalidatePath(`/offline-flights/${id}`);
  return data[0] as OfflineFlight;
}

export async function softDeleteOfflineFlight(id: number) {
  const { company } = await requireCompany();
  const { data, error } = await flightsOf(company)
    .update({ is_deleted: true })
    .eq("id", id)
    .select();

  if (error) throw error;
  if (!data?.[0]) throw new Error(FLIGHT_NOT_FOUND);
  await logAudit({
    action: "delete",
    entityType: "offline_flight",
    entityId: id,
  });
  revalidatePath("/offline-flights");
  revalidatePath(`/offline-flights/${id}`);
  return data[0] as OfflineFlight;
}

export async function restoreOfflineFlight(id: number) {
  const { company } = await requireCompany();
  const { data, error } = await flightsOf(company)
    .update({ is_deleted: false })
    .eq("id", id)
    .select();

  if (error) throw error;
  if (!data?.[0]) throw new Error(FLIGHT_NOT_FOUND);
  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: id,
    metadata: { restored: true },
  });
  revalidatePath("/offline-flights");
  revalidatePath(`/offline-flights/${id}`);
  return data[0] as OfflineFlight;
}

// ---- keyed by an event: Mega Events flights only, whatever the active company

export async function getFlightsByEventId(
  eventId: number,
): Promise<OfflineFlight[]> {
  await requireStaff();
  const { data, error } = await megaEventsFlights()
    .select("*")
    .contains("event_ids", [eventId])
    .eq("is_deleted", false)
    .order("outbound_departure_time", { ascending: true });

  if (error) throw error;
  return (data ?? []) as OfflineFlight[];
}

export async function removeEventFromFlight(
  flightId: number,
  eventId: number,
): Promise<OfflineFlight> {
  await requireStaff();
  const { data: current, error: fetchError } = await megaEventsFlights()
    .select("*")
    .eq("id", flightId)
    .single();
  if (fetchError) throw fetchError;

  const existing = (current.event_ids as number[]) ?? [];
  if (!existing.includes(eventId)) return current as OfflineFlight;

  const { data, error } = await megaEventsFlights()
    .update({ event_ids: existing.filter((id) => id !== eventId) })
    .eq("id", flightId)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: flightId,
    metadata: { event_id: eventId },
  });
  revalidatePath("/offline-flights");
  revalidatePath(`/events/${eventId}`);
  return data[0] as OfflineFlight;
}

export async function addEventToFlight(
  flightId: number,
  eventId: number,
): Promise<OfflineFlight> {
  await requireStaff();
  const { data: current, error: fetchError } = await megaEventsFlights()
    .select("*")
    .eq("id", flightId)
    .single();

  if (fetchError) throw fetchError;

  const existing = (current.event_ids as number[]) ?? [];
  if (existing.includes(eventId)) {
    return current as OfflineFlight;
  }

  const { data, error } = await megaEventsFlights()
    .update({ event_ids: [...existing, eventId] })
    .eq("id", flightId)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "offline_flight",
    entityId: flightId,
    metadata: { event_id: eventId },
  });
  revalidatePath("/offline-flights");
  revalidatePath(`/events/${eventId}`);
  return data[0] as OfflineFlight;
}

export async function getRelevantEventsForFlight(
  destinationIata: string,
  departureDate: string,
  returnDate: string,
): Promise<Pick<Event, "id" | "name" | "date">[]> {
  const { company } = await requireCompany();
  // Events are a Mega Events product: a tours company has nothing to suggest.
  if (!sellsEvents(company)) return [];
  const cityCodes = airportsInSameCity(destinationIata);
  const { data, error } = await supabase
    .from("events")
    .select("id, name, date")
    .is("is_deleted", null)
    .in("location->>city_iata", cityCodes)
    .gt("date", departureDate)
    .lt("date", returnDate)
    .order("date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Pick<Event, "id" | "name" | "date">[];
}

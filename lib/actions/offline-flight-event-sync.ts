import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase-server";
import type { OfflineFlight } from "@/types/offline-flight.types";

// NOT a "use server" file on purpose: every export of one is a public endpoint,
// and these writes skip the auth check - the guarded actions in
// offline-flight-actions.ts / offline-flight-bulk-actions.ts call them.

export type FlightForEvents = Pick<
  OfflineFlight,
  "price" | "outbound_departure_time" | "inbound_departure_time"
>;

export type FlightEventPush = {
  flight: FlightForEvents;
  /** Events this write links to the flight for the first time. */
  added?: number[];
  /** Already-linked events whose price must follow (the flight's price moved). */
  repriced?: number[];
};

/**
 * What a linked offline flight writes on its events (the rule
 * updateOfflineFlight always had, now shared by create, series and the bulk
 * price / link actions):
 * - a NEWLY linked event takes the flight's price as `base_flight_price` and
 *   its dates as the package default dates. Return date = takeoff of the
 *   return leg (inbound_departure_time), NOT the landing-back-in-Israel time;
 * - an already linked event takes only the price.
 *
 * One write per event: when two flights in `pushes` reach the same event, the
 * LATER one wins - the same result as saving them one after the other.
 */
export async function pushFlightsToEvents(
  pushes: FlightEventPush[],
): Promise<number[]> {
  const byEvent = new Map<number, { flight: FlightForEvents; added: boolean }>();
  for (const { flight, added = [], repriced = [] } of pushes) {
    for (const eventId of repriced) byEvent.set(eventId, { flight, added: false });
    for (const eventId of added) byEvent.set(eventId, { flight, added: true });
  }
  if (byEvent.size === 0) return [];

  await Promise.all(
    Array.from(byEvent).map(async ([eventId, { flight, added }]) => {
      const eventUpdate: Record<string, unknown> = {
        base_flight_price: Math.round(Number(flight.price)),
      };
      if (added) {
        eventUpdate.def_date_depart = flight.outbound_departure_time.slice(0, 10);
        eventUpdate.def_date_return = flight.inbound_departure_time.slice(0, 10);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("events")
        .update(eventUpdate)
        .eq("id", eventId);
      if (error) throw error;
    }),
  );

  const eventIds = Array.from(byEvent.keys());
  for (const eventId of eventIds) revalidatePath(`/events/${eventId}`);
  return eventIds;
}

// Stadium memory (spec docs/superpowers/specs/2026-09-02, section 4a).
//
// A venue that was ever detailed stays detailed: find the most recent live
// event at the same venue and hand its ticket-category structure to the new
// event. Prices come along only as the fallback - the wizard's existing
// reprice replaces them from live listings wherever a listing matches
// (a category with no match keeps the old price, per spec).
//
// No new table - the memory IS the existing events.
import { supabase } from "@/lib/supabase-server";
import { normalizeForSearch } from "@/lib/search";
import type { Event, EventTicket } from "@/types/app.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Haversine distance in km. Pure. */
export function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Venue names compare loosely: case, diacritics and punctuation ignored. */
export function normalizeVenueName(name: string): string {
  return normalizeForSearch(name);
}

/** Lodging fields a venue "remembers" (spec part C): the next home game at Anfield gets
 *  the same event city / mode / default without anyone re-typing them. */
export type VenueLodging = Pick<
  Event,
  "event_location" | "lodging_mode" | "lodging_default" | "lodging_note" | "split_default_nights"
>;

export type VenueMemory = {
  fromEventId: number;
  fromEventName: string;
  tickets: EventTicket[];
  /** null when the remembered event had no event city. */
  lodging: VenueLodging | null;
} | null;

interface MemoryRow {
  id: number;
  name: string;
  location: { latitude?: number; longitude?: number; name?: string } | null;
  tickets_and_rates: EventTicket[] | null;
  event_location: Event["event_location"];
  lodging_mode: Event["lodging_mode"] | null;
  lodging_default: Event["lodging_default"] | null;
  lodging_note: string | null;
  split_default_nights: number | null;
}

/**
 * The most recent live event at this venue that actually has ticket
 * categories. Match by normalized venue name, falling back to coordinate
 * proximity (< 1 km). Ticket ids are regenerated so two events never share
 * category ids.
 */
export async function findVenueMemory(
  venueName: string,
  lat: number,
  lon: number,
): Promise<VenueMemory> {
  const { data, error } = await db
    .from("events")
    .select("id,name,location,tickets_and_rates,event_location,lodging_mode,lodging_default,lodging_note,split_default_nights")
    .is("is_deleted", null)
    .order("date", { ascending: false })
    .limit(400);
  if (error) {
    console.error("venue-memory: query failed", JSON.stringify(error));
    return null;
  }

  const rows = (data ?? []) as MemoryRow[];
  const wanted = normalizeVenueName(venueName);
  const hasTickets = (row: MemoryRow) =>
    Array.isArray(row.tickets_and_rates) && row.tickets_and_rates.length > 0;

  let match =
    wanted.length > 0
      ? rows.find(
          (row) =>
            hasTickets(row) &&
            normalizeVenueName(row.location?.name ?? "") === wanted,
        )
      : undefined;

  if (!match && Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) {
    match = rows.find(
      (row) =>
        hasTickets(row) &&
        typeof row.location?.latitude === "number" &&
        typeof row.location?.longitude === "number" &&
        distanceKm(lat, lon, row.location.latitude, row.location.longitude) < 1,
    );
  }

  if (!match) return null;

  return {
    fromEventId: match.id,
    fromEventName: match.name,
    tickets: (match.tickets_and_rates ?? []).map((ticket) => ({
      ...ticket,
      id: crypto.randomUUID(),
    })),
    lodging: match.event_location
      ? {
          event_location: match.event_location,
          lodging_mode: match.lodging_mode ?? "flight_city",
          lodging_default: match.lodging_default ?? "flight",
          lodging_note: match.lodging_note ?? null,
          split_default_nights: match.split_default_nights ?? 2,
        }
      : null,
  };
}

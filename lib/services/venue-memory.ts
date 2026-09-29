// Stadium memory (spec docs/superpowers/specs/2026-09-02, section 4a).
//
// A venue that was ever detailed stays detailed: find the most recent live
// event at the same venue and hand its ticket-category structure to the new
// event. Prices come along only as the fallback - the TixStock sync and main's
// live pricing re-price every copied category by name once it carries the new
// fixture's `eid`.
//
// "The same venue" is the SEAT MAP, not the location (2026-09-28). Every live
// event's `location` is a CITY picked from the Locations dropdown, never a
// stadium, so the old venue-name match never hit and its <1km coordinate
// fallback meant "the latest event in the same city" - a Real Madrid game got
// Harry Styles' concert tickets. A seat map is one stadium in one layout (a
// concert at the Bernabéu has a drawing of its own), and our adopted copy of a
// map (`venue_maps`) is the same venue as the supplier drawing it came from.
//
// No new table - the memory IS the existing events.
import { supabase } from "@/lib/supabase-server";
import { fixturePair } from "@/lib/creative/fixture";
import { carriesToAnotherFixture, ticketForFixture } from "@/lib/suppliers";
import type { Event, EventTicket, EventType } from "@/types/app.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** How many same-map events are looked at before giving up. */
const MEMORY_CANDIDATES = 20;

/**
 * A drawing TixStock hands to more venues than this is a placeholder, not a
 * stadium ("General Admission.svg" serves 244 venues, from comedy clubs up) -
 * it would copy a club night's tickets onto an arena show.
 */
const GENERIC_MAP_VENUES = 3;

/** The spellings one URL is stored under: events hold both "Arsenal - Emirates"
 *  and "Arsenal%20-%20Emirates" for the same drawing. */
function urlSpellings(url: string): string[] {
  const out = new Set([url]);
  try {
    const decoded = decodeURI(url);
    out.add(decoded);
    out.add(encodeURI(decoded));
  } catch {
    // Malformed escape: the stored spelling is all we have.
  }
  return [...out];
}

/**
 * Whether a drawing is a football layout, by the TixStock events drawn on it:
 * most of them are "A vs B" fixtures. Pure. No events = not known to be one.
 */
export function isFixtureDrawing(eventNames: (string | null)[]): boolean {
  const names = eventNames.filter((name): name is string => !!name?.trim());
  const fixtures = names.filter((name) => fixturePair(name) !== null).length;
  return names.length > 0 && fixtures * 2 > names.length;
}

/**
 * What TixStock's own events say about a drawing: `generic` when it serves
 * several different venues (a placeholder), `fixtures` when it is a football
 * layout (`isFixtureDrawing`).
 */
async function drawingProfile(
  urls: string[],
): Promise<{ generic: boolean; fixtures: boolean }> {
  const { data, error } = await db
    .from("tixstock_events")
    .select("venue_name,event_name")
    .in("venue_map_url", urls)
    .limit(200);
  if (error) {
    console.warn("venue-memory: tixstock_events read failed", JSON.stringify(error));
    return { generic: false, fixtures: false };
  }
  const rows = (data ?? []) as { venue_name: string | null; event_name: string | null }[];
  const venues = new Set(rows.map((row) => (row.venue_name ?? "").trim().toLowerCase()));
  return {
    generic: venues.size > GENERIC_MAP_VENUES,
    fixtures: isFixtureDrawing(rows.map((row) => row.event_name)),
  };
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

export type VenueMemoryInput = {
  /** The new event's `map_image_url` - the supplier's drawing or our copy of it. */
  mapUrl: string;
  eventType: EventType;
  /** The new event's own supplier event id (a TixStock event id) - stamped on
   *  every copied ticket. null = the copies carry no `eid` at all. */
  supplierEventId: string | null;
  /** TixStock's name for the venue ("Anfield"). TixStock keeps more than one
   *  drawing of some stadiums; every drawing it uses for this venue counts as
   *  the same venue. null = the map alone decides. */
  supplierVenueName?: string | null;
};

interface MemoryRow {
  id: number;
  name: string;
  map_image_url: string | null;
  tickets_and_rates: EventTicket[] | null;
  event_location: Event["event_location"];
  lodging_mode: Event["lodging_mode"] | null;
  lodging_default: Event["lodging_default"] | null;
  lodging_note: string | null;
  split_default_nights: number | null;
}

/** The other side of a drawing's `venue_maps` row: supplier drawing <-> our adopted copy. */
async function adoptedTwins(mapUrl: string): Promise<string[]> {
  const urls: string[] = [];
  for (const column of ["source_url", "svg_url"] as const) {
    const { data, error } = await db
      .from("venue_maps")
      .select("source_url,svg_url")
      .in(column, urlSpellings(mapUrl))
      .limit(5);
    if (error) {
      // Table unreadable: the map URL alone still finds its events.
      console.warn("venue-memory: venue_maps read failed", JSON.stringify(error));
      continue;
    }
    for (const row of (data ?? []) as { source_url: string; svg_url: string | null }[]) {
      urls.push(...urlSpellings(row.source_url));
      if (row.svg_url) urls.push(row.svg_url);
    }
  }
  return urls;
}

/** Every FOOTBALL drawing TixStock uses for a venue, placeholders left out. */
async function tixstockVenueFixtureMaps(venueName: string): Promise<string[]> {
  const { data, error } = await db
    .from("tixstock_events")
    .select("venue_map_url,event_name")
    .eq("venue_name", venueName)
    .limit(500);
  if (error) {
    console.warn("venue-memory: tixstock venue maps read failed", JSON.stringify(error));
    return [];
  }
  const namesByMap = new Map<string, (string | null)[]>();
  for (const row of (data ?? []) as { venue_map_url: string | null; event_name: string | null }[]) {
    const url = (row.venue_map_url ?? "").trim();
    if (url) namesByMap.set(url, [...(namesByMap.get(url) ?? []), row.event_name]);
  }
  const kept: string[] = [];
  for (const [url, names] of namesByMap) {
    if (!isFixtureDrawing(names)) continue;
    if (!(await drawingProfile(urlSpellings(url))).generic) kept.push(url);
  }
  return kept;
}

/**
 * Every URL that draws the same venue as `mapUrl`: its spellings, our adopted
 * copy (or the drawing it came from), and - for a football drawing, given
 * TixStock's venue name - the other football drawings TixStock keeps of that
 * venue. Empty = no venue to remember: `mapUrl` is a placeholder shared by
 * many venues.
 *
 * Only football widens to the venue: every football drawing of a stadium is
 * the same seating (Anfield has two), while a concert is staged per tour and
 * its drawing is its own map. Widened by venue name, Oasis at the Etihad
 * copied Man City - Aston Villa's tickets (Alon 29.09); the Etihad has five
 * TixStock drawings - two football, three concerts.
 */
async function sameVenueMapUrls(
  mapUrl: string,
  supplierVenueName: string | null,
): Promise<string[]> {
  const primary = [...urlSpellings(mapUrl), ...(await adoptedTwins(mapUrl))];
  const profile = await drawingProfile(primary);
  if (profile.generic) return [];
  const urls = new Set(primary);
  const venue = supplierVenueName?.trim();
  if (venue && profile.fixtures) {
    for (const drawing of await tixstockVenueFixtureMaps(venue)) {
      urlSpellings(drawing).forEach((url) => urls.add(url));
      (await adoptedTwins(drawing)).forEach((url) => urls.add(url));
    }
  }
  return [...urls];
}

/**
 * The most recent live event on the same seat map and of the same type that
 * holds tickets which may move to another fixture (`carriesToAnotherFixture`:
 * TixStock categories, manual structure - never a LiveTickets / XS2Event ticket
 * or our own stock, which belong to one game). Test events are never a source.
 *
 * Copies get fresh ids and the NEW fixture's `eid`. A ticket's `zoneId` stays
 * only when both events draw the same map URL - a zone of our copy means
 * nothing on the supplier's drawing (the suppliers panel re-zones it from the
 * venue template).
 */
export async function findVenueMemory(input: VenueMemoryInput): Promise<VenueMemory> {
  const mapUrl = input.mapUrl.trim();
  if (!mapUrl) return null;

  const urls = await sameVenueMapUrls(mapUrl, input.supplierVenueName ?? null);
  if (urls.length === 0) return null;
  const { data, error } = await db
    .from("events")
    .select(
      "id,name,map_image_url,tickets_and_rates,event_location,lodging_mode,lodging_default,lodging_note,split_default_nights",
    )
    .in("map_image_url", urls)
    .eq("type", input.eventType)
    .is("is_deleted", null)
    .not("is_test", "is", true)
    .order("date", { ascending: false })
    .limit(MEMORY_CANDIDATES);
  if (error) {
    console.error("venue-memory: query failed", JSON.stringify(error));
    return null;
  }

  const ownSpellings = new Set(urlSpellings(mapUrl));
  for (const row of (data ?? []) as MemoryRow[]) {
    const sameDrawing = ownSpellings.has(row.map_image_url ?? "");
    const tickets = (row.tickets_and_rates ?? [])
      .filter((ticket) => carriesToAnotherFixture(ticket, input.eventType))
      .map((ticket) => {
        const copy = ticketForFixture(ticket, crypto.randomUUID(), input.supplierEventId);
        if (sameDrawing) return copy;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { zoneId: _zone, zoneLabel: _label, ...unzoned } = copy;
        return unzoned;
      });
    if (tickets.length === 0) continue;

    return {
      fromEventId: row.id,
      fromEventName: row.name,
      tickets,
      lodging: row.event_location
        ? {
            event_location: row.event_location,
            lodging_mode: row.lodging_mode ?? "flight_city",
            lodging_default: row.lodging_default ?? "flight",
            lodging_note: row.lodging_note ?? null,
            split_default_nights: row.split_default_nights ?? 2,
          }
        : null,
    };
  }
  return null;
}

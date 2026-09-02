// Artist tour mode (spec 2026-09-02, section 6): resolve city_iata for a
// venue by proximity to the locations table. Within 50km = same metro area
// for flight purposes; no match leaves the field manual.
import { supabase } from "@/lib/supabase-server";
import { distanceKm } from "@/lib/services/venue-memory";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface NearestCandidate {
  latitude: number;
  longitude: number;
  city_iata: string | null;
}

/** Pure: closest candidate within maxKm that actually has an IATA code. */
export function findNearestIata(
  lat: number,
  lon: number,
  locations: NearestCandidate[],
  maxKm = 50,
): string | null {
  let best: { iata: string; km: number } | null = null;
  for (const candidate of locations) {
    if (!candidate.city_iata) continue;
    const km = distanceKm(lat, lon, candidate.latitude, candidate.longitude);
    if (km <= maxKm && (!best || km < best.km)) {
      best = { iata: candidate.city_iata, km };
    }
  }
  return best?.iata ?? null;
}

export async function nearestIataFor(lat: number, lon: number): Promise<string | null> {
  const { data, error } = await db
    .from("locations")
    .select("latitude,longitude,city_iata");
  if (error) {
    console.error("nearest-location: query failed", JSON.stringify(error));
    return null;
  }
  return findNearestIata(lat, lon, (data ?? []) as NearestCandidate[]);
}

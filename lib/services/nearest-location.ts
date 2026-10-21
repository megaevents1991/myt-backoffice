// Artist tour mode (spec 2026-09-02, section 6): resolve city_iata for a
// venue by proximity to the locations table. Within 50km = same metro area
// for flight purposes; no match leaves the field manual.
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { NEAR_LOCATION_KM } from "@/lib/uploader/constants";

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

/** A `locations` row - what the tour uploader builds a package's flight city from. */
export interface LocationRow {
  id: number;
  name: string;
  city_iata: string | null;
  latitude: number;
  longitude: number;
  country_code: string | null;
}

/**
 * Pure: the closest row within `maxKm` that has an IATA code (a row without one cannot be flown
 * to, so it is never a package's location), with its distance. Ties go to the row listed first.
 */
export function findNearestLocation(
  lat: number,
  lon: number,
  rows: LocationRow[],
  maxKm: number,
): { row: LocationRow; km: number } | null {
  let best: { row: LocationRow; km: number } | null = null;
  for (const row of rows) {
    if (!row.city_iata?.trim()) continue;
    const km = distanceKm(lat, lon, row.latitude, row.longitude);
    if (km <= maxKm && (!best || km < best.km)) best = { row, km };
  }
  return best;
}

/**
 * Every `locations` row. THROWS on a failed read: to the uploader an empty table would read as
 * "no location near the venue" and build a ticket-only event - a guess, not an answer.
 */
export async function loadLocations(): Promise<LocationRow[]> {
  const { data, error } = await supabaseTyped
    .from("locations")
    .select("id,name,city_iata,latitude,longitude,country_code")
    .order("id", { ascending: true });
  if (error) {
    console.error("nearest-location: locations read failed", JSON.stringify(error));
    throw new Error(`locations read failed: ${error.message}`);
  }
  return data ?? [];
}

/** The nearest `locations` row with an IATA code within `maxKm` (default: the uploader's package radius). */
export async function nearestLocation(
  lat: number,
  lon: number,
  maxKm: number = NEAR_LOCATION_KM,
): Promise<{ row: LocationRow; km: number } | null> {
  return findNearestLocation(lat, lon, await loadLocations(), maxKm);
}

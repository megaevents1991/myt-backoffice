"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import type {
  Location,
  CreateLocationData,
  UpdateLocationData,
  LocationWithDistance
} from "@/types/location.types";
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit";

// Calculate distance between two points using Haversine formula
function calculateDistance(
  lat1: number, 
  lon1: number, 
  lat2: number, 
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in kilometers
}

type WriteError = { message: string; code?: string } | null;

/** The column is not there yet (its migration has not run): Postgres 42703, or PostgREST's schema cache without it. */
const isMissingColumn = (error: WriteError): boolean => error?.code === "42703" || error?.code === "PGRST204";

/** `aliases` as the form sends it, read again here: strings only, trimmed, empty parts dropped, one per spelling (case aside). */
function cleanAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const alias = item.trim();
    const key = alias.toLowerCase();
    if (alias === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/** Explicit column mapping - only these columns are ever written, whatever else the client object carries. */
function locationColumns(data: CreateLocationData | UpdateLocationData): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.name !== undefined) row.name = data.name;
  if (data.latitude !== undefined) row.latitude = data.latitude;
  if (data.longitude !== undefined) row.longitude = data.longitude;
  if (data.city_iata !== undefined) row.city_iata = data.city_iata;
  if (data.country_code !== undefined) row.country_code = data.country_code;
  if (data.aliases !== undefined) row.aliases = cleanAliases(data.aliases);
  return row;
}

/**
 * Runs a write with the row as built; when `aliases` is in it and its column does not exist yet (the code may land
 * before the migration) the write is repeated once without it, so the rest of the form is never lost to a missing column.
 */
async function writeWithAliasFallback(
  row: Record<string, unknown>,
  write: (row: Record<string, unknown>) => PromiseLike<{ data: unknown; error: WriteError }>,
): Promise<{ data: unknown; error: WriteError }> {
  const first = await write(row);
  if (!first.error || !("aliases" in row) || !isMissingColumn(first.error)) return first;
  console.warn("locations: aliases column is not migrated yet - saved without the aliases");
  const withoutAliases = { ...row };
  delete withoutAliases.aliases;
  return write(withoutAliases);
}

export async function getLocations(): Promise<Location[]> {
  await requireStaff();
  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .order("name");

  if (error) {
    console.error("Error fetching locations:", error);
    throw new Error(`Failed to fetch locations: ${error.message}`);
  }

  return data || [];
}

export async function getLocationById(id: number): Promise<Location | null> {
  await requireStaff();
  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    console.error("Error fetching location:", error);
    throw new Error(`Failed to fetch location: ${error.message}`);
  }

  return data;
}

export async function createLocation(locationData: CreateLocationData): Promise<Location> {
  await requireStaff();
  const row = locationColumns(locationData);
  const { data, error } = await writeWithAliasFallback(row, (r) =>
    supabase
      .from("locations")
      .insert([r])
      .select()
      .single(),
  );

  if (error) {
    console.error("Error creating location:", error);
    throw new Error(`Failed to create location: ${error.message}`);
  }

  const created = data as Location;
  await logAudit({
    action: "create",
    entityType: "location",
    entityId: created.id,
    changes: row,
  });

  return created;
}

export async function updateLocation(
  id: number,
  locationData: UpdateLocationData
): Promise<Location> {
  await requireStaff();
  const payload = locationColumns(locationData);
  const auditBefore = await fetchBefore("locations", "id", id, payload);
  const { data, error } = await writeWithAliasFallback(payload, (r) =>
    supabase
      .from("locations")
      .update(r)
      .eq("id", id)
      .select()
      .single(),
  );

  if (error) {
    console.error("Error updating location:", error);
    throw new Error(`Failed to update location: ${error.message}`);
  }

  await logAudit({
    action: "update",
    entityType: "location",
    entityId: id,
    changes: diffChanges(auditBefore, payload),
  });

  return data as Location;
}

export async function deleteLocation(id: number): Promise<void> {
  await requireStaff();
  const { error } = await supabase
    .from("locations")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting location:", error);
    throw new Error(`Failed to delete location: ${error.message}`);
  }

  await logAudit({ action: "delete", entityType: "location", entityId: id });
}

export async function findNearestLocation(
  latitude: number, 
  longitude: number
): Promise<LocationWithDistance | null> {
  await requireStaff();
  const locations = await getLocations();

  if (locations.length === 0) {
    return null;
  }

  // Calculate distances and find the nearest
  const locationsWithDistance = locations.map(location => ({
    ...location,
    distance: calculateDistance(latitude, longitude, location.latitude, location.longitude)
  }));

  // Sort by distance and return the nearest
  locationsWithDistance.sort((a, b) => a.distance - b.distance);
  return locationsWithDistance[0];
}

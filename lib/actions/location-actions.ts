"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import type {
  Location, 
  CreateLocationData, 
  UpdateLocationData, 
  LocationWithDistance 
} from "@/types/location.types";

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

export async function getLocations(): Promise<Location[]> {
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
  const { data, error } = await supabase
    .from("locations")
    .insert([locationData])
    .select()
    .single();

  if (error) {
    console.error("Error creating location:", error);
    throw new Error(`Failed to create location: ${error.message}`);
  }

  return data;
}

export async function updateLocation(
  id: number, 
  locationData: UpdateLocationData
): Promise<Location> {
  await requireAdmin();
  const { data, error } = await supabase
    .from("locations")
    .update(locationData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating location:", error);
    throw new Error(`Failed to update location: ${error.message}`);
  }

  return data;
}

export async function deleteLocation(id: number): Promise<void> {
  await requireAdmin();
  const { error } = await supabase
    .from("locations")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting location:", error);
    throw new Error(`Failed to delete location: ${error.message}`);
  }
}

export async function findNearestLocation(
  latitude: number, 
  longitude: number
): Promise<LocationWithDistance | null> {
  await requireAdmin();
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

export async function getLocationsWithinRadius(
  latitude: number, 
  longitude: number, 
  radiusKm: number = 100
): Promise<LocationWithDistance[]> {
  await requireAdmin();
  const locations = await getLocations();

  // Calculate distances and filter by radius
  const locationsWithDistance = locations
    .map(location => ({
      ...location,
      distance: calculateDistance(latitude, longitude, location.latitude, location.longitude)
    }))
    .filter(location => location.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance);

  return locationsWithDistance;
}

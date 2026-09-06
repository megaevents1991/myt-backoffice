"use server";

import { requireStaff } from "@/lib/auth/guards";
import { nearestIataFor } from "@/lib/services/nearest-location";
import { findVenueMemory, type VenueMemory } from "@/lib/services/venue-memory";

/** Wizard-facing wrapper for the stadium-memory lookup. */
export async function findVenueMemoryAction(
  venueName: string,
  lat: number,
  lon: number,
): Promise<VenueMemory> {
  await requireStaff();
  try {
    return await findVenueMemory(venueName, lat, lon);
  } catch (error) {
    console.error("venue-memory action failed", JSON.stringify(error));
    return null;
  }
}

/** Artist tour mode: resolve city_iata for venue coords (<=50km), else null. */
export async function nearestIataAction(
  lat: number,
  lon: number,
): Promise<string | null> {
  await requireStaff();
  try {
    return await nearestIataFor(lat, lon);
  } catch (error) {
    console.error("nearest-iata action failed", JSON.stringify(error));
    return null;
  }
}

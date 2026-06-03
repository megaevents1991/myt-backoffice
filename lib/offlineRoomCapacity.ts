// Capacity mapping for the controlled vocabulary in offline_hotels.room_type.
// Must match the <SelectItem> values in the offline-hotels form
// (app/(dashboard)/offline-hotels/new/page.tsx) AND the duplicate in the main
// app (../myt---main/lib/offlineRoomCapacity.ts) — keep all three in sync.
//
// Used when pushing an offline room's price onto an event's base_hotel_price:
// the offline `price` is the TOTAL per room (for the whole stay), but
// base_hotel_price is consumed PER PERSON by the main app, so we divide by the
// room's headcount capacity (Double -> 2, Triple -> 3, ...).
export const OFFLINE_ROOM_CAPACITY: Record<string, number> = {
  Standard: 2,
  Double: 2,
  Twin: 2,
  Triple: 3,
  Deluxe: 2,
  "Junior Suite": 2,
  Suite: 2,
  "Family Room": 4,
  Studio: 2,
};

// Default to 2 (no single-capacity rooms exist in offline inventory) so an
// unknown/blank room_type never collapses the divisor to 1 and double-charges.
export const getOfflineRoomCapacity = (
  roomType: string | null | undefined
): number => {
  if (!roomType) return 2;
  return OFFLINE_ROOM_CAPACITY[roomType] ?? 2;
};

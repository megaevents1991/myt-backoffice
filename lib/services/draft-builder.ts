// The factory's assembly line (spec 2026-09-02, section 8): take a draft's
// identity payload (already mapped from the provider row at intake) and run
// the same building blocks the wizard uses - nearest-iata, stadium memory,
// live base-price quotes. Whatever stays empty is reported in `missing` so
// the review grid can highlight exactly the human work left.
import type { Event } from "@/types/app.types";
import type { DraftMissingField } from "@/types/factory.types";
import { nearestIataFor } from "@/lib/services/nearest-location";
import { findVenueMemory } from "@/lib/services/venue-memory";
import { quoteFlight, quoteHotel } from "@/lib/services/price-quote";

export interface BuiltDraft {
  payload: Omit<Event, "id">;
  missing: DraftMissingField[];
}

export async function buildDraftPayload(
  input: Omit<Event, "id">,
): Promise<BuiltDraft> {
  // jsonb round-trip clone: the builder never mutates the stored payload.
  const payload = JSON.parse(JSON.stringify(input)) as Omit<Event, "id">;
  const missing: DraftMissingField[] = [];

  // 1) city_iata from venue coords (artist/tour + providers without iata).
  const { latitude, longitude } = payload.location ?? {};
  if (!payload.location.city_iata && latitude && longitude) {
    const iata = await nearestIataFor(latitude, longitude).catch(() => null);
    if (iata) payload.location.city_iata = iata;
  }
  if (!payload.location.city_iata) missing.push("city_iata");

  // 2) Stadium memory for empty ticket structures.
  if (payload.tickets_and_rates.length === 0) {
    const memory = await findVenueMemory(
      payload.location?.name ?? "",
      latitude ?? 0,
      longitude ?? 0,
    ).catch(() => null);
    if (memory) payload.tickets_and_rates = memory.tickets;
  }
  if (payload.tickets_and_rates.length === 0) missing.push("tickets");

  // 3) Live base prices through the shared rule - empty components only.
  const depart = payload.def_date_depart;
  const ret = payload.def_date_return;
  if (payload.base_flight_price === 0 && payload.location.city_iata && depart && ret) {
    const quote = await quoteFlight(payload.location.city_iata, depart, ret);
    if (quote) payload.base_flight_price = quote.price;
  }
  if (payload.base_flight_price === 0) missing.push("base_flight_price");

  if (payload.base_hotel_price === 0 && latitude && longitude && depart && ret) {
    const quote = await quoteHotel(latitude, longitude, depart, ret);
    if (quote) payload.base_hotel_price = quote.price;
  }
  if (payload.base_hotel_price === 0) missing.push("base_hotel_price");

  return { payload, missing };
}

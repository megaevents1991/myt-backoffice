import type { EventTicket } from "@/types/app.types";

export type PackagePriceEvent = {
  tickets_and_rates: EventTicket[] | null;
  base_flight_price: number | null;
  base_hotel_price: number | null;
  event_additional_markup?: number | null;
  markup_ticket?: number | null;
  markup_flight?: number | null;
  markup_hotel?: number | null;
};

// Replicates main-app computePackagePrice: flight + hotel + min available
// ticket + markups (composed per-component when any markup_* set, else the
// global 175) + event_additional_markup. See myt-main lib/events/price.ts.
export function computePackagePrice(event: PackagePriceEvent): number | null {
  const available = (event.tickets_and_rates || []).filter(
    (t) => t?.available !== false,
  );
  if (available.length === 0) return null;
  const minTicket = Math.min(...available.map((t) => t.price));
  const composed =
    event.markup_ticket != null ||
    event.markup_flight != null ||
    event.markup_hotel != null;
  const markup = composed
    ? (event.markup_ticket ?? 0) + (event.markup_flight ?? 0) + (event.markup_hotel ?? 0)
    : 175;
  return Math.round(
    (event.base_flight_price ?? 0) +
      (event.base_hotel_price ?? 0) +
      minTicket +
      markup +
      (event.event_additional_markup ?? 0),
  );
}

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
// Per-traveler USD, like main's — the order flow multiplies by pax.
// `ticketPrice` prices a SPECIFIC category instead of the cheapest one
// (main reaches the same number as min-based price + category delta).
export function computePackagePrice(
  event: PackagePriceEvent,
  ticketPrice?: number | null,
): number | null {
  const available = (event.tickets_and_rates || []).filter(
    (t) => t?.available !== false,
  );
  if (available.length === 0) return null;
  const ticket = ticketPrice ?? Math.min(...available.map((t) => t.price));
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
      ticket +
      markup +
      (event.event_additional_markup ?? 0),
  );
}

export function hasAvailableTickets(event: Pick<PackagePriceEvent, "tickets_and_rates">): boolean {
  return (event.tickets_and_rates || []).some((t) => t?.available !== false);
}

// Mirrors myt-main lib/events/price.ts isEventSoldOut. `lockedFlightSoldOut`
// is main's in-memory markLockedPackagesSoldOut flag — callers here derive it
// themselves (the backoffice reads `flights` directly) and pass it in.
export function isEventSoldOut(
  event: Pick<PackagePriceEvent, "tickets_and_rates"> & { tags?: string | null },
  lockedFlightSoldOut = false,
): boolean {
  return !hasAvailableTickets(event) || event.tags === "Sold" || lockedFlightSoldOut;
}

/**
 * Our own tickets (2026-09-28): seats WE hold for one game, sold beside the
 * suppliers' tickets on a multi-supplier event. A ticket is ours when its
 * `supplier` is "static" and it carries a `stock`; seats left = stock - seats
 * held by live reservations of that ticket.
 *
 * Pure. Mirrored verbatim in main `lib/own-stock.ts` - main enforces it on the
 * order page and in confirm-order, the backoffice shows it on the event.
 */
import type { EventTicket } from "@/types/app.types";

/**
 * Reservation statuses that hold no seats: Cancelled and Lost are gone, and
 * 24Save is a price hold, not a booking - paying for one inserts a NEW row, so
 * counting both would count the seats twice. Same set as the backoffice's
 * RELEASED_STATUSES and the `flight_event_consumed` view.
 */
const RELEASED_STATUSES = new Set(["cancelled", "lost", "24save"]);

export const holdsSeats = (status: string | null | undefined): boolean =>
  !RELEASED_STATUSES.has((status ?? "").trim().toLowerCase());

/** A ticket we hold stock for. */
export const hasOwnStock = (
  ticket: Pick<EventTicket, "supplier" | "stock">,
): boolean =>
  ticket.supplier === "static" &&
  typeof ticket.stock === "number" &&
  Number.isFinite(ticket.stock);

/** One reservation as the stock count reads it. */
export type StockReservation = {
  status: string | null;
  /** json: the flat order main writes, or an `{ events: [...] }` bundle. */
  event_order_info: unknown;
};

type OrderLine = { id?: unknown; number_of_ticket?: unknown };

const orderLines = (info: unknown): OrderLine[] => {
  if (!info || typeof info !== "object") return [];
  const bundle = (info as { events?: unknown }).events;
  return Array.isArray(bundle) ? (bundle as OrderLine[]) : [info as OrderLine];
};

/** Seats held per ticket id, from the live reservations of ONE event. */
export function seatsHeldByTicket(
  reservations: StockReservation[],
): Map<string, number> {
  const held = new Map<string, number>();
  for (const reservation of reservations) {
    if (!holdsSeats(reservation.status)) continue;
    for (const line of orderLines(reservation.event_order_info)) {
      const id = line.id == null ? "" : String(line.id);
      const seats = Number(line.number_of_ticket);
      if (!id || !Number.isFinite(seats) || seats <= 0) continue;
      held.set(id, (held.get(id) ?? 0) + seats);
    }
  }
  return held;
}

/**
 * The seating one of our own tickets promises a party of `qty` (Alon 29.09):
 * up to `seatsTogether` sit together, a bigger party in groups of up to that
 * many. No `seatsTogether` (or under 2), or a party of one = no promise.
 */
export function ownSeating(
  ticket: Pick<EventTicket, "seatsTogether">,
  qty: number,
): { seating: "together" | "groups" | "none"; seatingGroupMax?: number } {
  const max = ticket.seatsTogether;
  if (typeof max !== "number" || !Number.isInteger(max) || max < 2) {
    return { seating: "none" };
  }
  if (!Number.isInteger(qty) || qty < 2) return { seating: "none" };
  return qty <= max
    ? { seating: "together" }
    : { seating: "groups", seatingGroupMax: max };
}

/** Seats of an own ticket still for sale (never below 0); null = not stock-limited. */
export function stockLeft(
  ticket: Pick<EventTicket, "id" | "supplier" | "stock">,
  held: Map<string, number>,
): number | null {
  if (!hasOwnStock(ticket)) return null;
  return Math.max(0, (ticket.stock as number) - (held.get(ticket.id) ?? 0));
}

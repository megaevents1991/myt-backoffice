/**
 * Tickets with no zone yet take it from the venue template (supplier +
 * category -> zone), and the zone's description when the ticket has none. Tickets the operator
 * already zoned are never touched.
 *
 * Moved verbatim from components/event-suppliers-panel.tsx (the panel imports it back) so the tour
 * uploader's build can zone a new event's tickets by the same rule. Pure - no DB, no DOM.
 */
import { normalizeSupplierCategory, ticketSupplier } from "@/lib/suppliers";
import type { VenueMap } from "@/lib/venue-maps/svg-zones";
import type { Event, EventTicket } from "@/types/app.types";

export function zoneFromTemplate(
  tickets: EventTicket[],
  eventType: Event["type"],
  map: Pick<VenueMap, "zones" | "supplier_categories">,
): EventTicket[] {
  return tickets.map((ticket) => {
    if (ticket.zoneId) return ticket;
    const category = ticket.supplierCategory || ticket.category;
    const zoneId =
      map.supplier_categories?.[ticketSupplier(ticket, eventType)]?.[
        normalizeSupplierCategory(category)
      ];
    const zone = map.zones.find((z) => z.id === zoneId);
    if (!zone) return ticket;
    return {
      ...ticket,
      supplierCategory: category,
      zoneId: zone.id,
      zoneLabel: zone.label,
      // The zone's line under the title - only onto a ticket with no description of its own (a LiveTickets
      // description, or one a person wrote, is never overwritten).
      ...(zone.description && !ticket.description ? { description: zone.description } : {}),
    };
  });
}

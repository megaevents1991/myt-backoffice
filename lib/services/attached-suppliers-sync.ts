/**
 * Price/availability sync for LiveTickets tickets ATTACHED to another
 * supplier's event (multi-supplier events).
 *
 * The classic LiveTickets sync walks LiveTickets-typed events and reads the
 * supplier event id from `tickets_and_rates[0]`. An attached ticket lives on a
 * tx_event, next to TixStock tickets - so this sync selects TICKETS by their
 * `supplier`, and takes the event id from those tickets.
 *
 * It only ever refreshes what an operator attached: price and `available`.
 * A category that appears at the supplier later is reported, never published.
 */
import { supabase } from "@/lib/supabase-server";
import type { Event, EventTicket, EventType } from "@/types/app.types";
import { supplierEventId, ticketSupplier } from "@/lib/suppliers";
import {
  fetchLiveTicketsStock,
  liveTicketsPriceUsd,
  type LiveTicketsStock,
} from "@/lib/services/livetickets-offers";

const REQUEST_DELAY_MS = 500;

export interface AttachedSuppliersSyncResult {
  eventsProcessed: number;
  ticketsUpdated: number;
  /** Sellable supplier categories nobody attached yet, per event - FYI only. */
  unattachedCategories: { eventId: number; categories: string[] }[];
  errors: string[];
}

/**
 * The event's tickets after applying a LiveTickets answer. Pure.
 * Tickets of other suppliers pass through untouched - always.
 */
export function applyLiveTicketsStock(
  tickets: EventTicket[],
  eventType: EventType | undefined,
  stock: LiveTicketsStock | "SOLD_OUT",
  priceUsd: (cost: number) => number,
): { tickets: EventTicket[]; updated: number; unattached: string[] } {
  let updated = 0;
  const attachedIds = new Set<string>();

  const next = tickets.map((ticket) => {
    if (ticketSupplier(ticket, eventType) !== "livetickets") return ticket;
    attachedIds.add(ticket.id);

    const category =
      stock === "SOLD_OUT"
        ? undefined
        : stock.categories.find((c) => c.id === ticket.id);

    // A non-instant ticket stays on sale only because an operator attached it
    // AS non-instant. A regular ticket whose category stops confirming
    // instantly goes off sale - nobody agreed to sell it that way.
    const keptNonInstant = !!ticket.nonInstant && !!category?.nonInstantOnly;

    // Gone, or no longer passes the rules.
    if (!category || (!category.sellable && !keptNonInstant)) {
      if (ticket.available === false) return ticket;
      updated++;
      return { ...ticket, available: false };
    }

    const price = priceUsd(category.cost);
    // Became instant-confirm: the warning no longer applies.
    const nonInstant = keptNonInstant ? true : undefined;
    if (
      ticket.price === price &&
      ticket.available !== false &&
      ticket.nonInstant === nonInstant
    ) {
      return ticket;
    }
    updated++;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { nonInstant: _previous, ...rest } = ticket;
    return nonInstant
      ? { ...rest, price, available: true, nonInstant }
      : { ...rest, price, available: true };
  });

  const unattached =
    stock === "SOLD_OUT"
      ? []
      : stock.categories
          .filter((c) => c.sellable && !attachedIds.has(c.id))
          .map((c) => c.title);

  return { tickets: next, updated, unattached };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Refresh every attached LiveTickets ticket. Rates must be fresh already. */
export async function syncAttachedLiveTickets(): Promise<AttachedSuppliersSyncResult> {
  const result: AttachedSuppliersSyncResult = {
    eventsProcessed: 0,
    ticketsUpdated: 0,
    unattachedCategories: [],
    errors: [],
  };

  // LiveTickets-typed events belong to the classic sync; everything else may
  // carry attached tickets. tx_event is the only host today.
  const { data, error } = await supabase
    .from("events")
    .select("id,name,type,tickets_and_rates")
    .eq("type", "tx_event")
    .is("is_deleted", null)
    .gte("date", new Date().toISOString());

  if (error) {
    result.errors.push(`Attached sync: ${error.message}`);
    return result;
  }

  const events = (
    (data ?? []) as Pick<Event, "id" | "name" | "type" | "tickets_and_rates">[]
  ).filter((event) =>
    (event.tickets_and_rates ?? []).some(
      (t) => ticketSupplier(t, event.type) === "livetickets",
    ),
  );
  console.log(`🔗 Attached LiveTickets sync: ${events.length} event(s)`);

  for (const event of events) {
    try {
      const eid = supplierEventId(
        event.tickets_and_rates,
        "livetickets",
        event.type,
      );
      if (!eid) continue;

      const stock = await fetchLiveTicketsStock(eid);
      // Unreachable is NOT sold out - leave the tickets as they are.
      if (!stock) {
        result.errors.push(`Event ${event.id}: LiveTickets unreachable`);
        continue;
      }

      const currency = stock === "SOLD_OUT" ? null : stock.currency;
      const applied = applyLiveTicketsStock(
        event.tickets_and_rates,
        event.type,
        stock,
        (cost) => (currency ? liveTicketsPriceUsd(cost, currency) : 0),
      );

      if (applied.updated > 0) {
        // tickets_and_rates jsonb isn't in the generated row type.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (supabase.from("events") as any)
          .update({ tickets_and_rates: applied.tickets })
          .eq("id", event.id);
        if (updateError) throw updateError;
        result.ticketsUpdated += applied.updated;
      }

      if (applied.unattached.length > 0) {
        console.log(
          `ℹ️ Event ${event.id}: LiveTickets has categories nobody attached: ${applied.unattached.join(", ")}`,
        );
        result.unattachedCategories.push({
          eventId: event.id,
          categories: applied.unattached,
        });
      }

      result.eventsProcessed++;
      await delay(REQUEST_DELAY_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`❌ Attached sync, event ${event.id}: ${message}`);
      result.errors.push(`Event ${event.id}: ${message}`);
    }
  }

  return result;
}

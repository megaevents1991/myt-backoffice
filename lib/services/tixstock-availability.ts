// What TixStock's feed says about OUR tickets on a show, and what follows for the
// customer site: a category with nothing on sale goes off the site, an event
// with nothing left to sell is deactivated, and both come back by themselves
// when listings return. Pure: no DB, no fetch (scripts/tixstock-availability-selftest.ts).
//
// Born 04.10.2026: event 1100 (J. Cole Amsterdam) was a copy of the Berlin show
// and kept Berlin's category "Unterrang". TixStock sold the show, under other
// category names, so the site listed the event with a price and could not sell
// one ticket - for four weeks, with nobody told. A scan that day found 8 such
// events, plus 5 whose categories were simply sold out.
import type { EventTicket, EventType } from "@/types/app.types";
import { normalizeSupplierCategory, ticketSupplier } from "../suppliers";

/**
 * Why the price sync took a ticket off sale (`EventTicket.autoOff`):
 *  - "sold_out":    TixStock has the category, with nothing on sale right now
 *  - "no_category": TixStock sells the show and has no such category - it can
 *                   never sell until someone fixes the event's categories
 * A ticket that is off WITHOUT this mark was switched off by a person.
 */
export type TicketAutoOff = "sold_out" | "no_category";

/** `events.deactivated_reason` values this sync writes - and the only ones it may clear. */
export const TX_DEACTIVATION_REASONS = ["tx_no_category", "tx_sold_out"] as const;
export type TxDeactivationReason = (typeof TX_DEACTIVATION_REASONS)[number];

/** Is this `deactivated_reason` one the sync wrote itself? */
export const isTxDeactivation = (
  reason: string | null | undefined,
): reason is TxDeactivationReason =>
  !!reason && (TX_DEACTIVATION_REASONS as readonly string[]).includes(reason);

const DEACTIVATION_TEXT: Record<TxDeactivationReason, string> = {
  tx_no_category:
    "יש בו קטגוריות שלא קיימות ב-TixStock להופעה הזו, ואין בו כרטיס אחר למכירה",
  tx_sold_out:
    "הקטגוריות שלו קיימות ב-TixStock, אבל אין בהן כרטיסים למכירה כרגע",
};

/** Why the event is off the site, as staff read it (the task, the editor). */
export const deactivationText = (reason: string): string =>
  isTxDeactivation(reason) ? DEACTIVATION_TEXT[reason] : `סיבה: ${reason}`;

/**
 * The categories the sync took off sale on an event, by cause. A ticket a
 * person switched off carries no `autoOff` and is not listed.
 */
export function autoOffCategories(
  tickets: Pick<EventTicket, "category" | "autoOff">[],
): { missing: string[]; soldOut: string[] } {
  const of = (cause: TicketAutoOff) => [
    ...new Set(tickets.filter((t) => t.autoOff === cause).map((t) => t.category)),
  ];
  return { missing: of("no_category"), soldOut: of("sold_out") };
}

/** What TixStock's feed says about one show. */
export interface TixstockSupply {
  /**
   * Every category name TixStock has for the show (`meta.categories`), sold out
   * or not. null / empty = the feed did not say.
   */
  categories: string[] | null;
  /** The category of every listing on sale right now. */
  listed: string[];
}

export interface AvailabilityPlan {
  /** The event's tickets as they should be stored. */
  tickets: EventTicket[];
  changed: boolean;
  /** Ids of the tickets this plan takes off sale / puts back. */
  turnedOff: string[];
  turnedOn: string[];
  /** Our TixStock categories the show does not have at TixStock (off by us). */
  missing: string[];
  /** Our TixStock categories that exist there with nothing on sale (off by us). */
  soldOut: string[];
  /** Is anything left the customer can buy, of any supplier? */
  sellable: boolean;
}

/**
 * "live" - a listing is on sale; "sold_out" / "no_category" - see TicketAutoOff;
 * null - the feed cannot tell (no listings and no category list: possibly a
 * hiccup at the supplier, and nothing is ever switched off on a maybe).
 */
function supplyState(
  category: string,
  listed: Set<string>,
  known: Set<string> | null,
): "live" | TicketAutoOff | null {
  const name = normalizeSupplierCategory(category);
  if (!name) return null;
  if (listed.has(name)) return "live";
  if (known) return known.has(name) ? "sold_out" : "no_category";
  // No category list, but listings of OTHER categories: ours has nothing on sale.
  return listed.size > 0 ? "sold_out" : null;
}

/**
 * The event's tickets after TixStock's answer. Only TixStock tickets are judged
 * (another supplier can use the same category name), and a ticket a person
 * switched off is left alone - only a ticket carrying `autoOff` is ever put back.
 */
export function planTixstockAvailability(
  tickets: EventTicket[],
  eventType: EventType | undefined,
  supply: TixstockSupply,
): AvailabilityPlan {
  const listed = new Set(supply.listed.map(normalizeSupplierCategory).filter(Boolean));
  const known = supply.categories?.length
    ? new Set(supply.categories.map(normalizeSupplierCategory).filter(Boolean))
    : null;

  const turnedOff: string[] = [];
  const turnedOn: string[] = [];
  const missing = new Set<string>();
  const soldOut = new Set<string>();
  let changed = false;

  const next = tickets.map((ticket): EventTicket => {
    if (ticketSupplier(ticket, eventType) !== "tixstock") return ticket;
    const offByHand = ticket.available === false && !ticket.autoOff;
    if (offByHand) return ticket;

    const state = supplyState(ticket.category, listed, known);
    if (state === null) return ticket;

    if (state === "live") {
      if (!ticket.autoOff) return ticket;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { autoOff: _was, ...rest } = ticket;
      turnedOn.push(ticket.id);
      changed = true;
      return { ...rest, available: true };
    }

    (state === "no_category" ? missing : soldOut).add(ticket.category);
    if (ticket.available === false && ticket.autoOff === state) return ticket;
    if (ticket.available !== false) turnedOff.push(ticket.id);
    changed = true;
    return { ...ticket, available: false, autoOff: state };
  });

  return {
    tickets: next,
    changed,
    turnedOff,
    turnedOn,
    missing: [...missing],
    soldOut: [...soldOut],
    sellable: next.some((t) => t.available !== false),
  };
}

/**
 * `events.deactivated_reason` after the plan (null = on the site).
 * The event goes off only when nothing is left to sell AND we are the ones who
 * took tickets off - an event staff emptied by hand is their decision. It comes
 * back as soon as anything sells. A reason this sync did not write is never
 * changed.
 */
export function nextDeactivation(
  current: string | null | undefined,
  plan: AvailabilityPlan,
): string | null {
  if (current && !isTxDeactivation(current)) return current;
  if (plan.sellable) return null;
  if (!plan.tickets.some((t) => t.autoOff)) return current ?? null;
  return plan.missing.length ? "tx_no_category" : "tx_sold_out";
}

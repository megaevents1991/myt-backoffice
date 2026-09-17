import type { EventTicket, EventType } from "@/types/app.types";

/**
 * Ticket suppliers we can sell from on ONE event page.
 *
 * Historically the supplier was implied by `event.type` (a whole event was
 * TixStock or LiveTickets). A ticket now carries its own `supplier`, so one
 * event can mix several. Adding a supplier = add it here + write its adapter
 * (attach flow, price sync); nothing else names suppliers.
 *
 * Synced with main `lib/suppliers.ts`.
 */
export const SUPPLIERS = ["tixstock", "livetickets", "static"] as const;
export type TicketSupplier = (typeof SUPPLIERS)[number];

export const SUPPLIER_LABELS: Record<TicketSupplier, string> = {
  tixstock: "TixStock",
  livetickets: "LiveTickets",
  static: "Manual",
};

const isSupplier = (value: unknown): value is TicketSupplier =>
  typeof value === "string" &&
  (SUPPLIERS as readonly string[]).includes(value);

/**
 * The supplier of a ticket. Tickets saved before the per-ticket field existed
 * fall back to what their event type always meant. (Main resolves LiveTickets
 * event types to "static" because its page never live-prices them; here we
 * need the real supplier - this is what the price syncs select by.)
 */
export function ticketSupplier(
  ticket: Pick<EventTicket, "supplier">,
  eventType: EventType | undefined,
): TicketSupplier {
  if (isSupplier(ticket.supplier)) return ticket.supplier;
  if (eventType === "tx_event") return "tixstock";
  if (
    eventType === "sports_live_event_dynamic" ||
    eventType === "music_live_event_dynamic"
  ) {
    return "livetickets";
  }
  return "static";
}

/** The supplier's own event id, read from THAT supplier's tickets. */
export function supplierEventId(
  tickets: EventTicket[] | null | undefined,
  supplier: TicketSupplier,
  eventType: EventType | undefined,
): string | null {
  const ticket = (tickets ?? []).find(
    (t) => t.eid && ticketSupplier(t, eventType) === supplier,
  );
  return ticket?.eid ?? null;
}

/**
 * Comparable form of a supplier's category name: accents, parenthesised codes
 * and punctuation dropped, whitespace collapsed. TixStock restyles venue names
 * over time ("CATEGORÍA 2 (CAT2) - FONDO" → "Categoría 2 Fondo"); both become
 * "categoria 2 fondo". Same function as main `lib/tixstock-category.ts`.
 */
export function normalizeSupplierCategory(
  category: string | undefined | null,
): string {
  return (category ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Fixed per-currency ticket markup, in the supplier's currency. */
export const SUPPLIER_CURRENCY_MARKUP = {
  USD: 40,
  EUR: 40,
  GBP: 35,
  ILS: 150,
} as const;
export type SupplierCurrency = keyof typeof SUPPLIER_CURRENCY_MARKUP;

const CARD_FEE_MULTIPLIER = 1.035;

/**
 * Supplier cost → the USD ticket price of a ticket on a MULTI-SUPPLIER event:
 * (cost + currency markup) → USD → +3.5% → rounded up. Identical to main
 * `lib/supplier-pricing.ts`, which prices the same tickets live - so the DB
 * price the sync stores and the live price the customer sees agree.
 *
 * `toUsd` converts an amount of `currency` to USD (the caller owns the rates).
 */
export function supplierPriceUsd(
  cost: number,
  currency: SupplierCurrency,
  toUsd: (amount: number, currency: SupplierCurrency) => number,
): number {
  const withMarkup = cost + SUPPLIER_CURRENCY_MARKUP[currency];
  return Math.ceil(toUsd(withMarkup, currency) * CARD_FEE_MULTIPLIER);
}

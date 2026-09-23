/**
 * LiveTickets categories of one of THEIR events, as a multi-supplier event
 * uses them: which categories we are willing to sell, and at what USD price.
 *
 * One definition of "sellable" and one price formula, shared by the attach
 * flow (event editor) and the price sync - the two used to drift apart.
 * The legacy LiveTickets-typed events keep their own older pricing in
 * ticket-price-sync.ts (round-to-9, no card fee); this file is only for
 * tickets that carry `supplier: "livetickets"`.
 */
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { supplierPriceUsd, type SupplierCurrency } from "@/lib/suppliers";

const LIVE_API_BASE_URL = process.env.NEXT_SECRET_LIVE_API_URL || "";
const LIVE_API_KEY = process.env.NEXT_SECRET_LIVE_API_KEY || "";
const API_TIMEOUT_MS = 10_000;

/** LiveTickets `currency` codes. */
const CURRENCY_BY_CODE: Record<number, SupplierCurrency> = {
  1: "USD",
  2: "EUR",
  3: "GBP",
  4: "ILS",
};

/** `seatingMethodId` 2 = singles: no promise the party sits together. */
const SINGLES_SEATING_METHOD = 2;

/** Raw category - the live API and the `live_events` snapshot name comments differently. */
export interface RawLiveTicketsCategory {
  id: number;
  title?: string;
  hebTitle?: string;
  cost?: number;
  maxTicketAmount?: number;
  seatingMethodId?: number;
  seatingGroupMAXSize?: number | null;
  apiImmediatePurchase?: boolean;
  hebComents?: string;
  hebComments?: string;
  coments?: string;
  engComments?: string;
}

export type LiveTicketsCategory = {
  /** LiveTickets category id - becomes the ticket's `id`. */
  id: string;
  title: string;
  hebTitle: string;
  description: string;
  cost: number;
  maxPerOrder: number;
  seatingGroupMax: number | null;
  /** Passes every rule below - attached and kept on sale with no questions. */
  sellable: boolean;
  /**
   * Blocked ONLY because LiveTickets does not confirm it instantly. The operator
   * may still attach it on purpose ("bring non-instant too", Alon 23.09); the
   * ticket then carries `nonInstant` and every surface warns about it.
   */
  nonInstantOnly: boolean;
  /** Why not, for the operator. Empty when sellable. */
  blockedReason: string;
};

export const NOT_INSTANT_REASON = "Not instant-confirm";

export type LiveTicketsStock = {
  currency: SupplierCurrency;
  categories: LiveTicketsCategory[];
};

/**
 * LiveTickets colour-codes categories on THEIR map ("אדום במפה, לאורך המגרש...").
 * Our page shows our own map, so the colour reference is dropped.
 */
const stripMapColour = (text: string): string =>
  text.replace(/^[^,]{0,20}במפה\s*,\s*/u, "").trim();

/**
 * Hard blockers first - nothing opens them. Instant confirm last, so a
 * category blocked by it alone is recognisable (`nonInstantOnly`).
 * A category sold one per order is NOT blocked: main shows it only to a party
 * of one (Alon 23.09) - it drops any ticket whose `maxPerOrder` is below the
 * chosen quantity.
 */
function blockedReason(raw: RawLiveTicketsCategory): string {
  if (raw.seatingMethodId === SINGLES_SEATING_METHOD) return "Single seats";
  if ((raw.maxTicketAmount ?? 0) < 1) return "None per order";
  if (!Number.isFinite(raw.cost)) return "No cost";
  if (raw.apiImmediatePurchase !== true) return NOT_INSTANT_REASON;
  return "";
}

export function toLiveTicketsCategory(
  raw: RawLiveTicketsCategory,
): LiveTicketsCategory {
  const reason = blockedReason(raw);
  return {
    id: String(raw.id),
    title: raw.title ?? "",
    hebTitle: raw.hebTitle ?? raw.title ?? "",
    description: stripMapColour(
      raw.hebComments ?? raw.hebComents ?? raw.engComments ?? raw.coments ?? "",
    ),
    cost: raw.cost ?? 0,
    maxPerOrder: raw.maxTicketAmount ?? 0,
    seatingGroupMax: raw.seatingGroupMAXSize ?? null,
    sellable: reason === "",
    nonInstantOnly: reason === NOT_INSTANT_REASON,
    blockedReason: reason,
  };
}

export const currencyFromCode = (code: number): SupplierCurrency | null =>
  CURRENCY_BY_CODE[code] ?? null;

/** USD selling price of a LiveTickets cost. Refresh the rates before a batch. */
export function liveTicketsPriceUsd(
  cost: number,
  currency: SupplierCurrency,
): number {
  return supplierPriceUsd(cost, currency, (amount, cur) =>
    cur === "USD"
      ? amount
      : multiCurrencyExchangeRateService.convertToUSD(amount, cur),
  );
}

/**
 * Live stock of a LiveTickets event. "SOLD_OUT" = they answered with an empty
 * list (their way of saying so). null = unreachable / misconfigured - the
 * caller must NOT treat that as sold out.
 */
export async function fetchLiveTicketsStock(
  eid: string,
): Promise<LiveTicketsStock | "SOLD_OUT" | null> {
  if (!LIVE_API_BASE_URL || !LIVE_API_KEY) {
    console.error("livetickets-offers: missing NEXT_SECRET_LIVE_API_URL/KEY");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${LIVE_API_BASE_URL}/Events/getOneEvent?eid=${encodeURIComponent(eid)}`,
      {
        headers: { Authorization: LIVE_API_KEY },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error("Unexpected response shape");
    if (body.length === 0) return "SOLD_OUT";

    const event = body[0] as {
      currency?: number;
      ticketCategory?: RawLiveTicketsCategory[];
    };
    const currency = currencyFromCode(event.currency ?? 0);
    if (!currency) throw new Error(`Unknown currency code ${event.currency}`);

    return {
      currency,
      categories: (event.ticketCategory ?? []).map(toLiveTicketsCategory),
    };
  } catch (error) {
    console.error(
      `livetickets-offers: stock fetch failed for ${eid}:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

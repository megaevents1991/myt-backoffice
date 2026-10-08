/**
 * The nightly ticket-cost fill (spec section 2.3): Paid reservations whose
 * `ticket_cost_usd` is still null get an ESTIMATE from what the backoffice knows -
 * LiveTickets' category cost, XS2Event's net rate (EUR cents), else the markup formula
 * inverted. Never overwrites a `live` or `manual` cost (the UPDATE is scoped
 * `ticket_cost_usd is null`). `estimateTicketCostUsd` is pure
 * (scripts/reservation-cogs-selftest.ts); `fillTicketCosts` is the writer the sync calls.
 *
 * Where each cost really comes from (verified against types/database.types.ts):
 *  - LiveTickets: `live_events` is keyed by `event_id` (number - NOT `id`); its `currency`
 *    is 1 USD / 2 EUR / 3 GBP / 4 ILS and `ticket_categories` is a jsonb array whose items
 *    carry `id` (= the ticket id on the order item) and `cost` (in that currency). The
 *    live event id is the order item's `supplier_event_id` (= the ticket's `eid`); an
 *    older order without it falls back to the `eid` of that ticket inside
 *    `events.tickets_and_rates`. A category cost is the sync's CURRENT snapshot, not the
 *    price at booking - that is why the result is flagged `estimated`.
 *  - XS2Event: NOTHING is stored. `xs2e_events` has no tickets column (only the event's
 *    `min_ticket_price_eur`, the cheapest ticket - wrong for any other category) and
 *    `events` has no XS2 link column; an XS2 ticket's id (`events.tickets_and_rates[].id`
 *    = the order item's `id`) IS the XS2 ticket id. So the net rate is read live from
 *    `GET {NEXT_SECRET_XS2EVENT_API_URL}/tickets/{id}` -> `local_rates.net_rate_eur`
 *    (EUR cents), the very call ticket-price-sync makes. A ticket XS2 no longer knows
 *    (400/404/410/422) falls back to the inverted markup; any other failure leaves the
 *    reservation unfilled for tomorrow's run instead of writing a worse number for good.
 *    An event is XS2 when `events.type = sports_event_dynamic` (vendor "XS2Events").
 */
import { mdb } from "@/lib/services/marketing-db";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import type { ReservationEventOrderInfo, ReservationEventOrderInfoItem } from "@/types/reservation.types";

/** The sync's own markup on a USD-costed ticket, and the 3.5% card step (lib/suppliers.ts). */
const USD_MARKUP = 40;
const CARD_FACTOR = 1.035;

export type ToUsd = (amount: number, currency: "EUR" | "GBP" | "ILS" | "USD") => number;

export interface EstimateInput {
  supplier: string | null | undefined;
  quantity: number;
  salePerTicketUsd: number;
  liveCategoryCost?: number | null;
  liveCurrency?: "EUR" | "GBP" | "ILS" | "USD" | null;
  xs2NetRateEurCents?: number | null;
  toUsd: ToUsd;
}

export function estimateTicketCostUsd(i: EstimateInput): { usd: number; how: string } {
  const qty = Math.max(1, i.quantity || 1);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (i.supplier === "livetickets" && i.liveCategoryCost != null && i.liveCategoryCost > 0) {
    return { usd: r2(i.toUsd(i.liveCategoryCost, i.liveCurrency ?? "USD") * qty), how: "live_events category cost" };
  }
  if (i.xs2NetRateEurCents != null && i.xs2NetRateEurCents > 0) {
    return { usd: r2(i.toUsd(i.xs2NetRateEurCents / 100, "EUR") * qty), how: "xs2 net rate" };
  }
  const perTicket = Math.max(0, i.salePerTicketUsd / CARD_FACTOR - USD_MARKUP);
  return { usd: r2(perTicket * qty), how: "inverted markup" };
}

const LIVE_CURRENCY: Record<number, "USD" | "EUR" | "GBP" | "ILS"> = { 1: "USD", 2: "EUR", 3: "GBP", 4: "ILS" };

const XS2_TIMEOUT_MS = 10_000;
/** XS2 answers these for a ticket it does not (or no longer) know: nothing to look up. */
const XS2_UNKNOWN_TICKET = [400, 404, 410, 422];

/** One XS2 ticket's net rate in EUR cents; null when XS2 does not know the ticket. Throws on any other failure. */
async function fetchXs2NetRateEurCents(ticketId: string): Promise<number | null> {
  const base = process.env.NEXT_SECRET_XS2EVENT_API_URL;
  const key = process.env.NEXT_SECRET_XS2EVENT_API_KEY;
  if (!base || !key) throw new Error("XS2 API env (NEXT_SECRET_XS2EVENT_API_URL / NEXT_SECRET_XS2EVENT_API_KEY) is not set");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), XS2_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/tickets/${encodeURIComponent(ticketId)}`, {
      signal: controller.signal,
      headers: { "X-Api-Key": key, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (XS2_UNKNOWN_TICKET.includes(res.status)) return null;
    if (!res.ok) throw new Error(`XS2 HTTP ${res.status}`);
    const body = (await res.json()) as { local_rates?: { net_rate_eur?: unknown } } | null;
    const cents = Number(body?.local_rates?.net_rate_eur);
    return Number.isFinite(cents) && cents > 0 ? cents : null;
  } finally {
    clearTimeout(timer);
  }
}

type EventRow = { type: string | null; tickets_and_rates: { id?: string | number; eid?: string | number }[] | null };
type LiveRow = { currency: number | null; ticket_categories: { id: number | string; cost: number }[] | null };

/** Fill up to `limit` Paid reservations (last 120 days) that have no ticket cost. */
export async function fillTicketCosts(opts: { dryRun: boolean; limit?: number }): Promise<{ filled: number; skipped: number; errors: string[] }> {
  const since = new Date(Date.now() - 120 * 864e5).toISOString();
  const { data, error } = await mdb
    .from("reservations")
    .select("id, event_id, event_order_info")
    .eq("status", "Paid")
    .is("is_deleted", null)
    .is("ticket_cost_usd", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) throw new Error(`cogs fill read: ${error.message}`);
  const rows = (data ?? []) as { id: number; event_id: number; event_order_info: unknown }[];
  if (rows.length === 0) return { filled: 0, skipped: 0, errors: [] };

  // Dynamic import: ticket-price-sync builds its service singletons at load and throws when
  // the supplier env is missing - a static import would also break the pure selftest.
  const { multiCurrencyExchangeRateService: fx } = await import("@/lib/services/ticket-price-sync");
  await fx.updateAllExchangeRates(); // convertToUSD is synchronous and only reads the in-memory rates
  const toUsd: ToUsd = (a, c) => (c === "USD" ? a : fx.convertToUSD(a, c));

  // One read per event / live event / XS2 ticket per run.
  const eventCache = new Map<number, EventRow | null>();
  const liveCache = new Map<number, LiveRow | null>();
  const xs2Cache = new Map<string, number | null>();
  let xs2Down = false;

  const readEvent = async (eventId: number): Promise<EventRow | null> => {
    if (eventCache.has(eventId)) return eventCache.get(eventId) ?? null;
    const { data: ev, error: eerr } = await mdb.from("events").select("type, tickets_and_rates").eq("id", eventId).maybeSingle();
    if (eerr) throw new Error(`events read: ${eerr.message}`);
    eventCache.set(eventId, (ev as EventRow | null) ?? null);
    return (ev as EventRow | null) ?? null;
  };
  const readLive = async (liveEventId: number): Promise<LiveRow | null> => {
    if (liveCache.has(liveEventId)) return liveCache.get(liveEventId) ?? null;
    const { data: le, error: lerr } = await mdb.from("live_events").select("currency, ticket_categories").eq("event_id", liveEventId).maybeSingle();
    if (lerr) throw new Error(`live_events read: ${lerr.message}`);
    liveCache.set(liveEventId, (le as LiveRow | null) ?? null);
    return (le as LiveRow | null) ?? null;
  };
  const readXs2 = async (ticketId: string): Promise<number | null> => {
    if (xs2Cache.has(ticketId)) return xs2Cache.get(ticketId) ?? null;
    if (xs2Down) throw new Error("XS2 API unreachable earlier in this run");
    try {
      const cents = await fetchXs2NetRateEurCents(ticketId);
      xs2Cache.set(ticketId, cents);
      return cents;
    } catch (e) {
      xs2Down = true; // one transport/auth failure stops the XS2 calls of this run
      throw e;
    }
  };

  /** The estimate of one order item, or null when there is nothing honest to estimate from. */
  const estimateItem = async (item: ReservationEventOrderInfoItem, reservationEventId: number) => {
    const sale = Number(item.price_per_ticket) || 0;
    const isLive = [item.supplier, item.vendor].some((v) => String(v ?? "").toLowerCase() === "livetickets");
    const ev = await readEvent(Number(item.event_id) || reservationEventId);
    let liveCategoryCost: number | null = null;
    let liveCurrency: EstimateInput["liveCurrency"] = null;
    let xs2NetRateEurCents: number | null = null;
    if (isLive) {
      const eid = item.supplier_event_id ?? ev?.tickets_and_rates?.find((t) => String(t.id) === String(item.id))?.eid;
      if (eid !== undefined && /^\d{1,12}$/.test(String(eid))) {
        const le = await readLive(Number(eid));
        const currency = LIVE_CURRENCY[Number(le?.currency)] ?? null; // 5 = OTHER: no rate to convert with
        const cat = le?.ticket_categories?.find((c) => String(c.id) === String(item.id));
        if (currency && cat) {
          liveCategoryCost = cat.cost;
          liveCurrency = currency;
        }
      }
    } else if (ev?.type === "sports_event_dynamic" && item.id && !item.own_stock) {
      xs2NetRateEurCents = await readXs2(String(item.id));
    }
    const est = estimateTicketCostUsd({
      supplier: isLive ? "livetickets" : (item.supplier ?? item.vendor),
      quantity: Number(item.number_of_ticket) || 1,
      salePerTicketUsd: sale,
      liveCategoryCost,
      liveCurrency,
      xs2NetRateEurCents,
      toUsd,
    });
    // No supplier cost and no sale price either: 0 would be a made-up number written for good.
    return est.how === "inverted markup" && sale <= 0 ? null : est;
  };

  let filled = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const r of rows) {
    try {
      const items = normalizeReservationEventOrderInfo(r.event_order_info as ReservationEventOrderInfo | null);
      if (items.length === 0) { skipped += 1; continue; }
      let total = 0;
      let unknown = false;
      for (const item of items) {
        const est = await estimateItem(item, r.event_id);
        if (!est) { unknown = true; break; }
        total += est.usd;
      }
      if (unknown) { skipped += 1; continue; }
      if (!opts.dryRun) {
        const { error: werr } = await mdb
          .from("reservations")
          .update({ ticket_cost_usd: Math.round(total * 100) / 100, ticket_cost_source: "estimated" })
          .eq("id", r.id)
          .is("ticket_cost_usd", null);
        if (werr) throw new Error(werr.message);
      }
      filled += 1;
    } catch (e) {
      errors.push(`#${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { filled, skipped, errors };
}

/**
 * Revenue, COGS and net profit of ONE reservation, in USD - the marketing dashboard's
 * arithmetic (spec 2026-10-08-marketing-dashboard-design.md, section 2.1). Pure: no DB,
 * no fetch; `scripts/reservation-pnl-selftest.ts` runs it under plain node.
 *
 * Why these columns: `user_shown_price` IS what the customer pays in USD, net of the coupon
 * (never subtract coupon_discount_usd again). An Amadeus offer's `price.grandTotal` is what
 * WE pay; a hotel carries no markup, so its price is its cost; offline inventory already
 * stores its cost; a ticket's cost is the snapshot column (main / nightly fill) or, when
 * none, the SALE price flagged `estimated` so the screen says "N estimated" instead of hiding it.
 */
import { isPaid } from "@/lib/partner-commission";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";

export type PnlReservation = {
  status: string | null;
  user_shown_price: number | null;
  exchange_rate_usd_ils_100: number | null;
  agent_card_discount_ils: number | string | null;
  partner_settlement_method: string | null;
  flight_order_info: unknown;
  hotel_order_info: unknown;
  hotel_segments: unknown;
  offline_flight_cost: number | string | null;
  offline_hotel_cost: number | string | null;
  ticket_cost_usd: number | string | null;
  ticket_cost_source: string | null;
  actual_cost_usd: number | string | null;
  event_order_info: unknown;
};

export interface Cogs {
  total: number;
  flight: number;
  hotel: number;
  ticket: number;
  source: "actual" | "computed";
  /** Some component is a stand-in (customer price as cost, inverted markup, no snapshot). */
  estimated: boolean;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the customer paid us, USD. null unless Paid. */
export function revenueUsd(r: PnlReservation): number | null {
  if (!isPaid(r as { status: string | null })) return null;
  const price = num(r.user_shown_price) ?? 0;
  if (r.partner_settlement_method !== "agent_card") return price;
  const discountIls = num(r.agent_card_discount_ils) ?? 0;
  const rate = (num(r.exchange_rate_usd_ils_100) ?? 0) / 100;
  return rate > 0 ? round2(price - discountIls / rate) : price;
}

function flightCost(r: PnlReservation): { usd: number; estimated: boolean } {
  const f = obj(r.flight_order_info);
  if (Object.keys(f).length === 0) return { usd: 0, estimated: false };
  if (f.isOffline === true) {
    const c = num(r.offline_flight_cost);
    return c !== null ? { usd: c, estimated: false } : { usd: num(f.price) ?? 0, estimated: true };
  }
  const grand = num(obj(obj(f.offer).price).grandTotal);
  if (grand !== null) {
    const bags = obj(f.added_bags);
    const extra = (num(bags.total_usd) ?? 0) + (num(obj(bags.cabin).total_usd) ?? 0);
    return { usd: round2(grand + extra), estimated: false };
  }
  return { usd: num(f.price) ?? 0, estimated: true };
}

function hotelCost(r: PnlReservation): { usd: number; estimated: boolean } {
  const h = obj(r.hotel_order_info);
  if (Object.keys(h).length === 0) return { usd: 0, estimated: false };
  if (h.isOffline === true) {
    const c = num(r.offline_hotel_cost);
    return c !== null ? { usd: c, estimated: false } : { usd: num(h.price) ?? 0, estimated: true };
  }
  const segments = Array.isArray(r.hotel_segments) && r.hotel_segments.length > 1 ? r.hotel_segments : [h];
  const sum = segments.reduce<number>((acc, s) => acc + (num(obj(s).price) ?? 0), 0);
  return { usd: round2(sum), estimated: false };
}

function ticketCost(r: PnlReservation): { usd: number; estimated: boolean } {
  const snap = num(r.ticket_cost_usd);
  if (snap !== null) return { usd: snap, estimated: r.ticket_cost_source === "estimated" };
  const sale = normalizeReservationEventOrderInfo(r.event_order_info as never).reduce<number>(
    (acc, e) => acc + (num((e as { total_tickets_price?: unknown }).total_tickets_price) ?? 0),
    0,
  );
  return { usd: sale, estimated: true };
}

/** Supplier cost of the whole order, USD. `actual_cost_usd` (ops) wins whole. */
export function cogsUsd(r: PnlReservation): Cogs {
  const actual = num(r.actual_cost_usd);
  if (actual !== null) return { total: actual, flight: 0, hotel: 0, ticket: 0, source: "actual", estimated: false };
  const f = flightCost(r);
  const h = hotelCost(r);
  const t = ticketCost(r);
  return {
    total: round2(f.usd + h.usd + t.usd),
    flight: f.usd,
    hotel: h.usd,
    ticket: t.usd,
    source: "computed",
    estimated: f.estimated || h.estimated || t.estimated,
  };
}

/** revenue - cogs - processing fee (percent of revenue). null unless Paid. */
export function netUsd(r: PnlReservation, feePct: number): number | null {
  const rev = revenueUsd(r);
  if (rev === null) return null;
  return round2(rev - cogsUsd(r).total - (rev * feePct) / 100);
}

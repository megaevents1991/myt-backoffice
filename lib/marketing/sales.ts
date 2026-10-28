/**
 * The Sales tab (spec 2026-10-28 section 1): what the Paid orders of the period bought - by event, artist, football
 * team, category (the vertical tag), league and genre - each against the previous period of the same length. Pure;
 * scripts/marketing-sales-selftest.ts.
 *
 * An event's artist / team / league / genre / vertical are its typed feed tags (`event_tags.type`, taxonomy v2) - the
 * same tags the site's categories are built from. An event tagged with two teams (a derby) counts for BOTH teams, so
 * the team table does not add up to the total; every other table does, except where an event carries no such tag.
 */

/** A change against the previous period. `change` is a percentage, null when there is nothing to compare with. */
export interface Trend {
  dir: "new" | "up" | "down" | "flat" | "none";
  change: number | null;
}

/** Below this move (in %) a number is "flat" - a 30-day period moving one ticket is not a trend. */
export const FLAT_PCT = 5;

export function trendOf(current: number, previous: number): Trend {
  if (current === 0 && previous === 0) return { dir: "none", change: null };
  if (previous === 0) return { dir: "new", change: null };
  const change = Math.round(((current - previous) / previous) * 1000) / 10;
  if (Math.abs(change) < FLAT_PCT) return { dir: "flat", change };
  return { dir: change > 0 ? "up" : "down", change };
}

/** One event of one Paid order. `revenue` is the order's revenue (the P&L's rule), in the screen's currency; an
 *  order of several events splits it by each event's ticket price. */
export interface SaleLine {
  orderId: number;
  /** In the chosen period; false = the previous period. */
  current: boolean;
  eventId: number | null;
  /** The order's own copy of the event name and date - the label when the event row is gone. */
  name: string;
  date: string | null;
  tickets: number;
  revenue: number;
}

export interface SaleTag {
  type: string;
  slug: string;
  name: string;
  nameEnglish: string | null;
}

export interface SaleEventInfo {
  name: string;
  nameEnglish: string | null;
  date: string | null;
}

export interface SalesRow {
  key: string;
  label: string;
  /** English name for a tag, the date for an event. */
  sublabel: string | null;
  /** Set on event rows - the site link. */
  eventId: number | null;
  orders: number;
  tickets: number;
  revenue: number;
  prevOrders: number;
  prevTickets: number;
  prevRevenue: number;
  /** On tickets. */
  trend: Trend;
}

export interface SalesTotals {
  orders: number;
  tickets: number;
  revenue: number;
  prevOrders: number;
  prevTickets: number;
  prevRevenue: number;
  trend: Trend;
}

export type RisingRow = SalesRow & { group: "artist" | "team" };

export interface SalesView {
  totals: SalesTotals;
  events: SalesRow[];
  artists: SalesRow[];
  teams: SalesRow[];
  categories: SalesRow[];
  leagues: SalesRow[];
  genres: SalesRow[];
  bestArtist: SalesRow | null;
  bestTeam: SalesRow | null;
  /** Artists and teams that sold more than in the previous period, the biggest gain in tickets first. */
  rising: RisingRow[];
  /** Orders per event id in EITHER period (the events table lists this period's only) - what a landing page sold
   *  (lib/marketing/page-subject.ts). */
  eventOrders: { eventId: number; orders: number; prevOrders: number }[];
}

/** A rise needs at least this many tickets now - one ticket after none is not a trend. */
export const RISING_MIN_TICKETS = 2;
export const RISING_MAX = 5;

/** The bucket of an event with no vertical tag. */
export const NO_CATEGORY_KEY = "vertical:none";

type Acc = SalesRow & { orderIds: Set<number>; prevOrderIds: Set<number> };

const r2 = (n: number) => Math.round(n * 100) / 100;

function add(map: Map<string, Acc>, key: string, label: string, sublabel: string | null, eventId: number | null, line: SaleLine): void {
  let row = map.get(key);
  if (!row) {
    row = { key, label, sublabel, eventId, orders: 0, tickets: 0, revenue: 0, prevOrders: 0, prevTickets: 0, prevRevenue: 0, trend: { dir: "none", change: null }, orderIds: new Set(), prevOrderIds: new Set() };
    map.set(key, row);
  }
  if (line.current) {
    row.orderIds.add(line.orderId);
    row.tickets += line.tickets;
    row.revenue += line.revenue;
  } else {
    row.prevOrderIds.add(line.orderId);
    row.prevTickets += line.tickets;
    row.prevRevenue += line.revenue;
  }
}

/** Rows that sold in the period, most tickets first (then revenue, then name). */
function finish(map: Map<string, Acc>): SalesRow[] {
  return [...map.values()]
    .map(({ orderIds, prevOrderIds, ...row }) => ({
      ...row,
      orders: orderIds.size,
      prevOrders: prevOrderIds.size,
      revenue: r2(row.revenue),
      prevRevenue: r2(row.prevRevenue),
      trend: trendOf(row.tickets, row.prevTickets),
    }))
    .sort((a, b) => b.tickets - a.tickets || b.revenue - a.revenue || a.label.localeCompare(b.label));
}

const sold = (rows: SalesRow[]) => rows.filter((r) => r.tickets > 0 || r.orders > 0);

export function buildSales(input: { lines: SaleLine[]; tagsByEvent: Map<number, SaleTag[]>; events: Map<number, SaleEventInfo> }): SalesView {
  const events = new Map<string, Acc>();
  const byType: Record<"artist" | "team" | "league" | "genre" | "vertical", Map<string, Acc>> = {
    artist: new Map(),
    team: new Map(),
    league: new Map(),
    genre: new Map(),
    vertical: new Map(),
  };
  const orderIds = { current: new Set<number>(), previous: new Set<number>() };
  const totals = { tickets: 0, revenue: 0, prevTickets: 0, prevRevenue: 0 };

  for (const line of input.lines) {
    (line.current ? orderIds.current : orderIds.previous).add(line.orderId);
    if (line.current) {
      totals.tickets += line.tickets;
      totals.revenue += line.revenue;
    } else {
      totals.prevTickets += line.tickets;
      totals.prevRevenue += line.revenue;
    }

    const info = line.eventId !== null ? input.events.get(line.eventId) : undefined;
    const eventKey = line.eventId !== null ? `event:${line.eventId}` : `name:${line.name.trim().toLowerCase()}|${line.date ?? ""}`;
    add(events, eventKey, info?.name || line.name || "Unknown event", info?.date ?? line.date, line.eventId, line);

    const tags = line.eventId !== null ? input.tagsByEvent.get(line.eventId) ?? [] : [];
    const seen = new Set<string>();
    let hasVertical = false;
    for (const t of tags) {
      if (!(t.type in byType)) continue;
      const key = `${t.type}:${t.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (t.type === "vertical") hasVertical = true;
      add(byType[t.type as keyof typeof byType], key, t.name || t.nameEnglish || t.slug, t.nameEnglish && t.nameEnglish !== t.name ? t.nameEnglish : null, null, line);
    }
    if (!hasVertical) add(byType.vertical, NO_CATEGORY_KEY, "No category", null, null, line);
  }

  const allEvents = finish(events);
  const artists = sold(finish(byType.artist));
  const teams = sold(finish(byType.team));
  const rising: RisingRow[] = [
    ...artists.map((r) => ({ ...r, group: "artist" as const })),
    ...teams.map((r) => ({ ...r, group: "team" as const })),
  ]
    .filter((r) => r.tickets >= RISING_MIN_TICKETS && r.tickets > r.prevTickets)
    .sort((a, b) => b.tickets - b.prevTickets - (a.tickets - a.prevTickets) || b.tickets - a.tickets)
    .slice(0, RISING_MAX);

  return {
    totals: {
      orders: orderIds.current.size,
      tickets: totals.tickets,
      revenue: r2(totals.revenue),
      prevOrders: orderIds.previous.size,
      prevTickets: totals.prevTickets,
      prevRevenue: r2(totals.prevRevenue),
      trend: trendOf(totals.tickets, totals.prevTickets),
    },
    events: sold(allEvents),
    artists,
    teams,
    categories: sold(finish(byType.vertical)),
    leagues: sold(finish(byType.league)),
    genres: sold(finish(byType.genre)),
    bestArtist: artists[0] ?? null,
    bestTeam: teams[0] ?? null,
    rising,
    eventOrders: allEvents.filter((e) => e.eventId !== null).map((e) => ({ eventId: e.eventId as number, orders: e.orders, prevOrders: e.prevOrders })),
  };
}

/** One order's events, each with its share of the order's revenue (by ticket price; equal shares when no price is
 *  known). Pure - the reader hands in the normalized `event_order_info` items. */
export function splitOrder(
  order: { id: number; current: boolean; eventId: number | null; revenue: number },
  items: { event_id?: number | null; name?: string | null; date?: string | Date | null; number_of_ticket?: number | null; total_tickets_price?: number | null }[],
): SaleLine[] {
  const list = items.length ? items : [{}];
  const prices = list.map((i) => Math.max(0, Number(i.total_tickets_price) || 0));
  const priceSum = prices.reduce((a, b) => a + b, 0);
  return list.map((item, i) => {
    const share = priceSum > 0 ? prices[i] / priceSum : 1 / list.length;
    const id = Number(item.event_id);
    const date = item.date == null ? null : typeof item.date === "string" ? item.date.slice(0, 10) : item.date.toISOString().slice(0, 10);
    return {
      orderId: order.id,
      current: order.current,
      eventId: Number.isFinite(id) && id > 0 ? id : list.length === 1 ? order.eventId : null,
      name: (item.name ?? "").trim(),
      date,
      tickets: Math.max(0, Number(item.number_of_ticket) || 0),
      revenue: order.revenue * share,
    };
  });
}

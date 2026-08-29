// lib/actions/tixstock-actions.ts

import { TixStockEventDB, TixStockListing } from '@/types/tixstock.types';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
} as const;

export interface TixStockEventsResult {
  events: TixStockEventDB[];
  /** Rows matching the filters, before the server's row ceiling is applied. */
  total: number;
  /** Ticketless events the server filtered out - kept for the UI's "(N)". */
  hiddenEmpty: number;
  /** True when the server hit its row ceiling and the list is incomplete. */
  truncated: boolean;
}

/**
 * Fetch TixStock events from internal DB API.
 *
 * The server applies the same filters the browser used to apply after
 * downloading everything (48h lead time, has-tickets), so `withTickets` has to
 * round-trip rather than being toggled client-side.
 */
export async function getTixStockEvents(
  options: { query?: string; withTickets?: boolean } = {}
): Promise<TixStockEventsResult> {
  const { query, withTickets = true } = options;

  let url = `/api/tixstock/events?_=${Date.now()}`;
  if (query) url += `&query=${encodeURIComponent(query)}`;
  if (!withTickets) url += `&with_tickets=0`;

  const res = await fetch(url, { cache: 'no-store', headers: NO_CACHE_HEADERS });

  if (!res.ok) throw new Error('Failed to fetch TixStock events');
  const json = await res.json();
  const events: TixStockEventDB[] = json.data || [];

  return {
    events,
    total: json.meta?.total ?? events.length,
    hiddenEmpty: json.meta?.hiddenEmpty ?? 0,
    truncated: json.meta?.truncated ?? false,
  };
}

/**
 * Fetch a single TixStock event by ID. Looked up server-side by primary key -
 * this used to download every future event and find one row in memory.
 */
export async function getTixStockEventById(eventId: string): Promise<TixStockEventDB | null> {
  const res = await fetch(
    `/api/tixstock/events?event_id=${encodeURIComponent(eventId)}&_=${Date.now()}`,
    { cache: 'no-store', headers: NO_CACHE_HEADERS }
  );

  if (!res.ok) throw new Error('Failed to fetch TixStock event');
  const json = await res.json();
  return json.data?.[0] ?? null;
}

/**
 * Fetch real-time tickets for a specific event from TixStock API via Proxy
 */
export async function getTixStockTickets(eventId: string): Promise<TixStockListing[]> {
  const res = await fetch(`/api/tixstock/tickets?event_id=${eventId}&_=${Date.now()}`, {
    cache: 'no-store',
    headers: NO_CACHE_HEADERS
  });

  if (!res.ok) {
    console.error(`❌ TixStock API tickets fetch failed for event ${eventId}: ${res.status} ${res.statusText}`);
    throw new Error(`Failed to fetch TixStock tickets: ${res.statusText}`);
  }

  const json = await res.json();
  
  if (json.success && json.data?.data) {
    return json.data.data as TixStockListing[];
  }

  return [];
}

/**
 * Trigger sync
 */
export async function triggerTixStockSync() {
  const res = await fetch('/api/tixstock/sync', { method: 'POST' });
  if (!res.ok) throw new Error('Sync failed');
  return res.json();
}

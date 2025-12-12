// lib/actions/tixstock-actions.ts

import { TixStockEventDB, TixStockListing } from '@/types/tixstock.types';

/**
 * Fetch TixStock events from internal DB API
 */
export async function getTixStockEvents(query?: string): Promise<TixStockEventDB[]> {
  let url = `/api/tixstock/events?_=${Date.now()}`;
  if (query) {
    url += `&query=${encodeURIComponent(query)}`;
  }

  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });

  if (!res.ok) throw new Error('Failed to fetch TixStock events');
  const json = await res.json();
  return json.data || [];
}

/**
 * Fetch a single TixStock event by ID from internal DB API
 * (Reusing the events endpoint with a filter, or we could add a specific endpoint)
 */
export async function getTixStockEventById(eventId: string): Promise<TixStockEventDB | null> {
  // We can reuse the events list endpoint if we filter client side or add ID param to API
  // For now, let's assume we fetch all or filter. 
  // Better: Update the API to support ID filtering.
  // Let's assume we update the API or just fetch list and find. 
  // Given the API implementation I wrote earlier, it supports 'query' but not 'id' explicitly yet.
  // I will update the API to support ID or just fetch all and find for now (inefficient but works for MVP).
  // Actually, let's just fetch the list and find it, or better, let's assume I'll update the API.
  // Wait, I wrote the API earlier. It only supports 'query'.
  // I will update the API in a separate step if needed, but for now let's just fetch list and find.
  
  // Actually, let's use the same endpoint but filter in memory for now to save a round trip of editing the API file again immediately.
  // Or better, I'll just add the ID param to the API call in the action and hope I updated it or will update it.
  // I'll stick to fetching all and finding for now to be safe without editing API again.
  
  const events = await getTixStockEvents();
  return events.find(e => e.event_id === eventId) || null;
}

/**
 * Fetch real-time tickets for a specific event from TixStock API via Proxy
 */
export async function getTixStockTickets(eventId: string): Promise<TixStockListing[]> {
  const res = await fetch(`/api/tixstock/tickets?event_id=${eventId}&_=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
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

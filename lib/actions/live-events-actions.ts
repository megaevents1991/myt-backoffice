// lib/actions/live-events-actions.ts

import { LiveEventDB, LiveTicketCategory } from '@/types/live-events.types';

/**
 * Fetch live events by type (sports or music)
 */
export async function getLiveEvents(eventType?: 'sports_live_event_dynamic' | 'music_live_event_dynamic'): Promise<LiveEventDB[]> {
  // Use server API endpoint to avoid RLS restrictions client-side
  const url = `/api/live-events/events?type=${encodeURIComponent(eventType || 'all')}&_=${Date.now()}`;
  const res = await fetch(url, { 
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
  if (!res.ok) throw new Error('Failed to fetch live events');
  const json = await res.json();
  return json.data || [];
}

/**
 * Fetch a single live event by ID
 */
export async function getLiveEventById(eventId: number): Promise<LiveEventDB | null> {
  const url = `/api/live-events/events?limit=1&event_id=${eventId}&_=${Date.now()}`;
  const res = await fetch(url, { 
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
  if (!res.ok) throw new Error('Failed to fetch live event');
  const json = await res.json();
  const list: LiveEventDB[] = json.data || [];
  return list.find(e => e.event_id === eventId) || null;
}

/**
 * Fetch live tickets for a specific event from the API
 * 
 * IMPORTANT: Always fetches from LIVE API for real-time inventory.
 * NO CACHING - Backoffice requires fresh data at all times.
 */
export async function getLiveTickets(eventId: number): Promise<LiveTicketCategory[]> {
  // ✅ ALWAYS fetch fresh tickets from LIVE API endpoint - NO FALLBACK TO CACHE
  const res = await fetch(`/api/live-events/tickets?event_id=${eventId}&_=${Date.now()}`, { 
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
  
  if (!res.ok) {
    console.error(`❌ LIVE API tickets fetch failed for event ${eventId}: ${res.status} ${res.statusText}`);
    throw new Error(`Failed to fetch live tickets: ${res.statusText}`);
  }
  
  const json = await res.json();
  
  if (json.success && json.data?.tickets) {
    console.log(`✅ Fetched ${json.data.tickets.length} live tickets for event ${eventId}`);
    return json.data.tickets as LiveTicketCategory[];
  }
  
  console.warn(`⚠️ LIVE API returned no tickets for event ${eventId}`);
  return [];
}

/**
 * Get sync status from the API
 */
export async function getLiveSyncStatus() {
  try {
    const response = await fetch('/api/live-events/sync', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to get LIVE sync status: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get LIVE sync status:', error);
    throw error;
  }
}

/**
 * Trigger data sync from LIVE API
 */
export async function triggerLiveSync(type?: string) {
  try {
    const url = type ? `/api/live-events/sync?type=${type}` : '/api/live-events/sync';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to trigger LIVE sync: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to trigger LIVE sync:', error);
    throw error;
  }
}

// lib/actions/live-events-actions.ts

import { supabase } from '@/lib/supabase-client';
import { LiveEventDB, LiveTicketCategory, LiveEventsApiResponse } from '@/types/live-events.types';
// Utility normalizers (duplicated minimally to avoid circular import)
const normalizeIata = (raw: string | null | undefined) => {
  if (!raw) return '';
  const trimmed = raw.trim().toUpperCase();
  const match = trimmed.match(/[A-Z]{1,3}/);
  return match ? match[0] : '';
};
const safeStr = (v: string | null | undefined) => (v || '').trim();

/**
 * Fetch live events by type (sports or music)
 */
export async function getLiveEvents(eventType?: 'sports_event_dynamic' | 'music_event_dynamic'): Promise<LiveEventDB[]> {
  // Use server API endpoint to avoid RLS restrictions client-side
  const url = `/api/live-events/events?type=${encodeURIComponent(eventType || 'all')}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch live events');
  const json = await res.json();
  return json.data || [];
}

/**
 * Fetch live events by category
 */
export async function getLiveEventsByCategory(categoryName: string): Promise<LiveEventDB[]> {
  const url = `/api/live-events/events?category=${encodeURIComponent(categoryName)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch live events (category)');
  const json = await res.json();
  return json.data || [];
}

/**
 * Fetch live events by performer
 */
export async function getLiveEventsByPerformer(performerName: string): Promise<LiveEventDB[]> {
  const url = `/api/live-events/events?performer=${encodeURIComponent(performerName)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch live events (performer)');
  const json = await res.json();
  return json.data || [];
}

/**
 * Fetch a single live event by ID
 */
export async function getLiveEventById(eventId: number): Promise<LiveEventDB | null> {
  const url = `/api/live-events/events?limit=1&event_id=${eventId}`; // event_id filter handled below via client side filter (could extend API)
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch live event');
  const json = await res.json();
  const list: LiveEventDB[] = json.data || [];
  return list.find(e => e.event_id === eventId) || null;
}

/**
 * Fetch live tickets for a specific event from the API
 */
export async function getLiveTickets(eventId: number): Promise<LiveTicketCategory[]> {
  // Tickets are embedded in the stored event row (ticket_categories JSONB)
  try {
    const res = await fetch(`/api/live-events/events?event_id=${eventId}&limit=1`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load event for tickets');
    const json = await res.json();
    const event: LiveEventDB | undefined = (json.data || [])[0];
    if (event && Array.isArray((event as any).ticket_categories)) {
      return (event as any).ticket_categories as LiveTicketCategory[];
    }
  } catch (e) {
    console.error('getLiveTickets failed', e);
  }
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

/**
 * Search live events by text
 */
export async function searchLiveEvents(searchTerm: string): Promise<LiveEventDB[]> {
  // Client-side filter after fetching all (could optimize with API param if needed)
  const all = await getLiveEvents();
  const term = searchTerm.toLowerCase();
  return all.filter(e =>
    e.event_name.toLowerCase().includes(term) ||
    (e.event_name_heb || '').toLowerCase().includes(term) ||
    (e.primary_category || '').toLowerCase().includes(term)
  ).slice(0,50);
}

/**
 * Get available categories from live events
 */
export async function getLiveCategories() {
  const res = await fetch('/api/live-events/categories', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch categories');
  const json = await res.json();
  return json.data || [];
}

/**
 * Get available performers from live events
 */
export async function getLivePerformers() {
  const res = await fetch('/api/live-events/performers', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch performers');
  const json = await res.json();
  return json.data || [];
}

/**
 * Get cities (for dropdowns, mapping, etc.) ensuring trimmed IATA and empty-string (not null) names for client simplicity
 */
export async function getLiveCities(options: { limit?: number } = {}) {
  const { limit = 5000 } = options;
  const { data, error } = await supabase
    .from('live_cities')
    .select('*')
    .limit(limit)
    .order('city_name');

  if (error) {
    console.error('Failed to fetch live cities:', error);
    throw new Error(`Failed to fetch live cities: ${error.message}`);
  }

  return (data || []).map(c => ({
    ...c,
    city_name: safeStr((c as any).city_name),
    eng_full_name: safeStr((c as any).eng_full_name) || '',
    heb_full_name: safeStr((c as any).heb_full_name) || '',
    iata: normalizeIata((c as any).iata)
  }));
}

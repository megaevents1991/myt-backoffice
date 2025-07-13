
import { supabase } from '@/lib/supabase-client';
import { XS2Sport, XS2Tournament, XS2Event, XS2Ticket, SportsEventsApiResponse, LiveTicketsResponse } from '@/types/sports-events.types';

/**
 * Fetch all sports from the cached database
 */
export async function getSports(): Promise<XS2Sport[]> {
  const { data, error } = await supabase
    .from('xs2e_sports')
    .select('sport_id, created_at, updated_at')
    .order('sport_id');

  if (error) {
    console.error('Failed to fetch sports:', error);
    throw new Error(`Failed to fetch sports: ${error.message}`);
  }

  return (data as XS2Sport[]) || [];
}

/**
 * Fetch tournaments for a specific sport (only future/ongoing tournaments)
 */
export async function getTournaments(sportId: string): Promise<XS2Tournament[]> {
  // Get current timestamp for filtering future/ongoing tournaments
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('xs2e_tournaments')
    .select(`
      tournament_id,
      official_name,
      season,
      tournament_type,
      region,
      sport_type,
      date_start,
      date_stop,
      slug,
      number_events,
      created,
      updated,
      created_at,
      updated_at
    `)
    .eq('sport_type', sportId)
    .gte('date_stop', now) // Only tournaments that haven't ended yet
    .order('date_start', { ascending: false });

  if (error) {
    console.error('Failed to fetch tournaments:', error);
    throw new Error(`Failed to fetch tournaments: ${error.message}`);
  }

  return (data as XS2Tournament[]) || [];
}

/**
 * Fetch events for a specific tournament (only future events)
 */
export async function getEvents(tournamentId: string): Promise<XS2Event[]> {
  // Get current timestamp for filtering future events
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('xs2e_events')
    .select(`
      event_id,
      event_name,
      event_name_heb,
      date_start,
      date_stop,
      date_confirmed,
      event_status,
      event_description,
      event_description_heb,
      slug,
      number_of_tickets,
      sales_periods,
      is_popular,
      min_ticket_price_eur,
      max_ticket_price_eur,
      tournament_id,
      tournament_name,
      tournament_name_heb,
      venue_id,
      venue_name,
      venue_name_heb,
      city,
      latitude,
      longitude,
      hometeam_name,
      visiting_name,
      created,
      updated,
      created_at,
      updated_at
    `)
    .eq('tournament_id', tournamentId)
    .gte('date_start', now) // Only events with date_start >= now
    .order('date_start', { ascending: true }); // Sort by upcoming date first

  if (error) {
    console.error('Failed to fetch events:', error);
    throw new Error(`Failed to fetch events: ${error.message}`);
  }

  return (data as XS2Event[]) || [];
}

/**
 * Fetch all tournaments from the cached database (for overview, only future/ongoing tournaments)
 */
export async function getAllTournaments(): Promise<XS2Tournament[]> {
  // Get current timestamp for filtering future/ongoing tournaments
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('xs2e_tournaments')
    .select(`
      tournament_id,
      official_name,
      season,
      tournament_type,
      region,
      sport_type,
      date_start,
      date_stop,
      slug,
      number_events,
      created,
      updated,
      created_at,
      updated_at
    `)
    .gte('date_stop', now) // Only tournaments that haven't ended yet
    .order('date_start', { ascending: false });

  if (error) {
    console.error('Failed to fetch all tournaments:', error);
    throw new Error(`Failed to fetch tournaments: ${error.message}`);
  }

  return (data as XS2Tournament[]) || [];
}

/**
 * Fetch a single event by ID (only if it's a future event)
 */
export async function getEventById(eventId: string): Promise<XS2Event | null> {
  // Get current timestamp for filtering future events
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('xs2e_events')
    .select(`
      event_id,
      event_name,
      event_name_heb,
      date_start,
      date_stop,
      date_confirmed,
      event_status,
      event_description,
      event_description_heb,
      slug,
      number_of_tickets,
      sales_periods,
      is_popular,
      min_ticket_price_eur,
      max_ticket_price_eur,
      tournament_id,
      tournament_name,
      tournament_name_heb,
      venue_id,
      venue_name,
      venue_name_heb,
      city,
      latitude,
      longitude,
      hometeam_name,
      visiting_name,
      created,
      updated,
      created_at,
      updated_at
    `)
    .eq('event_id', eventId)
    .gte('date_start', now) // Only if event is in the future
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned - event doesn't exist or is in the past
      return null;
    }
    console.error('Failed to fetch event:', error);
    throw new Error(`Failed to fetch event: ${error.message}`);
  }

  return data as XS2Event;
}

/**
 * Fetch live tickets for a specific event from the API
 */
export async function getLiveTickets(eventId: string): Promise<XS2Ticket[]> {
  try {
    const response = await fetch(`/api/sports-events/live-tickets?event_id=${eventId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tickets: ${response.statusText}`);
    }

    const result: SportsEventsApiResponse<LiveTicketsResponse> = await response.json();
    
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch tickets');
    }

    return result.data.tickets || [];
  } catch (error) {
    console.error('Failed to fetch live tickets:', error);
    throw error;
  }
}

/**
 * Get sync status from the API
 */
export async function getSyncStatus() {
  try {
    const response = await fetch('/api/sports-events/sync', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to get sync status: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get sync status:', error);
    throw error;
  }
}

/**
 * Trigger data sync from XS2Event API
 */
export async function triggerSync(type?: string) {
  try {
    const url = type ? `/api/sports-events/sync?type=${type}` : '/api/sports-events/sync';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to trigger sync: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to trigger sync:', error);
    throw error;
  }
}

/**
 * Clean up past events from the database
 * This can be called during sync to remove events that are no longer relevant
 */
export async function cleanupPastEvents(): Promise<{ deletedCount: number }> {
  try {
    const now = new Date().toISOString();
    
    // First, count how many past events exist
    const { count: countResult } = await supabase
      .from('xs2e_events')
      .select('*', { count: 'exact', head: true })
      .lt('date_start', now);

    // Then delete them
    const { error } = await supabase
      .from('xs2e_events')
      .delete()
      .lt('date_start', now);

    if (error) {
      console.error('Failed to cleanup past events:', error);
      throw new Error(`Failed to cleanup past events: ${error.message}`);
    }

    const deletedCount = countResult || 0;
    console.log(`🧹 Cleaned up ${deletedCount} past events`);
    
    return { deletedCount };
  } catch (error) {
    console.error('Failed to cleanup past events:', error);
    throw error;
  }
}

// Server-only sync service — called by cron/API routes. Deliberately NOT a
// Server Action ("use server" removed): exports must not be client-dispatchable.

import { supabase } from '@/lib/supabase-server';
//import { cleanupPastEvents } from '@/lib/actions/sports-events-actions';

// Types for sync results
export interface SyncResult {
  count: number;
  status: 'success' | 'error';
  error?: string;
  details?: string;
}

export interface SyncResults {
  sports?: SyncResult;
  tournaments?: SyncResult;
  events?: SyncResult;
}

// XS2Event API functions
async function fetchXS2<T = unknown>(path: string, options: { cache?: RequestCache; revalidate?: number } = {}): Promise<T> {
  const { cache = 'no-store', revalidate } = options;
  
  if (!process.env.NEXT_SECRET_XS2EVENT_API_KEY) {
    throw new Error('XS2EVENT_API_KEY environment variable is not set');
  }
  
  const fetchOptions: RequestInit = {
    headers: { 
      'X-Api-Key': process.env.NEXT_SECRET_XS2EVENT_API_KEY!,
      'Content-Type': 'application/json'
    },
    cache,
    ...(revalidate && { next: { revalidate } })
  };

  try {
    const url = `${process.env.NEXT_SECRET_XS2EVENT_API_URL}/${path}`;
    console.log(`🔗 Fetching from: ${url}`);
    
    const res = await fetch(url, fetchOptions);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`❌ XS2Event API error: ${res.status} ${res.statusText}`, errorText);
      throw new Error(`XS2Event API error: ${res.status} ${res.statusText} - ${errorText}`);
    }
    
    const data = await res.json();
    console.log(`✅ Successfully fetched data from: ${url}`);
    return data;
  } catch (error) {
    console.error(`Failed to fetch from XS2Event API (${path}):`, error);
    throw error;
  }
}

async function fetchAllPaginated<T = unknown>(
  path: string, 
  options: { cache?: RequestCache; revalidate?: number } = {},
  maxPages: number = 100
): Promise<T[]> {
  const allData: T[] = [];
  let currentPage = 1;
  let hasMoreData = true;
  
  console.log(`🔄 Starting paginated fetch for ${path}...`);
  
  while (hasMoreData && currentPage <= maxPages) {
    try {
      const separator = path.includes('?') ? '&' : '?';
      const paginatedPath = `${path}${separator}page_size=100&page=${currentPage}`;
      
      console.log(`📄 Fetching page ${currentPage} from ${paginatedPath}`);
      
      const response = await fetchXS2<any>(paginatedPath, options);
      console.log(`🔍 Raw response structure:`, {
        isArray: Array.isArray(response),
        keys: typeof response === 'object' && response ? Object.keys(response) : [],
        responseType: typeof response
      });
      
      let pageData: T[] = [];
      let pagination: any = null;
      
      if (Array.isArray(response)) {
        pageData = response;
        console.log(`📋 Array response: ${pageData.length} items`);
        // For array responses, assume no more data if less than page size
        hasMoreData = pageData.length === 100;
      } else if (typeof response === 'object' && response !== null) {
        // Handle different response formats
        pageData = response.sports || response.teams || response.venues || 
                  response.tournaments || response.events || response.data || 
                  response.results || [];
        pagination = response.pagination || response.meta || response.paging;
        
        console.log(`📋 Object response: ${pageData.length} items, pagination:`, pagination);
        
        if (pagination) {
          // Try different pagination property names
          hasMoreData = 
            pagination.has_next || 
            pagination.hasNext || 
            pagination.has_more || 
            pagination.hasMore ||
            (pagination.next_page && pagination.next_page !== '') ||
            (pagination.nextPage && pagination.nextPage !== '') ||
            (pagination.current_page && pagination.total_pages && pagination.current_page < pagination.total_pages) ||
            (pagination.page && pagination.pages && pagination.page < pagination.pages) ||
            (pagination.total_size && pagination.page_size && (currentPage * pagination.page_size) < pagination.total_size) ||
            false;
          
          console.log(`🔄 Pagination check: hasMoreData=${hasMoreData}, pagination=`, pagination);
        } else {
          // Fallback: if we got a full page, assume there might be more
          hasMoreData = pageData.length === 100;
          console.log(`🔄 No pagination metadata, fallback check: hasMoreData=${hasMoreData} (got ${pageData.length} items)`);
        }
      }
      
      console.log(`📊 Page ${currentPage}: ${pageData.length} items, hasMoreData: ${hasMoreData}`);
      
      if (pageData.length === 0) {
        console.log(`🛑 No data on page ${currentPage}, stopping pagination`);
        hasMoreData = false;
      } else {
        allData.push(...pageData);
        console.log(`✅ Added ${pageData.length} items, total so far: ${allData.length}`);
      }
      
      currentPage++;
      
      // Small delay to be respectful to the API
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.error(`❌ Error fetching page ${currentPage}:`, error);
      hasMoreData = false;
    }
  }
  
  if (currentPage > maxPages) {
    console.warn(`⚠️ Reached maximum page limit (${maxPages}) for ${path}`);
  }
  
  console.log(`✅ Completed paginated fetch for ${path}: ${allData.length} total items across ${currentPage - 1} pages`);
  return allData;
}

// Individual sync functions
export async function syncSports(): Promise<SyncResult> {
  try {
    console.log('Syncing sports data...');
    const sportsResponse = await fetchAllPaginated('sports', { cache: 'no-store' });
    
    const sports = Array.isArray(sportsResponse) ? sportsResponse : [];
    
    if (!Array.isArray(sports) || sports.length === 0) {
      console.warn('No sports data received from XS2Event API');
      return { status: 'error', error: 'No sports data received', count: 0 };
    }

    const filteredSports = sports.map((sport: any) => ({
      sport_id: sport.sport_id || sport.id,
    }));
    
    const { error } = await supabase
      .from('xs2e_sports')
      .upsert(filteredSports, { onConflict: 'sport_id' });
    
    if (error) throw error;
    
    console.log(`✅ Synced ${filteredSports.length} sports`);
    return { count: filteredSports.length, status: 'success' };

  } catch (error) {
    console.error('❌ Failed to sync sports:', error);
    return { 
      status: 'error', 
      error: String(error),
      count: 0
    };
  }
}

export async function syncTournaments(): Promise<SyncResult> {
  try {
    console.log('Syncing tournaments data...');
    const tournamentsResponse = await fetchAllPaginated('tournaments', { cache: 'no-store' });
    
    const tournaments = Array.isArray(tournamentsResponse) ? tournamentsResponse : [];
    
    if (!Array.isArray(tournaments) || tournaments.length === 0) {
      console.warn('No tournaments data received from XS2Event API');
      return { status: 'error', error: 'No tournaments data received', count: 0 };
    }

    const filteredTournaments = tournaments
      .map((tournament: any) => ({
        tournament_id: tournament.tournament_id || tournament.id,
        official_name: tournament.official_name || tournament.name,
        season: tournament.season || '',
        tournament_type: tournament.tournament_type || tournament.type || '',
        region: tournament.region || '',
        sport_type: tournament.sport_type || tournament.sport_id || '',
        date_start: tournament.date_start || tournament.start_date,
        date_stop: tournament.date_stop || tournament.end_date,
        slug: tournament.slug || null,
        number_events: tournament.number_events || tournament.event_count || null,
        created: tournament.created || null,
        updated: tournament.updated || null
      }))
      .filter(tournament => 
        tournament.tournament_id && 
        tournament.tournament_id !== 'undefined' &&
        tournament.official_name &&
        tournament.season &&
        tournament.tournament_type &&
        tournament.region &&
        tournament.sport_type &&
        tournament.date_start &&
        tournament.date_stop
      );
    
    const { error } = await supabase
      .from('xs2e_tournaments')
      .upsert(filteredTournaments, { onConflict: 'tournament_id' });
    
    if (error) throw error;
    
    console.log(`✅ Synced ${filteredTournaments.length} tournaments`);
    return { count: filteredTournaments.length, status: 'success' };

  } catch (error) {
    console.error('❌ Failed to sync tournaments:', error);
    return { 
      status: 'error', 
      error: String(error),
      details: error instanceof Error ? error.message : 'Unknown error',
      count: 0
    };
  }
}

export async function syncEvents(): Promise<SyncResult> {
  try {
    console.log('Syncing events data...');
    
    
    const eventsPath = `events`;
    const eventsResponse = await fetchAllPaginated(eventsPath, { cache: 'no-store' });
    
    const events = Array.isArray(eventsResponse) ? eventsResponse : [];
    
    if (!Array.isArray(events) || events.length === 0) {
      console.log('ℹ️ No future events found from XS2Event API');
      return { count: 0, status: 'success' };
    }

    console.log(`� Received ${events.length} future events from API`);

    const filteredEvents = events
      .map((event: any) => ({
        // Primary fields (required by DB schema)
        event_id: event.event_id,
        event_name: event.event_name,
        event_name_heb: event.event_name_heb || null,
        date_start: event.date_start,
        date_stop: event.date_stop,
        event_status: event.event_status || event.status || 'unknown',
        tournament_id: event.tournament_id,
        tournament_name: event.tournament_name,
        tournament_name_heb: event.tournament_name_heb || null,
        venue_id: event.venue_id,
        venue_name: event.venue_name,
        venue_name_heb: event.venue_name_heb || null,
        city: event.city || null,
        latitude: event.latitude ? parseFloat(event.latitude) : null,
        longitude: event.longitude ? parseFloat(event.longitude) : null,
        date_confirmed: event.date_confirmed || false,
        hometeam_name: event.hometeam_name || event.home_team_name || null,
        visiting_name: event.visiting_name || event.away_team_name || null,
        created: event.created || null,
        updated: event.updated || null,
        event_description: event.event_description || event.description || null,
        event_description_heb: event.event_description_heb || null,
        min_ticket_price_eur: event.min_ticket_price_eur ? parseFloat(event.min_ticket_price_eur) / 100 : null,
        max_ticket_price_eur: event.max_ticket_price_eur ? parseFloat(event.max_ticket_price_eur) / 100 : null,
        slug: event.slug || null,
        number_of_tickets: event.number_of_tickets ? parseInt(event.number_of_tickets) : null,
        sales_periods: event.sales_periods || null, // Store as JSON
        is_popular: event.is_popular || false,
        
        // Additional fields (commented out in eventSchema but stored in DB)
        location_id: event.location_id || null,
        iso_country: event.iso_country || null,
        sport_type: event.sport_type || null,
        season: event.season || null,
        tournament_type: event.tournament_type || null,
        date_start_main_event: event.date_start_main_event || null,
        date_stop_main_event: event.date_stop_main_event || null,
        hometeam_id: event.hometeam_id || event.home_team_id || null,
        visiting_id: event.visiting_id || event.away_team_id || null
      }))
      .filter(event => {
        // Basic required field validation
        if (!event.event_id || 
            event.event_id === 'undefined' || 
            !event.tournament_id || 
            !event.venue_id ||
            !event.date_start ||
            !event.date_stop ||
            !event.tournament_name ||
            !event.venue_name) {
          console.log(`❌ Skipping invalid event: ${event.event_name || 'Unknown'} - missing required fields`);
          return false;
        }

        return true;
      });

    console.log(`📊 Valid events after filtering: ${filteredEvents.length} out of ${events.length} received`);
    
    if (filteredEvents.length === 0) {
      console.log('ℹ️ No valid future events to sync');
      return { count: 0, status: 'success' };
    }
    
    const { error } = await supabase
      .from('xs2e_events')
      .upsert(filteredEvents, { onConflict: 'event_id' });
    
    if (error) throw error;
    
    console.log(`✅ Synced ${filteredEvents.length} future events`);
    return { count: filteredEvents.length, status: 'success' };

  } catch (error) {
    console.error('❌ Failed to sync events:', error);
    return { 
      status: 'error', 
      error: String(error),
      count: 0
    };
  }
}

// Combined sync function
export async function syncSportsEventsData(types?: string[]): Promise<SyncResults> {
  const results: SyncResults = {};
  const syncTypes = types || ['sports', 'tournaments', 'events'];

  if (syncTypes.includes('sports')) {
    results.sports = await syncSports();
  }

  if (syncTypes.includes('tournaments')) {
    results.tournaments = await syncTournaments();
  }

  if (syncTypes.includes('events')) {
    results.events = await syncEvents();
    
    // Clean up past events after syncing new ones
    try {
      console.log('🧹 Cleaning up past events...');
      //await cleanupPastEvents();
    } catch (error) {
      console.warn('Failed to cleanup past events:', error);
      // Don't fail the entire sync if cleanup fails
    }
  }

  return results;
}

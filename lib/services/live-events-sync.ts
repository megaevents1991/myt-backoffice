// lib/services/live-events-sync.ts
// Server-only sync service — called by cron/API routes. Deliberately NOT a
// Server Action ("use server" removed): exports must not be client-dispatchable.

import { supabase } from '@/lib/supabase-server';
import { LiveEvent, LiveCategory, LivePerformer, LiveVenue, CategoryClassification, RawLiveCategory, RawLivePerformer, RawLiveCity } from '@/types/live-events.types';

// LIVE API configuration
const LIVE_API_BASE_URL = process.env.NEXT_SECRET_LIVE_API_URL || "https://api.doctorticket.com/api";
const LIVE_API_KEY = process.env.NEXT_SECRET_LIVE_API_KEY;

// Types for sync results
export interface LiveSyncResult {
  count: number;
  status: 'success' | 'error';
  error?: string;
  details?: string;
}

export interface LiveSyncResults {
  events?: LiveSyncResult;
  categories?: LiveSyncResult;
  performers?: LiveSyncResult;
  venues?: LiveSyncResult;
  cities?: LiveSyncResult;
}

// LIVE API request helper
async function fetchLive<T = unknown>(endpoint: string): Promise<T> {
  if (!LIVE_API_KEY) {
    throw new Error('LIVE_API_KEY environment variable is not set');
  }

  const url = `${LIVE_API_BASE_URL}/${endpoint}`;
  console.log(`🔗 Fetching from LIVE API: ${url}`);

  const TIMEOUT_MS = 30000; // 30 seconds
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': LIVE_API_KEY,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      },
      cache: 'no-store',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`LIVE API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully fetched from LIVE API: ${url}`);
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`⏱️ LIVE API timeout after ${TIMEOUT_MS}ms (${endpoint})`);
      throw new Error(`Request timeout - LIVE API did not respond within ${TIMEOUT_MS}ms`);
    }
    
    console.error(`❌ Failed to fetch from LIVE API (${endpoint}):`, error);
    throw error;
  }
}

// --- Normalization helpers ---
function normalizeIata(raw: string | null | undefined): string {
  // Trim, uppercase, keep up to 3 alphanumeric chars (airport codes) – fallback empty string
  if (!raw) return '';
  const trimmed = raw.trim().toUpperCase();
  // Some API responses (example: "FR        ") are country codes padded with spaces.
  // Keep first 3 valid A-Z letters.
  const match = trimmed.match(/[A-Z]{1,3}/);
  return match ? match[0] : '';
}

function safeStr(v: string | null | undefined): string {
  return (v || '').trim();
}

// Category classification logic
function classifyEvent(event: LiveEvent): CategoryClassification {
  const sportsKeywords = ['sports', 'football', 'tennis', 'basketball', 'soccer', 'baseball', 'hockey', 'golf', 'racing', 'boxing', 'mma'];
  const musicKeywords = ['music', 'concert', 'festival', 'band', 'singer', 'orchestra', 'opera', 'jazz', 'rock', 'pop'];

  // Check categories for sports/music indicators
  const allCategories = [
    ...event.category1,
    ...event.category2,
    ...event.category3
  ];

  const categoryText = allCategories
    .map(cat => `${cat.name} ${cat.hebName}`.toLowerCase())
    .join(' ');

  const eventText = `${event.eventName} ${event.eventHebName}`.toLowerCase();
  const performerText = event.performers
    .map(p => `${p.name} ${p.hebName}`.toLowerCase())
    .join(' ');

  const fullText = `${categoryText} ${eventText} ${performerText}`;

  const isSports = sportsKeywords.some(keyword => fullText.includes(keyword));
  const isMusic = musicKeywords.some(keyword => fullText.includes(keyword));

  // Determine primary category
  let primaryCategory = 'other';
  if (event.category1.length > 0) {
    primaryCategory = event.category1[0].name;
  }

  return {
    isSports,
    isMusic,
    primaryCategory,
    subcategories: allCategories.map(cat => cat.name)
  };
}

// Determine event type based on classification
function determineEventType(classification: CategoryClassification): 'sports_live_event_dynamic' | 'music_live_event_dynamic' | null {
  if (classification.isSports && !classification.isMusic) {
    return 'sports_live_event_dynamic';
  }
  if (classification.isMusic && !classification.isSports) {
    return 'music_live_event_dynamic';
  }
  if (classification.isSports && classification.isMusic) {
    // If both, prefer sports (or could be configurable)
    return 'sports_live_event_dynamic';
  }
  
  // If neither clearly sports nor music, skip for now
  return null;
}

// Sync functions
export async function syncLiveEvents(): Promise<LiveSyncResult> {
  try {
    console.log('🎭 Syncing LIVE events...');
    
    const events = await fetchLive<LiveEvent[]>('Events/GetAllEvents');
    
    if (!Array.isArray(events)) {
      throw new Error('Invalid response format from LIVE API');
    }

    console.log(`📅 Processing ${events.length} events from LIVE API`);

    // Filter and process events
    const processedEvents = events
      .map(event => {
        const classification = classifyEvent(event);
        const eventType = determineEventType(classification);
        
        if (!eventType) {
          return null; // Skip events that don't fit our categories
        }

        // Only process future events
        const eventDate = new Date(event.showDate);
        const now = new Date();
        if (eventDate <= now) {
          return null;
        }

        return {
          event_id: event.id,
          event_name: safeStr(event.eventName),
          event_name_heb: safeStr(event.eventHebName) || null, // keep nullable for Hebrew if entirely missing
          show_date: event.showDate,
          is_show_date_finale: event.isShowDateFinale,
          show_date_remarks: safeStr(event.showDateRemarks) || null,
          street_address: safeStr(event.streetAddress),
          street_address_heb: safeStr(event.streetAddressHeb) || null,
          city_id: event.cityId,
          city_name: safeStr(event.cityName),
          country_id: event.countryID,
          country_name: safeStr(event.countryName),
          iata: normalizeIata(event.iata),
          passport_required: event.passportRequired,
          venue_map_url: safeStr(event.venueMapWithBase) || null,
            venue_map_heb_url: safeStr(event.venueHebMapWithBase) || null,
          currency: event.currency,
          stop_selling_margin: event.stopSaleingMargin,
          event_type: eventType,
          primary_category: classification.primaryCategory,
          categories: {
            category1: event.category1,
            category2: event.category2,
            category3: event.category3
          },
          performers: event.performers,
          venues: event.venue,
          ticket_categories: event.ticketCategory,
          is_active: true,
          last_synced: new Date().toISOString()
        };
      })
      .filter((event): event is NonNullable<typeof event> => event !== null); // Remove null entries with type guard

    console.log(`✅ Processed ${processedEvents.length} valid events`);

    // Upsert to database in controllable batches to avoid large payloads / timeouts
    if (processedEvents.length > 0) {
      const BATCH_SIZE = 500; // Safe batch size for Supabase/Postgres; adjust if needed

      const chunk = <T,>(arr: T[], size: number): T[][] => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      const batches = chunk(processedEvents, BATCH_SIZE);
      console.log(`🗃️ Upserting ${processedEvents.length} events in ${batches.length} batches (size <= ${BATCH_SIZE}).`);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const { error } = await supabase
          .from('live_events')
          .upsert(batch, {
            onConflict: 'event_id',
            ignoreDuplicates: false,
          });
        if (error) {
          throw new Error(`Batch ${i + 1}/${batches.length} upsert failed: ${error.message}`);
        }
        console.log(`✅ Batch ${i + 1}/${batches.length} (${batch.length} events) upserted.`);
      }
    }

    console.log(`🎭 Successfully synced ${processedEvents.length} LIVE events`);
    return { count: processedEvents.length, status: 'success', details: 'Batched upsert completed' };

  } catch (error) {
    console.error('❌ Failed to sync LIVE events:', error);
    return {
      status: 'error',
      error: String(error),
      count: 0
    };
  }
}

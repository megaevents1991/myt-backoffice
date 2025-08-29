// lib/services/live-events-sync.ts
"use server"

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

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': LIVE_API_KEY,
        'Content-Type': 'application/json'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`LIVE API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Successfully fetched from LIVE API: ${url}`);
    return data;
  } catch (error) {
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
function determineEventType(classification: CategoryClassification): 'sports_event_dynamic' | 'music_event_dynamic' | null {
  if (classification.isSports && !classification.isMusic) {
    return 'sports_event_dynamic';
  }
  if (classification.isMusic && !classification.isSports) {
    return 'music_event_dynamic';
  }
  if (classification.isSports && classification.isMusic) {
    // If both, prefer sports (or could be configurable)
    return 'sports_event_dynamic';
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

    // Upsert to database
    if (processedEvents.length > 0) {
      const { error } = await supabase
        .from('live_events')
        .upsert(processedEvents, { 
          onConflict: 'event_id',
          ignoreDuplicates: false 
        });

      if (error) {
        throw new Error(`Database upsert failed: ${error.message}`);
      }
    }

    console.log(`🎭 Successfully synced ${processedEvents.length} LIVE events`);
    return { count: processedEvents.length, status: 'success' };

  } catch (error) {
    console.error('❌ Failed to sync LIVE events:', error);
    return {
      status: 'error',
      error: String(error),
      count: 0
    };
  }
}

export async function syncLiveCategories(): Promise<LiveSyncResult> {
  try {
    console.log('📂 Syncing LIVE categories...');
    const raw = await fetchLive<RawLiveCategory[]>('Categories/GetAllCategories');
    if (!Array.isArray(raw)) throw new Error('Invalid categories response format');
    const categoryMap = new Map<number, {
      category_id: number;
      category_name: string;
      category_name_heb: string | null;
      category_level: number;
      is_sports_related: boolean;
      is_music_related: boolean;
    }>();

    raw.forEach(r => {
      const id = r.id;
      if (categoryMap.has(id)) return; // keep first occurrence
      const nameBase = r.categoryTNName || r.categoryDTName || r.categoryHebName || `CAT_${id}`;
      if (!nameBase) return;
      categoryMap.set(id, {
        category_id: id,
        category_name: nameBase,
        category_name_heb: r.categoryHebName || null,
        category_level: 1,
        is_sports_related: (r.categoryTNName || r.categoryDTName || '').toLowerCase().includes('sport'),
        is_music_related: (r.categoryTNName || r.categoryDTName || '').toLowerCase().includes('music')
      });
    });
    const processedCategories = Array.from(categoryMap.values());
    console.log(`📂 Mapped ${processedCategories.length} unique categories (raw: ${raw.length})`);

    if (processedCategories.length > 0) {
      const { error } = await supabase
        .from('live_categories')
        .upsert(processedCategories, { onConflict: 'category_id' });

      if (error) {
        throw new Error(`Categories sync failed: ${error.message}`);
      }
    }

    console.log(`✅ Synced ${processedCategories.length} categories`);
    return { count: processedCategories.length, status: 'success' };

  } catch (error) {
    console.error('❌ Failed to sync categories:', error);
    return {
      status: 'error',
      error: String(error),
      count: 0
    };
  }
}

export async function syncLivePerformers(): Promise<LiveSyncResult> {
  try {
    console.log('🎤 Syncing LIVE performers...');
    const raw = await fetchLive<RawLivePerformer[]>('Performers/GetAllPerformers');
    if (!Array.isArray(raw)) throw new Error('Invalid performers response format');
    const perfMap = new Map<number, {
      performer_id: number;
      performer_name: string;
      performer_name_heb: string | null;
      is_dt_performer: boolean;
      performer_classification_id: number | null;
    }>();
    raw.forEach(p => {
      if (perfMap.has(p.id)) return;
      if (!p.performerName) return;
      perfMap.set(p.id, {
        performer_id: p.id,
        performer_name: p.performerName,
        performer_name_heb: p.performerHebName || null,
        is_dt_performer: p.isDtPerformer,
        performer_classification_id: p.performerClassificationId || null
      });
    });
    const processedPerformers = Array.from(perfMap.values());
    console.log(`🎤 Mapped ${processedPerformers.length} unique performers (raw: ${raw.length})`);

    if (processedPerformers.length > 0) {
      const { error } = await supabase
        .from('live_performers')
        .upsert(processedPerformers, { onConflict: 'performer_id' });

      if (error) {
        throw new Error(`Performers sync failed: ${error.message}`);
      }
    }

    console.log(`✅ Synced ${processedPerformers.length} performers`);
    return { count: processedPerformers.length, status: 'success' };

  } catch (error) {
    console.error('❌ Failed to sync performers:', error);
    return {
      status: 'error',
      error: String(error),
      count: 0
    };
  }
}

export async function syncLiveVenues(): Promise<LiveSyncResult> {
  try {
    console.log('🏟️ Syncing LIVE venues...');
    
    const venues = await fetchLive<LiveVenue[]>('Venues/GetAllVenues');
    
    if (!Array.isArray(venues)) {
      throw new Error('Invalid venues response format');
    }

    // Remove duplicates by venue_id and filter out null/empty names
    const uniqueVenues = venues
      .filter(venue => venue.name && venue.name.trim()) // Filter out null/empty names
      .reduce((acc, venue) => {
        if (!acc.some(v => v.id === venue.id)) {
          acc.push(venue);
        }
        return acc;
      }, [] as LiveVenue[]);

    const processedVenues = uniqueVenues.map(venue => ({
      venue_id: venue.id,
      venue_name: venue.name,
      venue_name_heb: venue.hebName || null,
      is_dt_venue: venue.isDtVenue
    }));

    console.log(`🏟️ Filtered ${processedVenues.length} unique venues from ${venues.length} total`);

    if (processedVenues.length > 0) {
      const { error } = await supabase
        .from('live_venues')
        .upsert(processedVenues, { onConflict: 'venue_id' });

      if (error) {
        throw new Error(`Venues sync failed: ${error.message}`);
      }
    }

    console.log(`✅ Synced ${processedVenues.length} venues`);
    return { count: processedVenues.length, status: 'success' };

  } catch (error) {
    console.error('❌ Failed to sync venues:', error);
    return {
      status: 'error',
      error: String(error),
      count: 0
    };
  }
}

export async function syncLiveCities(): Promise<LiveSyncResult> {
  try {
    console.log('🌆 Syncing LIVE cities...');
    const raw = await fetchLive<RawLiveCity[]>('Cities/GetAllCities');
    if (!Array.isArray(raw)) throw new Error('Invalid cities response format');
    const fullRecords = raw
      .map(c => ({
        city_id: c.id,
        city_name: safeStr(c.cityName),
        eng_full_name: safeStr(c.engFullName), // empty string if originally null
        heb_full_name: safeStr(c.hebFullName),
        iata: normalizeIata(c.iata)
      }))
      .filter(c => c.city_name); // city_name already trimmed / empty-string guarded

    let attempt = 1;
    let finalCount = 0;
    let lastError: any = null;

    const minimalRecords = fullRecords.map(c => ({
      city_id: c.city_id,
      city_name: c.city_name,
      iata: c.iata
    }));

    for (const variant of [fullRecords, minimalRecords]) {
      if (variant.length === 0) break;
      const { error } = await supabase
        .from('live_cities')
        .upsert(variant, { onConflict: 'city_id' });
      if (!error) {
        finalCount = variant.length;
        if (attempt === 2) {
          console.log('🌆 City sync used minimal column set fallback (schema lacks eng_full_name / heb_full_name).');
        }
        break;
      } else {
        lastError = error;
        // Only retry once with minimal variant if first attempt failed due to missing columns
        if (attempt === 1 && /eng_full_name|heb_full_name/i.test(error.message)) {
          attempt++;
          continue;
        } else {
          throw new Error(`Cities sync failed: ${error.message}`);
        }
      }
    }

    console.log(`✅ Synced ${finalCount} cities`);
    return { count: finalCount, status: 'success' };
  } catch (error) {
    console.error('❌ Failed to sync cities:', error);
    return { status: 'error', error: String(error), count: 0 };
  }
}

// Combined sync function
export async function syncLiveEventsData(types?: string[]): Promise<LiveSyncResults> {
  const results: LiveSyncResults = {};
  const syncTypes = types || ['categories', 'performers', 'cities', 'venues', 'events'];

  console.log(`🚀 Starting LIVE API sync for: ${syncTypes.join(', ')}`);

  if (syncTypes.includes('categories')) {
    results.categories = await syncLiveCategories();
  }

  if (syncTypes.includes('performers')) {
    results.performers = await syncLivePerformers();
  }

  if (syncTypes.includes('cities')) {
    results.cities = await syncLiveCities();
  }

  if (syncTypes.includes('venues')) {
    results.venues = await syncLiveVenues();
  }

  if (syncTypes.includes('events')) {
    results.events = await syncLiveEvents();
  }

  console.log('🏁 LIVE API sync completed', results);
  return results;
}

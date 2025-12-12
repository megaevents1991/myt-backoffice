import { supabase } from '@/lib/supabase-server';
import { TixStockEvent, TixStockFeedResponse, TixStockEventDB } from '@/types/tixstock.types';

const TIXSTOCK_API_URL = process.env.NEXT_SECRET_TIXSTOCK_API_URL || 'https://sandbox-pf.tixstock.com/v1';
const TIXSTOCK_TOKEN = process.env.NEXT_SECRET_TIXSTOCK_TOKEN;

export interface TixStockSyncResult {
  count: number;
  status: 'success' | 'error';
  error?: string;
}

async function fetchTixStockPage(page: number): Promise<TixStockFeedResponse> {
  if (!TIXSTOCK_TOKEN) {
    throw new Error('TixStock API token is missing');
  }

  const url = `${TIXSTOCK_API_URL}/feed?page=${page}&include_listings=false`;
  console.log(`Fetching TixStock feed page ${page}...`);

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TIXSTOCK_TOKEN}`,
      'Accept': 'application/json'
    },
    cache: 'no-store'
  });

  if (!res.ok) {
    throw new Error(`TixStock API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

function mapEventToDB(event: TixStockEvent): TixStockEventDB {
  return {
    event_id: event.id,
    event_name: event.name,
    show_date: event.datetime,
    event_status: event.status,
    venue_name: event.venue?.name || 'Unknown Venue',
    city_name: event.venue?.city || 'Unknown City',
    country_code: event.venue?.country_code || '',
    venue_data: event.venue,
    category_name: event.category?.name || 'Other',
    sub_categories: event.category,
    performers: event.performers || [],
    venue_map_url: event.map_url,
    last_synced: new Date().toISOString(),
    is_active: event.status === 'Active'
  };
}

export async function syncTixStockEvents(): Promise<TixStockSyncResult> {
  try {
    let currentPage = 1;
    let lastPage = 1;
    let totalSynced = 0;

    console.log('Starting TixStock sync...');

    do {
      const response = await fetchTixStockPage(currentPage);
      const events = response.data || [];
      
      if (events.length === 0) break;

      const dbEvents = events.map(mapEventToDB);

      const { error } = await supabase
        .from('tixstock_events')
        .upsert(dbEvents as any, { onConflict: 'event_id' });

      if (error) {
        console.error('Error upserting TixStock events:', error);
        throw error;
      }

      totalSynced += dbEvents.length;
      lastPage = response.meta.last_page;
      currentPage++;

      // Safety break for sandbox/testing to avoid infinite loops if meta is wrong
      if (currentPage > 100) {
        console.warn('Safety break: Reached 100 pages limit');
        break;
      }

    } while (currentPage <= lastPage);

    console.log(`TixStock sync completed. Total events: ${totalSynced}`);
    return { count: totalSynced, status: 'success' };

  } catch (error: any) {
    console.error('TixStock sync failed:', error);
    return { count: 0, status: 'error', error: error.message };
  }
}

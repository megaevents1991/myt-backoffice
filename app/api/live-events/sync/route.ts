// app/api/live-events/sync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { syncLiveEvents } from '@/lib/services/live-events-sync';
import { guardAdminRoute } from '@/lib/auth/guards';
import { logAudit } from '@/lib/audit';

/**
 * Sync API endpoint to cache LIVE events data from the LIVE API to Supabase.
 *
 * Usage: POST /api/live-events/sync
 *
 * Only events are currently synced.
 */
export async function POST(request: NextRequest) {
  const denied = await guardAdminRoute();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);

    // Use the shared sync service
    const results = await syncLiveEvents();
    await logAudit({ action: "sync_triggered", entityType: "live" });

    return NextResponse.json({
      success: true,
      message: 'LIVE events sync completed',
      timestamp: new Date().toISOString(),
      results
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

  } catch (error) {
    console.error('❌ LIVE events sync operation failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'LIVE events sync operation failed',
        details: String(error),
        timestamp: new Date().toISOString()
      },
      { 
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    );
  }
}

/**
 * GET endpoint to check sync status and last update times
 */
export async function GET() {
  try {
    const { supabase } = await import('@/lib/supabase-server');
    const results: Record<string, any> = {};

    // Check events table
    const eventsCount = await supabase
      .from('live_events')
      .select('event_id', { count: 'exact', head: true });
    
    const sportsEventsCount = await supabase
      .from('live_events')
      .select('event_id', { count: 'exact', head: true })
      .eq('event_type', 'sports_live_event_dynamic');
    
    const musicEventsCount = await supabase
      .from('live_events')
      .select('event_id', { count: 'exact', head: true })
      .eq('event_type', 'music_live_event_dynamic');

    results.events = { 
      total: eventsCount.count,
      sports: sportsEventsCount.count,
      music: musicEventsCount.count
    };

    // Check categories table
    const categoriesCount = await supabase
      .from('live_categories')
      .select('category_id', { count: 'exact', head: true });
    results.categories = { count: categoriesCount.count };

    // Check performers table
    const performersCount = await supabase
      .from('live_performers')
      .select('performer_id', { count: 'exact', head: true });
    results.performers = { count: performersCount.count };

    // Check venues table
    const venuesCount = await supabase
      .from('live_venues')
      .select('venue_id', { count: 'exact', head: true });
    results.venues = { count: venuesCount.count };

    // Check cities table
    const citiesCount = await supabase
      .from('live_cities')
      .select('city_id', { count: 'exact', head: true });
    results.cities = { count: citiesCount.count };

    return NextResponse.json({
      success: true,
      message: 'LIVE events sync status retrieved',
      timestamp: new Date().toISOString(),
      results
    }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

  } catch (error) {
    console.error('❌ Failed to get LIVE events sync status:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get LIVE events sync status',
        details: String(error)
      },
      { 
        status: 500,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    );
  }
}

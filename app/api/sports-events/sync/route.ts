// app/api/sports-events/sync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { syncSportsEventsData } from '@/lib/services/sports-events-sync';

/**
 * Sync API endpoint to cache master data from XS2Event to Supabase
 * This should be called periodically (hourly/daily) to keep cached data fresh
 * 
 * Usage: POST /api/sports-events/sync
 * 
 * Can also be called with specific data types:
 * POST /api/sports-events/sync?type=sports
 * POST /api/sports-events/sync?type=tournaments  
 * POST /api/sports-events/sync?type=events
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const syncType = searchParams.get('type');

    // Determine which types to sync
    const typesToSync = syncType ? [syncType] : ['sports', 'tournaments', 'events'];

    // Use the shared sync service
    const results = await syncSportsEventsData(typesToSync);

    return NextResponse.json({
      success: true,
      message: 'Sync completed',
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
    console.error('❌ Sync operation failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Sync operation failed',
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

    // Check sports table
    const sportsCount = await supabase
      .from('xs2e_sports')
      .select('sport_id', { count: 'exact', head: true });
    results.sports = { count: sportsCount.count };

    // Check tournaments table
    const tournamentsCount = await supabase
      .from('xs2e_tournaments')
      .select('tournament_id', { count: 'exact', head: true });
    results.tournaments = { count: tournamentsCount.count };

    // Check events table
    const eventsCount = await supabase
      .from('xs2e_events')
      .select('event_id', { count: 'exact', head: true });
    results.events = { count: eventsCount.count };

    return NextResponse.json({
      success: true,
      message: 'Sync status retrieved',
      timestamp: new Date().toISOString(),
      results
    });

  } catch (error) {
    console.error('❌ Failed to get sync status:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get sync status',
        details: String(error)
      },
      { status: 500 }
    );
  }
}

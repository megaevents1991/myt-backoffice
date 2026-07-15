// app/api/p1-events/sync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { syncP1Events } from '@/lib/services/p1-events-sync';
import { guardAdminRoute } from '@/lib/auth/guards';
import { logAudit } from '@/lib/audit';

/**
 * Sync API endpoint to cache P1 events data from XML feeds to Supabase.
 *
 * Usage: POST /api/p1-events/sync
 */
export async function POST(request: NextRequest) {
  const denied = await guardAdminRoute();
  if (denied) return denied;
  try {
    // Use the shared sync service
    const results = await syncP1Events();
    await logAudit({ action: "sync_triggered", entityType: "p1" });

    return NextResponse.json({
      success: true,
      message: 'P1 events sync completed',
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
    console.error('❌ P1 events sync operation failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'P1 events sync operation failed',
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
      .from('p1_events')
      .select('event_id', { count: 'exact', head: true });

    results.events = { 
      total: eventsCount.count,
    };

    // Get last sync time
    const { data: lastEvent } = await supabase
      .from('p1_events')
      .select('last_synced')
      .order('last_synced', { ascending: false })
      .limit(1)
      .single();

    results.last_synced = lastEvent?.last_synced || null;

    // Category breakdown
    const { data: categories } = await supabase
      .from('p1_events')
      .select('category')
      .eq('is_active', true);

    if (categories) {
      const categoryCounts: Record<string, number> = {};
      categories.forEach((row: any) => {
        const cat = row.category || 'OTHER';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      });
      results.categories = categoryCounts;
    }

    return NextResponse.json({
      success: true,
      results,
      timestamp: new Date().toISOString()
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

  } catch (error) {
    console.error('❌ Failed to get P1 sync status:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get sync status',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

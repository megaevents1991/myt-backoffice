// app/api/cron/dailyLiveEventsSync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { syncLiveEvents } from '@/lib/services/live-events-sync';
import { guardCronRoute } from '@/lib/auth/guards';

/**
 * Cron job to sync live events data daily (at 00:30 every day)
 * This endpoint should be called by Vercel cron job
 * Security: Vercel CRON_SECRET (Authorization: Bearer) with legacy ?key fallback
 */
export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  try {
  console.log('🎭 Daily live events sync cron job started (direct function call)');

  // Directly invoke the sync function (avoids internal HTTP hop)
  const syncResult = await syncLiveEvents();

  console.log('✅ Daily live events sync completed (direct):', syncResult);

    return NextResponse.json({
      success: true,
      message: 'Daily live events sync completed successfully',
      timestamp: new Date().toISOString(),
      syncResult
    }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

  } catch (error) {
    console.error('❌ Daily live events sync failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Daily live events sync failed',
        details: String(error),
        timestamp: new Date().toISOString()
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

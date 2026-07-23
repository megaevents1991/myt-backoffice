// app/api/cron/dailyEventsSync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { syncEvents } from '@/lib/services/sports-events-sync';
import { guardCronRoute } from '@/lib/auth/guards';

// Sync walks up to ~100 provider pages sequentially — the 60s cron-glob cap
// in vercel.json killed runs mid-way. Must match the vercel.json entry.
export const maxDuration = 300;

/**
 * Cron job to sync events data daily (at 00:01 every day)
 * This endpoint should be called by Vercel cron job
 * Security: Vercel CRON_SECRET (Authorization: Bearer) with legacy ?key fallback
 */
export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  try {
    console.log('🌅 Daily events sync cron job started');

    // Use the shared sync service directly
    const syncResult = await syncEvents();

    console.log('✅ Daily events sync completed:', syncResult);

    return NextResponse.json({
      success: true,
      message: 'Daily events sync completed successfully',
      timestamp: new Date().toISOString(),
      syncResult
    });

  } catch (error) {
    console.error('❌ Daily events sync failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Daily events sync failed',
        details: String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

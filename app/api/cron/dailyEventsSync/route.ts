// app/api/cron/dailyEventsSync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { syncEvents } from '@/lib/services/sports-events-sync';

/**
 * Cron job to sync events data daily (at 00:01 every day)
 * This endpoint should be called by Vercel cron job
 * Security: Uses a secret key to prevent unauthorized access
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    // Security check - prevent unauthorized access
    if (!key || key !== process.env.CRON_SECRET_KEY) {
      console.error('❌ Unauthorized cron job access attempt');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

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

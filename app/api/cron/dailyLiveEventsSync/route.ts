// app/api/cron/dailyLiveEventsSync/route.ts

import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron job to sync live events data daily (at 00:30 every day)
 * This endpoint should be called by Vercel cron job
 * Security: Uses a secret key to prevent unauthorized access
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    // Security check - prevent unauthorized access
    if (!key || key !== process.env.NEXT_SECRET_CRON_SECRET_KEY) {
      console.error('❌ Unauthorized live events cron job access attempt');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('🎭 Daily live events sync cron job started');

    // Call the live events sync API endpoint directly
    const syncResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/live-events/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!syncResponse.ok) {
      throw new Error(`Live events sync API returned ${syncResponse.status}: ${syncResponse.statusText}`);
    }

    const syncResult = await syncResponse.json();

    console.log('✅ Daily live events sync completed:', syncResult);

    return NextResponse.json({
      success: true,
      message: 'Daily live events sync completed successfully',
      timestamp: new Date().toISOString(),
      syncResult
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
      { status: 500 }
    );
  }
}

// app/api/cron/monthlyTournamentsSync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { syncTournaments } from '@/lib/services/sports-events-sync';

/**
 * Cron job to sync tournaments data monthly (every 1st of the month)
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

    console.log('🗓️ Monthly tournaments sync cron job started');

    // Use the shared sync service directly
    const syncResult = await syncTournaments();

    console.log('✅ Monthly tournaments sync completed:', syncResult);

    return NextResponse.json({
      success: true,
      message: 'Monthly tournaments sync completed successfully',
      timestamp: new Date().toISOString(),
      syncResult
    });

  } catch (error) {
    console.error('❌ Monthly tournaments sync failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Monthly tournaments sync failed',
        details: String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

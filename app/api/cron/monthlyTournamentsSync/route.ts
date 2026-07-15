// app/api/cron/monthlyTournamentsSync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { syncTournaments } from '@/lib/services/sports-events-sync';
import { guardCronRoute } from '@/lib/auth/guards';

/**
 * Cron job to sync tournaments data monthly (every 1st of the month)
 * This endpoint should be called by Vercel cron job
 * Security: Vercel CRON_SECRET (Authorization: Bearer) with legacy ?key fallback
 */
export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  try {
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

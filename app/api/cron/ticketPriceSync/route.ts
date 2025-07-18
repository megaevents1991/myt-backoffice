// app/api/cron/ticketPriceSync/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { ticketPriceSyncService } from '@/lib/services/ticket-price-sync';

export const maxDuration = 300; // Maximum duration in seconds for the cron job

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    // Security check - prevent unauthorized access
    if (!key || key !== process.env.NEXT_SECRET_CRON_SECRET_KEY) {
      console.error('❌ Unauthorized ticket price sync cron job access attempt');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('🎫 Ticket price sync cron job started');

    // Run the ticket price synchronization
    const syncResult = await ticketPriceSyncService.syncAllTicketPrices();

    // Calculate sync duration
    const durationMs = syncResult.endTime.getTime() - syncResult.startTime.getTime();
    const durationMinutes = Math.round(durationMs / 60000 * 100) / 100; // Round to 2 decimal places

    // Determine if sync was successful overall
    const isSuccessful = syncResult.failedUpdates === 0 || 
                        (syncResult.successfulUpdates > 0 && syncResult.failedUpdates < syncResult.successfulUpdates);

    console.log(`✅ Ticket price sync completed successfully`);
    console.log(`📊 Results: ${syncResult.successfulUpdates}/${syncResult.totalTickets} tickets updated`);
    
    if (syncResult.errors.length > 0) {
      console.warn(`⚠️ ${syncResult.errors.length} errors occurred during sync`);
      syncResult.errors.forEach(error => console.warn(`   - ${error}`));
    }

    const responseData = {
      success: isSuccessful,
      message: `Ticket price sync completed${isSuccessful ? ' successfully' : ' with errors'}`,
      timestamp: new Date().toISOString(),
      duration: `${durationMinutes} minutes`,
      summary: {
        eventsProcessed: syncResult.eventsProcessed,
        totalTickets: syncResult.totalTickets,
        successfulUpdates: syncResult.successfulUpdates,
        failedUpdates: syncResult.failedUpdates,
        errorCount: syncResult.errors.length
      },
      ...(syncResult.errors.length > 0 && { 
        errors: syncResult.errors.slice(0, 10) // Limit errors in response to prevent large payloads
      })
    };

    return NextResponse.json(responseData, {
      status: isSuccessful ? 200 : 207 // 207 Multi-Status for partial success
    });

  } catch (error) {
    console.error('❌ Ticket price sync cron job failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      {
        success: false,
        error: 'Ticket price sync failed',
        message: errorMessage,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * Optional POST endpoint for manual triggering (development/testing)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Simple authentication for manual triggers
    if (!body.key || body.key !== process.env.NEXT_SECRET_CRON_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('🔧 Manual ticket price sync triggered');

    const syncResult = await ticketPriceSyncService.syncAllTicketPrices();
    
    return NextResponse.json({
      success: true,
      message: 'Manual ticket price sync completed',
      timestamp: new Date().toISOString(),
      result: syncResult
    });

  } catch (error) {
    console.error('❌ Manual ticket price sync failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Manual ticket price sync failed',
        details: String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

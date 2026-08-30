// app/api/cron/nightlyTixstockPriceSync/route.ts

import { NextRequest, NextResponse } from "next/server";
import { syncTixStockPrices } from "@/lib/services/tixstock-price-sync";
import { guardCronRoute } from "@/lib/auth/guards";

/**
 * Cron job to sync TixStock ticket prices for all tx_events (at 03:00 every day)
 * Runs after nightlyTixstockSync (02:00) to ensure events are up to date first.
 * Security: Vercel CRON_SECRET (Authorization: Bearer) with legacy ?key fallback
 */
export const maxDuration = 800;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  try {
    console.log("💰 Nightly TixStock price sync cron job started");

    // Budget under the 800s maxDuration so the run always finishes and
    // reports; leftovers (syncResult.remaining) drain on the next schedule.
    // Serial processing outgrew the ceiling at ~500 tx_events (2026-08-30).
    const syncResult = await syncTixStockPrices({
      timeBudgetMs: 700_000,
      concurrency: 4,
    });

    console.log("✅ Nightly TixStock price sync completed:", syncResult);

    const hasErrors = syncResult.errors.length > 0;

    return NextResponse.json(
      {
        success: !hasErrors || syncResult.ticketsUpdated > 0,
        message: "Nightly TixStock price sync completed",
        timestamp: new Date().toISOString(),
        syncResult,
      },
      { status: hasErrors && syncResult.eventsProcessed === 0 ? 500 : 200 },
    );
  } catch (error) {
    console.error("❌ Nightly TixStock price sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

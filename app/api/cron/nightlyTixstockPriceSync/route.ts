// app/api/cron/nightlyTixstockPriceSync/route.ts

import { NextRequest, NextResponse } from "next/server";
import { syncTixStockPrices } from "@/lib/services/tixstock-price-sync";

/**
 * Cron job to sync TixStock ticket prices for all tx_events (at 03:00 every day)
 * Runs after nightlyTixstockSync (02:00) to ensure events are up to date first.
 * Security: Uses a secret key to prevent unauthorized access
 */
export const maxDuration = 800;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (!key || key !== process.env.NEXT_SECRET_CRON_SECRET_KEY) {
      console.error("❌ Unauthorized cron job access attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("💰 Nightly TixStock price sync cron job started");

    const syncResult = await syncTixStockPrices();

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

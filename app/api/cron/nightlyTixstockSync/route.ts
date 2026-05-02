// app/api/cron/nightlyTixstockSync/route.ts

import { NextRequest, NextResponse } from "next/server";
import { syncTixStockEvents } from "@/lib/services/tixstock-sync";

/**
 * Cron job to sync TixStock events nightly (at 02:00 every day)
 * Security: Uses a secret key to prevent unauthorized access
 */
export const maxDuration = 800;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    // Security check - prevent unauthorized access
    if (!key || key !== process.env.NEXT_SECRET_CRON_SECRET_KEY) {
      console.error("❌ Unauthorized cron job access attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("🌙 Nightly TixStock sync cron job started");

    const syncResult = await syncTixStockEvents();

    console.log("✅ Nightly TixStock sync completed:", syncResult);

    return NextResponse.json({
      success: true,
      message: "Nightly TixStock sync completed successfully",
      timestamp: new Date().toISOString(),
      syncResult,
    });
  } catch (error) {
    console.error("❌ Nightly TixStock sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

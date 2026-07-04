// app/api/cron/nightlyTixstockSync/route.ts

import { NextRequest, NextResponse } from "next/server";
import { syncTixStockEvents } from "@/lib/services/tixstock-sync";
import { guardCronRoute } from "@/lib/auth/guards";

/**
 * Cron job to sync TixStock events nightly (at 02:00 every day)
 * Security: Vercel CRON_SECRET (Authorization: Bearer) with legacy ?key fallback
 */
export const maxDuration = 800;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  try {
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

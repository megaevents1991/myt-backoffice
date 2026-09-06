import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runBasePriceSync } from "@/lib/services/base-price-sync";

// Nightly at 01:30 UTC (vercel.json). Manual trigger with the legacy
// ?key= fallback; add &dry_run=1 to compute the full report with ZERO
// writes - the safe way to test from a preview deploy against prod data.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runBasePriceSync({ dryRun, budgetMs: 270_000 });
    console.log(
      `[base-price-sync] scanned=${summary.scanned} applied=${summary.applied.length} review=${summary.needsReview.length} errors=${summary.errors.length} remaining=${summary.remaining}${dryRun ? " (dry-run)" : ""}`,
    );
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[base-price-sync] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "sync failed" }, { status: 500 });
  }
}

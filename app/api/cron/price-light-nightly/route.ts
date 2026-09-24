import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runPriceLightNightly } from "@/lib/services/price-light-nightly";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";

// 00:15 UTC nightly (vercel.json), before base-price-sync at 01:30. ?dry_run=1 = zero writes.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    // 240s of a 300s function: the budget is checked only before an event STARTS, and the last
    // MATCH_CONCURRENCY (3) started can still run two scopes of parallel 12s AI calls before
    // revalidation and the summary email. Events now run in parallel (2026-09-24), so the same
    // window covers several times the events; raising maxDuration is not needed for that.
    const summary = await runPriceLightNightly({ dryRun, budgetMs: 240_000 });
    // Once per run, not per event: the screen's cached rows and AI spend are stale now.
    if (!dryRun) invalidatePriceLight("rows", "cost");
    console.log(`[price-light-nightly] scanned=${summary.scanned} tagged=${summary.tagged} lightChanges=${summary.lightChanges.length} errors=${summary.errors.length} remaining=${summary.remaining} snapshotsRemaining=${summary.snapshotsRemaining}${dryRun ? " (dry-run)" : ""}`);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[price-light-nightly] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "nightly failed" }, { status: 500 });
  }
}

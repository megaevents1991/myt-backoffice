import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runPriceLightNightly } from "@/lib/services/price-light-nightly";

// 00:15 UTC nightly (vercel.json), before base-price-sync at 01:30. ?dry_run=1 = zero writes.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    // 240s of a 300s function: the budget is checked only BETWEEN events, and the last one started
    // can still run two scopes of parallel 12s AI calls before revalidation and the summary email.
    const summary = await runPriceLightNightly({ dryRun, budgetMs: 240_000 });
    console.log(`[price-light-nightly] scanned=${summary.scanned} tagged=${summary.tagged} lightChanges=${summary.lightChanges.length} errors=${summary.errors.length} remaining=${summary.remaining} snapshotsRemaining=${summary.snapshotsRemaining}${dryRun ? " (dry-run)" : ""}`);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[price-light-nightly] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "nightly failed" }, { status: 500 });
  }
}

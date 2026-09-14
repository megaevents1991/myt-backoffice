import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runPriceLightRetention } from "@/lib/services/price-light-retention";

/**
 * Weekly price-light retention (vercel.json, Sundays 03:00 UTC): keep RETENTION_DAYS (180) of
 * snapshots, matches, listings, crawl runs and price-light audit rows; hard-delete the rest.
 *
 * Weekly and on its own schedule ON PURPOSE - a delete pass must never compete with the nightly's
 * 270s budget, and nothing here is urgent. `?dry_run=1` reports exactly what a real run would
 * remove and writes nothing.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runPriceLightRetention({ dryRun });
    console.log(
      `[price-light-retention] cutoff=${summary.cutoff} snapshots=${summary.snapshots} matches=${summary.matches} ` +
      `listings=${summary.listings} runs=${summary.runs} audit=${summary.auditRows} errors=${summary.errors.length}` +
      `${dryRun ? " (dry-run)" : ""}`,
    );
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[price-light-retention] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "retention failed" }, { status: 500 });
  }
}

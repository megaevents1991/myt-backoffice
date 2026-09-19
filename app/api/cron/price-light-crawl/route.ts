import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { pickDueCompetitor, pickDueDetailPass, runCrawl, runDetailPass } from "@/lib/services/price-light-crawl";
import { ACTIVE_COMPETITORS } from "@/lib/services/competitor-scrapers";
import type { CompetitorKey } from "@/types/price-light.types";

// Tick every 6h (vercel.json "7 */6 * * *" - sites are weekly now, hourly was pointless): crawls at most ONE competitor whose
// interval elapsed. A tick with no catalog due spends itself on a DETAILS pass instead (at most one
// site, at most once a day per site, ten pages - runDetailPass), so the comparison sheet's
// flight / hotel / ticket lines fill in days rather than months. ?competitor=<key> forces one
// site's catalog, ?details=<key> forces one site's details pass, ?dry_run=1 writes nothing.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  try {
    const forced = url.searchParams.get("competitor");
    if (forced && !ACTIVE_COMPETITORS.includes(forced as CompetitorKey)) {
      return NextResponse.json({ error: "unknown or inactive competitor" }, { status: 400 });
    }
    const forcedDetails = url.searchParams.get("details");
    if (forcedDetails && !ACTIVE_COMPETITORS.includes(forcedDetails as CompetitorKey)) {
      return NextResponse.json({ error: "unknown or inactive competitor" }, { status: 400 });
    }
    const competitor = forcedDetails ? null : (forced as CompetitorKey | null) ?? (await pickDueCompetitor());
    if (!competitor) {
      const detailsFor = (forcedDetails as CompetitorKey | null) ?? (await pickDueDetailPass("vercel"));
      if (!detailsFor) return NextResponse.json({ skipped: true, reason: "nothing due" });
      const pass = await runDetailPass(detailsFor, { dryRun });
      console.log(`[price-light-crawl] ${detailsFor} details pass pages=${pass.detailPages} ms=${pass.ms} ${pass.note ?? ""}`);
      return NextResponse.json(pass);
    }
    const summary = await runCrawl(competitor, dryRun ? "dry_run" : "schedule", { dryRun });
    console.log(`[price-light-crawl] ${competitor} ${summary.status} listings=${summary.listings} pages=${summary.pages + summary.detailPages} ms=${summary.ms}`);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[price-light-crawl] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "crawl failed" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { pickDueCompetitor, runCrawl } from "@/lib/services/price-light-crawl";
import { ACTIVE_COMPETITORS } from "@/lib/services/competitor-scrapers";
import type { CompetitorKey } from "@/types/price-light.types";

// Tick every 6h (vercel.json "7 */6 * * *" - sites are weekly now, hourly was pointless): crawls at most ONE competitor whose
// interval elapsed. Most ticks do nothing. ?competitor=<key> forces one site,
// ?dry_run=1 crawls without writing.
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
    const competitor = (forced as CompetitorKey | null) ?? (await pickDueCompetitor());
    if (!competitor) return NextResponse.json({ skipped: true, reason: "nothing due" });
    const summary = await runCrawl(competitor, dryRun ? "dry_run" : "schedule", { dryRun });
    console.log(`[price-light-crawl] ${competitor} ${summary.status} listings=${summary.listings} pages=${summary.pages + summary.detailPages} ms=${summary.ms}`);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[price-light-crawl] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "crawl failed" }, { status: 500 });
  }
}

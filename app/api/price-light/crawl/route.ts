import { NextRequest, NextResponse } from "next/server";
import { guardAdminRoute } from "@/lib/auth/guards";
import { runCrawl } from "@/lib/services/price-light-crawl";
import { ACTIVE_COMPETITORS } from "@/lib/services/competitor-scrapers";
import type { CompetitorKey } from "@/types/price-light.types";

// Admin "crawl now" - staff-triggered from the dashboard, one competitor at a time.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const denied = await guardAdminRoute();
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const competitor = body?.competitor as CompetitorKey | undefined;
  if (!competitor || !ACTIVE_COMPETITORS.includes(competitor)) {
    return NextResponse.json({ error: "unknown or inactive competitor" }, { status: 400 });
  }
  try {
    return NextResponse.json(await runCrawl(competitor, "manual", { dryRun: body?.dry_run === true }));
  } catch (error) {
    console.error("[price-light/crawl] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "crawl failed" }, { status: 500 });
  }
}

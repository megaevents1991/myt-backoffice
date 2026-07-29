import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runCampaignCreatives } from "@/lib/creative/auto";

/**
 * Nightly campaign creatives for the Meta product feed. Walks feed-eligible
 * events (same window the feed serves: not deleted, today onward), finds ones
 * whose input hash changed (new event / price / date / name / template
 * version), and regenerates with the SAME auto-derive + render pipeline the
 * creative designer uses.
 *
 * No per-run render cap: the run is bounded only by its time budget, and the
 * response reports `remaining` so a caller can re-invoke until it hits zero.
 * `?limit=<n>` caps it explicitly when you want a small probe run.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : null;
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
    return NextResponse.json({ error: "limit must be a positive number" }, { status: 400 });
  }

  try {
    const summary = await runCampaignCreatives({ limit });
    return NextResponse.json(summary);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[campaign-cron] run failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

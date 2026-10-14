import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { syncToursEventsFeed } from "@/lib/services/tours-events-feed-sync";

/**
 * Mega Events' hot packages for the tours company sites (Mega Family's header menu and its
 * "ספורט ומוזיקה" world) - lib/services/tours-events-feed-sync.ts. Stores the list in
 * tours.site_content ('events_feed') and rebuilds a company's site only when its list changed.
 * Schedule in vercel.json (every 6 hours). Manual trigger: `?key=<NEXT_SECRET_CRON_SECRET_KEY>`.
 */
// the site's homepage pools (25 s at most) + one events read + a deploy hook per changed company
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  try {
    const result = await syncToursEventsFeed();
    console.log("[toursEventsFeed]", JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[toursEventsFeed] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

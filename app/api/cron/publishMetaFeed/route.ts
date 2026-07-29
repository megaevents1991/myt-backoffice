import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { publishMetaFeeds } from "@/lib/feed/publish-meta-feed";

/**
 * Republishes the Meta product-catalog feeds to Supabase Storage (plain static
 * files on a different host entirely) so Meta's fetcher never touches Vercel's
 * edge. The publishing logic lives in `lib/feed/publish-meta-feed.ts` and is
 * shared with the "Sync now" button on /meta-feed, so a manual sync does
 * exactly what this cron does.
 *
 * Schedule: twice a day (06:00 + 15:00 UTC) — see vercel.json. Meta refetches
 * the snapshot hourly on its own side.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  try {
    const result = await publishMetaFeeds();
    console.log(
      `[publishMetaFeed] published xml ${result.xmlBytes}B, csv ${result.csvBytes}B, ` +
        `activities ${result.activitiesBytes}B (${result.activityRows} rows) → ${result.activitiesUrl}`
    );
    return NextResponse.json({ published: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[publishMetaFeed] failed:", message);
    return NextResponse.json({ published: false, error: message }, { status: 500 });
  }
}

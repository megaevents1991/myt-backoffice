import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { publishMetaFeeds } from "@/lib/feed/publish-meta-feed";
import { publishAllToursFeeds } from "@/lib/feed/tours-publish";

/**
 * Republishes the Meta product-catalog feeds to Supabase Storage (plain static
 * files on a different host entirely) so Meta's fetcher never touches Vercel's
 * edge. The publishing logic lives in `lib/feed/publish-meta-feed.ts` and is
 * shared with the "Sync now" button on /meta-feed, so a manual sync does
 * exactly what this cron does.
 *
 * Schedule: six times a day (05, 08, 11, 14, 17, 20 UTC) - see vercel.json. Meta
 * refetches the snapshot hourly on its own side. The tours companies' feeds
 * (lib/feed/tours-publish.ts) are published in the same run, after Mega Events'.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  // Mega Events first, exactly as before; the tours companies after it, each on its own (lib/feed/tours-publish.ts) -
  // a failure of one never touches another, and the answer's status stays Mega Events'.
  let body: Record<string, unknown>;
  let status = 200;
  try {
    const result = await publishMetaFeeds();
    console.log(
      `[publishMetaFeed] published xml ${result.xmlBytes}B, csv ${result.csvBytes}B, ` +
        `activities ${result.activitiesBytes}B (${result.activityRows} rows) → ${result.activitiesUrl}`,
    );
    body = { published: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[publishMetaFeed] failed:", message);
    body = { published: false, error: message };
    status = 500;
  }
  const tours = await publishAllToursFeeds();
  for (const t of tours) {
    if (t.ok) console.log(`[publishMetaFeed] ${t.company}: ${t.items} tours (${t.branded} branded, ${t.skipped} left out${t.live ? "" : ", build dates"}) → ${t.csvUrl}`);
  }
  return NextResponse.json({ ...body, tours }, { status });
}

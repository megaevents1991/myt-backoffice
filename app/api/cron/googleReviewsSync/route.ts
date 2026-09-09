import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { syncGoogleReviews } from "@/lib/services/google-reviews-sync";

/**
 * Daily mirror of the Mega Events Google reviews into `google_reviews`
 * (lib/services/google-reviews-sync.ts). Schedule lives in vercel.json
 * (04:00 UTC). Manual trigger: `?key=<NEXT_SECRET_CRON_SECRET_KEY>`.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  try {
    const result = await syncGoogleReviews();
    console.log("[googleReviewsSync]", JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[googleReviewsSync] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

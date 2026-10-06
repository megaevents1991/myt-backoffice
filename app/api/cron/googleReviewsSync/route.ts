import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { syncGoogleReviews, tourCompanyPlaceIds } from "@/lib/services/google-reviews-sync";

/**
 * Daily mirror of the Mega Events Google reviews into `google_reviews`
 * (lib/services/google-reviews-sync.ts). Schedule lives in vercel.json
 * (04:00 UTC). Manual trigger: `?key=<NEXT_SECRET_CRON_SECRET_KEY>`.
 */
// two profiles now (Mega Events, then the tours companies), each a row-by-row upsert
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  try {
    const result = await syncGoogleReviews();
    console.log("[googleReviewsSync]", JSON.stringify(result));

    // The profiles of the tours companies (Mega Family), each under its own Place ID. They run after
    // the Mega Events mirror and never fail it: a profile that cannot be read is logged and reported.
    const companies: Record<string, unknown>[] = [];
    const placeIds = await tourCompanyPlaceIds().catch((error) => {
      console.error("[googleReviewsSync] tours companies:", error instanceof Error ? error.message : String(error));
      return [] as string[];
    });
    for (const placeId of placeIds) {
      if (placeId === result.placeId) continue;
      try {
        const one = await syncGoogleReviews(placeId);
        console.log("[googleReviewsSync] company profile", JSON.stringify(one));
        companies.push({ ...one });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[googleReviewsSync] company profile failed:", placeId, message);
        companies.push({ placeId, error: message });
      }
    }
    return NextResponse.json({ ok: true, ...result, companies });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[googleReviewsSync] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

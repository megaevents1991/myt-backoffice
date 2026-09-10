"use server";

import { requireAdmin, requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import {
  DEFAULT_PLACE_ID,
  syncGoogleReviews,
  type GoogleReviewsSyncResult,
} from "@/lib/services/google-reviews-sync";

/**
 * Health of the Google-reviews mirror for the dashboard banner. The daily
 * `googleReviewsSync` cron reads an unofficial Elfsight feed (no Places key),
 * so the day it stops working we want to see it - not discover the site's
 * "לקוחות משתפים" froze months ago.
 */

/** A daily cron that hasn't succeeded for this long is treated as broken. */
const STALE_AFTER_HOURS = 48;

export interface GoogleReviewsHealth {
  ok: boolean;
  /** Human-readable reason when not ok. */
  problem: string | null;
  syncedAt: string | null;
  syncError: string | null;
  reviewCount: number | null;
  rating: number | null;
}

// google_review_sources postdates types/database.types.ts - boundary cast
// until `npm run db:types` is rerun.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function getGoogleReviewsHealth(): Promise<GoogleReviewsHealth> {
  await requireStaff();
  const placeId = process.env.NEXT_SECRET_GOOGLE_PLACE_ID || DEFAULT_PLACE_ID;

  const { data, error } = await db
    .from("google_review_sources")
    .select("synced_at,sync_error,review_count,rating")
    .eq("place_id", placeId)
    .maybeSingle();

  if (error) {
    console.error("[google-reviews-health]", JSON.stringify(error));
    return {
      ok: false,
      problem: `Could not read google_review_sources: ${error.message}`,
      syncedAt: null,
      syncError: null,
      reviewCount: null,
      rating: null,
    };
  }

  const syncedAt: string | null = data?.synced_at ?? null;
  const syncError: string | null = data?.sync_error ?? null;
  const rating = data?.rating == null ? null : Number(data.rating);

  let problem: string | null = null;
  if (!data) {
    problem = "No reviews source row - the mirror was never seeded.";
  } else if (syncError) {
    problem = `Last sync failed: ${syncError}`;
  } else if (!syncedAt) {
    problem = "The reviews sync has never run.";
  } else {
    const ageHours = (Date.now() - new Date(syncedAt).getTime()) / 36e5;
    if (ageHours > STALE_AFTER_HOURS) {
      problem = `Last successful sync was ${Math.round(ageHours / 24)} days ago - the daily cron is not running.`;
    }
  }

  return {
    ok: problem === null,
    problem,
    syncedAt,
    syncError,
    reviewCount: data?.review_count ?? null,
    rating: rating != null && Number.isFinite(rating) ? rating : null,
  };
}

/** Manual re-run from the dashboard banner (admins). */
export async function runGoogleReviewsSyncNow(): Promise<
  { ok: true; result: GoogleReviewsSyncResult } | { ok: false; error: string }
> {
  await requireAdmin();
  try {
    const result = await syncGoogleReviews();
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[google-reviews-sync-now]", message);
    return { ok: false, error: message };
  }
}

"use server";

/**
 * The Google reviews of a tours company (Mega Family), for the Reviews section
 * of its home page editor.
 *
 * The reviews are mirrored like Mega Events' own (lib/services/google-reviews-sync.ts,
 * daily cron `googleReviewsSync`) into public.google_reviews, under the Place ID the
 * company keeps in its general document (Website > Header & Footer > Contact details).
 * Those two tables hold every profile, so each action here reads and writes only the
 * rows of the active company's own Place ID.
 */
import { requireCompany, type Company } from "@/lib/company";
import { supabase } from "@/lib/supabase-server";
import { toursDb } from "@/lib/tours/db";
import { logAudit } from "@/lib/audit";
import { actionFail, plainFail, type ActionResult } from "@/lib/tours/action-kit";
import { asObject, companyAudit } from "@/lib/tours/company-kit";
import { syncGoogleReviews } from "@/lib/services/google-reviews-sync";

const SCOPE = "tours-reviews-actions";

// google_reviews / google_review_sources postdate types/database.types.ts - boundary cast,
// as in lib/actions/google-reviews-actions.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface CompanyGoogleReview {
  key: string;
  name: string;
  rating: number;
  text: string;
  date: string;
  hidden: boolean;
}

export interface CompanyGoogleReviews {
  /** "" = the company named no Google profile yet. */
  placeId: string;
  name: string | null;
  rating: number | null;
  count: number | null;
  mapsUrl: string | null;
  syncedAt: string | null;
  syncError: string | null;
  /** Newest first. A review without a text is listed too: the site skips it by itself. */
  reviews: CompanyGoogleReview[];
}

const NO_PROFILE = "Set the company's Google Place ID first: Header & Footer > Contact details.";

async function companyPlaceId(company: Company): Promise<string> {
  const { data, error } = await toursDb().from("site_content").select("data").eq("company_id", company.id).eq("key", "general").maybeSingle();
  if (error) throw error;
  const id = asObject(data?.data).googlePlaceId;
  return typeof id === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(id.trim()) ? id.trim() : "";
}

async function mirrorOf(placeId: string): Promise<CompanyGoogleReviews> {
  const empty: CompanyGoogleReviews = { placeId, name: null, rating: null, count: null, mapsUrl: null, syncedAt: null, syncError: null, reviews: [] };
  if (!placeId) return empty;
  const [source, reviews] = await Promise.all([
    db.from("google_review_sources").select("display_name, rating, review_count, maps_url, synced_at, sync_error").eq("place_id", placeId).maybeSingle(),
    db
      .from("google_reviews")
      .select("review_key, author_name, rating, text, published_at, is_hidden")
      .eq("place_id", placeId)
      .order("published_at", { ascending: false })
      .limit(500),
  ]);
  if (source.error) throw new Error(`google_review_sources read: ${source.error.message}`);
  if (reviews.error) throw new Error(`google_reviews read: ${reviews.error.message}`);
  const rating = source.data?.rating != null ? Number(source.data.rating) : null;
  return {
    placeId,
    name: source.data?.display_name ?? null,
    rating: rating != null && Number.isFinite(rating) ? rating : null,
    count: source.data?.review_count ?? null,
    mapsUrl: source.data?.maps_url ?? null,
    syncedAt: source.data?.synced_at ?? null,
    syncError: source.data?.sync_error ?? null,
    reviews: ((reviews.data ?? []) as Record<string, unknown>[]).map((r) => ({
      key: String(r.review_key),
      name: String(r.author_name ?? ""),
      rating: Number(r.rating) || 0,
      text: typeof r.text === "string" ? r.text : "",
      date: String(r.published_at ?? ""),
      hidden: r.is_hidden === true,
    })),
  };
}

/** The mirrored Google reviews of the active company's profile. */
export async function getCompanyGoogleReviews(): Promise<ActionResult<CompanyGoogleReviews>> {
  try {
    const { company } = await requireCompany("tours");
    return { success: true, data: await mirrorOf(await companyPlaceId(company)) };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the Google reviews");
  }
}

/** Reads the company's Google profile now instead of waiting for the daily run. */
export async function refreshCompanyGoogleReviews(): Promise<ActionResult<CompanyGoogleReviews>> {
  try {
    const { company } = await requireCompany("tours");
    const placeId = await companyPlaceId(company);
    if (!placeId) return plainFail(NO_PROFILE);
    try {
      const result = await syncGoogleReviews(placeId);
      await logAudit({
        action: "update",
        entityType: "tours_google_reviews",
        entityId: placeId,
        metadata: { ...companyAudit(company), source: result.source, fetched: result.fetched, inserted: result.inserted, updated: result.updated },
      });
    } catch (error) {
      // the reason is also stored on the source row (sync_error); say it here in plain words
      console.error(`${SCOPE}: sync ${placeId} failed`, error instanceof Error ? error.message : String(error));
      return plainFail("Google's reviews could not be read right now. The reviews already mirrored stay on the site. Try again later.");
    }
    return { success: true, data: await mirrorOf(placeId) };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to refresh the Google reviews");
  }
}

/** Takes one Google review off the site (or puts it back). The mirror keeps the row either way. */
export async function setCompanyGoogleReviewHidden(reviewKey: string, hidden: boolean): Promise<ActionResult<{ key: string; hidden: boolean }>> {
  try {
    const { company } = await requireCompany("tours");
    const placeId = await companyPlaceId(company);
    if (!placeId) return plainFail(NO_PROFILE);
    if (typeof reviewKey !== "string" || !reviewKey || reviewKey.length > 400 || typeof hidden !== "boolean") return plainFail("Unknown review");
    // the Place ID is part of the condition: a review of another profile can never be touched from here
    const { data, error } = await db
      .from("google_reviews")
      .update({ is_hidden: hidden, updated_at: new Date().toISOString() })
      .eq("review_key", reviewKey)
      .eq("place_id", placeId)
      .select("review_key")
      .maybeSingle();
    if (error) throw new Error(`google_reviews update: ${error.message}`);
    if (!data) return plainFail("This review is not in the company's Google reviews any more. Reload the page.");
    await logAudit({
      action: "update",
      entityType: "tours_google_reviews",
      entityId: reviewKey,
      metadata: { ...companyAudit(company), place_id: placeId, is_hidden: hidden },
    });
    return { success: true, data: { key: reviewKey, hidden } };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to update the review");
  }
}

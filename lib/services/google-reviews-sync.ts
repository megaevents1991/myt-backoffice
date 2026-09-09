import { supabase } from "@/lib/supabase-server";

/**
 * Mirrors the Google reviews of the Mega Events business profile into
 * `google_reviews` / `google_review_sources` (migration 20260909120000).
 *
 * Source: Google Places API (New) Place Details. It returns the live rating +
 * review count and at most FIVE reviews per call, so the mirror accumulates:
 * every run upserts what it sees and never deletes, and the historical
 * backlog came from a one-time seed (scripts/seed-google-reviews-from-elfsight.mjs).
 * Owner replies are not exposed by the Places API - seeded rows keep theirs.
 *
 * Env: NEXT_SECRET_GOOGLE_PLACES_API_KEY (Places API (New) enabled on the key),
 * optional NEXT_SECRET_GOOGLE_PLACE_ID (defaults to the Mega Events profile).
 */

/** Mega Events – חבילות להופעות ואירועי ספורט בחו״ל (CID 3588250245740006173). */
export const DEFAULT_PLACE_ID = "ChIJ4_iJNrNJZWoRHYuKTpYGzDE";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places";
const FIELD_MASK = "displayName,rating,userRatingCount,googleMapsUri,reviews";

interface PlacesReview {
  name?: string;
  rating?: number;
  text?: { text?: string; languageCode?: string };
  originalText?: { text?: string; languageCode?: string };
  authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
  publishTime?: string;
  googleMapsUri?: string;
}

interface PlacesDetails {
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: PlacesReview[];
}

export interface GoogleReviewRow {
  review_key: string;
  place_id: string;
  author_name: string;
  author_photo_url: string | null;
  author_url: string | null;
  rating: number;
  text: string | null;
  text_html: string | null;
  language: string | null;
  published_at: string;
  review_url: string | null;
  reply_text: string | null;
  reply_at: string | null;
  images: string[];
}

export interface GoogleReviewsSyncResult {
  placeId: string;
  rating: number | null;
  reviewCount: number | null;
  fetched: number;
  inserted: number;
  updated: number;
  skippedDuplicates: number;
}

// google_reviews / google_review_sources postdate types/database.types.ts;
// single boundary cast until `npm run db:types` is rerun.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Review id = last path segment of `places/{place}/reviews/{id}`. */
function reviewKeyOf(review: PlacesReview): string | null {
  const name = review.name ?? "";
  const idx = name.lastIndexOf("/");
  return idx >= 0 && idx < name.length - 1 ? name.slice(idx + 1) : null;
}

export function mapPlacesReview(
  placeId: string,
  review: PlacesReview,
): GoogleReviewRow | null {
  const key = reviewKeyOf(review);
  const author = review.authorAttribution?.displayName?.trim();
  const rating = Number(review.rating);
  const publishedAt = review.publishTime;
  if (!key || !author || !Number.isFinite(rating) || !publishedAt) return null;
  const text = review.originalText?.text ?? review.text?.text ?? null;
  return {
    review_key: key,
    place_id: placeId,
    author_name: author,
    author_photo_url: review.authorAttribution?.photoUri ?? null,
    author_url: review.authorAttribution?.uri ?? null,
    rating: Math.max(1, Math.min(5, Math.round(rating))),
    text,
    text_html: text ? escapeHtml(text).replace(/\n/g, "<br>") : null,
    language: review.originalText?.languageCode ?? review.text?.languageCode ?? null,
    published_at: publishedAt,
    review_url: review.googleMapsUri ?? null,
    reply_text: null,
    reply_at: null,
    images: [],
  };
}

export async function fetchPlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<PlacesDetails> {
  const res = await fetch(
    `${PLACES_ENDPOINT}/${encodeURIComponent(placeId)}?languageCode=he`,
    {
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Places API ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as PlacesDetails;
}

/**
 * Upserts a batch of mapped rows. A row whose key is new but whose
 * (author, publish day) already exists - the seed used a different id
 * encoding - is the same review: only its avatar URL is refreshed.
 */
export async function upsertReviews(
  rows: GoogleReviewRow[],
): Promise<{ inserted: number; updated: number; skippedDuplicates: number }> {
  let inserted = 0;
  let updated = 0;
  let skippedDuplicates = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    const { data: byKey, error: keyErr } = await db
      .from("google_reviews")
      .select("review_key")
      .eq("review_key", row.review_key)
      .maybeSingle();
    if (keyErr) throw new Error(`google_reviews lookup: ${keyErr.message}`);

    if (byKey) {
      const { error } = await db
        .from("google_reviews")
        .update({
          author_name: row.author_name,
          author_photo_url: row.author_photo_url,
          author_url: row.author_url,
          rating: row.rating,
          text: row.text,
          text_html: row.text_html,
          language: row.language,
          review_url: row.review_url,
          updated_at: now,
        })
        .eq("review_key", row.review_key);
      if (error) throw new Error(`google_reviews update: ${error.message}`);
      updated += 1;
      continue;
    }

    const day = row.published_at.slice(0, 10);
    const { data: sameDay, error: dupErr } = await db
      .from("google_reviews")
      .select("review_key")
      .eq("place_id", row.place_id)
      .eq("author_name", row.author_name)
      .gte("published_at", `${day}T00:00:00Z`)
      .lt("published_at", `${day}T23:59:59.999Z`)
      .limit(1);
    if (dupErr) throw new Error(`google_reviews dup check: ${dupErr.message}`);
    if (sameDay && sameDay.length > 0) {
      const { error } = await db
        .from("google_reviews")
        .update({ author_photo_url: row.author_photo_url, updated_at: now })
        .eq("review_key", sameDay[0].review_key);
      if (error) throw new Error(`google_reviews dup update: ${error.message}`);
      skippedDuplicates += 1;
      continue;
    }

    const { error } = await db.from("google_reviews").insert({
      review_key: row.review_key,
      place_id: row.place_id,
      author_name: row.author_name,
      author_photo_url: row.author_photo_url,
      author_url: row.author_url,
      rating: row.rating,
      text: row.text,
      text_html: row.text_html,
      language: row.language,
      published_at: row.published_at,
      review_url: row.review_url,
      reply_text: row.reply_text,
      reply_at: row.reply_at,
      images: row.images,
    });
    if (error) throw new Error(`google_reviews insert: ${error.message}`);
    inserted += 1;
  }

  return { inserted, updated, skippedDuplicates };
}

export async function syncGoogleReviews(): Promise<GoogleReviewsSyncResult> {
  const apiKey = process.env.NEXT_SECRET_GOOGLE_PLACES_API_KEY;
  const placeId = process.env.NEXT_SECRET_GOOGLE_PLACE_ID || DEFAULT_PLACE_ID;
  if (!apiKey) throw new Error("NEXT_SECRET_GOOGLE_PLACES_API_KEY is not set");

  // The source row must exist before reviews reference it.
  const { error: srcErr } = await db
    .from("google_review_sources")
    .upsert({ place_id: placeId }, { onConflict: "place_id", ignoreDuplicates: true });
  if (srcErr) throw new Error(`google_review_sources upsert: ${srcErr.message}`);

  let details: PlacesDetails;
  try {
    details = await fetchPlaceDetails(placeId, apiKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .from("google_review_sources")
      .update({ sync_error: message, synced_at: new Date().toISOString() })
      .eq("place_id", placeId);
    throw error;
  }

  const rows = (details.reviews ?? [])
    .map((r) => mapPlacesReview(placeId, r))
    .filter((r): r is GoogleReviewRow => r !== null);

  const counts = await upsertReviews(rows);

  const { error: sumErr } = await db
    .from("google_review_sources")
    .update({
      display_name: details.displayName?.text ?? null,
      rating: typeof details.rating === "number" ? details.rating : null,
      review_count:
        typeof details.userRatingCount === "number" ? details.userRatingCount : null,
      maps_url: details.googleMapsUri ?? null,
      synced_at: new Date().toISOString(),
      sync_error: null,
    })
    .eq("place_id", placeId);
  if (sumErr) throw new Error(`google_review_sources update: ${sumErr.message}`);

  return {
    placeId,
    rating: details.rating ?? null,
    reviewCount: details.userRatingCount ?? null,
    fetched: rows.length,
    ...counts,
  };
}

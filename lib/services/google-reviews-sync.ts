import { supabase } from "@/lib/supabase-server";

/**
 * Mirrors the Google reviews of the Mega Events business profile into
 * `google_reviews` / `google_review_sources` (migration 20260909120000).
 *
 * Two sources, picked per run:
 *  - Google Places API (New) Place Details when NEXT_SECRET_GOOGLE_PLACES_API_KEY
 *    is set: live rating + review count, at most FIVE reviews per call, no
 *    owner replies.
 *  - Otherwise Elfsight's public review feed for our Place ID (the same feed
 *    the retired widget read): every review incl. owner replies, rating/count
 *    derived from it. Unofficial endpoint - refreshed on Elfsight's schedule
 *    and could close without notice; the run then logs `sync_error` and the
 *    site keeps what is already mirrored.
 * Either way the mirror only accumulates: upsert, dedupe, never delete.
 *
 * Env: NEXT_SECRET_GOOGLE_PLACES_API_KEY (optional - enables the Places source),
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

export type ReviewSource = "places" | "elfsight";

export interface GoogleReviewsSyncResult {
  placeId: string;
  source: ReviewSource;
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

// ── Elfsight public feed ────────────────────────────────────────────────────

const ELFSIGHT_FEED = "https://service-reviews-ultimate.elfsight.com/data/reviews";

interface ElfsightReview {
  id?: string;
  supplier?: string;
  reviewer_name?: string;
  reviewer_picture_url?: string | null;
  rating?: number;
  text?: string | null;
  text_html?: string | null;
  url?: string | null;
  language?: string | null;
  /** Unix seconds. */
  published_at?: number;
  images?: Array<string | { url?: string }>;
  response?: { text?: string | null; date?: number | null } | null;
}

/** Google's review id rides in the Maps URL as `!1s<id>` (first occurrence). */
function reviewKeyFromMapsUrl(url: string | null | undefined, fallback: string): string {
  const m = /!1s([A-Za-z0-9_-]+)/.exec(url ?? "");
  return m ? m[1] : `elfsight:${fallback}`;
}

function unixToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function mapElfsightReview(
  placeId: string,
  review: ElfsightReview,
): GoogleReviewRow | null {
  const author = review.reviewer_name?.trim();
  const rating = Number(review.rating);
  if (
    review.supplier !== "google" ||
    !author ||
    !Number.isFinite(rating) ||
    !review.published_at
  ) {
    return null;
  }
  const images = Array.isArray(review.images)
    ? review.images
        .map((i) => (typeof i === "string" ? i : i?.url))
        .filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
  return {
    review_key: reviewKeyFromMapsUrl(review.url, review.id ?? `${author}-${review.published_at}`),
    place_id: placeId,
    author_name: author,
    author_photo_url: review.reviewer_picture_url || null,
    author_url: null,
    rating: Math.max(1, Math.min(5, Math.round(rating))),
    text: review.text || null,
    text_html: review.text_html || null,
    language: review.language || null,
    published_at: unixToIso(review.published_at),
    review_url: review.url || null,
    reply_text: review.response?.text || null,
    reply_at: review.response?.date ? unixToIso(review.response.date) : null,
    images,
  };
}

export async function fetchElfsightFeed(placeId: string): Promise<ElfsightReview[]> {
  const url = `${ELFSIGHT_FEED}?uris%5B%5D=${encodeURIComponent(placeId)}&page_length=500&order=date`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MYT backoffice reviews sync)" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Elfsight feed ${res.status}: ${body.slice(0, 200)}`);
  }
  const payload = (await res.json()) as { result?: { data?: unknown } };
  const data = payload.result?.data;
  if (!Array.isArray(data)) throw new Error("Elfsight feed: unexpected shape");
  return data as ElfsightReview[];
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

interface FetchedSnapshot {
  rows: GoogleReviewRow[];
  rating: number | null;
  reviewCount: number | null;
  displayName: string | null;
  mapsUrl: string | null;
}

async function fetchFromPlaces(placeId: string, apiKey: string): Promise<FetchedSnapshot> {
  const details = await fetchPlaceDetails(placeId, apiKey);
  return {
    rows: (details.reviews ?? [])
      .map((r) => mapPlacesReview(placeId, r))
      .filter((r): r is GoogleReviewRow => r !== null),
    rating: typeof details.rating === "number" ? details.rating : null,
    reviewCount:
      typeof details.userRatingCount === "number" ? details.userRatingCount : null,
    displayName: details.displayName?.text ?? null,
    mapsUrl: details.googleMapsUri ?? null,
  };
}

async function fetchFromElfsight(placeId: string): Promise<FetchedSnapshot> {
  const feed = await fetchElfsightFeed(placeId);
  const rows = feed
    .map((r) => mapElfsightReview(placeId, r))
    .filter((r): r is GoogleReviewRow => r !== null);
  // The feed has no profile summary - derive it from every review it carries
  // (all ratings, text or not), which is what the widget displayed too.
  const rating = rows.length
    ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10
    : null;
  return {
    rows,
    rating,
    reviewCount: rows.length || null,
    displayName: null,
    mapsUrl: null,
  };
}

export async function syncGoogleReviews(): Promise<GoogleReviewsSyncResult> {
  const apiKey = process.env.NEXT_SECRET_GOOGLE_PLACES_API_KEY;
  const placeId = process.env.NEXT_SECRET_GOOGLE_PLACE_ID || DEFAULT_PLACE_ID;
  const source: ReviewSource = apiKey ? "places" : "elfsight";

  // The source row must exist before reviews reference it.
  const { error: srcErr } = await db
    .from("google_review_sources")
    .upsert({ place_id: placeId }, { onConflict: "place_id", ignoreDuplicates: true });
  if (srcErr) throw new Error(`google_review_sources upsert: ${srcErr.message}`);

  let snapshot: FetchedSnapshot;
  try {
    snapshot = apiKey
      ? await fetchFromPlaces(placeId, apiKey)
      : await fetchFromElfsight(placeId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .from("google_review_sources")
      .update({ sync_error: `[${source}] ${message}`, synced_at: new Date().toISOString() })
      .eq("place_id", placeId);
    throw error;
  }

  const counts = await upsertReviews(snapshot.rows);

  // Only overwrite summary fields the source actually knows.
  const summary: Record<string, unknown> = {
    synced_at: new Date().toISOString(),
    sync_error: null,
  };
  if (snapshot.rating != null) summary.rating = snapshot.rating;
  if (snapshot.reviewCount != null) summary.review_count = snapshot.reviewCount;
  if (snapshot.displayName) summary.display_name = snapshot.displayName;
  if (snapshot.mapsUrl) summary.maps_url = snapshot.mapsUrl;

  const { error: sumErr } = await db
    .from("google_review_sources")
    .update(summary)
    .eq("place_id", placeId);
  if (sumErr) throw new Error(`google_review_sources update: ${sumErr.message}`);

  return {
    placeId,
    source,
    rating: snapshot.rating,
    reviewCount: snapshot.reviewCount,
    fetched: snapshot.rows.length,
    ...counts,
  };
}

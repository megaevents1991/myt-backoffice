/**
 * Instagram Graph API reader for the business account linked to the Facebook page the
 * read token can see (today @megatr_il). Media + per-media insights + stories (gone after
 * 24 h - the sync runs 4x a day to catch them) + account counters. Spec section 4 step 3.
 */
import type { IgMediaRow } from "@/types/marketing.types";
import { graphGetAll } from "./meta";

const GRAPH = "https://graph.facebook.com/v26.0";

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const u = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${process.env.NEXT_SECRET_META_READ_TOKEN?.trim() ?? ""}` }, signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message: string } };
  if (!res.ok || body.error) throw new Error(`Instagram ${path}: ${body.error?.message ?? res.status}`);
  return body;
}

interface RawMedia { id: string; media_type?: string; media_product_type?: string; caption?: string; permalink?: string; media_url?: string; thumbnail_url?: string; timestamp?: string; like_count?: number; comments_count?: number }

const MEDIA_FIELDS = "id,media_type,media_product_type,caption,permalink,media_url,thumbnail_url,timestamp,like_count,comments_count";

function toRow(m: RawMedia, igUserId: string, productType?: IgMediaRow["media_product_type"]): IgMediaRow {
  const pt = (productType ?? m.media_product_type ?? null) as IgMediaRow["media_product_type"];
  return { id: m.id, ig_user_id: igUserId, media_type: m.media_type ?? null, media_product_type: pt, caption: m.caption?.slice(0, 2000) ?? null, permalink: m.permalink ?? null, media_url: m.media_url ?? null, thumbnail_url: m.thumbnail_url ?? null, posted_at: m.timestamp ?? null, like_count: m.like_count ?? 0, comments_count: m.comments_count ?? 0, reach: 0, saved: 0, shares: 0, views: 0, insights_at: null };
}

/**
 * Newest `limit` feed posts and reels: ONE page on purpose. The account holds hundreds of
 * media (550 on 2026-10-08), so the page always has a `paging.next` - `graphGetAll(..., 1)`
 * would throw "more than 1 pages" on every call. A response with no `data` array still throws.
 */
export async function fetchIgMedia(opts: { igUserId: string; limit?: number }): Promise<IgMediaRow[]> {
  const path = `/${opts.igUserId}/media`;
  const body = await graphGet<{ data?: RawMedia[] }>(path, { fields: MEDIA_FIELDS, limit: String(opts.limit ?? 100) });
  if (!Array.isArray(body.data)) throw new Error(`Instagram ${path}: no data array in response`);
  return body.data.map((m) => toRow(m, opts.igUserId));
}

/** Stories live right now. */
export async function fetchIgStories(opts: { igUserId: string }): Promise<IgMediaRow[]> {
  const raws = await graphGetAll<RawMedia>(`/${opts.igUserId}/stories`, { fields: MEDIA_FIELDS, limit: "50" }, 1);
  return raws.map((m) => toRow(m, opts.igUserId, "STORY"));
}

/** Metrics the API serves per product type (an unsupported metric fails the whole call, so ask per type). */
export const IG_INSIGHT_METRICS: Record<string, string[]> = {
  FEED: ["reach", "saved", "shares", "views"],
  REELS: ["reach", "saved", "shares", "views"],
  STORY: ["reach", "shares", "views"],
};

/**
 * reach / saved / shares / views of one media; a metric the type lacks reads 0. A failed call, or a
 * 200 that carries no `data` (missing or empty), returns null - the row keeps its old counters and
 * its `insights_at` (four zeros would be written over real numbers and stamped as fresh).
 */
export async function fetchIgMediaInsights(media: Pick<IgMediaRow, "id" | "media_product_type">): Promise<Pick<IgMediaRow, "reach" | "saved" | "shares" | "views"> | null> {
  const metrics = IG_INSIGHT_METRICS[media.media_product_type ?? "FEED"] ?? IG_INSIGHT_METRICS.FEED;
  try {
    const body = await graphGet<{ data?: { name: string; values?: { value: number }[] }[] }>(`/${media.id}/insights`, { metric: metrics.join(",") });
    if (!Array.isArray(body.data) || body.data.length === 0) {
      console.warn(`[instagram] insights ${media.id}: no data in response`);
      return null;
    }
    const read = (name: string) => body.data?.find((d) => d.name === name)?.values?.[0]?.value ?? 0;
    return { reach: read("reach"), saved: read("saved"), shares: read("shares"), views: read("views") };
  } catch (error) {
    console.warn(`[instagram] insights ${media.id}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function fetchIgAccount(opts: { igUserId: string }): Promise<{ followers: number; mediaCount: number }> {
  const body = await graphGet<{ followers_count?: number; media_count?: number }>(`/${opts.igUserId}`, { fields: "followers_count,media_count" });
  // A missing counter must not become a 0 in the followers series.
  if (typeof body.followers_count !== "number") throw new Error("Instagram account: followers_count missing");
  return { followers: body.followers_count, mediaCount: body.media_count ?? 0 };
}

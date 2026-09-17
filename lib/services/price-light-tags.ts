// The feed tags the price light reads: the vertical an event really belongs to
// (`kindOf`, which competitors it is compared against) and the coverage a scraper
// claims (`CompetitorScraper.covers`).
//
// Its own module rather than a function on price-light-match.ts, because
// price-light-store.ts needs it too and match already imports store - importing
// back the other way would close a cycle.
import { supabase } from "@/lib/supabase-server";
import { MUSIC_TAG_SLUG } from "@/lib/services/price-light";

// New tables predate the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Chunk size for the `event_tag_links` bulk read. PostgREST caps a response at 1000 rows and
 *  an event carries at most a handful of tags, so 100 ids per request can never be truncated. */
const TAG_CHUNK = 100;

/** The event's feed-tag slugs - the vertical ("football"/"music") `kindOf` and a scraper's
 *  `covers()` read. Loaded ONCE per event by the caller, never per (competitor, scope).
 *  A query failure returns [] on purpose: that makes ISSTA `skipped` and the kind type-only,
 *  both the safe direction (never a false `alone`, never a silently changed comparison). */
export async function tagSlugsForEvent(eventId: number): Promise<string[]> {
  const { data, error } = await db.from("event_tag_links").select("event_tags!inner(slug)").eq("event_id", eventId);
  if (error) { console.error("price-light-tags: tag slugs failed", JSON.stringify(error)); return []; }
  return (data ?? [])
    .map((r: { event_tags: { slug: string } | { slug: string }[] | null }) =>
      (Array.isArray(r.event_tags) ? r.event_tags[0]?.slug : r.event_tags?.slug) ?? null)
    .filter((s: string | null): s is string => !!s);
}

/**
 * Which of these events carry the `music` tag - the one tag `kindOf` needs, for a whole list
 * of events (the /price-light screen reads ~440 at a time).
 *
 * Two small reads instead of the embedded-filter form: the tag id once, then the links in
 * chunks of TAG_CHUNK event ids. A failed read returns an EMPTY set and logs - the caller then
 * classifies by type alone, exactly as before tags were consulted, rather than losing the list.
 */
export async function musicTaggedEventIds(eventIds: readonly number[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (eventIds.length === 0) return out;

  const { data: tag, error: tagError } = await db
    .from("event_tags").select("id").eq("slug", MUSIC_TAG_SLUG).maybeSingle();
  if (tagError) { console.error("price-light-tags: music tag lookup failed", JSON.stringify(tagError)); return out; }
  const tagId = (tag as { id: number } | null)?.id;
  if (tagId == null) return out;

  const chunks: number[][] = [];
  for (let i = 0; i < eventIds.length; i += TAG_CHUNK) chunks.push(eventIds.slice(i, i + TAG_CHUNK));
  // Concurrently: the chunks are disjoint reads of one small index, and the screen's opening
  // load waits on this - five sequential round trips would be five times the latency.
  const results = await Promise.all(chunks.map((chunk) => db
    .from("event_tag_links").select("event_id").eq("tag_id", tagId).in("event_id", chunk)));

  for (const { error } of results as { error: { message: string } | null }[]) {
    if (error) {
      // Partial is worse than nothing here: half the list would be classified one way and half
      // the other, so the whole answer is dropped and every event falls back to its type.
      console.error("price-light-tags: music links failed", JSON.stringify(error));
      return new Set<number>();
    }
  }
  for (const { data } of results as { data: { event_id: number }[] | null }[]) {
    for (const row of data ?? []) out.add(Number(row.event_id));
  }
  return out;
}

/** The `tagSlugs` argument `kindOf` wants, for an event already known to be (or not be) music -
 *  so a bulk caller never has to fabricate a tag list by hand. */
export function musicTagSlugs(isMusic: boolean): readonly string[] {
  return isMusic ? MUSIC_TAGS : NO_TAGS;
}

const MUSIC_TAGS: readonly string[] = [MUSIC_TAG_SLUG];
const NO_TAGS: readonly string[] = [];

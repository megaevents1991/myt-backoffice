import { supabase } from "@/lib/supabase-server";
import type { TagRuleField, TagType } from "@/types/taxonomy.types";

/**
 * Rules-based auto-tagger. ADDITIVE ONLY: it adds missing (event, tag) links
 * and never removes any, so manual curation is never undone.
 *
 * Matching:
 *  - field "name": case-insensitive contains vs `${name} ${name_english}`
 *  - field "city": case-insensitive equality vs location->>'city_iata'
 *
 * Implication pass: an event carrying (or gaining) a league/team tag also
 * gets the `football` vertical tag; genre/artist implies `music`. That keeps
 * custom_label_0 populated without a rule per fixture.
 */

// tag_rules isn't in the generated Supabase types - same untyped boundary as
// event-taxonomy-actions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = (t: string) => (supabase as any).from(t);

export type LoadedRule = {
  tag_id: number;
  field: TagRuleField;
  pattern: string;
};

export type MatchableEvent = {
  id: number;
  name: string | null;
  name_english: string | null;
  location: { city_iata?: string | null } | null;
};

export function matchRuleTags(
  event: MatchableEvent,
  rules: LoadedRule[],
): number[] {
  const hay = `${event.name ?? ""} ${event.name_english ?? ""}`.toLowerCase();
  const iata = (event.location?.city_iata ?? "").trim().toLowerCase();
  const out = new Set<number>();
  for (const r of rules) {
    const p = r.pattern.trim().toLowerCase();
    if (!p) continue;
    if (r.field === "name" && hay.includes(p)) out.add(r.tag_id);
    if (r.field === "city" && iata && iata === p) out.add(r.tag_id);
  }
  return [...out];
}

/** tag type -> implied vertical slug */
const VERTICAL_IMPLICATIONS: Partial<Record<TagType, string>> = {
  league: "football",
  team: "football",
  genre: "music",
  artist: "music",
};

const CHUNK = 200;
const PAGE = 1000;

/**
 * Runs rule matching + the implication pass over the scanned events and
 * links any missing (event, tag) pairs.
 *
 * `eventsMatched` counts events that gained at least one NEW tag link this
 * run - not events whose rules merely matched. An event that was already
 * fully tagged (rules + implications resolve to tags it already has) does
 * not count, even though its rules "matched".
 */
export async function applyTagRules(eventIds?: number[]): Promise<{
  eventsScanned: number;
  eventsMatched: number;
  linksAdded: number;
}> {
  // Active rules whose target tag is alive.
  const { data: ruleRows, error: rulesErr } = await tbl("tag_rules")
    .select("tag_id,field,pattern,event_tags!inner(is_deleted)")
    .eq("is_active", true)
    .eq("event_tags.is_deleted", false);
  if (rulesErr) throw rulesErr;
  const rules: LoadedRule[] = (ruleRows ?? []).map(
    (r: { tag_id: number; field: TagRuleField; pattern: string }) => ({
      tag_id: r.tag_id,
      field: r.field,
      pattern: r.pattern,
    }),
  );

  // Tag types for the implication pass (id -> type, slug -> id for verticals).
  const { data: tagRows, error: tagsErr } = await tbl("event_tags")
    .select("id,slug,type")
    .eq("is_deleted", false);
  if (tagsErr) throw tagsErr;
  const typeById = new Map<number, TagType>();
  const idBySlug = new Map<string, number>();
  (tagRows ?? []).forEach((t: { id: number; slug: string; type: TagType }) => {
    typeById.set(t.id, t.type);
    idBySlug.set(t.slug, t.id);
  });

  // Live events (scoped when ids are passed). PostgREST caps an unranged
  // select at ~1000 rows, so the full-scan path (no eventIds) pages through
  // with .range() - otherwise a run-all silently skips events past the cap
  // as the table grows. The eventIds-scoped path chunks .in() at 200 ids in
  // case a caller ever passes more than the default PostgREST page size.
  const list: MatchableEvent[] = [];
  if (eventIds?.length) {
    for (let i = 0; i < eventIds.length; i += CHUNK) {
      const ids = eventIds.slice(i, i + CHUNK);
      const { data: events, error: evErr } = await tbl("events")
        .select("id,name,name_english,location")
        .is("is_deleted", null)
        .in("id", ids);
      if (evErr) throw evErr;
      list.push(...((events ?? []) as MatchableEvent[]));
    }
  } else {
    for (let from = 0; ; from += PAGE) {
      const { data: events, error: evErr } = await tbl("events")
        .select("id,name,name_english,location")
        .is("is_deleted", null)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (evErr) throw evErr;
      const page = (events ?? []) as MatchableEvent[];
      list.push(...page);
      if (page.length < PAGE) break;
    }
  }

  // Existing links for the scanned events (chunked .in()).
  const existing = new Map<number, Set<number>>();
  for (let i = 0; i < list.length; i += CHUNK) {
    const ids = list.slice(i, i + CHUNK).map((e) => e.id);
    const { data: links, error: linkErr } = await tbl("event_tag_links")
      .select("event_id,tag_id")
      .in("event_id", ids);
    if (linkErr) throw linkErr;
    (links ?? []).forEach((l: { event_id: number; tag_id: number }) => {
      let tagIds = existing.get(l.event_id);
      if (!tagIds) {
        tagIds = new Set<number>();
        existing.set(l.event_id, tagIds);
      }
      tagIds.add(l.tag_id);
    });
  }

  // Match + implication -> missing pairs only.
  const toInsert: { event_id: number; tag_id: number }[] = [];
  let eventsMatched = 0;
  for (const ev of list) {
    const have = existing.get(ev.id) ?? new Set<number>();
    const want = new Set<number>(matchRuleTags(ev, rules));
    for (const tagId of [...have, ...want]) {
      const impliedSlug = VERTICAL_IMPLICATIONS[typeById.get(tagId) ?? "other"];
      const impliedId = impliedSlug ? idBySlug.get(impliedSlug) : undefined;
      if (impliedId) want.add(impliedId);
    }
    const missing = [...want].filter((t) => !have.has(t));
    if (missing.length > 0) eventsMatched++;
    missing.forEach((tag_id) => toInsert.push({ event_id: ev.id, tag_id }));
  }

  for (let i = 0; i < toInsert.length; i += 500) {
    const { error } = await tbl("event_tag_links").upsert(
      toInsert.slice(i, i + 500),
      { onConflict: "event_id,tag_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  return {
    eventsScanned: list.length,
    eventsMatched,
    linksAdded: toInsert.length,
  };
}

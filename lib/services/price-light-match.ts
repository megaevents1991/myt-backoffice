// Pair one of our events with a competitor's stored listing (spec §4). Rule only
// in phase 0; `judge` is the phase-1 AI hook. Writes a competitor_matches row
// only when the verdict differs from the latest row.
import { supabase } from "@/lib/supabase-server";
import { takeBudget, type AgentBudget } from "@/lib/agents/switch";
import {
  DATE_TOLERANCE_DAYS, LIGHT_STALE_DAYS, competitorsFor, kindOf, listingNights, normalize, ourNightRateUsd,
  ourNights, ourPackageUsd, ourTicketUsd, pickRuleMatch, type MatchCandidate,
} from "@/lib/services/price-light";
import { ACTIVE_COMPETITORS, scraperFor } from "@/lib/services/competitor-scrapers";
import { loadEventForLight, recomputeEventLights, type LightEvent } from "@/lib/services/price-light-store";
import { aiEnabled, extractAndJudge, makeJudge } from "@/lib/services/price-light-judge";
import type { CompetitorKey, ExtractedAttrs, ListingRow, MatchMethod, MatchStatus, MatchTrigger, Scope } from "@/types/price-light.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface MatchOutcome { competitor: CompetitorKey; scope: Scope; status: MatchStatus; wrote: boolean; listingId: number | null; note: string | null }

/** Run-wide ceiling on AI calls, shared (and mutated) across every event in one pass.
 *  The nightly creates exactly one of these (`newBudget(PRICE_LIGHT_AGENT)`); ad-hoc callers
 *  pass none = no ceiling. The type and the decrement are the agent layer's, so every agent
 *  gets the same accounting. */
export type AiBudget = AgentBudget;

export interface MatchOptions {
  dryRun?: boolean;
  judge?: Judge | null;
  aiBudget?: AiBudget;
  tagSlugs?: string[];
  /** The agent's house rules + staff corrections (price-light-memory.ts `loadJudgeMemory`),
   *  loaded ONCE per run by the caller and handed to every AI call this pass makes - both the
   *  `judge` closure and the direct extraction call below. Omitted = base prompt only. */
  aiMemory?: string | null;
}

/** The gate both AI call sites go through: decrement first, and once the budget is spent report
 *  "no call allowed" - which the caller treats exactly like `judge: null` for that event
 *  (rule-only, no `unsure`-by-AI, no cost). Shared with every other agent (lib/agents/switch.ts). */
const takeAiBudget = takeBudget;

/** Phase 1 plugs Claude in here. null = rule-only. */
export type Judge = (input: { event: LightEvent; candidates: ListingRow[] }) =>
  Promise<{ status: "found" | "not_selling" | "unsure"; listing: ListingRow | null; attrs: Partial<ExtractedAttrs> | null; verdict: Record<string, unknown> } | null>;

// Same staleness window the light engine uses for "stale" - kept in one place
// (lib/services/price-light.ts) so the two never drift apart.
const STALE_LISTING_MS = LIGHT_STALE_DAYS * 86_400_000;

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10);
}

async function candidatesFor(event: LightEvent, competitor: CompetitorKey, scope: Scope): Promise<ListingRow[]> {
  const day = event.date.slice(0, 10);
  const from = shiftDay(day, -DATE_TOLERANCE_DAYS);
  const to = shiftDay(day, DATE_TOLERANCE_DAYS);
  // Two ways to be a candidate: a dated listing within ±DATE_TOLERANCE_DAYS, or (phase 2)
  // an undated listing whose travel window contains our date. PostgREST `or` with nested
  // `and` groups; every value is a YYYY-MM-DD string, no quoting needed.
  const { data, error } = await db.from("competitor_listings")
    .select("id,competitor,external_key,scope,title,title_he,event_date,city,venue,price_from,currency,price_usd,travel_depart,travel_return,attrs,detail_text,url,first_seen_at,last_seen_at,last_changed_at,run_id")
    .eq("competitor", competitor).eq("scope", scope)
    .or(`and(event_date.gte.${from},event_date.lte.${to}),and(event_date.is.null,travel_depart.lte.${day},travel_return.gte.${day})`)
    .gte("last_seen_at", new Date(Date.now() - STALE_LISTING_MS).toISOString());
  if (error) { console.error("price-light-match: candidates failed", JSON.stringify(error)); return []; }
  return (data ?? []) as ListingRow[];
}

/**
 * Does this competitor's crawled catalog cover the event at all? Coverage gates ONLY the
 * absence claim (`not_selling`) - a scraper with no `covers()` covers everything, which is
 * every competitor but ISSTA today.
 */
function coversEvent(competitor: CompetitorKey, event: LightEvent, tagSlugs: string[]): boolean {
  const covers = scraperFor(competitor).covers;
  if (!covers) return true;
  return covers({ type: event.type, name: event.name, name_english: event.name_english ?? null, tagSlugs });
}

/** The event's feed-tag slugs - the vertical ("football"/"music") a scraper's `covers()` reads.
 *  Loaded ONCE per event in matchAllForEvent, never per (competitor, scope). A query failure
 *  returns [] on purpose: that makes ISSTA `skipped`, the safe direction (never a false `alone`). */
export async function tagSlugsForEvent(eventId: number): Promise<string[]> {
  const { data, error } = await db.from("event_tag_links").select("event_tags!inner(slug)").eq("event_id", eventId);
  if (error) { console.error("price-light-match: tag slugs failed", JSON.stringify(error)); return []; }
  return (data ?? [])
    .map((r: { event_tags: { slug: string } | { slug: string }[] | null }) =>
      (Array.isArray(r.event_tags) ? r.event_tags[0]?.slug : r.event_tags?.slug) ?? null)
    .filter((s: string | null): s is string => !!s);
}

async function hadGoodCrawl(competitor: CompetitorKey): Promise<boolean> {
  const { data, error } = await db.from("competitor_crawl_runs").select("id").eq("competitor", competitor)
    .in("status", ["ok", "partial"]).gte("started_at", new Date(Date.now() - STALE_LISTING_MS).toISOString()).limit(1);
  if (error) { console.error(JSON.stringify(error)); throw error; }
  return (data ?? []).length > 0;
}

interface PrevRow {
  status: MatchStatus; listing_id: number | null; normalized_usd: number | null; our_usd: number | null;
  listing_changed_at: string | null; ai_verdict: Record<string, unknown> | null; attrs: Partial<ExtractedAttrs> | null;
  /** When this row was written - the reference point for the "same question, same inputs"
   *  negative cache below (a candidate that has not changed since is not a new question). */
  created_at: string | null;
}

async function latestRow(eventId: number, competitor: CompetitorKey, scope: Scope): Promise<PrevRow | null> {
  const { data, error } = await db.from("competitor_matches")
    .select("status,listing_id,normalized_usd,our_usd,listing_changed_at,ai_verdict,attrs,created_at")
    .eq("event_id", eventId).eq("competitor", competitor).eq("scope", scope)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error(JSON.stringify(error)); throw error; }
  return (data as PrevRow | null) ?? null;
}

/** True when `listing` is attached and its last_changed_at differs from the previous row's -
 *  the single change-trigger used by both the `found` and generic write-diff branches. */
function hasListingChanged(prev: PrevRow | null, listing: ListingRow | null): boolean {
  if (!listing) return false;
  return (prev?.listing_changed_at ?? null) !== listing.last_changed_at;
}

const ATTR_KEYS: (keyof ExtractedAttrs)[] = ["bag_included", "direct_flight", "hotel_stars", "nights", "breakfast", "transfers"];

/** Extraction is only worth an AI call when the page gave us nothing already. */
function attrsAllUnknown(attrs: Partial<ExtractedAttrs> | null): boolean {
  if (!attrs) return true;
  return ATTR_KEYS.every((k) => (attrs[k] ?? "unknown") === "unknown");
}

/** Page attrs win over AI attrs PER FIELD, not as a whole-object spread - LiveEvents
 *  always stores all six keys, "unknown" when it doesn't know one, so `{ ...ai, ...page }`
 *  would let an all-"unknown" page object overwrite every AI-extracted value and turn
 *  the extraction call into a paid no-op (fix round 2 finding 2). Copies a page field
 *  onto the AI result only when the page actually knows it (defined, not "unknown"). */
function mergeAttrs(ai: Partial<ExtractedAttrs> | null, page: Partial<ExtractedAttrs> | null): Partial<ExtractedAttrs> {
  const merged: Partial<ExtractedAttrs> = { ...(ai ?? {}) };
  const setIfKnown = <K extends keyof ExtractedAttrs>(key: K, value: ExtractedAttrs[K] | undefined) => {
    if (value !== undefined && value !== "unknown") merged[key] = value;
  };
  for (const key of ATTR_KEYS) setIfKnown(key, page?.[key]);
  return merged;
}

/**
 * Fill `nights` from the listing's own travel window when no detail page ever said it.
 *
 * `attrs.nights` is only written by a detail page, and detail enrichment reaches a fraction of
 * a catalog: on 2026-09-13, 123 of Golasso's 132 package listings had `attrs: null` while ALL
 * 132 carried the depart/return window their card prints. Deriving here (the same
 * return-minus-depart ISSTA's and OnTour's scrapers already do at scrape time) is what turns
 * those into duration-aware comparisons instead of raw price-vs-price.
 *
 * The derived value is persisted on the MATCH row's attrs, never back onto the listing: the
 * listing records what its page said, the match records what the comparison was made with.
 */
function withListingNights(attrs: Partial<ExtractedAttrs>, listing: ListingRow): Partial<ExtractedAttrs> {
  const nights = listingNights(attrs, listing);
  return nights === "unknown" ? attrs : { ...attrs, nights };
}

/** One AI call per (event, listing) pair (spec `§5`): the previous row's listing
 *  is still among today's candidates, unchanged, and already carries a verdict -
 *  but NOT an error verdict (fix round 1 finding 1): a failed call must not pin
 *  forever just because the listing hasn't changed since - treat it as a miss so
 *  the next visit retries the call. */
function cachedCandidateFor(prev: PrevRow | null, candidates: ListingRow[]): ListingRow | null {
  if (!prev || prev.listing_id == null || prev.ai_verdict == null) return null;
  if ((prev.ai_verdict as { error?: unknown } | null)?.error != null) return null;
  const listing = candidates.find((c) => c.id === prev.listing_id) ?? null;
  return listing && !hasListingChanged(prev, listing) ? listing : null;
}

/**
 * NEGATIVE cache - the "same question, same inputs" rule (final review, I5b).
 *
 * `cachedCandidateFor` can only reuse a verdict that picked a listing. The judge's other
 * answer - `unsure` with `listing: null` (ISSTA's marketing titles rule-score ~0, so the
 * judge is asked and honestly declines) - writes `listing_id: null` and therefore could
 * never be cached: the same event re-bought the same call every night, forever, and the
 * 40-call ceiling was spent on no-hopers before a genuinely ambiguous pair got a look.
 *
 * So: skip the call when the previous row was that exact answer (unsure, no listing, a real
 * non-error verdict) AND not one candidate has changed since it was written. A new or
 * changed candidate is a new question and pays for a fresh call.
 */
function aiAlreadyDeclined(prev: PrevRow | null, candidates: ListingRow[]): boolean {
  if (!prev || prev.status !== "unsure" || prev.listing_id != null || prev.ai_verdict == null) return false;
  if ((prev.ai_verdict as { error?: unknown } | null)?.error != null) return false;
  if (!prev.created_at) return false;
  const asked = Date.parse(prev.created_at);
  if (!Number.isFinite(asked)) return false;
  return candidates.every((c) => Date.parse(c.last_changed_at) <= asked);
}

/** `ai error: <msg>` when `verdict.error` is set, else null. Shared by the `unsure`
 *  note (`aiNote`) and the `found` note (an extraction that errored but still left
 *  the rule-matched listing usable). */
function verdictErrorNote(verdict: Record<string, unknown> | null): string | null {
  const err = verdict && typeof verdict.error === "string" ? verdict.error : null;
  return err ? `ai error: ${err}` : null;
}

/** Note text for an `unsure` row that went through the judge - falls back to the
 *  phase-0 "ambiguous, no judge" wording when no verdict was ever produced. */
function aiNote(verdict: Record<string, unknown> | null): string | null {
  if (!verdict) return null;
  const err = verdictErrorNote(verdict);
  if (err) return err;
  const confidence = typeof verdict.confidence === "number" ? verdict.confidence : 0;
  return `ai unsure (confidence ${confidence.toFixed(2)})`;
}

export async function matchEvent(
  event: LightEvent,
  competitor: CompetitorKey,
  scope: Scope,
  trigger: MatchTrigger,
  opts: MatchOptions = {},
): Promise<MatchOutcome> {
  const out: MatchOutcome = { competitor, scope, status: "skipped", wrote: false, listingId: null, note: null };
  const judge = opts.judge === undefined ? makeJudge(opts.aiMemory) : opts.judge;
  const ourUsd = scope === "package" ? ourPackageUsd(event) : ourTicketUsd(event);
  const prev = await latestRow(event.id, competitor, scope);

  const write = async (row: Record<string, unknown>) => {
    if (opts.dryRun) { out.wrote = true; return; }
    const { error } = await db.from("competitor_matches").insert({ event_id: event.id, competitor, scope, ...row });
    if (error) console.error(`price-light-match: insert failed (${trigger})`, JSON.stringify(error)); else out.wrote = true;
  };

  if (ourUsd == null) {
    out.status = "na";
    if (prev?.status !== "na") await write({ status: "na", method: "rule", note: scope === "package" ? "skip_flight or no ticket" : "no ticket_only_markup" });
    return out;
  }

  const candidates = await candidatesFor(event, competitor, scope);
  let picked: ListingRow | null = null;
  let attrs: Partial<ExtractedAttrs> | null = null;
  let verdict: Record<string, unknown> | null = null;
  let method: MatchMethod = "rule";
  let status: MatchStatus;
  // Quote-only listing (LiveEvents sports): competitor sells the package but
  // publishes no price. Rule matched it, but it can never resolve to "found"
  // (no normalized price) or "not_selling" - it goes to "unsure" instead.
  let quoteOnly = false;

  const rule = pickRuleMatch(
    { names: [event.name, event.name_english ?? ""].filter(Boolean), date: event.date.slice(0, 10) },
    candidates.map<MatchCandidate>((c) => ({
      id: c.id, title: c.title, title_he: c.title_he, event_date: c.event_date,
      travel_depart: c.travel_depart, travel_return: c.travel_return,
    })),
  );
  // Same listing as last visit, unchanged, already verdicted - reused by both the
  // rule-found extraction branch below and the rule-failed judge-decide branch.
  const cached = cachedCandidateFor(prev, candidates);

  if (rule) {
    picked = candidates.find((c) => c.id === rule.candidate.id) ?? null;
    if (picked && picked.price_usd == null) {
      quoteOnly = true;
      status = "unsure";
    } else {
      status = "found";
      if (picked && prev && cached && cached.id === picked.id) {
        // Cache hit, no call. `cached: true` marks the copy so the AI cost gauge
        // (aiCostThisMonth) doesn't count this re-written verdict as a second call.
        attrs = prev.attrs; verdict = { ...prev.ai_verdict, cached: true }; method = "ai";
      } else if (picked && judge !== null && aiEnabled() && picked.detail_text && attrsAllUnknown(picked.attrs)
        && takeAiBudget(opts.aiBudget)) {
        // Fix round 2 finding 1: gate on `judge !== null` too, not just `aiEnabled()` -
        // an explicit `opts.judge: null` ("rule-only, must not spend money") must still
        // suppress this call even though it invokes `extractAndJudge` directly rather
        // than the `judge` closure itself.
        // Fix round 1 finding 2: call `extractAndJudge` DIRECTLY (not the `judge`
        // closure) so `same_event`/confidence never gates whether we keep the
        // extracted attrs - the rule already decided this is the same event.
        // `price-light-match.ts` stays the judge module's only caller either way.
        try {
          const r = await extractAndJudge({ event, candidates: [picked] }, { memory: opts.aiMemory });
          attrs = r.attrs; verdict = r.verdict as unknown as Record<string, unknown>; method = "ai";
        } catch (e) {
          // Defensive: extractAndJudge never throws today, but don't let a future
          // change here take matchEvent down with it.
          verdict = { error: e instanceof Error ? e.message : "call failed" }; method = "ai";
        }
      }
    }
  } else if (prev && cached) {
    // Full-decision cache reuse (status included, not just attrs/verdict) is an
    // accepted deviation from a literal "reuse prev.attrs/prev.ai_verdict" reading -
    // ruling: one AI call per (event, listing) pair means a known-good cached match
    // must not re-invoke the judge just to re-derive the same status.
    if (cached.price_usd == null) {
      quoteOnly = true; picked = cached; status = "unsure";
    } else {
      // Same `cached: true` marker as the branch above - a reused verdict is not a new call.
      picked = cached; status = "found"; attrs = prev.attrs; verdict = { ...prev.ai_verdict, cached: true }; method = "ai";
    }
  } else if (candidates.length > 0 && judge && !aiAlreadyDeclined(prev, candidates) && takeAiBudget(opts.aiBudget)) {
    let j: Awaited<ReturnType<Judge>> = null;
    try {
      j = await judge({ event, candidates });
    } catch (e) {
      // Defensive: the judge (price-light-judge.ts) already never throws past its
      // own boundary, but guard here too so a bug there can't take matchEvent down.
      j = { status: "unsure", listing: null, attrs: null, verdict: { error: e instanceof Error ? e.message : "call failed" } };
    }
    if (j) {
      status = j.status; picked = j.listing; attrs = j.attrs; verdict = j.verdict; method = "ai";
      if (status === "found" && picked && picked.price_usd == null) { quoteOnly = true; status = "unsure"; }
    } else status = "unsure";
  } else if (candidates.length > 0) {
    status = "unsure";                                          // ambiguous, no judge (AI off or rule-only mode)
  } else if (!coversEvent(competitor, event, opts.tagSlugs ?? [])) {
    // The scraper says its crawled catalog does not cover this event's vertical (ISSTA is
    // football-only), so "no candidate" is not evidence of anything: record `skipped`, which
    // computeScopeLight already treats as non-valid -> the scope lands on `partial_coverage`
    // instead of claiming `alone` off a section we never opened (final review, I1).
    status = "skipped";
  } else {
    status = (await hadGoodCrawl(competitor)) ? "not_selling" : "skipped";
  }

  out.status = status; out.listingId = picked?.id ?? null;

  if (status === "found" && picked) {
    const priceUsd = Number(picked.price_usd ?? 0);
    // Page attrs win over AI attrs, per field; the derived duration is a PACKAGE concern only -
    // a ticket has no nights, and stamping one on a ticket row would be data that means nothing.
    const base = mergeAttrs(attrs, picked.attrs);
    const merged = scope === "package" ? withListingNights(base, picked) : base;
    const norm = scope === "package"
      ? normalize(priceUsd, merged, { nights: ourNights(event), nightRateUsd: ourNightRateUsd(event) })
      : { normalizedUsd: Math.round(priceUsd), adjustments: [], partial: false };
    // A verdict produced THIS run against a row that has none must always be persisted,
    // even when the price landed on the same number: otherwise the call is paid for,
    // thrown away, and `cachedCandidateFor` never finds a verdict to reuse - the cache
    // could never engage and every visit would re-buy the same extraction.
    // `nights` is compared as well as the price: a duration we have only just learned (derived
    // from the listing's travel window) can leave `normalized_usd` identical - a zero-night gap
    // adjusts nothing - while still being the difference between a light that carries a night
    // of doubt and one that does not. Without this the row would never be rewritten and the
    // store would keep pricing that doubt off stale "unknown" attrs.
    const nightsUnchanged = (prev?.attrs?.nights ?? "unknown") === (merged.nights ?? "unknown");
    const unchanged = prev?.status === "found" && prev.listing_id === picked.id &&
      !hasListingChanged(prev, picked) && nightsUnchanged &&
      Number(prev.normalized_usd) === norm.normalizedUsd && Number(prev.our_usd) === ourUsd &&
      !(verdict != null && prev.ai_verdict == null);
    if (!unchanged) {
      // Fix round 1 finding 3: surface an extraction error even on a `found` row
      // (the rule still matched the listing; only the AI attrs enrichment failed) -
      // join with the pre-existing partial-normalization note when both apply.
      const notes = [verdictErrorNote(verdict), norm.partial ? "partial normalization" : null].filter((n): n is string => n != null);
      await write({
        status, method, listing_id: picked.id, ai_verdict: verdict, raw_price: picked.price_from, raw_currency: picked.currency,
        price_usd: priceUsd, normalized_usd: norm.normalizedUsd, adjustments: norm.adjustments, attrs: merged,
        our_usd: ourUsd, diff_usd: ourUsd - norm.normalizedUsd, listing_changed_at: picked.last_changed_at,
        note: notes.length > 0 ? notes.join(" · ") : null,
      });
    }
    return out;
  }

  if (status !== "skipped") {
    const listingId = picked?.id ?? null;
    // Same rule as the `found` branch above: a fresh verdict against a verdict-less
    // previous row is itself a change worth writing, or the call was paid for nothing.
    const changed = prev?.status !== status || (prev?.listing_id ?? null) !== listingId ||
      Number(prev?.our_usd ?? null) !== ourUsd || hasListingChanged(prev, picked) ||
      (verdict != null && prev?.ai_verdict == null);
    if (changed) {
      await write({
        status, method, listing_id: listingId, ai_verdict: verdict, our_usd: ourUsd,
        ...(picked ? { listing_changed_at: picked.last_changed_at } : {}),
        note: quoteOnly ? "quote_only" : status === "unsure" ? (aiNote(verdict) ?? `${candidates.length} candidates, no rule match`) : null,
      });
    }
  }
  return out;
}

export async function matchAllForEvent(
  eventId: number,
  trigger: MatchTrigger,
  opts: MatchOptions = {},
) {
  const event = await loadEventForLight(eventId);
  if (!event || event.is_deleted) return null;
  // Resolve once per event, not once per (competitor, scope) - `matchEvent` never
  // re-resolves when it is handed an already-concrete (possibly null) judge.
  const judge = opts.judge === undefined ? makeJudge(opts.aiMemory) : opts.judge;
  // One query per EVENT, not per (competitor, scope) - the slugs are the same for all of them.
  const tagSlugs = opts.tagSlugs ?? (await tagSlugsForEvent(eventId));
  const outcomes: MatchOutcome[] = [];
  for (const scope of ["package", "ticket"] as const) {
    const competitors = competitorsFor(kindOf(event), scope, ACTIVE_COMPETITORS)
      .filter((c) => scraperFor(c).scopes.includes(scope));
    // Competitors within one scope run concurrently: their rows are disjoint per
    // (event, competitor, scope), and the shared `aiBudget` decrement in `takeAiBudget` is
    // synchronous, so the ceiling still holds exactly. Scopes stay sequential (final review,
    // I5a) - this is what offsets the per-event cost phase 2's extra crawlers added.
    outcomes.push(...await Promise.all(
      competitors.map((competitor) => matchEvent(event, competitor, scope, trigger, { ...opts, judge, tagSlugs })),
    ));
  }
  const lights = await recomputeEventLights(eventId, trigger, { dryRun: opts.dryRun });
  return { outcomes, lights };
}

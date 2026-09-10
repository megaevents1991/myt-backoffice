// Pair one of our events with a competitor's stored listing (spec §4). Rule only
// in phase 0; `judge` is the phase-1 AI hook. Writes a competitor_matches row
// only when the verdict differs from the latest row.
import { supabase } from "@/lib/supabase-server";
import {
  DATE_TOLERANCE_DAYS, LIGHT_STALE_DAYS, competitorsFor, kindOf, normalize, ourNights, ourPackageUsd, ourTicketUsd,
  pickRuleMatch, type MatchCandidate,
} from "@/lib/services/price-light";
import { ACTIVE_COMPETITORS, scraperFor } from "@/lib/services/competitor-scrapers";
import { loadEventForLight, recomputeEventLights, type LightEvent } from "@/lib/services/price-light-store";
import type { CompetitorKey, ExtractedAttrs, ListingRow, MatchMethod, MatchStatus, MatchTrigger, Scope } from "@/types/price-light.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface MatchOutcome { competitor: CompetitorKey; scope: Scope; status: MatchStatus; wrote: boolean; listingId: number | null; note: string | null }

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
  const { data, error } = await db.from("competitor_listings")
    .select("id,competitor,external_key,scope,title,title_he,event_date,city,venue,price_from,currency,price_usd,travel_depart,travel_return,attrs,detail_text,url,first_seen_at,last_seen_at,last_changed_at,run_id")
    .eq("competitor", competitor).eq("scope", scope)
    .gte("event_date", shiftDay(day, -DATE_TOLERANCE_DAYS)).lte("event_date", shiftDay(day, DATE_TOLERANCE_DAYS))
    .gte("last_seen_at", new Date(Date.now() - STALE_LISTING_MS).toISOString());
  if (error) { console.error("price-light-match: candidates failed", JSON.stringify(error)); return []; }
  return (data ?? []) as ListingRow[];
}

async function hadGoodCrawl(competitor: CompetitorKey): Promise<boolean> {
  const { data, error } = await db.from("competitor_crawl_runs").select("id").eq("competitor", competitor)
    .in("status", ["ok", "partial"]).gte("started_at", new Date(Date.now() - STALE_LISTING_MS).toISOString()).limit(1);
  if (error) { console.error(JSON.stringify(error)); throw error; }
  return (data ?? []).length > 0;
}

interface PrevRow { status: MatchStatus; listing_id: number | null; normalized_usd: number | null; our_usd: number | null; listing_changed_at: string | null }

async function latestRow(eventId: number, competitor: CompetitorKey, scope: Scope): Promise<PrevRow | null> {
  const { data, error } = await db.from("competitor_matches")
    .select("status,listing_id,normalized_usd,our_usd,listing_changed_at")
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

export async function matchEvent(
  event: LightEvent,
  competitor: CompetitorKey,
  scope: Scope,
  trigger: MatchTrigger,
  opts: { dryRun?: boolean; judge?: Judge | null } = {},
): Promise<MatchOutcome> {
  const out: MatchOutcome = { competitor, scope, status: "skipped", wrote: false, listingId: null, note: null };
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
    candidates.map<MatchCandidate>((c) => ({ id: c.id, title: c.title, title_he: c.title_he, event_date: c.event_date })),
  );
  if (rule) {
    picked = candidates.find((c) => c.id === rule.candidate.id) ?? null;
    if (picked && picked.price_usd == null) {
      quoteOnly = true;
      status = "unsure";
    } else {
      status = "found";
    }
  } else if (candidates.length > 0 && opts.judge) {
    const j = await opts.judge({ event, candidates });
    if (j) { status = j.status; picked = j.listing; attrs = j.attrs; verdict = j.verdict; method = "ai"; }
    else status = "unsure";
  } else if (candidates.length > 0) {
    status = "unsure";                                          // ambiguous, no judge yet (phase 1)
  } else {
    status = (await hadGoodCrawl(competitor)) ? "not_selling" : "skipped";
  }

  out.status = status; out.listingId = picked?.id ?? null;

  if (status === "found" && picked) {
    const priceUsd = Number(picked.price_usd ?? 0);
    const merged = { ...(attrs ?? {}), ...(picked.attrs ?? {}) };          // page attrs win over AI attrs
    const norm = scope === "package"
      ? normalize(priceUsd, merged, { nights: ourNights(event) })
      : { normalizedUsd: Math.round(priceUsd), adjustments: [], partial: false };
    const unchanged = prev?.status === "found" && prev.listing_id === picked.id &&
      !hasListingChanged(prev, picked) &&
      Number(prev.normalized_usd) === norm.normalizedUsd && Number(prev.our_usd) === ourUsd;
    if (!unchanged) {
      await write({
        status, method, listing_id: picked.id, ai_verdict: verdict, raw_price: picked.price_from, raw_currency: picked.currency,
        price_usd: priceUsd, normalized_usd: norm.normalizedUsd, adjustments: norm.adjustments, attrs: merged,
        our_usd: ourUsd, diff_usd: ourUsd - norm.normalizedUsd, listing_changed_at: picked.last_changed_at,
        note: norm.partial ? "partial normalization" : null,
      });
    }
    return out;
  }

  if (status !== "skipped") {
    const listingId = picked?.id ?? null;
    const changed = prev?.status !== status || (prev?.listing_id ?? null) !== listingId ||
      Number(prev?.our_usd ?? null) !== ourUsd || hasListingChanged(prev, picked);
    if (changed) {
      await write({
        status, method, listing_id: listingId, ai_verdict: verdict, our_usd: ourUsd,
        ...(picked ? { listing_changed_at: picked.last_changed_at } : {}),
        note: quoteOnly ? "quote_only" : status === "unsure" ? `${candidates.length} candidates, no rule match` : null,
      });
    }
  }
  return out;
}

export async function matchAllForEvent(eventId: number, trigger: MatchTrigger, opts: { dryRun?: boolean; judge?: Judge | null } = {}) {
  const event = await loadEventForLight(eventId);
  if (!event || event.is_deleted) return null;
  const outcomes: MatchOutcome[] = [];
  for (const scope of ["package", "ticket"] as const) {
    for (const competitor of competitorsFor(kindOf(event), scope, ACTIVE_COMPETITORS)) {
      if (!scraperFor(competitor).scopes.includes(scope)) continue;
      outcomes.push(await matchEvent(event, competitor, scope, trigger, opts));
    }
  }
  const lights = await recomputeEventLights(eventId, trigger, { dryRun: opts.dryRun });
  return { outcomes, lights };
}

// DB side of the price-light engine. Every write to the events light/tag
// columns and to event_price_snapshots goes through here.
import { supabase } from "@/lib/supabase-server";
import { ACTIVE_COMPETITORS } from "@/lib/services/competitor-scrapers";
import {
  competitorsFor, computeScopeLight, decidePriceDrop, kindOf, lightSettled, minAvailableTicketUsd,
  nightsUncertaintyUsd, ourNightRateUsd, ourNights, ourPackageUsd, ourTicketUsd, totalMarkupUsd,
  OVERRIDE_DRIFT_USD, PRICE_DROP_LOOKBACK_DAYS, type LatestMatch, type PricedEvent,
} from "@/lib/services/price-light";
import type {
  ExtractedAttrs, Light, LightDetail, LightOverride, LightScopeDetail, MatchRow, MatchTrigger, Scope,
} from "@/types/price-light.types";

// New tables predate the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const LIGHT_EVENT_COLUMNS =
  "id,name,name_english,type,date,def_date_depart,def_date_return,location," +
  "base_flight_price,base_hotel_price,tickets_and_rates,skip_flight,ticket_only_markup," +
  "markup_ticket,markup_flight,markup_hotel,event_additional_markup,is_deleted,is_test," +
  "light_package,light_ticket,light_detail,light_checked_at,light_silenced_until," +
  "price_drop_usd,price_drop_from,price_drop_until";

export interface LightEvent extends PricedEvent {
  id: number;
  location: { name?: string; city_iata?: string } | null;
  is_deleted: string | null;
  is_test?: boolean | null;
  light_package: Light | null;
  light_ticket: Light | null;
  light_detail: LightDetail | null;
  light_checked_at: string | null;
  /** A red light muted until this instant ("השאר בפיד"). Cleared here the moment no scope is red. */
  light_silenced_until: string | null;
  price_drop_usd: number | null;
  price_drop_from: number | null;
  price_drop_until: string | null;
}

export type Lights = { package: Light | null; ticket: Light | null };

export async function loadEventForLight(eventId: number): Promise<LightEvent | null> {
  const { data, error } = await db.from("events").select(LIGHT_EVENT_COLUMNS).eq("id", eventId).maybeSingle();
  if (error) { console.error("price-light: load event failed", JSON.stringify(error)); return null; }
  return (data as LightEvent | null) ?? null;
}

/** Newest match row per (competitor, scope), with its listing's crawl time and the attrs the
 *  comparison was made with (`scopeDetail` prices the nights doubt off them). */
export async function loadLatestMatches(eventId: number): Promise<(LatestMatch & { scope: Scope; attrs: Partial<ExtractedAttrs> | null })[]> {
  const { data, error } = await db
    .from("competitor_matches")
    .select("id,competitor,scope,status,listing_id,raw_price,raw_currency,normalized_usd,adjustments,attrs,note,created_at,competitor_listings(last_seen_at)")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    // Headroom for de-dup: only the newest row per (competitor, scope) survives below,
    // but with ~2 scopes x a handful of active competitors, 60 rows comfortably covers
    // every competitor's history within a single crawl cycle even with reruns/retries.
    .limit(60);
  // Throw, never `[]`: no matches recomputes both lights to "unchecked" and writes that over the
  // real ones - one failed read would wipe the lights, lift a mute and auto-close red tasks.
  if (error) { console.error("price-light: load matches failed", JSON.stringify(error)); throw new Error(`load matches ${eventId}: ${error.message}`); }
  const seen = new Set<string>();
  const out: (LatestMatch & { scope: Scope; attrs: Partial<ExtractedAttrs> | null })[] = [];
  for (const row of (data ?? []) as (MatchRow & { competitor_listings: { last_seen_at: string } | null })[]) {
    const key = `${row.competitor}:${row.scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const partial = !!(row.attrs && Object.values(row.attrs).some((v) => v === "unknown"));
    out.push({
      competitor: row.competitor, scope: row.scope, status: row.status,
      normalized_usd: row.normalized_usd == null ? null : Number(row.normalized_usd),
      raw: row.raw_price == null ? null : Number(row.raw_price), raw_currency: row.raw_currency,
      // A not_selling verdict is as fresh as the match itself (no listing to point at).
      crawled_at: row.competitor_listings?.last_seen_at ?? row.created_at,
      match_id: row.id, adjustments: row.adjustments ?? [], partial,
      // A competitor that does not cover this event (price-light-match `notCovered`) is a coverage
      // gap, not a broken crawl - say which, or the tooltip blames a crawl that never failed.
      reason: row.status === "skipped" ? (row.note?.startsWith("not covered") ? "partial_coverage" : "crawl_failed") : null,
      attrs: row.attrs ?? null,
      quote_only: row.status === "unsure" && row.note === "quote_only",
    });
  }
  return out;
}

/**
 * The nights doubt is priced HERE, not in the engine: `nightsUncertaintyUsd` needs this event's
 * own night rate, and `computeScopeLight` stays pure (it is handed numbers, it does not look
 * events up). Ticket scope compares like for like - a ticket has no duration - so it carries no
 * doubt at all; only the package scope does.
 */
function scopeDetail(
  event: LightEvent,
  scope: Scope,
  matches: (LatestMatch & { scope: Scope; attrs: Partial<ExtractedAttrs> | null })[],
  now: string,
): LightScopeDetail {
  const competitors = competitorsFor(kindOf(event), scope, ACTIVE_COMPETITORS);
  const ourUsd = scope === "package" ? ourPackageUsd(event) : ourTicketUsd(event);
  const nightsOurs = ourNights(event);
  const nightRate = ourNightRateUsd(event);
  const scoped = matches.filter((m) => m.scope === scope).map((m) => {
    if (scope !== "package" || m.status !== "found") return m;
    const theirs = m.attrs?.nights ?? "unknown";
    return {
      ...m,
      uncertainty_usd: nightsUncertaintyUsd(theirs, nightsOurs, nightRate),
      nights: { ours: nightsOurs, theirs },
    };
  });
  return computeScopeLight({ ourUsd, matches: scoped, competitors, now });
}

/**
 * Spec §3 ("דריסה ידנית גוברת כל עוד המתחרה המנורמל לא זז יותר מ-OVERRIDE_DRIFT_USD"):
 * a manual override outranks the recomputed light until the competitor price it was
 * taken against moves more than OVERRIDE_DRIFT_USD. A null on either side means there
 * is no drift to measure (the usual case - overrides are set on unchecked/alone/na
 * scopes that have no competitor number at all), so the override stands.
 */
function overrideStillHolds(override: LightOverride, detail: LightScopeDetail): boolean {
  const was = override.competitor_normalized_usd;
  if (was == null || detail.normalized_usd == null) return true;
  return Math.abs(detail.normalized_usd - was) <= OVERRIDE_DRIFT_USD;
}

export async function recomputeEventLights(
  eventId: number,
  trigger: MatchTrigger,
  opts: { dryRun?: boolean } = {},
): Promise<{ before: Lights; after: Lights; changed: boolean; detail: LightDetail }> {
  const event = await loadEventForLight(eventId);
  if (!event) throw new Error(`price-light: event ${eventId} not found`);
  const now = new Date().toISOString();
  const matches = await loadLatestMatches(eventId);
  const pkg = scopeDetail(event, "package", matches, now);
  const tkt = scopeDetail(event, "ticket", matches, now);

  // `light_detail.override` is a single scope-tagged field (setLightOverride replaces
  // it wholesale), so at most one scope is ever overridden. Keep it while it still
  // holds; once the competitor drifted past the threshold, drop it and let the
  // computed light through - the market moved, the manual call is stale.
  const override = event.light_detail?.override ?? null;
  const overrideDetail = override ? (override.scope === "package" ? pkg : tkt) : null;
  const keepOverride = override != null && overrideDetail != null && overrideStillHolds(override, overrideDetail);

  // `ours` (our package's described contents, lib/services/our-offer-detail.ts) is not this pass's
  // to compute - it is carried over as read, or every nightly recompute would erase it.
  const detail: LightDetail = {
    package: pkg, ticket: tkt, override: keepOverride ? override : null,
    ours: event.light_detail?.ours ?? null,
  };
  const before: Lights = { package: event.light_package, ticket: event.light_ticket };
  const after: Lights = {
    package: keepOverride && override?.scope === "package" ? override.light : pkg.light,
    ticket: keepOverride && override?.scope === "ticket" ? override.light : tkt.light,
  };
  const changed = before.package !== after.package || before.ticket !== after.ticket;
  // "השאר בפיד" mutes a RED light. Once no scope is red any more the mute has nothing
  // left to hide, so it is cleared in the same write that records the new lights -
  // otherwise a stale `light_silenced_until` would keep a future red out of
  // "ממתינים להחלטה" without anyone deciding that.
  // "unchecked" is not "no longer red": a competitor site blocked for two weeks turns a real red
  // into unchecked without anyone deciding anything, and must not lift a mute on its way.
  const clearSilence = lightSettled(after.package) && lightSettled(after.ticket) && event.light_silenced_until != null;
  if (!opts.dryRun) {
    const { error } = await db
      .from("events")
      .update({
        light_package: after.package, light_ticket: after.ticket, light_detail: detail, light_checked_at: now,
        ...(clearSilence ? { light_silenced_until: null } : {}),
      })
      .eq("id", eventId);
    if (error) { console.error(`price-light: write lights ${eventId} (${trigger}) failed`, JSON.stringify(error)); throw error; }
    try {
      // Dynamic import avoids a store <-> tasks import cycle (tasks imports
      // LightEvent/Lights types from this file).
      const { closePriceLightTasksIfNotRed } = await import("@/lib/services/price-light-tasks");
      await closePriceLightTasksIfNotRed(eventId, after);
    } catch (e) {
      console.error(`price-light: auto-close tasks ${eventId} (${trigger}) failed`, e);
    }
  }
  return { before, after, changed, detail };
}

function isoDaysAgo(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Spec §6.2 steps 1-2: today's snapshot + the price-drop tag decision. */
export async function writeSnapshotAndTag(
  event: LightEvent,
  today: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ tagged: boolean; cleared: boolean; packageUsd: number | null }> {
  const packageUsd = ourPackageUsd(event);
  const ticketUsd = ourTicketUsd(event);
  const snapshot = {
    event_id: event.id, day: today, package_usd: packageUsd, ticket_usd: ticketUsd,
    min_ticket: minAvailableTicketUsd(event), base_flight: Math.round(Number(event.base_flight_price) || 0),
    base_hotel: Math.round(Number(event.base_hotel_price) || 0), markup: Math.round(totalMarkupUsd(event)),
  };

  // Reference window: 10-21 days back (LOOKBACK-4 .. LOOKBACK+7). Fetch every snapshot in
  // that window and pick the one whose day is closest to `today - PRICE_DROP_LOOKBACK_DAYS`
  // (ties -> the older row), rather than trusting the query's own ordering to land on it -
  // "order by day desc limit 1" would just return the freshest-in-window row (nearest the
  // 10-day edge), not the one nearest the 14-day target.
  const { data: refRows, error: refError } = await db
    .from("event_price_snapshots")
    .select("day,package_usd")
    .eq("event_id", event.id)
    .lte("day", isoDaysAgo(today, PRICE_DROP_LOOKBACK_DAYS - 4))
    .gte("day", isoDaysAgo(today, PRICE_DROP_LOOKBACK_DAYS + 7))
    .limit(12);
  if (refError) console.error("price-light: snapshot ref failed", JSON.stringify(refError));

  const target = isoDaysAgo(today, PRICE_DROP_LOOKBACK_DAYS);
  const targetMs = new Date(`${target}T00:00:00.000Z`).getTime();
  let refRow: { day: string; package_usd: number | null } | null = null;
  for (const row of (refRows ?? []) as { day: string; package_usd: number | null }[]) {
    if (!refRow) { refRow = row; continue; }
    const rowDist = Math.abs(new Date(`${row.day}T00:00:00.000Z`).getTime() - targetMs);
    const bestDist = Math.abs(new Date(`${refRow.day}T00:00:00.000Z`).getTime() - targetMs);
    // Strictly closer wins; on a tie, prefer the older row (smaller day).
    if (rowDist < bestDist || (rowDist === bestDist && row.day < refRow.day)) refRow = row;
  }

  const current = event.price_drop_usd != null && event.price_drop_from != null && event.price_drop_until
    ? { usd: event.price_drop_usd, from: event.price_drop_from, until: event.price_drop_until }
    : null;
  const decision = decidePriceDrop({ today, todayUsd: packageUsd, refUsd: refRow?.package_usd ?? null, current });
  const next = decision ? { usd: decision.usd, from: decision.from, until: decision.until } : null;
  // Field-wise compare, not `!current`/`!decision` alone - an EXPIRED tag (until < today)
  // that rolls into a brand-new drop still has a non-null `current`, so that shortcut would
  // never write it. Any field differing (including a fresh `until`) means the write is real.
  const dirty = (next?.usd ?? null) !== (current?.usd ?? null) ||
    (next?.from ?? null) !== (current?.from ?? null) ||
    (next?.until ?? null) !== (current?.until ?? null);
  const tagged = !!next && dirty;
  const cleared = !next && !!current;

  if (!opts.dryRun) {
    const { error: snapError } = await db.from("event_price_snapshots").upsert(snapshot, { onConflict: "event_id,day" });
    if (snapError) { console.error("price-light: snapshot upsert failed", JSON.stringify(snapError)); throw snapError; }
    if (dirty) {
      const { error } = await db.from("events").update({
        price_drop_usd: next?.usd ?? null, price_drop_from: next?.from ?? null, price_drop_until: next?.until ?? null,
      }).eq("id", event.id);
      if (error) { console.error("price-light: tag write failed", JSON.stringify(error)); throw error; }
    }
  }
  return { tagged, cleared, packageUsd };
}

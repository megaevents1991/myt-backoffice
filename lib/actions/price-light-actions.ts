"use server";

import { unstable_cache } from "next/cache";
import { requireAdmin, requireStaff } from "@/lib/auth/guards";
import { invalidatePriceLight, PRICE_LIGHT_TAG, PRICE_LIGHT_TTL_S } from "@/lib/services/price-light-cache";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { revalidateMain } from "@/lib/revalidate-main";
import { fetchPaged } from "@/lib/supabase-paged";
import { matchAllForEvent } from "@/lib/services/price-light-match";
import { musicTaggedEventIds, musicTagSlugs, tagSlugsForEvent } from "@/lib/services/price-light-tags";
import { aiEnabled } from "@/lib/services/price-light-judge";
import { loadJudgeMemory } from "@/lib/services/price-light-memory";
import {
  LIGHT_EVENT_COLUMNS,
  loadEventForLight,
  recomputeEventLights,
  type LightEvent,
  type Lights,
} from "@/lib/services/price-light-store";
import { openPriceLightTask as insertPriceLightTask } from "@/lib/services/price-light-tasks";
import { lightSnapshot, recordRepriced, snapshotFor } from "@/lib/services/price-light-decisions";
import { OPEN_TASK_STATUSES } from "@/types/task.types";
import {
  addDays, cheapestAvailableTicket, competitorsFor, kindOf, minAvailableTicketUsd, ourFromUsd, ourNights, ourOfferLines,
  ourPackageUsd, ourTicketUsd, PRICE_DROP_MIN_USD, PRICE_DROP_SHOW_DAYS, totalMarkupUsd,
} from "@/lib/services/price-light";
import { formatOfferLines, parseOfferDetail } from "@/lib/services/offer-detail";
import {
  describeOurOffer, OUR_OFFER_EVENT_COLUMNS, OUR_OFFER_REFRESH_DAYS, storeOurOffer, type OurOfferEvent,
} from "@/lib/services/our-offer-detail";
import {
  ACTIVE_COMPETITORS,
  scraperFor,
  type CompetitorScraper,
} from "@/lib/services/competitor-scrapers";
import { circuitOpen, runCrawl, type CrawlSummary } from "@/lib/services/price-light-crawl";
import { softDeleteEvent } from "@/lib/actions/event-actions";
import { OVERRIDE_NOTE_MAX, RECHECK_AI_CALLS, SILENCE_DAYS, SILENCE_DAYS_MAX } from "@/lib/actions/price-light-constants";
import { ADMIN_ROLES } from "@/types/auth.types";
import {
  LIGHTS,
  SCOPES,
  type ComparisonOffer,
  type CompetitorAnswer,
  type CompetitorKey,
  type OfferLines,
  type PriceLightComparison,
  type CrawlStatus,
  type EventKind,
  type Light,
  type LightDetail,
  type LightOverride,
  type LightScopeDetail,
  type ListingRow,
  type MatchMethod,
  type MatchRow,
  type PriceLightRow,
  type PriceLightScopeCell,
  type Scope,
} from "@/types/price-light.types";

// New tables predate the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Shared shape for actions that only report success/failure. */
export type Ok = { ok: true } | { ok: false; error: string };

// SILENCE_DAYS moved to price-light-constants.ts (imported above, used by
// silenceRedLight below) - a "use server" file may only export async
// functions, and `export const` here broke `npm run build` the moment a
// client component imported it (found while building /price-light). Import
// it from price-light-constants.ts directly - it can no longer be re-exported
// from this module.

/**
 * "בדוק עכשיו": re-match against the stored catalogs and recompute both lights. No browsing.
 * Returns `lights` (package/ticket) together with `detail` (the `LightDetail` the label/tooltip
 * read) and `checked_at` so the caller can patch `light_package`, `light_ticket`, `light_detail`,
 * and `light_checked_at` on the row in one shot - patching only the first two leaves the
 * label/tooltip stale after a recheck.
 */
export async function recheckEvent(
  eventId: number,
  // /price-light asks for both: the fresh row (so the client patches ONE row instead of reloading
  // the list - a reload re-sorted the table and the row the reader was on jumped away) and a
  // re-description of our own package when it has gone stale. The events-table icon asks for neither.
  opts: { withRow?: boolean; describeOurs?: boolean } = {},
): Promise<
  | { ok: true; lights: Lights; detail: LightDetail; checked_at: string; row: PriceLightRow | null; described_ours: boolean }
  | { ok: false; error: string }
> {
  const session = await requireStaff();
  // The refresh icon is on /events, which editors see; spending AI calls is an admin decision
  // everywhere else in this feature, so an editor's recheck is rule-only.
  const canSpend = ADMIN_ROLES.includes(session.role);
  try {
    // A manual recheck must judge by exactly the same rules the nightly does, corrections
    // included - otherwise "בדוק עכשיו" could answer differently from last night's pass on
    // identical inputs. One small audit-log read, and only when the AI is actually on.
    const aiMemory = canSpend && aiEnabled() ? await loadJudgeMemory() : null;
    // Paid searches (Amadeus + hotels) - an admin decision, like the AI calls below.
    const describedOurs = canSpend && opts.describeOurs === true ? await describeOursIfStale(eventId) : false;
    // A ceiling on ONE click. Every other AI call site runs under a run-wide budget; a manual
    // recheck has no run to belong to, so without this a click could fan out to one call per
    // competitor per scope, and a staff member working down a list of reds would spend at the
    // nightly's rate with nothing accounting for it. The per-(event, listing) cache means
    // re-clicking the same row after this is free anyway.
    const result = await matchAllForEvent(eventId, "manual", canSpend
      ? { aiMemory, aiBudget: { remaining: RECHECK_AI_CALLS } }
      : { judge: null });
    if (!result) return { ok: false, error: "event not found or deleted" };
    invalidatePriceLight("rows", "cost");
    return {
      ok: true, lights: result.lights.after, detail: result.lights.detail, checked_at: new Date().toISOString(),
      // The row is the admin screen's payload (competitor prices, our margin-free price): an
      // editor reaches this action through the events-table icon and must not be handed it.
      row: canSpend && opts.withRow === true ? await buildPriceLightRow(eventId) : null,
      described_ours: describedOurs,
    };
  } catch (e) {
    console.error("recheckEvent failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

export async function listEventMatches(eventId: number): Promise<{ matches: MatchRow[]; listings: Record<number, ListingRow> }> {
  await requireStaff();
  const { data, error } = await db.from("competitor_matches")
    .select("id,event_id,competitor,scope,listing_id,status,method,ai_verdict,raw_price,raw_currency,price_usd,normalized_usd,adjustments,attrs,our_usd,diff_usd,light,listing_changed_at,note,created_at")
    .eq("event_id", eventId).order("created_at", { ascending: false }).limit(50);
  if (error) { console.error("listEventMatches failed", JSON.stringify(error)); return { matches: [], listings: {} }; }
  const matches = (data ?? []) as MatchRow[];
  const ids = [...new Set(matches.map((m) => m.listing_id).filter((id): id is number => id != null))];
  const listings: Record<number, ListingRow> = {};
  if (ids.length) {
    const { data: rows, error: lErr } = await db.from("competitor_listings")
      .select("id,competitor,external_key,scope,title,title_he,event_date,city,venue,price_from,currency,price_usd,travel_depart,travel_return,attrs,detail_text,url,first_seen_at,last_seen_at,last_changed_at,run_id")
      .in("id", ids);
    if (lErr) console.error("listEventMatches listings failed", JSON.stringify(lErr));
    for (const r of (rows ?? []) as ListingRow[]) listings[r.id] = r;
  }
  return { matches, listings };
}

// ---- side-by-side comparison (partner, 2026-09-14) ---------------------------------------------
type NewestMatchRow = Pick<MatchRow, "id" | "competitor" | "scope" | "status" | "listing_id" | "raw_price" | "raw_currency" |
  "price_usd" | "normalized_usd" | "diff_usd" | "light" | "attrs" | "note" | "created_at">;
type ComparisonListing = Pick<ListingRow, "id" | "title" | "url" | "event_date" | "travel_depart" | "travel_return" |
  "attrs" | "detail_text" | "last_seen_at" | "price_from" | "currency" | "price_usd">;

const nightsBetweenDays = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const n = Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * One event, every competitor, both scopes - with what each package CONTAINS (flight, hotel, seat).
 * Loaded on demand for one row, never with the list: detail pages run to 6,000 characters each.
 */
async function buildComparison(eventId: number): Promise<PriceLightComparison | null> {
  const event = await loadEventForLight(eventId);
  if (!event) return null;
  // The vertical is read off the feed tags, not `type` alone (kindOf, 2026-09-17) - one query
  // for this one event, so the comparison lists the same competitors the light was set against.
  const kind = kindOf(event, await tagSlugsForEvent(eventId));

  const { data: matchData, error: matchError } = await db.from("competitor_matches")
    .select("id,competitor,scope,status,listing_id,raw_price,raw_currency,price_usd,normalized_usd,diff_usd,light,attrs,note,created_at")
    .eq("event_id", eventId).order("created_at", { ascending: false }).limit(60);
  if (matchError) console.error("buildComparison: matches failed", JSON.stringify(matchError));
  const newest = new Map<string, NewestMatchRow>();
  for (const m of (matchData ?? []) as NewestMatchRow[]) {
    const key = `${m.scope}:${m.competitor}`;
    if (!newest.has(key)) newest.set(key, m);
  }

  const listingIds = [...new Set([...newest.values()].map((m) => m.listing_id).filter((id): id is number => id != null))];
  const listings = new Map<number, ComparisonListing>();
  if (listingIds.length > 0) {
    const { data, error } = await db.from("competitor_listings")
      .select("id,title,url,event_date,travel_depart,travel_return,attrs,detail_text,last_seen_at,price_from,currency,price_usd")
      .in("id", listingIds);
    if (error) console.error("buildComparison: listings failed", JSON.stringify(error));
    for (const l of (data ?? []) as ComparisonListing[]) listings.set(l.id, l);
  }

  const ours = event.light_detail?.ours ?? null;
  const ticket = cheapestAvailableTicket(event);
  const ticketName = [ticket?.category, ticket?.description].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ") || null;
  // Never described yet -> the rule's own wording, so the column is never blank.
  const ruleLines = ourOfferLines(event);
  const ruleText = (key: "flight" | "hotel") => ruleLines.find((l) => l.key === key)?.detail ?? null;

  const offersFor = (scope: Scope): ComparisonOffer[] => {
    // Package: the margin-free "from" price the light compares; the site price rides along.
    const ourUsd = scope === "package" ? ourFromUsd(event) : ourTicketUsd(event);
    if (ourUsd == null) return [];
    const detail = event.light_detail?.[scope];
    const oursLines: OfferLines = scope === "package"
      ? {
          flight: ours?.flight ? formatOfferLines({ flight: ours.flight, hotel: null, ticket: null, multiMatch: false }).flight : ruleText("flight"),
          hotel: ours?.hotel ? formatOfferLines({ flight: null, hotel: ours.hotel, ticket: null, multiMatch: false }).hotel : ruleText("hotel"),
          ticket: ticketName,
        }
      : { flight: null, hotel: null, ticket: ticketName };
    const us: ComparisonOffer = {
      who: "ours", status: "ours", quote_only: false, raw: ourUsd, raw_currency: "USD", usd: ourUsd,
      normalized_usd: ourUsd, diff_usd: null, light: null, decided: false, title: event.name, url: null,
      depart: scope === "package" ? event.def_date_depart ?? null : null,
      return: scope === "package" ? event.def_date_return ?? null : null,
      nights: scope === "package" ? ourNights(event) : null,
      lines: oursLines, multi_match: false, seen_at: ours?.at ?? null,
      site_usd: scope === "package" ? ourPackageUsd(event) : null,
      markup_usd: scope === "package" ? totalMarkupUsd(event) || null : null,
    };

    const theirs = competitorsFor(kind, scope, ACTIVE_COMPETITORS).map<ComparisonOffer>((competitor) => {
      const m = newest.get(`${scope}:${competitor}`) ?? null;
      const per = detail?.per_competitor?.[competitor];
      const listing = m?.listing_id != null ? listings.get(m.listing_id) ?? null : null;
      const attrs = m?.attrs ?? listing?.attrs ?? null;
      const parsed = listing ? parseOfferDetail(competitor, listing.detail_text, attrs) : null;
      const lines = parsed ? formatOfferLines(parsed) : { flight: null, hotel: null, ticket: null };
      return {
        who: competitor,
        status: per?.status ?? m?.status ?? "skipped",
        quote_only: per?.quote_only ?? m?.note === "quote_only",
        raw: m?.raw_price ?? listing?.price_from ?? null,
        raw_currency: m?.raw_currency ?? listing?.currency ?? null,
        usd: m?.price_usd ?? listing?.price_usd ?? null,
        normalized_usd: per?.normalized_usd ?? m?.normalized_usd ?? null,
        diff_usd: per?.diff_usd ?? m?.diff_usd ?? null,
        light: per?.light ?? null,
        decided: detail?.competitor === competitor,
        title: listing?.title ?? null,
        url: listing?.url ?? null,
        depart: listing?.travel_depart ?? null,
        return: listing?.travel_return ?? null,
        nights: typeof attrs?.nights === "number" ? attrs.nights : nightsBetweenDays(listing?.travel_depart ?? null, listing?.travel_return ?? null),
        // A ticket listing is the ticket - flight/hotel lines there would be noise.
        lines: scope === "ticket" ? { flight: null, hotel: null, ticket: lines.ticket } : lines,
        multi_match: parsed?.multiMatch ?? false,
        seen_at: listing?.last_seen_at ?? m?.created_at ?? null,
        site_usd: null,
        markup_usd: null,
      };
    });
    // The one that set the light first, then the priced ones cheapest-first, then everyone else.
    theirs.sort((a, b) =>
      Number(b.decided) - Number(a.decided) ||
      (a.normalized_usd ?? Infinity) - (b.normalized_usd ?? Infinity));
    return [us, ...theirs];
  };

  return {
    event_id: event.id,
    name: event.name,
    date: event.date,
    ours_at: ours?.at ?? null,
    ours_errors: ours?.errors ?? [],
    package: offersFor("package"),
    ticket: offersFor("ticket"),
  };
}

/** The side-by-side comparison for one event row on /price-light. */
export async function getPriceLightComparison(eventId: number): Promise<PriceLightComparison | null> {
  // Admin-only surface (competitor prices / AI spend) - same bar as the /price-light page.
  await requireAdmin();
  try {
    return await buildComparison(eventId);
  } catch (e) {
    console.error("getPriceLightComparison failed", e);
    return null;
  }
}

/**
 * "פרט עכשיו": describe OUR package's contents right now (the rule's Amadeus + hotel searches, or the
 * linked offline inventory), store it, and hand back the refreshed comparison. Admin-only - it spends
 * paid searches. Describes; never writes a price.
 */
export async function refreshOurOffer(
  eventId: number,
): Promise<{ ok: true; comparison: PriceLightComparison } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    const { data, error } = await db.from("events").select(OUR_OFFER_EVENT_COLUMNS).eq("id", eventId).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "event not found" };
    const ours = await describeOurOffer(data as OurOfferEvent);
    await storeOurOffer(eventId, ours);
    invalidatePriceLight("rows");
    const comparison = await buildComparison(eventId);
    return comparison ? { ok: true, comparison } : { ok: false, error: "event not found" };
  } catch (e) {
    console.error("refreshOurOffer failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

// lightSnapshot / snapshotFor moved to lib/services/price-light-decisions.ts (2026-09-16) so a
// price_light task-closing rule and the all-staff Pricing tab can stamp the exact same evidence
// without going through this admin-gated file. Imported above.

/**
 * Re-describe OUR package when `light_detail.ours` is missing or older than OUR_OFFER_REFRESH_DAYS -
 * the comparison the reader is about to judge should not rest on a week-old flight. Never throws:
 * a failed description must not fail the recheck it rides on. Returns whether it described.
 */
async function describeOursIfStale(eventId: number): Promise<boolean> {
  try {
    const { data, error } = await db.from("events").select(`${OUR_OFFER_EVENT_COLUMNS},light_detail`).eq("id", eventId).maybeSingle();
    if (error || !data) return false;
    const at = (data as { light_detail?: LightDetail | null }).light_detail?.ours?.at ?? null;
    if (at && Date.now() - Date.parse(at) < OUR_OFFER_REFRESH_DAYS * 86_400_000) return false;
    await storeOurOffer(eventId, await describeOurOffer(data as OurOfferEvent));
    return true;
  } catch (e) {
    console.error("describeOursIfStale failed (recheck continues)", e);
    return false;
  }
}

/** A decision that changed the row: the fresh row comes back so the client patches it in place. */
type RowResult = { ok: true; row: PriceLightRow | null } | { ok: false; kind: "invalid" | "not_found" | "db" | "failed" };

const LIGHT_MARKUP_MAX_USD = 5_000;

/**
 * "הוזל" with a number: the ONE price write this feature makes, and it is a markup - never a base
 * price, never the pricing rule. package -> `event_additional_markup`, ticket -> `ticket_only_markup`
 * (null clears the ticket-only price). Written as a single explicit column, NOT through `updateEvent`
 * (which takes a whole client object). `markPriceDrop` additionally stamps the site's "ירידת מחיר"
 * tag from the SITE card price before/after (`ourPackageUsd` - what the customer sees), in the same
 * columns and for the same PRICE_DROP_SHOW_DAYS the nightly tag uses; below PRICE_DROP_MIN_USD the
 * nightly would clear it the same night, so it is not written at all.
 */
export async function setEventMarkupFromLight(
  eventId: number,
  scope: Scope,
  value: number | null,
  opts: { markPriceDrop?: boolean } = {},
): Promise<RowResult> {
  await requireAdmin();
  if (!SCOPES.includes(scope)) return { ok: false, kind: "invalid" };
  if (value === null ? scope !== "ticket" : !(Number.isFinite(value) && value >= 0 && value <= LIGHT_MARKUP_MAX_USD)) {
    return { ok: false, kind: "invalid" };
  }
  try {
    const event = await loadEventForLight(eventId);
    if (!event || event.is_deleted) return { ok: false, kind: "not_found" };
    const column = scope === "package" ? "event_additional_markup" : "ticket_only_markup";
    const before = scope === "package" ? event.event_additional_markup ?? null : event.ticket_only_markup ?? null;
    const after = value === null ? null : Math.round(value);
    const snapshot = lightSnapshot(event, scope); // BEFORE the write - the comparison the human judged

    const update: Record<string, number | string | null> = { [column]: after };
    let priceDrop: { usd: number; from: number; until: string } | null = null;
    if (opts.markPriceDrop === true && scope === "package") {
      const siteBefore = ourPackageUsd(event);
      const siteAfter = ourPackageUsd({ ...event, event_additional_markup: after ?? 0 });
      const today = new Date().toISOString().slice(0, 10);
      // A tag already live keeps its reference price: trimming another $60 off an event the nightly
      // tagged "$200 down from $1,500" must read "$260 down from $1,500", not "$60 down from $1,300".
      const liveFrom = event.price_drop_from != null && event.price_drop_until != null && event.price_drop_until >= today
        ? event.price_drop_from
        : null;
      const from = liveFrom != null && siteBefore != null ? Math.max(liveFrom, siteBefore) : siteBefore;
      if (from != null && siteBefore != null && siteAfter != null && siteBefore > siteAfter && from - siteAfter >= PRICE_DROP_MIN_USD) {
        priceDrop = { usd: from - siteAfter, from, until: addDays(today, PRICE_DROP_SHOW_DAYS) };
        update.price_drop_usd = priceDrop.usd;
        update.price_drop_from = priceDrop.from;
        update.price_drop_until = priceDrop.until;
      }
    }
    const { error } = await db.from("events").update(update).eq("id", eventId);
    if (error) { console.error("setEventMarkupFromLight: update failed", JSON.stringify(error)); return { ok: false, kind: "db" }; }

    // The price is already live from here on, so the record comes FIRST: a recompute that throws
    // (a transient match read) must not lose the audit row - the agent's strongest signal - nor
    // tell the admin "failed" about a markup that was in fact saved.
    await logAudit({
      action: "price_light.repriced", entityType: "event", entityId: eventId,
      metadata: { ...(snapshot ?? { scope }), column, before, after, ...(priceDrop ? { price_drop: priceDrop } : {}) },
    });
    try {
      await recomputeEventLights(eventId, "manual");
    } catch (e) {
      console.error("setEventMarkupFromLight: recompute failed after the write (the nightly will catch up)", e);
    }
    invalidatePriceLight("rows");
    await revalidateMain();
    return { ok: true, row: await buildPriceLightRow(eventId) };
  } catch (e) {
    console.error("setEventMarkupFromLight failed", e);
    return { ok: false, kind: "failed" };
  }
}

/**
 * "סולד אאוט": takes the event off sale on the site without deleting it - main reads
 * `tags === "Sold"` (its `isEventSoldOut`): sold-out card, not bookable, out of search, "out of
 * stock" in the feed. The tag it replaces is kept in the audit row, and turning it off restores it.
 */
export async function setEventSoldOut(eventId: number, on: boolean): Promise<RowResult> {
  await requireAdmin();
  try {
    const event = await loadEventForLight(eventId);
    if (!event || event.is_deleted) return { ok: false, kind: "not_found" };
    const current = event.tags ?? null;
    let next: string | null = "Sold";
    if (!on) {
      if (current !== "Sold") return { ok: true, row: await buildPriceLightRow(eventId) };
      // The tag to restore is the one OUR mark replaced - and only while that mark still stands.
      // "Sold" is also written, unaudited, by the 2-hourly ticket sync: if the newest thing we
      // recorded is a CLEAR, today's "Sold" is the sync's, and an old previous tag ("Hot") must
      // not be resurrected onto a genuinely sold-out event. Then the answer is simply no tag.
      const { data, error } = await db.from("audit_log").select("action,metadata")
        .in("action", ["price_light.sold_out", "price_light.sold_out_cleared"])
        .eq("entity_type", "event").eq("entity_id", String(eventId)).order("created_at", { ascending: false }).limit(1);
      if (error) console.error("setEventSoldOut: previous tag read failed", JSON.stringify(error));
      const newest = ((data ?? []) as { action: string; metadata: { previous_tags?: string | null } | null }[])[0] ?? null;
      const previous = newest?.action === "price_light.sold_out" ? newest.metadata?.previous_tags ?? null : null;
      next = previous === "Sold" ? null : previous;
    } else if (current === "Sold") {
      return { ok: true, row: await buildPriceLightRow(eventId) };
    }
    const snapshot = await snapshotFor(eventId);
    const { error } = await db.from("events").update({ tags: next }).eq("id", eventId);
    if (error) { console.error("setEventSoldOut: update failed", JSON.stringify(error)); return { ok: false, kind: "db" }; }
    invalidatePriceLight("rows");
    await revalidateMain();
    await logAudit({
      action: on ? "price_light.sold_out" : "price_light.sold_out_cleared", entityType: "event", entityId: eventId,
      metadata: { ...(snapshot ?? {}), previous_tags: current },
    });
    return { ok: true, row: await buildPriceLightRow(eventId) };
  } catch (e) {
    console.error("setEventSoldOut failed", e);
    return { ok: false, kind: "failed" };
  }
}

/**
 * "הוזל": records that a human looked at a red light, judged the gap REAL, and went to fix our
 * price. Nothing else happens here - the price itself is edited on the event page, and the light
 * never writes a price. This exists purely so the strongest signal we have stops being invisible:
 * before it, the button was a plain link and the decision left no trace at all.
 */
export async function markRepriced(eventId: number, scope: Scope): Promise<Ok> {
  // Admin, like every other decision here: it is only reachable from the admin-only /price-light
  // screen, and what it writes becomes evidence the agent learns from. The write itself is shared
  // with the task-closing rule and the Pricing tab - see lib/services/price-light-decisions.ts.
  const session = await requireAdmin();
  return recordRepriced(eventId, scope, session.sub);
}

/** "מזכיר לי מאוחר יותר": mute a red light for `days` (default SILENCE_DAYS) without touching the light itself. */
export async function silenceRedLight(eventId: number, days: number = SILENCE_DAYS): Promise<Ok> {
  await requireAdmin();
  // A server action is a public endpoint: never trust the client's number. An absurd `days` made
  // toISOString() throw a RangeError; clamp to a sane mute instead.
  const safeDays = Number.isFinite(days) ? Math.min(SILENCE_DAYS_MAX, Math.max(1, Math.round(days))) : SILENCE_DAYS;
  try {
    // Read the light BEFORE muting it - this row is the agent's record of what a human saw and
    // chose to accept, and the mute itself changes nothing about the comparison it describes.
    const snapshot = await snapshotFor(eventId);
    const until = new Date(Date.now() + safeDays * 86_400_000).toISOString();
    const { error } = await db.from("events").update({ light_silenced_until: until }).eq("id", eventId);
    if (error) {
      console.error("silenceRedLight failed", JSON.stringify(error));
      return { ok: false, error: "update failed" };
    }
    await logAudit({ action: "price_light.silenced", entityType: "event", entityId: eventId, metadata: { ...(snapshot ?? {}), days: safeDays, until } });
    invalidatePriceLight("rows");
    return { ok: true };
  } catch (e) {
    console.error("silenceRedLight failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

/**
 * Manual override of the computed light for one scope (e.g. staff knows the competitor stopped
 * selling even though the crawler still shows a price). `light_detail.override` is a single,
 * scope-tagged field - setting an override for one scope replaces whatever override (if any) was
 * previously active for the other scope too, by design (one manual call at a time per event).
 */
export async function setLightOverride(eventId: number, scope: Scope, light: Light, note: string): Promise<Ok> {
  const session = await requireAdmin();
  // Validated server-side: `light` lands in `light_package`/`light_ticket`, a column the main app
  // reads, and the note is quoted into every AI prompt - neither may be whatever a client sends.
  if (!(SCOPES as readonly string[]).includes(scope)) return { ok: false, error: "invalid scope" };
  if (!(LIGHTS as readonly string[]).includes(light) || light === "na") return { ok: false, error: "invalid light" };
  const trimmed = (note ?? "").trim();
  if (trimmed.length < 3) return { ok: false, error: "note must be at least 3 characters" };
  if (trimmed.length > OVERRIDE_NOTE_MAX) return { ok: false, error: `note must be at most ${OVERRIDE_NOTE_MAX} characters` };
  try {
    const event = await loadEventForLight(eventId);
    if (!event) return { ok: false, error: "event not found" };
    const currentDetail: LightDetail = event.light_detail ?? {};
    const now = new Date().toISOString();
    const override: LightOverride = {
      scope,
      light,
      note: trimmed,
      by: session.email,
      at: now,
      competitor_normalized_usd: currentDetail[scope]?.normalized_usd ?? null,
    };
    const column = scope === "package" ? "light_package" : "light_ticket";
    // A forced light IS the light the reader sees, so forcing it is a change - and this write
    // does not go through `recomputeEventLights`, which is where every other light change gets
    // its `light_changed_at`. Without this, an override never showed in "השתנה השבוע": the next
    // recompute compares the effective light against the column this write already forced, sees
    // them equal, and carries the old stamp forward. Only when the forced light actually differs
    // from what the column says today, and only if this scope has a detail to stamp.
    const currentScopeDetail = currentDetail[scope];
    const forcedIsNew = light !== (scope === "package" ? event.light_package : event.light_ticket);
    const nextDetail: LightDetail = {
      ...currentDetail,
      override,
      ...(currentScopeDetail && forcedIsNew
        ? { [scope]: { ...currentScopeDetail, light_changed_at: now } }
        : {}),
    };
    const { error } = await db.from("events").update({ light_detail: nextDetail, [column]: light }).eq("id", eventId);
    if (error) {
      console.error("setLightOverride failed", JSON.stringify(error));
      return { ok: false, error: "update failed" };
    }
    // `before` is the light this override overruled - the comparison the human disagreed with,
    // which is exactly what makes the note underneath it a lesson rather than an opinion.
    const before = lightSnapshot(event, scope);
    await logAudit({
      action: "price_light.override",
      entityType: "event",
      entityId: eventId,
      // `light` stays the OVERRULED light (from the snapshot) and the human's new one is
      // `to_light`: a lesson that read "package green — overruled to green" would describe
      // nothing. When there was no light to snapshot, `light` falls back to the new one.
      metadata: { ...(before ?? { scope, light }), to_light: light, note: trimmed },
    });
    invalidatePriceLight("rows");
    return { ok: true };
  } catch (e) {
    console.error("setLightOverride failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

/** Removes the manual override, then lets the normal rule recompute both lights from scratch. */
export async function clearLightOverride(eventId: number): Promise<Ok> {
  await requireAdmin();
  try {
    const event = await loadEventForLight(eventId);
    if (!event) return { ok: false, error: "event not found" };
    const detail = event.light_detail;
    if (!detail || !detail.override) return { ok: false, error: "no override set" };
    // Spread, then clear: rebuilding from package/ticket alone silently erased `ours`.
    const nextDetail: LightDetail = { ...detail, override: null };
    const { error } = await db.from("events").update({ light_detail: nextDetail }).eq("id", eventId);
    if (error) {
      console.error("clearLightOverride failed", JSON.stringify(error));
      return { ok: false, error: "update failed" };
    }
    await recomputeEventLights(eventId, "manual");
    await logAudit({ action: "price_light.override_cleared", entityType: "event", entityId: eventId });
    invalidatePriceLight("rows");
    return { ok: true };
  } catch (e) {
    console.error("clearLightOverride failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

/** "פתח משימה": open (or reuse) a price_light task for one red scope, carrying the current detail + history along. */
export async function openPriceLightTask(
  eventId: number,
  scope: Scope,
): Promise<{ ok: true; taskId: string; existed: boolean } | { ok: false; error: string }> {
  // Admin, like every other decision on /price-light: its audit row is a lesson the agent learns from.
  const session = await requireAdmin();
  try {
    const event = await loadEventForLight(eventId);
    if (!event) return { ok: false, error: "event not found" };
    const detail = event.light_detail?.[scope];
    if (!detail) return { ok: false, error: "no light detail for scope" };
    const { matches } = await listEventMatches(eventId);
    const opened = await insertPriceLightTask(event, scope, detail, matches, { id: session.sub });
    if (opened.ok) invalidatePriceLight("rows"); // `has_open_task` drops the row out of "ממתינים להחלטה"
    return opened;
  } catch (e) {
    console.error("openPriceLightTask failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

/** "הסר מהאתר": soft-delete the event (never a hard delete) once a red light is a lost cause. */
export async function removeEventFromSite(eventId: number): Promise<Ok> {
  await requireAdmin();
  try {
    // Snapshot first: after the soft delete the event drops out of every light query, and the
    // comparison a human refused to match would be unrecoverable.
    const snapshot = await snapshotFor(eventId);
    await softDeleteEvent(eventId); // invalidates the rows cache itself
    await logAudit({ action: "price_light.removed", entityType: "event", entityId: eventId, metadata: { ...(snapshot ?? {}) } });
    return { ok: true };
  } catch (e) {
    console.error("removeEventFromSite failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

// The row shapes this screen renders live in types/price-light.types.ts (`PriceLightRow`,
// `PriceLightScopeCell`, `CompetitorAnswer`): a "use server" file may only export async
// functions, so the types - and the pure helpers over them - cannot live here.

/** Row for the crawl-status panel: one per registered competitor scraper. */
export interface CrawlPanelRow {
  competitor: CompetitorKey;
  mode: CompetitorScraper["mode"];
  /** "local" = refreshed by scripts/crawl-local.ts off an Israeli address; no on-demand crawl from here. */
  crawlFrom: NonNullable<CompetitorScraper["crawlFrom"]>;
  intervalHours: number;
  last: { status: CrawlStatus; started_at: string; finished_at: string | null; listings: number; note: string | null } | null;
  nextDueAt: string | null;
  circuitOpen: boolean;
  totalListings: number;
}

// The list reads exactly the light projection - `light_silenced_until` moved into
// LIGHT_EVENT_COLUMNS itself once recomputeEventLights started clearing it.
// NOTE: `events` has no `city` column - city lives in the `location` jsonb (`location.name`).
const LIST_EVENT_COLUMNS = LIGHT_EVENT_COLUMNS;
type ListedEvent = LightEvent;

// A few hundred live future events at current catalog size.
const LIST_EVENTS_MAX = 5_000;
// ~2 scopes x a handful of competitors x every listed event's RECENT match history
// (bounded by NEWEST_MATCH_LOOKBACK_DAYS below, not by the whole table's lifetime).
const LIST_MATCHES_MAX = 20_000;
/** How far back `loadNewestMatches` looks. Well past LIGHT_STALE_DAYS (14) - a match older than
 *  this cannot be behind a live light, and reading past it only grows with the table's age. */
const NEWEST_MATCH_LOOKBACK_DAYS = 90;
// One open price_light task per red (event, scope) at most - well under the event count.
const LIST_TASKS_MAX = 5_000;

interface NewestMatch { event_id: number; scope: Scope; url: string | null; method: MatchMethod; created_at: string }

/** Every live, future, non-deleted, non-test event - the universe the price-light screen
 *  watches. `is_test` is filtered client-side, exactly as the nightly pass does, so the
 *  screen shows the same population the lights were computed for. `onlyRed` narrows it to
 *  events with a red light on either scope - the screen's first paint (see listPriceLight). */
async function loadListedEvents(onlyRed: boolean): Promise<ListedEvent[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { rows, error, truncated } = await fetchPaged<ListedEvent>(
    () => {
      const q = db
        .from("events")
        .select(LIST_EVENT_COLUMNS)
        .is("is_deleted", null)
        .gte("date", today);
      return (onlyRed ? q.or("light_package.eq.red,light_ticket.eq.red") : q).order("id", { ascending: true });
    },
    LIST_EVENTS_MAX,
  );
  if (error) console.error("listPriceLight: events failed", JSON.stringify(error));
  if (truncated) console.error(`listPriceLight: events truncated at ${LIST_EVENTS_MAX}`);
  return rows.filter((e) => !e.is_test);
}

/** `${row_id}:${scope}` for every currently-open price_light task - one query, no N+1 per row. */
async function loadOpenPriceLightTaskKeys(): Promise<Set<string>> {
  const { rows, error, truncated } = await fetchPaged<{ id: string; source_ref: { row_id: string | number; kind: string } | null }>(
    () =>
      db
        .from("tasks")
        .select("id,source_ref")
        .eq("source", "price_light")
        .is("deleted_at", null)
        .in("status", OPEN_TASK_STATUSES)
        .order("id", { ascending: true }),
    LIST_TASKS_MAX,
  );
  if (error) console.error("listPriceLight: open tasks failed", JSON.stringify(error));
  if (truncated) console.error(`listPriceLight: open tasks truncated at ${LIST_TASKS_MAX}`);
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.source_ref) keys.add(`${row.source_ref.row_id}:${row.source_ref.kind}`);
  }
  return keys;
}

/**
 * Newest competitor_matches row per (event_id, scope) for the listed events, with the match's
 * listing url in the same round trip.
 *
 * First choice is the `price_light_newest_matches` Postgres function (migration 20260916113000):
 * a DISTINCT ON that returns exactly the ~2 rows per event in ONE request. Before it existed the
 * screen paged through every match of the lookback window - 6,055 rows in 7 sequential pages,
 * 3.4s measured on 2026-09-16 - to keep 852 of them. That paged read stays as the fallback for a
 * deploy whose database has not run the migration yet (PGRST202 = function not found), so the
 * screen never breaks on the ordering of a merge and its migration.
 */
async function loadNewestMatches(eventIds: number[]): Promise<Map<string, NewestMatch>> {
  const map = new Map<string, NewestMatch>();
  if (eventIds.length === 0) return map;
  const since = new Date(Date.now() - NEWEST_MATCH_LOOKBACK_DAYS * 86_400_000).toISOString();

  const { data: newest, error: rpcError } = await db.rpc("price_light_newest_matches", { event_ids: eventIds, since });
  if (!rpcError) {
    for (const row of (newest ?? []) as { event_id: number; scope: Scope; method: MatchMethod; created_at: string; url: string | null }[]) {
      map.set(`${row.event_id}:${row.scope}`, { event_id: row.event_id, scope: row.scope, url: row.url, method: row.method, created_at: row.created_at });
    }
    return map;
  }
  if (rpcError.code !== "PGRST202") console.error("listPriceLight: newest-matches rpc failed, paging instead", JSON.stringify(rpcError));

  const { rows, error, truncated } = await fetchPaged<{
    id: number;
    event_id: number;
    scope: Scope;
    method: MatchMethod;
    created_at: string;
    competitor_listings: { url: string } | null;
  }>(
    () =>
      db
        .from("competitor_matches")
        .select("id,event_id,scope,method,created_at,competitor_listings(url)")
        .in("event_id", eventIds)
        // Only the recent past. This table is append-only and grows by ~170 rows a night, so an
        // unbounded read walks the whole history to use its newest row per (event, scope) - and
        // would silently hit LIST_MATCHES_MAX within months, at which point the events beyond the
        // cap quietly lose their listing link and "changed this week" flag. Nothing older than
        // NEWEST_MATCH_LOOKBACK_DAYS can be driving a live light anyway: a match goes stale at
        // LIGHT_STALE_DAYS (14).
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
    LIST_MATCHES_MAX,
  );
  if (error) console.error("listPriceLight: matches failed", JSON.stringify(error));
  if (truncated) console.error(`listPriceLight: matches truncated at ${LIST_MATCHES_MAX}`);
  // Rows arrive newest-first, so the first hit per key is the newest one.
  for (const row of rows) {
    const key = `${row.event_id}:${row.scope}`;
    if (!map.has(key)) {
      map.set(key, {
        event_id: row.event_id,
        scope: row.scope,
        url: row.competitor_listings?.url ?? null,
        method: row.method,
        created_at: row.created_at,
      });
    }
  }
  return map;
}

/** One scope's cell, or null when that scope has nothing to say for this event (`na`). */
function buildScopeCell(
  event: ListedEvent,
  scope: Scope,
  newest: NewestMatch | null,
  hasOpenTask: boolean,
  now: number,
  kind: EventKind,
): PriceLightScopeCell | null {
  const light: Light = (scope === "package" ? event.light_package : event.light_ticket) ?? "unchecked";
  if (light === "na") return null;
  const detail: LightScopeDetail | undefined = event.light_detail?.[scope];
  const decided = detail?.competitor ?? null;
  // Every active competitor for this scope, not only the one that set the light - the deciding
  // one first, then the rest in registry order, so the eye lands on the number that mattered.
  const perCompetitor = detail?.per_competitor ?? {};
  const competitors: CompetitorAnswer[] = competitorsFor(kind, scope, ACTIVE_COMPETITORS)
    .map((competitor) => {
      const answer = perCompetitor[competitor];
      return {
        competitor,
        status: answer?.status ?? "skipped",
        normalized_usd: answer?.normalized_usd ?? null,
        crawled_at: answer?.crawled_at ?? null,
        diff_usd: answer?.diff_usd ?? null,
        light: answer?.light ?? null,
        decided: competitor === decided,
        quote_only: answer?.quote_only ?? false,
      };
    })
    .sort((a, b) => Number(b.decided) - Number(a.decided));

  return {
    scope,
    light,
    diff_usd: detail?.diff_usd ?? null,
    our_usd: detail?.our_usd ?? null,
    // Pure arithmetic over columns already loaded - no extra query, no write on a read path.
    our_usd_now: scope === "package" ? ourFromUsd(event) : ourTicketUsd(event),
    site_usd: scope === "package" ? ourPackageUsd(event) : null,
    competitor: decided,
    normalized_usd: detail?.normalized_usd ?? null,
    raw: detail?.raw ?? null,
    raw_currency: detail?.raw_currency ?? null,
    listing_url: newest?.url ?? null,
    adjustments: detail?.adjustments.map((a) => a.label) ?? [],
    partial: detail?.partial ?? false,
    // The COVERAGE question, which "כיסוי חלקי" is named after: a competitor that should have
    // answered did not, so this scope has no verdict. `partial` above is the unrelated
    // normalization one (missing package contents) - the two shared a name and the view was
    // reading the wrong one (6 rows shown while ~248 scopes were unchecked for coverage).
    partial_coverage: detail?.reason === "partial_coverage",
    quote_only: detail?.reason === "quote_only",
    // `nights.theirs` is "unknown" when no competitor page ever said - null on the wire, so the
    // client renders "?" instead of inventing a number. Rows written before 2026-09-13 carry
    // neither field at all, hence the ?? fallbacks.
    nights_ours: detail?.nights?.ours ?? null,
    nights_theirs: typeof detail?.nights?.theirs === "number" ? detail.nights.theirs : null,
    uncertainty_usd: detail?.uncertainty_usd ?? 0,
    reason: detail?.reason ?? null,
    crawled_at: detail?.crawled_at ?? null,
    has_open_task: hasOpenTask,
    // The LIGHT changed, not "a match row was rewritten": match rows are rewritten whenever a
    // listing's price, attrs or freshness moves, so the old test (newest match younger than a
    // week) was true for all 436 events. `light_changed_at` is stamped only when the light the
    // reader sees actually moved; absent (rows written before 2026-09-17) = we do not know = no.
    changed_this_week: !!detail?.light_changed_at &&
      now - Date.parse(detail.light_changed_at) < 7 * 86_400_000,
    method: newest?.method ?? null,
    competitors,
    // Our own side, per the pricing rule. Package only: a ticket comparison IS the ticket, and
    // repeating its category under itself would be noise.
    ours: scope === "package"
      ? ourOfferLines(event).map((l) => ({ label: l.label, detail: l.detail, usd: l.usd }))
      : [],
  };
}

/**
 * One row per EVENT for the /price-light table, carrying both conclusions - three round trips
 * total, never one per event.
 *
 * `onlyRed`: just the events with a red light on either scope. The screen opens on "ממתינים
 * להחלטה", which is a subset of red, so it asks for this first and paints the table from it, then
 * fetches the whole list behind it for the other tiles and views. Measured 2026-09-16: 238 of
 * 426 events are red, so the first answer is about half the rows and bytes (550ms / 0.86 MB vs
 * 1.0s / 1.46 MB from Israel) - a half-second earlier table, not an order of magnitude. Same
 * shape, same code path - only the event filter differs - so a red row looks identical in both.
 *
 * Cached (lib/services/price-light-cache.ts): the answer is kept under the `rows` tag for
 * PRICE_LIGHT_TTL_S.rows seconds or until a write path invalidates it - a decision here, a
 * recheck, an event edit, a task closing, the nightly. Auth stays OUTSIDE the cached function:
 * `unstable_cache` cannot read cookies, and the cache is shared by every admin anyway.
 * A payload over Vercel's 2 MB data-cache item limit is silently not cached (today's full
 * list is about half that) - the screen then simply behaves as before this cache existed.
 */
export async function listPriceLight(opts: { onlyRed?: boolean } = {}): Promise<PriceLightRow[]> {
  // Admin-only surface (competitor prices / AI spend) - same bar as the /price-light page.
  await requireAdmin();
  return cachedPriceLightRows(opts.onlyRed === true);
}

const cachedPriceLightRows = unstable_cache(buildPriceLightRows, ["price-light-rows"], {
  tags: [PRICE_LIGHT_TAG.rows],
  revalidate: PRICE_LIGHT_TTL_S.rows,
});

async function buildPriceLightRows(onlyRed: boolean): Promise<PriceLightRow[]> {
  return rowsForEvents(await loadListedEvents(onlyRed));
}

/** ONE event's fresh row, uncached - what a decision hands back so the client patches in place.
 *  null when the event is gone/deleted or has nothing to say on either scope. */
async function buildPriceLightRow(eventId: number): Promise<PriceLightRow | null> {
  const event = await loadEventForLight(eventId);
  if (!event || event.is_deleted || event.is_test) return null;
  return (await rowsForEvents([event]))[0] ?? null;
}

async function rowsForEvents(events: ListedEvent[]): Promise<PriceLightRow[]> {
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const [openTaskKeys, newestMatches, musicIds] = await Promise.all([
    loadOpenPriceLightTaskKeys(),
    loadNewestMatches(eventIds),
    // Which of these events are music by TAG (kindOf, 2026-09-17) - one chunked read for the
    // whole list, never one per event. A failed read comes back empty and logs, so the list
    // still renders with type-only kinds rather than not at all.
    musicTaggedEventIds(eventIds),
  ]);

  const now = Date.now();
  const rows: PriceLightRow[] = [];
  for (const event of events) {
    const kind = kindOf(event, musicTagSlugs(musicIds.has(event.id)));
    const cellFor = (scope: Scope) => buildScopeCell(
      event,
      scope,
      newestMatches.get(`${event.id}:${scope}`) ?? null,
      openTaskKeys.has(`${event.id}:${scope}`),
      now,
      kind,
    );
    const pkg = cellFor("package");
    const tkt = cellFor("ticket");
    // An event with nothing to say on either scope is not a row - it would be an empty line the
    // reader has to check and discard.
    if (!pkg && !tkt) continue;
    rows.push({
      id: String(event.id),
      event_id: event.id,
      name: event.name,
      name_english: event.name_english ?? null,
      date: event.date,
      city: event.location?.name ?? null,
      kind,
      package: pkg,
      ticket: tkt,
      checked_at: event.light_checked_at,
      silenced_until: event.light_silenced_until,
      override: event.light_detail?.override ?? null,
      sold_out: event.tags === "Sold",
      site_url: `${PUBLIC_SITE_URL}/order/${event.id}`,
      pricing: rowPricing(event),
    });
  }
  return rows;
}

/** The priced columns the "הוזל" preview needs - see `PriceLightRowPricing`. */
function rowPricing(event: ListedEvent): PriceLightRow["pricing"] {
  const ticket = minAvailableTicketUsd(event);
  const ours = event.light_detail?.ours ?? null;
  return {
    type: event.type,
    name: event.name,
    date: event.date,
    def_date_depart: event.def_date_depart ?? null,
    def_date_return: event.def_date_return ?? null,
    base_flight_price: event.base_flight_price,
    base_hotel_price: event.base_hotel_price,
    tickets_and_rates: ticket == null ? [] : [{ price: ticket, available: true }],
    ticket_only_markup: event.ticket_only_markup ?? null,
    markup_ticket: event.markup_ticket ?? null,
    markup_flight: event.markup_flight ?? null,
    markup_hotel: event.markup_hotel ?? null,
    event_additional_markup: event.event_additional_markup ?? null,
    light_detail: ours
      ? { ours: { flight: ours.flight ? { usd: ours.flight.usd ?? null } : null, hotel: ours.hotel ? { usd: ours.hotel.usd ?? null } : null } }
      : null,
  };
}

/** One competitor's panel row - four small reads, issued together. */
async function crawlPanelRow(competitor: CompetitorKey): Promise<CrawlPanelRow> {
  const scraper = scraperFor(competitor);
  const [lastRes, dueRes, countRes, circuit] = await Promise.all([
    db
      .from("competitor_crawl_runs")
      .select("status,started_at,finished_at,listings,note")
      .eq("competitor", competitor)
      .order("started_at", { ascending: false })
      .limit(1),
    // "Next due" is based on the newest ok/partial/blocked run, ignoring skipped/running (and a
    // lone error row) - the same basis pickDueCompetitor uses to decide overdue-ness
    // (price-light-crawl.ts:66-84). `last` above stays "any status" for display.
    db
      .from("competitor_crawl_runs")
      .select("started_at")
      .eq("competitor", competitor)
      .in("status", ["ok", "partial", "blocked"])
      .order("started_at", { ascending: false })
      .limit(1),
    db
      .from("competitor_listings")
      .select("id", { count: "exact", head: true })
      .eq("competitor", competitor),
    circuitOpen(competitor),
  ]);
  if (lastRes.error) console.error("listCrawlRuns: last run failed", JSON.stringify(lastRes.error));
  if (dueRes.error) console.error("listCrawlRuns: due-basis run failed", JSON.stringify(dueRes.error));
  if (countRes.error) console.error("listCrawlRuns: count failed", JSON.stringify(countRes.error));

  const last = ((lastRes.data ?? []) as { status: CrawlStatus; started_at: string; finished_at: string | null; listings: number; note: string | null }[])[0] ?? null;
  const dueSince = ((dueRes.data ?? []) as { started_at: string }[])[0] ?? null;
  const nextDueAt = dueSince ? new Date(Date.parse(dueSince.started_at) + scraper.intervalHours * 3_600_000).toISOString() : null;
  return {
    competitor,
    mode: scraper.mode,
    crawlFrom: scraper.crawlFrom ?? "vercel",
    intervalHours: scraper.intervalHours,
    last,
    nextDueAt,
    circuitOpen: circuit,
    totalListings: countRes.count ?? 0,
  };
}

/**
 * Crawl-status panel: one row per registered competitor scraper (a handful, never paged).
 * Every read runs concurrently - five competitors x four reads used to go one after another,
 * 20 round trips that took longer than the whole events list (4.6s measured 2026-09-16) and,
 * because the screen waited for all three loads together, held the table back too.
 */
export async function listCrawlRuns(): Promise<CrawlPanelRow[]> {
  // Admin-only surface (competitor prices / AI spend) - same bar as the /price-light page.
  await requireAdmin();
  return cachedCrawlPanel();
}

// Invalidated by every crawl-run write (price-light-crawl.ts insertRun/finishRun); the TTL
// covers a run written from outside Next (scripts/crawl-local.ts).
const cachedCrawlPanel = unstable_cache(
  () => Promise.all(ACTIVE_COMPETITORS.map(crawlPanelRow)),
  ["price-light-runs"],
  { tags: [PRICE_LIGHT_TAG.runs], revalidate: PRICE_LIGHT_TTL_S.runs },
);

/**
 * "סרוק עכשיו" on the crawl panel: run one competitor's crawl on demand (or a dry run).
 *
 * NOTE - two different bars on the same capability, on purpose: this action is
 * `requireAdmin()` (only ADMIN_ROLES, matching the /price-light screen it lives on),
 * while the equivalent HTTP entry point `POST /api/price-light/crawl` uses
 * `guardAdminRoute()`, i.e. any staff session. Behaviour left as-is; documented so the
 * difference reads as a decision rather than an oversight.
 */
export async function triggerCrawl(
  competitor: CompetitorKey,
  dryRun = false,
): Promise<{ ok: true; summary: CrawlSummary } | { ok: false; error: string }> {
  await requireAdmin();
  if (!ACTIVE_COMPETITORS.includes(competitor)) return { ok: false, error: `unknown competitor: ${competitor}` };
  // The panel hides the button for a local-only site; a direct call still gets a plain answer
  // instead of a `skipped` run row (runCrawl would refuse it on Vercel anyway).
  if (scraperFor(competitor).crawlFrom === "local") return { ok: false, error: "האתר נסרק רק מהמחשב המקומי (scripts/crawl-local.ts), לא מכאן" };
  try {
    const summary = await runCrawl(competitor, "manual", { dryRun });
    await logAudit({
      action: "price_light.crawl_triggered",
      entityType: "competitor",
      entityId: competitor,
      metadata: { dry_run: dryRun, status: summary.status, listings: summary.listings },
    });
    invalidatePriceLight("runs");
    return { ok: true, summary };
  } catch (e) {
    console.error("triggerCrawl failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

// A month of AI-judged matches across every active competitor - comfortably above realistic volume.
const AI_COST_FETCH_MAX = 50_000;

/**
 * Sum of this calendar month's `ai_verdict.cost_usd` across every judged match - the AI
 * spend gauge. Rows whose verdict was REUSED from an earlier match (`cached: true`, set
 * in price-light-match.ts) are skipped: the verdict is copied onto every new row for that
 * listing, so counting them would re-bill one call once per visit and inflate both numbers.
 */
export async function aiCostThisMonth(): Promise<{ usd: number; calls: number }> {
  // Admin-only surface (competitor prices / AI spend) - same bar as the /price-light page.
  await requireAdmin();
  return cachedAiCost();
}

// Invalidated by the paths that spend AI inside a request (recheck) and by the nightly at its end.
const cachedAiCost = unstable_cache(sumAiCostThisMonth, ["price-light-cost"], {
  tags: [PRICE_LIGHT_TAG.cost],
  revalidate: PRICE_LIGHT_TTL_S.cost,
});

async function sumAiCostThisMonth(): Promise<{ usd: number; calls: number }> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { rows, error, truncated } = await fetchPaged<{ id: number; ai_verdict: { cost_usd?: number; cached?: boolean } | null }>(
    () =>
      db
        .from("competitor_matches")
        .select("id,ai_verdict")
        .gte("created_at", monthStart)
        .not("ai_verdict", "is", null)
        .order("id", { ascending: true }),
    AI_COST_FETCH_MAX,
  );
  if (error) console.error("aiCostThisMonth failed", JSON.stringify(error));
  if (truncated) console.error(`aiCostThisMonth: truncated at ${AI_COST_FETCH_MAX}`);
  let usd = 0;
  let calls = 0;
  for (const row of rows) {
    if (row.ai_verdict?.cached === true) continue;
    const cost = row.ai_verdict?.cost_usd;
    if (typeof cost === "number" && Number.isFinite(cost)) {
      usd += cost;
      calls += 1;
    }
  }
  return { usd: Math.round(usd * 10_000) / 10_000, calls };
}

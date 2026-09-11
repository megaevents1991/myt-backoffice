// Price light (רמזור) rules engine - the ONLY place thresholds, normalization
// constants and the light decision live. Pure: no DB, no fetch, no runtime
// imports (scripts/price-light-selftest.ts runs it under plain node).
// Spec: docs/superpowers/specs/2026-09-09-price-light-design.md §2.
import type {
  Adjustment, CompetitorKey, Currency, EventKind, ExtractedAttrs, Light,
  LightScopeDetail, MatchStatus, PerCompetitor, Scope, UncheckedReason,
} from "../../types/price-light.types";

// ---- thresholds -----------------------------------------------------------
export const LIGHT_GREEN_USD = -150;
export const LIGHT_RED_USD = 150;
export const LIGHT_STALE_DAYS = 14;
export const OVERRIDE_DRIFT_USD = 20;
export const PRICE_DROP_MIN_USD = 50;
export const PRICE_DROP_LOOKBACK_DAYS = 14;
export const PRICE_DROP_SHOW_DAYS = 14;
export const DATE_TOLERANCE_DAYS = 1;
/** Longest travel window (depart..return, inclusive) a window-only listing may use to claim our
 *  date. Every real window is 3-6 days; a season-long "ברצלונה 2026/27" range would otherwise
 *  silently cover both legs of a tie (final review, M1). */
export const MAX_WINDOW_DAYS = 14;

// ---- normalization (applied to the COMPETITOR's price to look like ours:
// direct, no bag, 3*, our nights, no breakfast, no transfers) ---------------
export const BAG_USD = 120;        // partners' number
export const CONNECTION_USD = 100; // opening values below - calibrate after a month
export const STAR_STEP_USD = 40;   // per star per night
export const NIGHT_USD = 90;       // per night
export const BREAKFAST_USD = 15;   // per night
export const TRANSFER_USD = 30;

// LiveTickets ticket light uses the API's `brt` (gross) as their shelf price.
// If the phase-0 spot check disproves that, calibrate cost -> shelf here.
export const LIVETICKETS_RETAIL_FACTOR = 1.0;
export const LIVETICKETS_RETAIL_OFFSET_USD = 0;

/** Main's legacy package markup (lib/events/price.ts DEFAULT_MARKUP). */
export const MAIN_DEFAULT_MARKUP_USD = 175;

// ---- our prices (mirrors main lib/events/price.ts - keep in step) ----------
export interface PricedEvent {
  type: string;
  name: string;
  name_english?: string | null;
  date: string;
  def_date_depart?: string | null;
  def_date_return?: string | null;
  base_flight_price: number | null;
  base_hotel_price: number | null;
  tickets_and_rates: { price: number; available?: boolean }[] | null;
  skip_flight?: boolean | null;
  ticket_only_markup?: number | null;
  markup_ticket?: number | null;
  markup_flight?: number | null;
  markup_hotel?: number | null;
  event_additional_markup?: number | null;
}

const amount = (v: number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function minAvailableTicketUsd(e: PricedEvent): number | null {
  const available = (e.tickets_and_rates ?? []).filter((t) => t?.available !== false);
  if (available.length === 0) return null;
  return Math.min(...available.map((t) => Number(t.price)));
}

/** Composed markups when any is set, else main's global 175; plus the per-event extra. */
export function totalMarkupUsd(e: PricedEvent): number {
  const extra = Number(e.event_additional_markup ?? 0) || 0;
  const composed = e.markup_ticket != null || e.markup_flight != null || e.markup_hotel != null;
  if (composed) {
    return amount(e.markup_ticket) + amount(e.markup_flight) + amount(e.markup_hotel) + extra;
  }
  return MAIN_DEFAULT_MARKUP_USD + extra;
}

/**
 * The catalog-card price: flight + hotel + cheapest ticket + markup. null = na.
 *
 * `skip_flight` does NOT make this null (Dor, 2026-09-11): an event we happen to sell without
 * flights still has stored base prices, and the competitors we compare against sell the full
 * package, so we want the package picture too - "as if there were no flight skip" - alongside
 * the ticket-vs-ticket one. Before this, `skip_flight` was true on 428 of 436 live events, so
 * the package light was `na` almost everywhere and every package competitor (LiveEvents, ISSTA,
 * Golasso, OnTour) had nothing to compare against, even where their catalog carried the very
 * same fixture - 105 Golasso listings lined up with our events, dozens at a perfect rule score.
 *
 * What DOES make it null: no available ticket, or no travel component at all. A package price
 * built on a zero flight or a zero hotel is not a package price - it would sit far below a
 * competitor's flight-inclusive package and read as a confident green, which is the one wrong
 * answer this light must never give.
 */
export function ourPackageUsd(e: PricedEvent): number | null {
  const ticket = minAvailableTicketUsd(e);
  if (ticket == null) return null;
  const flight = amount(e.base_flight_price);
  const hotel = amount(e.base_hotel_price);
  if (flight === 0 || hotel === 0) return null;
  return Math.round(flight + hotel + ticket + totalMarkupUsd(e));
}

/** Ticket-only override price. null = na (no override configured). */
export function ourTicketUsd(e: PricedEvent): number | null {
  const markup = e.ticket_only_markup;
  if (markup == null || !Number.isFinite(Number(markup)) || Number(markup) < 0) return null;
  const ticket = minAvailableTicketUsd(e);
  if (ticket == null) return null;
  return Math.round(ticket + Number(markup));
}

export function ourNights(e: PricedEvent): number {
  const a = e.def_date_depart ? Date.parse(e.def_date_depart.slice(0, 10)) : NaN;
  const b = e.def_date_return ? Date.parse(e.def_date_return.slice(0, 10)) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 3;
  return Math.round((b - a) / 86_400_000);
}

// ---- competitors per kind ---------------------------------------------------
export function kindOf(e: Pick<PricedEvent, "type">): EventKind {
  return e.type === "music_event" || e.type === "music_live_event_dynamic" ? "music" : "sports";
}

const COMPETITORS_BY_KIND: Record<EventKind, Record<Scope, CompetitorKey[]>> = {
  sports: { package: ["liveevents", "issta", "golasso"], ticket: ["livetickets"] },
  music: { package: ["liveevents", "ontour"], ticket: ["livetickets"] },
};

/** Only competitors that have a crawler in the registry count ("alone" is never claimed against a site we cannot see). */
export function competitorsFor(kind: EventKind, scope: Scope, active: readonly CompetitorKey[]): CompetitorKey[] {
  return COMPETITORS_BY_KIND[kind][scope].filter((c) => active.includes(c));
}

// ---- normalization ------------------------------------------------------------
export function normalize(
  priceUsd: number,
  attrs: Partial<ExtractedAttrs> | null | undefined,
  ours: { nights: number },
): { normalizedUsd: number; adjustments: Adjustment[]; partial: boolean } {
  const a = attrs ?? {};
  const adjustments: Adjustment[] = [];
  let partial = false;
  const known = <T>(v: T | "unknown" | undefined): v is T => v !== undefined && v !== "unknown";

  if (known(a.bag_included)) { if (a.bag_included) adjustments.push({ key: "bag", usd: -BAG_USD, label: `+bag −$${BAG_USD}` }); }
  else partial = true;
  if (known(a.direct_flight)) { if (!a.direct_flight) adjustments.push({ key: "connection", usd: CONNECTION_USD, label: `connection +$${CONNECTION_USD}` }); }
  else partial = true;
  if (known(a.hotel_stars)) {
    const usd = (3 - a.hotel_stars) * STAR_STEP_USD * ours.nights;
    if (usd !== 0) adjustments.push({ key: "stars", usd, label: `${a.hotel_stars}★ ${usd > 0 ? "+" : "−"}$${Math.abs(usd)}` });
  } else partial = true;
  if (known(a.nights)) {
    const usd = (ours.nights - a.nights) * NIGHT_USD;
    if (usd !== 0) adjustments.push({ key: "nights", usd, label: `${a.nights} nights ${usd > 0 ? "+" : "−"}$${Math.abs(usd)}` });
  } else partial = true;
  if (known(a.breakfast)) { if (a.breakfast) adjustments.push({ key: "breakfast", usd: -BREAKFAST_USD * ours.nights, label: `+breakfast −$${BREAKFAST_USD * ours.nights}` }); }
  else partial = true;
  if (known(a.transfers)) { if (a.transfers) adjustments.push({ key: "transfers", usd: -TRANSFER_USD, label: `+transfers −$${TRANSFER_USD}` }); }
  else partial = true;

  const normalizedUsd = Math.round(priceUsd + adjustments.reduce((s, x) => s + x.usd, 0));
  return { normalizedUsd, adjustments, partial };
}

// ---- the light ------------------------------------------------------------------
export interface LatestMatch {
  competitor: CompetitorKey;
  status: MatchStatus;
  normalized_usd: number | null;
  raw: number | null;
  raw_currency: Currency | null;
  crawled_at: string | null;
  match_id: number | null;
  adjustments?: Adjustment[] | null;
  partial?: boolean;
  reason?: UncheckedReason | null; // carried from a failed crawl
}

function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

export function computeScopeLight(input: {
  ourUsd: number | null;
  matches: LatestMatch[];
  competitors: readonly CompetitorKey[];
  now: string;
  staleDays?: number;
}): LightScopeDetail {
  const staleDays = input.staleDays ?? LIGHT_STALE_DAYS;
  const empty: LightScopeDetail = {
    light: "unchecked", diff_usd: null, our_usd: input.ourUsd, competitor: null, raw: null,
    raw_currency: null, normalized_usd: null, adjustments: [], partial: false, reason: null,
    crawled_at: null, match_id: null, per_competitor: {},
  };
  if (input.ourUsd == null) return { ...empty, light: "na" };
  if (input.competitors.length === 0) return { ...empty, reason: "never" };

  const per: Partial<Record<CompetitorKey, PerCompetitor>> = {};
  const valid: LatestMatch[] = [];
  let newestReason: UncheckedReason = "never";
  for (const c of input.competitors) {
    const match = input.matches.find((x) => x.competitor === c) ?? null;
    if (!match) { per[c] = { status: "skipped", normalized_usd: null, crawled_at: null }; continue; }
    per[c] = { status: match.status, normalized_usd: match.normalized_usd, crawled_at: match.crawled_at };
    const fresh = !!match.crawled_at && daysBetween(match.crawled_at, input.now) <= staleDays;
    if ((match.status === "found" || match.status === "not_selling") && fresh) valid.push(match);
    else newestReason = !fresh && match.crawled_at ? "stale" : match.status === "unsure" ? "unsure" : (match.reason ?? "crawl_failed");
  }

  if (valid.length === 0) return { ...empty, reason: newestReason, per_competitor: per };
  const found = valid.filter((x) => x.status === "found" && x.normalized_usd != null);
  if (found.length === 0) {
    if (valid.length === input.competitors.length) return { ...empty, light: "alone", per_competitor: per };
    return { ...empty, reason: "partial_coverage", per_competitor: per };
  }
  const best = found.reduce((a, b) => ((b.normalized_usd as number) < (a.normalized_usd as number) ? b : a));
  const diff = Math.round(input.ourUsd - (best.normalized_usd as number));
  const light: Light = diff < LIGHT_GREEN_USD ? "green" : diff > LIGHT_RED_USD ? "red" : "orange";
  return {
    light, diff_usd: diff, our_usd: input.ourUsd, competitor: best.competitor, raw: best.raw,
    raw_currency: best.raw_currency, normalized_usd: best.normalized_usd, adjustments: best.adjustments ?? [],
    partial: !!best.partial, reason: null, crawled_at: best.crawled_at, match_id: best.match_id, per_competitor: per,
  };
}

// ---- price-drop tag --------------------------------------------------------------
export interface PriceDropDecision { usd: number; from: number; until: string }

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Spec §6.2 step 2. `current` = the tag already on the event (or null). */
export function decidePriceDrop(input: {
  today: string;
  todayUsd: number | null;
  refUsd: number | null;
  current: PriceDropDecision | null;
}): PriceDropDecision | null {
  const { today, todayUsd, current } = input;
  if (todayUsd == null) return null;
  if (current && current.until >= today) {
    // Keep the tag unless the price climbed back to within $50 of the old price.
    return todayUsd <= current.from - PRICE_DROP_MIN_USD ? current : null;
  }
  if (input.refUsd == null) return null;
  const drop = input.refUsd - todayUsd;
  if (drop < PRICE_DROP_MIN_USD) return null;
  return { usd: Math.round(drop), from: Math.round(input.refUsd), until: addDays(today, PRICE_DROP_SHOW_DAYS) };
}

// ---- rule-based matching (before any AI) ----------------------------------------------
const STOP = new Set(["vs", "v", "fc", "cf", "the", "and", "at", "in", "match", "game", "tickets", "package", "משחק", "נגד", "מול", "חבילה", "כרטיסים"]);

export function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface MatchCandidate {
  id: number;
  title: string;
  title_he?: string | null;
  event_date: string | null;
  /** Phase 2: sites that publish a travel window instead of the match date (ISSTA, OnTour). */
  travel_depart?: string | null;
  travel_return?: string | null;
}

/** 0..1 - share of our name tokens found in the candidate title (best over our names). */
export function ruleMatchScore(ours: { names: string[] }, candidate: MatchCandidate): number {
  const theirs = new Set([...nameTokens(candidate.title), ...nameTokens(candidate.title_he ?? "")]);
  let best = 0;
  for (const name of ours.names) {
    const tokens = nameTokens(name);
    if (tokens.length === 0) continue;
    const hit = tokens.filter((t) => theirs.has(t)).length / tokens.length;
    best = Math.max(best, hit);
  }
  return best;
}

/**
 * A candidate is "on our date" either by exact event_date, or — when the site publishes no
 * event date at all — because its travel window contains our date (inclusive both ends).
 * A candidate WITH an event_date is judged by that date only; its window is ignored.
 * A window longer than MAX_WINDOW_DAYS is not a trip, it's a season — rejected outright.
 */
export function candidateCoversDate(c: MatchCandidate, date: string): boolean {
  if (c.event_date) return c.event_date === date;
  if (!c.travel_depart || !c.travel_return) return false;
  if (!(c.travel_depart <= date && date <= c.travel_return)) return false;
  const span = (Date.parse(`${c.travel_return}T00:00:00Z`) - Date.parse(`${c.travel_depart}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(span) && span <= MAX_WINDOW_DAYS;
}

export const RULE_MATCH_MIN_SCORE = 0.8;

/**
 * Deterministic pick: the single candidate on our date (exact date, or a travel window
 * that contains it) whose title covers >= 80% of our name tokens. Two qualifying
 * candidates with the same score = ambiguous = null (the AI judge decides). A ±1-day
 * dated candidate is never picked by rule.
 */
export function pickRuleMatch(
  ours: { names: string[]; date: string },
  candidates: MatchCandidate[],
): { candidate: MatchCandidate; score: number } | null {
  const onDate = candidates.filter((c) => candidateCoversDate(c, ours.date));
  const scored = onDate
    .map((candidate) => ({ candidate, score: ruleMatchScore(ours, candidate) }))
    .filter((x) => x.score >= RULE_MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 1) return scored[0];
  if (scored.length > 1 && scored[0].score > scored[1].score) return scored[0];
  return null;
}

// ---- display helpers ------------------------------------------------------------
export function signedUsd(n: number): string {
  if (n === 0) return "$0";
  return `${n < 0 ? "−" : "+"}$${Math.abs(Math.round(n))}`;
}

export function lightLabel(detail: LightScopeDetail | null | undefined): string {
  if (!detail) return "unchecked";
  switch (detail.light) {
    case "alone": return "alone";
    case "na": return "—";
    case "unchecked": return detail.reason ? `unchecked · ${detail.reason.replace("_", " ")}` : "unchecked";
    default: return signedUsd(detail.diff_usd ?? 0);
  }
}

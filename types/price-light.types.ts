/**
 * Price light (רמזור) - hand-typed until the migration lands on master and
 * `npm run db:types` regenerates. Spec: docs/superpowers/specs/2026-09-09-price-light-design.md
 */

export const LIGHTS = ["alone", "green", "orange", "red", "unchecked", "na"] as const;
export type Light = (typeof LIGHTS)[number];

export const COMPETITORS = ["liveevents", "issta", "golasso", "ontour", "livetickets"] as const;
export type CompetitorKey = (typeof COMPETITORS)[number];

export const SCOPES = ["package", "ticket"] as const;
export type Scope = (typeof SCOPES)[number];

export type EventKind = "sports" | "music";

export const MATCH_STATUSES = ["found", "not_selling", "unsure", "na", "skipped"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const MATCH_METHODS = ["rule", "ai", "manual", "api"] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

export const CRAWL_STATUSES = ["running", "ok", "partial", "blocked", "error", "skipped"] as const;
export type CrawlStatus = (typeof CRAWL_STATUSES)[number];

export type CrawlTrigger = "schedule" | "manual" | "dry_run";
export type MatchTrigger = "crawl" | "nightly" | "on_create" | "manual" | "our_price_moved";

export type Currency = "ILS" | "USD" | "EUR" | "GBP";

/** What a competitor's page (or the AI) says is in the package. */
export interface ExtractedAttrs {
  bag_included: boolean | "unknown";
  direct_flight: boolean | "unknown";
  hotel_stars: number | "unknown";
  nights: number | "unknown";
  breakfast: boolean | "unknown";
  transfers: boolean | "unknown";
}

export const UNKNOWN_ATTRS: ExtractedAttrs = {
  bag_included: "unknown",
  direct_flight: "unknown",
  hotel_stars: "unknown",
  nights: "unknown",
  breakfast: "unknown",
  transfers: "unknown",
};

export interface Adjustment {
  key: "bag" | "connection" | "stars" | "nights" | "breakfast" | "transfers";
  usd: number;
  /** Short human label, e.g. "+bag −$120". */
  label: string;
}

export interface PerCompetitor {
  status: MatchStatus;
  normalized_usd: number | null;
  crawled_at: string | null;
}

export type UncheckedReason =
  | "never"
  | "stale"
  | "crawl_failed"
  | "unsure"
  | "partial_coverage";

export interface LightScopeDetail {
  light: Light;
  diff_usd: number | null;
  our_usd: number | null;
  competitor: CompetitorKey | null;
  raw: number | null;
  raw_currency: Currency | null;
  normalized_usd: number | null;
  adjustments: Adjustment[];
  partial: boolean;
  /** USD the nights comparison could still be wrong by - the red/green band is widened by it.
   *  Optional: rows written before 2026-09-13 have no such field, so every reader treats
   *  `undefined` as zero doubt rather than as a missing number. */
  uncertainty_usd?: number;
  /** Both package durations, so a reader can see WHY a light was widened or moved. */
  nights?: { ours: number | null; theirs: number | "unknown" } | null;
  reason: UncheckedReason | null;
  crawled_at: string | null;
  match_id: number | null;
  per_competitor: Partial<Record<CompetitorKey, PerCompetitor>>;
}

export interface LightOverride {
  scope: Scope;
  light: Light;
  note: string;
  by: string;
  at: string;
  // null when the scope had no competitor price at override time (unchecked/alone/na) -
  // the common case an override is actually used for (Phase 1 task 4, setLightOverride).
  competitor_normalized_usd: number | null;
}

export interface LightDetail {
  package?: LightScopeDetail;
  ticket?: LightScopeDetail;
  override?: LightOverride | null;
}

export interface CrawlRunRow {
  id: number;
  competitor: CompetitorKey;
  status: CrawlStatus;
  trigger: CrawlTrigger;
  started_at: string;
  finished_at: string | null;
  pages: number;
  listings: number;
  prev_listings: number | null;
  note: string | null;
  browser_mode: "remote" | "local" | "fetch" | "table" | null;
}

export interface ListingRow {
  id: number;
  competitor: CompetitorKey;
  external_key: string;
  scope: Scope;
  title: string;
  title_he: string | null;
  event_date: string | null; // YYYY-MM-DD
  city: string | null;
  venue: string | null;
  price_from: number | null;
  currency: Currency | null;
  price_usd: number | null;
  travel_depart: string | null;
  travel_return: string | null;
  attrs: Partial<ExtractedAttrs> | null;
  detail_text: string | null;
  url: string;
  first_seen_at: string;
  last_seen_at: string;
  last_changed_at: string;
  run_id: number | null;
}

export interface MatchRow {
  id: number;
  event_id: number;
  competitor: CompetitorKey;
  scope: Scope;
  listing_id: number | null;
  status: MatchStatus;
  method: MatchMethod;
  ai_verdict: Record<string, unknown> | null;
  raw_price: number | null;
  raw_currency: Currency | null;
  price_usd: number | null;
  normalized_usd: number | null;
  adjustments: Adjustment[] | null;
  attrs: Partial<ExtractedAttrs> | null;
  our_usd: number | null;
  diff_usd: number | null;
  light: Light | null;
  listing_changed_at: string | null;
  note: string | null;
  created_at: string;
}

export interface PriceSnapshotRow {
  event_id: number;
  day: string; // YYYY-MM-DD
  package_usd: number | null;
  ticket_usd: number | null;
  min_ticket: number | null;
  base_flight: number | null;
  base_hotel: number | null;
  markup: number | null;
}

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
/** `our_price_moved` is RESERVED, not wired: re-matching the moment our own price changes would
 *  mean hooking `ticket-price-sync`, and the standing rule is that the light never edits the
 *  pricing code. Our price therefore drifts from the recorded `our_usd` between nightly runs;
 *  `/price-light` shows the live figure beside the recorded one (`our_usd_now`) instead. */
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

/**
 * What ONE competitor said about one (event, scope) - with its own verdict, not just the
 * winner's.
 *
 * `diff_usd` / `light` / `uncertainty_usd` are per-competitor (Dor, 2026-09-14: "טבלה שיש לה
 * סיכום פר אירוע מול כל המתחרים... וצבע הרמזור כנגד כל מתחרה"): the scope's own light answers
 * "are we dear against the toughest offer on the shelf", which is the decision - but it hides
 * whether we are dear against ALL of them or only against one aggressive site. Optional: rows
 * written before 2026-09-14 carry only the first three fields.
 */
export interface PerCompetitor {
  status: MatchStatus;
  normalized_usd: number | null;
  crawled_at: string | null;
  diff_usd?: number | null;
  light?: Light;
  uncertainty_usd?: number;
  /** Sells the event, publishes no price ("לקבלת הצעת מחיר") - status stays `unsure`, since there
   *  is nothing to compare, but it is NOT a doubt about whether they sell it. */
  quote_only?: boolean;
}

export type UncheckedReason =
  | "never"
  | "stale"
  | "crawl_failed"
  | "unsure"
  | "partial_coverage"
  /** A competitor sells the event but publishes no price (quote on request), and no other
   *  competitor left a hole: nothing to compare, nothing more to check. */
  | "quote_only";

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
  /**
   * When THIS scope's light value last changed - stamped by `recomputeEventLights`
   * (lib/services/price-light-store.ts `stampLightChange`) and read by the "השתנה השבוע" view.
   *
   * Optional: rows written before 2026-09-17 carry no stamp, and "we do not know when it last
   * moved" must read as "not changed" rather than as "changed just now".
   */
  light_changed_at?: string | null;
  crawled_at: string | null;
  match_id: number | null;
  per_competitor: Partial<Record<CompetitorKey, PerCompetitor>>;
}

/**
 * What the comparison looked like at the moment a human decided something about it.
 *
 * Stamped into the `audit_log` metadata of every price-light decision (הוזל / השאר בפיד /
 * הסר מהאתר / משימה / דריסה), because "someone removed event 812" teaches nothing, while
 * "at the time, package was red +$420 against Golasso, our 4 nights against their 3, and a
 * human pulled the event rather than match it" is a labelled example. This is the record the
 * price-light agent learns from - see lib/agents/price-light.agent.ts.
 */
export interface LightDecisionSnapshot {
  scope: Scope;
  light: Light;
  diff_usd: number | null;
  our_usd: number | null;
  competitor: CompetitorKey | null;
  normalized_usd: number | null;
  nights_ours: number | null;
  nights_theirs: number | "unknown" | null;
  uncertainty_usd: number | null;
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

// ---- what a package contains (partner format, 2026-09-14) ------------------------------------
// "טיסות: אל על עם מזוודה ישיר 16-20 | מלון: שם מלון כולל ארוחת בוקר או ללא | סוג כרטיס".
// Read out of competitor pages by lib/services/offer-detail.ts, and out of our own rule by
// lib/services/our-offer-detail.ts - one shape, so both sides print in the same words.

export interface FlightLeg { depart: string | null; arrive: string | null }

export interface OfferFlight {
  airline: string | null;
  direct: boolean | null;
  /** Short human wording: "כולל מזוודה 23 ק\"ג" / "טרולי בלבד" / "כבודה מלאה" / "ללא מזוודה". */
  bag: string | null;
  out: FlightLeg | null;
  back: FlightLeg | null;
}

export type Board = "breakfast" | "room_only";

export interface OfferHotel { name: string | null; stars: number | null; board: Board | null }

export interface OfferDetail {
  flight: OfferFlight | null;
  hotel: OfferHotel | null;
  ticket: string | null;
  /** The package bundles more than one fixture (Golasso "חבילה מרובת משחקים"). */
  multiMatch: boolean;
}

export interface OfferLines { flight: string | null; hotel: string | null; ticket: string | null }

/**
 * OUR package's contents as the pricing rule would buy it today - the cheapest direct flight (a
 * connection only past the $300 gap) and the cheapest 3★ hotel, exactly what `price-quote.ts` prices.
 *
 * `price-quote.ts` keeps only the resulting number, never the airline or hotel behind it, and the
 * light never edits the pricing code; so this is described separately (nightly rotation +
 * "פרט עכשיו") and stored under `light_detail.ours`. An event linked to an offline flight or hotel is
 * described from THAT inventory, since that is what the customer actually gets.
 */
export interface OurOfferSnapshot {
  at: string;
  flight: (OfferFlight & { usd: number | null; source: "amadeus" | "offline" }) | null;
  hotel: (OfferHotel & { usd: number | null; room: string | null; source: "hotel_api" | "offline" }) | null;
  /** Why a half is missing ("no direct or connecting offer", "hotel search failed: ..."). */
  errors: string[];
}

export interface LightDetail {
  package?: LightScopeDetail;
  ticket?: LightScopeDetail;
  override?: LightOverride | null;
  /** Preserved across every recompute - written only by lib/services/our-offer-detail.ts. */
  ours?: OurOfferSnapshot | null;
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

// ---- what the /price-light screen renders -------------------------------------------------
// These live here, not next to `listPriceLight`, because that file is "use server" and may only
// export async functions - a type or a pure helper there breaks the build the moment anything
// imports it.

/**
 * One competitor's answer for one (event, scope) - including the ones that did NOT set the light.
 *
 * The light is decided by the cheapest normalized offer, but "who else did we check, and what did
 * they say" is the question a human asks next (Dor, 2026-09-14: "האם אפשר שנבדוק את כל המתחרים
 * לאותו אירוע"). The data was always recorded in `light_detail[scope].per_competitor`; it just had
 * nowhere to be seen.
 */
export interface CompetitorAnswer {
  competitor: CompetitorKey;
  status: MatchStatus;
  normalized_usd: number | null;
  crawled_at: string | null;
  /** This competitor's OWN gap and verdict - "are we dear against THIS one", which is what a
   *  per-competitor summary is for. Null/undefined on a competitor with no usable price, and on
   *  rows written before 2026-09-14. */
  diff_usd: number | null;
  light: Light | null;
  /** True for the one whose price the scope's light was actually computed against. */
  decided: boolean;
  /** Sells it, no published price - "מוכר · הצעת מחיר", never read as "not sure they sell it". */
  quote_only: boolean;
}

/** One scope's verdict for an event - the package conclusion, or the ticket conclusion. */
export interface PriceLightScopeCell {
  scope: Scope;
  light: Light;
  diff_usd: number | null;
  our_usd: number | null;
  /**
   * OUR price as it is RIGHT NOW, recomputed from the event's own columns at read time.
   *
   * `our_usd` is a snapshot from when matching last ran, and our own ticket prices move between
   * runs (`ticket-price-sync`, every 2h), so the two drift apart during the day - 151 of 435
   * events on 2026-09-13, by $5 to $163, against a ±$150 band. The light stays the recorded
   * verdict; this is shown beside it so nobody reads a stale number as today's price.
   */
  our_usd_now: number | null;
  /**
   * The SITE card price (`ourPackageUsd`, including the pricing rule's +$100/+$120 margins) for a
   * package cell; null for ticket. `our_usd` / `our_usd_now` are the margin-free "from" price the
   * light compares (2026-09-17) - this is shown beside them so the two are never confused.
   */
  site_usd: number | null;
  competitor: CompetitorKey | null;
  normalized_usd: number | null;
  raw: number | null;
  raw_currency: Currency | null;
  listing_url: string | null;
  adjustments: string[];
  /** Normalization was incomplete: the competitor's page never said what the package contains,
   *  so some adjustments could not be applied. NOT about which competitors were checked -
   *  that is `partial_coverage` below. */
  partial: boolean;
  /** A competitor that should have answered did not - its crawl did not cover this event, so
   *  the scope has no verdict to give ("כיסוי חלקי"). The coverage question, as opposed to
   *  `partial` above, which is the normalization one. */
  partial_coverage: boolean;
  /** No verdict because a competitor sells this by quote only (`reason === "quote_only"`). */
  quote_only: boolean;
  /** Nights on each side + the USD doubt that widened the light's band (price-light.ts). */
  nights_ours: number | null;
  nights_theirs: number | null;
  uncertainty_usd: number;
  reason: UncheckedReason | null;
  crawled_at: string | null;
  has_open_task: boolean;
  changed_this_week: boolean;
  method: MatchMethod | null;
  /** Every active competitor for this scope, the deciding one first. */
  competitors: CompetitorAnswer[];
  /** What OUR side of this comparison is, component by component, per the pricing rule
   *  (`ourOfferLines`). Package only - a ticket comparison has one component and it is the row. */
  ours: { label: string; detail: string; usd: number | null }[];
}

/**
 * ONE row per event, carrying BOTH conclusions (Dor, 2026-09-14: "צריך להיות באותה שורה גם
 * המסקנה על כרטיס וגם המסקנה על חבילה").
 *
 * It used to be one row per (event, scope), which split the two halves of one decision across two
 * lines of the table - "cheap on the ticket, dear on the package" was something you had to
 * assemble by eye. A scope is null when it has nothing to say (`na`: no ticket-only price
 * configured, or no package price at all).
 */
export interface PriceLightRow {
  id: string;            // String(event_id) - the table's row id
  event_id: number;
  name: string;
  /** The English name, so the table's search finds "barcelona"/"barca" and not only "ברצלונה"
   *  (`name` is Hebrew on most rows). null when the event has none. */
  name_english: string | null;
  date: string;
  city: string | null;
  kind: EventKind;
  package: PriceLightScopeCell | null;
  ticket: PriceLightScopeCell | null;
  checked_at: string | null;
  silenced_until: string | null;
  override: LightOverride | null;
  /** `events.tags === "Sold"` - main shows it sold out and takes it off sale. */
  sold_out: boolean;
  /** The event's page on the customer site. */
  site_url: string;
  /** What the "הוזל" popover edits and previews with (pure `previewMarkupChange`): the priced
   *  columns of the event, nothing else. */
  pricing: PriceLightRowPricing;
}

/**
 * A `PricedEvent` (lib/services/price-light.ts) cut down to what the price functions read, so the
 * client can hand it straight to `previewMarkupChange`. `tickets_and_rates` carries ONLY the
 * cheapest available ticket - the one number the price functions use - to keep the list payload small.
 */
export interface PriceLightRowPricing {
  type: string;
  name: string;
  date: string;
  def_date_depart: string | null;
  def_date_return: string | null;
  base_flight_price: number | null;
  base_hotel_price: number | null;
  tickets_and_rates: { price: number; available: boolean }[];
  ticket_only_markup: number | null;
  markup_ticket: number | null;
  markup_flight: number | null;
  markup_hotel: number | null;
  event_additional_markup: number | null;
  light_detail: { ours: { flight: { usd: number | null } | null; hotel: { usd: number | null } | null } | null } | null;
}

/** The scopes this row has something to say about, package first. */
export function rowScopes(row: PriceLightRow): PriceLightScopeCell[] {
  return [row.package, row.ticket].filter((c): c is PriceLightScopeCell => c != null);
}

/** One side of the side-by-side comparison: us, or one competitor's matched listing. */
export interface ComparisonOffer {
  who: CompetitorKey | "ours";
  status: MatchStatus | "ours";
  quote_only: boolean;
  /** As published ("€1,349") - the number a human can check against the page. */
  raw: number | null;
  raw_currency: Currency | null;
  usd: number | null;
  normalized_usd: number | null;
  /** OUR price minus theirs, normalized; null for us and for anyone with no price. */
  diff_usd: number | null;
  light: Light | null;
  decided: boolean;
  title: string | null;
  url: string | null;
  depart: string | null;
  return: string | null;
  nights: number | null;
  lines: OfferLines;
  multi_match: boolean;
  seen_at: string | null;
  /** Ours, package only: the SITE card price (with the rule's margins) - `usd` is the "from" price. */
  site_usd: number | null;
  /** Ours, package only: the site markup inside the "from" price. null for competitors. */
  markup_usd: number | null;
  /** What the correction dialog opens with; null for us and for a competitor with no listing. */
  edit: OfferEdit | null;
  /** Live staff corrections behind the values on this row (incl. a pair-scoped "not this event"). */
  corrections: OfferCorrection[];
}

/** A live staff correction, shown beside the value it replaced (lib/services/price-light-corrections.ts). */
export interface OfferCorrection {
  id: number;
  field: string;
  original: unknown;
  value: unknown;
  reason: string | null;
  note: string;
  by: string | null;
  at: string;
}

/** The EFFECTIVE values of one competitor listing (corrections applied) - the dialog's defaults.
 *  The server works out what the crawl said and who said it; the client never sends an `original`. */
export interface OfferEdit {
  listing_id: number;
  price: { amount: number; currency: Currency } | null;
  attrs: Partial<ExtractedAttrs>;
  airline: string | null;
  hotel_name: string | null;
  ticket: string | null;
}

export interface PriceLightComparison {
  event_id: number;
  name: string;
  date: string;
  /** When our own contents were last described; null = never (rule wording is shown instead). */
  ours_at: string | null;
  ours_errors: string[];
  package: ComparisonOffer[];
  ticket: ComparisonOffer[];
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

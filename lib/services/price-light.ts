// Price light (רמזור) rules engine - the ONLY place thresholds, normalization
// constants and the light decision live. Pure: no DB, no fetch, and runtime
// imports only from other pure modules by relative `.ts` path
// (scripts/price-light-selftest.ts runs it under plain node).
// Spec: docs/superpowers/specs/2026-09-09-price-light-design.md §2.
import type {
  Adjustment, CompetitorKey, CompetitorOverride, Currency, EventKind, ExtractedAttrs, Light,
  LightScopeDetail, MatchStatus, PerCompetitor, Scope, UncheckedReason,
} from "../../types/price-light.types";
import { FLIGHT_MARGIN_USD, HOTEL_MARGIN_USD } from "./price-margins.ts";

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
export const NIGHT_USD = 90;       // per night - the FALLBACK rate only (see ourNightRateUsd)
export const BREAKFAST_USD = 15;   // per night
export const TRANSFER_USD = 30;
/**
 * A low-cost carrier on THEIR side while we fly a full-service one (Dor, 2026-09-23: "גולאסו שם
 * לואו קוסט ואנחנו אל על... לא הכל זה מחיר"). Per person, on top of the bag adjustment - this is
 * the service gap (seat, times, reliability), not the luggage, which BAG_USD already prices.
 * One direction only, as agreed: it raises their normalized price when they fly low-cost and we
 * do not; it never lowers it. Needs both airlines known - an unknown one adjusts nothing and does
 * not make the comparison "partial" (most listings never name their airline).
 */
export const LOW_COST_USD = 60;
/** Low-cost / charter carriers as the parsers and Amadeus name them (offer-detail.ts), Hebrew and
 *  Latin. Israir and Arkia are in on purpose: staff's own rule compares "ישראייר" against El Al. */
const LOW_COST_AIRLINES: RegExp[] = [
  /וויז|WIZZ/i, /ריי?נאייר|RYANAIR/i, /איזי\s?ג'?יט|EASYJET/i, /ווילינג|וואלינג|VUELING/i,
  /טרנסאוויה|TRANSAVIA/i, /פגסוס|PEGASUS/i, /בלו\s?בירד|BLUE\s?BIRD/i, /JET\s?2|ג'ט\s?2/i,
  /יורווינגס|EUROWINGS/i, /VOLOTEA|וולוטאה/i, /ישראייר|ISRAIR/i, /ארקיע|ARKIA/i,
  // A bare IATA code - `airlineFromCode` returns the code itself for a carrier it has no name for.
  /^(W4|W6|W9|5W|FR|RK|U2|EC|VY|HV|TO|PC|BZ|LS|EW|V7|6H|IZ)$/i,
];

/** true = a low-cost carrier, false = a named full-service one, null = no airline to judge. */
export function isLowCostAirline(airline: string | null | undefined): boolean | null {
  const name = (airline ?? "").trim();
  if (!name) return null;
  return LOW_COST_AIRLINES.some((re) => re.test(name));
}

/**
 * A night is the single biggest difference between two packages for the same fixture, and it
 * is worth wildly different money per destination: on the live catalog (2026-09-13, probe over
 * every matched package listing) a Manchester night prices at $190 and a Barcelona one at
 * $75-138. A flat $90 therefore mis-prices a one-night gap by up to 2x in BOTH directions -
 * enough on its own to flip a light. So the rate comes from OUR OWN hotel base for that event
 * (`ourNightRateUsd`), clamped into a sane band, and NIGHT_USD is only the fallback for an
 * event with no usable hotel number.
 *
 * Units: `base_hotel_price` is per person for the whole stay (.claude/rules/pricing.md), and
 * every competitor package price we store is also per person in a double room - so dividing it
 * by our nights gives a per-person night rate directly comparable to theirs.
 */
export const NIGHT_RATE_MIN_USD = 45;
export const NIGHT_RATE_MAX_USD = 260;
/** Nights assumed for per-night scaling (stars, breakfast) when our own travel window is missing. */
export const NIGHTS_FALLBACK = 3;
/** Nights-gap size priced with full confidence; past it the estimate itself is doubted. */
export const NIGHT_GAP_FREE = 2;
/** Share of a night's rate counted as doubt for each gap night beyond NIGHT_GAP_FREE. */
export const NIGHT_GAP_DOUBT = 0.5;

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
  /** `category`/`description` are what the ticket actually IS ("CATEGORÍA 3 (CAT3)" / "מאחורי
   *  השער טבעת עליונה") - optional because only the naming code reads them. */
  tickets_and_rates: { price: number; available?: boolean; category?: string | null; description?: string | null }[] | null;
  skip_flight?: boolean | null;
  ticket_only_markup?: number | null;
  markup_ticket?: number | null;
  markup_flight?: number | null;
  markup_hotel?: number | null;
  event_additional_markup?: number | null;
  /** Only the searched NET per-person prices are read (`ourNetFlightUsd` / `ourNetHotelUsd`) -
   *  a structural slice of `LightDetail`, so this module stays free of the full type. */
  light_detail?: {
    ours?: {
      flight?: { usd?: number | null } | null;
      hotel?: { usd?: number | null } | null;
    } | null;
  } | null;
}

const amount = (v: number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The cheapest ticket a customer can actually buy - the row, not just its price. */
export function cheapestAvailableTicket(e: PricedEvent): NonNullable<PricedEvent["tickets_and_rates"]>[number] | null {
  const available = (e.tickets_and_rates ?? []).filter((t) => t?.available !== false);
  if (available.length === 0) return null;
  return available.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
}

export function minAvailableTicketUsd(e: PricedEvent): number | null {
  const ticket = cheapestAvailableTicket(e);
  return ticket ? Number(ticket.price) : null;
}

/** One component of OUR package, as the pricing rule defines it. */
export interface OurOfferLine { key: "flight" | "hotel" | "ticket" | "markup"; label: string; detail: string; usd: number | null }

/**
 * What our own package IS, component by component (Dor, 2026-09-14: "תשלוף את הדברים שלנו לפי
 * החוקיות שיש לנו").
 *
 * Two of the three are a RULE, not a record: `price-quote.ts` prices the cheapest DIRECT flight
 * (a connection only when the direct beats it by more than $300) and the cheapest 3★ hotel, per
 * person in a double room - it stores the resulting number, never the airline or the hotel that
 * produced it. So this describes the rule honestly rather than inventing a name we never kept.
 * The ticket is different: we DO store what it is, so it is named exactly.
 *
 * Flight and hotel are the NET prices (`ourNetFlightUsd` / `ourNetHotelUsd`, the rule's margins
 * stripped) and a 4th line carries the site markup, so the four lines add up to `ourFromUsd` - the
 * number the light compares - not to the site card price.
 *
 * Mirrors `lib/services/price-quote.ts`; this module stays pure and must not import it (it drags
 * Amadeus and the hotel service in), so if that rule changes, change the wording here too.
 */
export function ourOfferLines(e: PricedEvent): OurOfferLine[] {
  const nights = ourNights(e);
  const flight = ourNetFlightUsd(e);
  const hotel = ourNetHotelUsd(e);
  // Where each net came from: the last search, a rule base with its margin stripped, or a base
  // typed by hand at/below the margin (never carried one, so kept whole).
  const source = (searched: number | null | undefined, base: number | null, margin: number) =>
    searchedUsd(searched) != null ? " (מהחיפוש האחרון)" : amount(base) > margin ? " (בסיס פחות תוספת)" : " (בסיס ידני)";
  const markup = totalMarkupUsd(e);
  const ticket = cheapestAvailableTicket(e);
  const ticketName = [ticket?.category, ticket?.description]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  return [
    {
      key: "flight",
      label: "טיסה",
      detail: flight === 0
        ? "אין מחיר טיסה"
        : `ישירה, הזולה ביותר (קונקשן רק אם הישירה יקרה ב-$300+) · ללא תוספת $${FLIGHT_MARGIN_USD}${source(e.light_detail?.ours?.flight?.usd, e.base_flight_price, FLIGHT_MARGIN_USD)}`,
      usd: flight || null,
    },
    {
      key: "hotel",
      label: "מלון",
      detail: hotel === 0
        ? "אין מחיר מלון"
        : `3★ הזול ביותר · ${nights == null ? "מספר לילות לא ידוע" : `${nights} לילות`} · לאדם בחדר זוגי · ללא תוספת $${HOTEL_MARGIN_USD}${source(e.light_detail?.ours?.hotel?.usd, e.base_hotel_price, HOTEL_MARGIN_USD)}`,
      usd: hotel || null,
    },
    {
      key: "ticket",
      label: "כרטיס",
      detail: ticket ? (ticketName || "הקטגוריה הזמינה הזולה") : "אין כרטיס זמין",
      usd: ticket ? Math.round(Number(ticket.price)) : null,
    },
    { key: "markup", label: "עמלות לקוח", detail: "מארקאפ האתר", usd: markup || null },
  ];
}

/** A searched net price we can use: positive and finite, else null. */
function searchedUsd(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * OUR flight per person WITHOUT the rule's +$100: the last search (`light_detail.ours.flight.usd`,
 * already the raw offer) when there is one, else the stored base minus the margin. A base at or below
 * the margin was typed by hand and never carried one, so it is kept whole. 0 = nothing to go on.
 */
export function ourNetFlightUsd(e: PricedEvent): number {
  const searched = searchedUsd(e.light_detail?.ours?.flight?.usd);
  if (searched != null) return searched;
  const base = amount(e.base_flight_price);
  return base > FLIGHT_MARGIN_USD ? base - FLIGHT_MARGIN_USD : base;
}

/**
 * OUR hotel per person WITHOUT the rule's +$120: the last search (`light_detail.ours.hotel.usd`,
 * already per person) when there is one, else the stored base minus the margin (kept whole at or
 * below it - a hand-typed base). 0 = nothing to go on.
 */
export function ourNetHotelUsd(e: PricedEvent): number {
  const searched = searchedUsd(e.light_detail?.ours?.hotel?.usd);
  if (searched != null) return searched;
  const base = amount(e.base_hotel_price);
  return base > HOTEL_MARGIN_USD ? base - HOTEL_MARGIN_USD : base;
}

/**
 * OUR real "from" package price - what the price light compares against competitors (Dor,
 * 2026-09-17): net flight + net hotel + cheapest ticket + markup, i.e. without the pricing rule's
 * +$100/+$120 margins (they exist so a customer who picks a different flight or hotel sees a minus;
 * a competitor's headline carries no such cushion). null = na on the same terms as `ourPackageUsd`:
 * no available ticket, or no stored flight/hotel base.
 *
 * `ourPackageUsd` stays the SITE card price, and it is what the daily price snapshots and the
 * "ירידת מחיר" tag use - switching those to this would record a fake ~$220 drop the day it shipped.
 */
export function ourFromUsd(e: PricedEvent): number | null {
  const ticket = minAvailableTicketUsd(e);
  if (ticket == null) return null;
  if (amount(e.base_flight_price) === 0 || amount(e.base_hotel_price) === 0) return null;
  // With both bases > 0, neither net can be 0 (a base at/below the margin is kept whole).
  return Math.round(ourNetFlightUsd(e) + ourNetHotelUsd(e) + ticket + totalMarkupUsd(e));
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
 * The SITE catalog-card price: flight + hotel + cheapest ticket + markup, where the flight and
 * hotel bases INCLUDE the pricing rule's +$100/+$120 margins. null = na. The light compares
 * `ourFromUsd` instead; this one feeds the daily price snapshots and the "ירידת מחיר" tag.
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

/**
 * Nights in OUR package, or null when the event carries no usable travel window.
 *
 * It used to answer a flat 3 in that case, which is a guess wearing a number's clothes: the
 * nights gap it produced against a competitor was indistinguishable from a measured one and
 * moved real money through `normalize`. Callers now get null and must decide - `normalize`
 * skips the gap adjustment and marks the comparison partial (no live event needs this today:
 * all 427 future events have both dates).
 */
export function ourNights(e: PricedEvent): number | null {
  const a = e.def_date_depart ? Date.parse(e.def_date_depart.slice(0, 10)) : NaN;
  const b = e.def_date_return ? Date.parse(e.def_date_return.slice(0, 10)) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 86_400_000);
}

/** What one night of OUR stay costs, per person - the price of a nights gap. See NIGHT_RATE_MIN_USD.
 *  Priced off the NET hotel (`ourNetHotelUsd`): the rule's +$120 is not what a night costs. */
export function ourNightRateUsd(e: PricedEvent): number {
  const nights = ourNights(e);
  const hotel = ourNetHotelUsd(e);
  if (nights == null || nights <= 0 || hotel === 0) return NIGHT_USD;
  const rate = hotel / nights;
  if (!Number.isFinite(rate) || rate <= 0) return NIGHT_USD;
  return Math.round(Math.min(NIGHT_RATE_MAX_USD, Math.max(NIGHT_RATE_MIN_USD, rate)));
}

/**
 * How many nights the competitor's listing is, from whatever the crawl actually captured.
 *
 * `attrs.nights` is only ever filled by a DETAIL page, and detail enrichment reaches a small
 * slice of a catalog (budget + "worth a detail" filter): on 2026-09-13 that left 123 of
 * Golasso's 132 package listings with `attrs: null` - while all 132 carried the travel window
 * their card prints. The window is the same measurement ISSTA's and OnTour's scrapers already
 * turn into `nights`, so deriving it here costs nothing and fixes the majority of comparisons.
 *
 * The MAX_WINDOW_DAYS ceiling is the same one `candidateCoversDate` uses: past it the range is
 * a season, not a trip, and the night count read off it would be fiction.
 */
export function listingNights(
  attrs: Partial<ExtractedAttrs> | null | undefined,
  window: { travel_depart?: string | null; travel_return?: string | null } | null | undefined,
): number | "unknown" {
  // A stated night count past MAX_WINDOW_DAYS is a typo on THEIR page, not a trip (OnTour printed
  // "חזרה 07.11.2027" for a 2026 show: 368 nights, a normalized price of -$27,596 and a red light
  // off it, 2026-09-19). Not believable -> fall through to the window, which has the same ceiling.
  const known = attrs?.nights;
  if (typeof known === "number" && Number.isFinite(known) && known > 0 && known <= MAX_WINDOW_DAYS) return known;
  const depart = window?.travel_depart, ret = window?.travel_return;
  if (!depart || !ret) return "unknown";
  const span = (Date.parse(`${ret}T00:00:00Z`) - Date.parse(`${depart}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(span) || span <= 0 || span > MAX_WINDOW_DAYS) return "unknown";
  return Math.round(span);
}

/**
 * Money the nights comparison could still be wrong by, in USD - what the light's red/green
 * band is widened by so a duration we cannot see never gets called a price difference.
 *
 * - A night unknown on EITHER side = one whole night of doubt. This is the common case
 *   (63 of 77 matched package listings on 2026-09-13) and the one that produced false reds:
 *   a 3-night competitor package sitting next to our 4-night one, compared as if equal.
 * - A gap wider than NIGHT_GAP_FREE = we are extrapolating our own hotel rate across nights
 *   nobody priced, so each extra night carries NIGHT_GAP_DOUBT of a night.
 */
export function nightsUncertaintyUsd(
  theirNights: number | "unknown" | undefined,
  ourNightsValue: number | null,
  nightRateUsd: number,
): number {
  if (typeof theirNights !== "number" || ourNightsValue == null) return Math.round(nightRateUsd);
  const gap = Math.abs(ourNightsValue - theirNights);
  if (gap <= NIGHT_GAP_FREE) return 0;
  return Math.round((gap - NIGHT_GAP_FREE) * NIGHT_GAP_DOUBT * nightRateUsd);
}

// ---- competitors per kind ---------------------------------------------------
/** The feed tag that makes an event music whatever its `type` column says. */
export const MUSIC_TAG_SLUG = "music";

/**
 * Which competitors an event is compared against - sports sites or music sites.
 *
 * The `type` column alone is not enough: 136 live MUSIC events are `tx_event` (TixStock sells
 * concerts as well as fixtures) and were therefore classified "sports", so their package light
 * was compared against ISSTA + Golasso - two football-only sites - and never against OnTour.
 * ISSTA's `covers()` then recorded `skipped`, the scope fell to `partial_coverage`, and all 136
 * sat on "לא נבדק" for good (measured 2026-09-17).
 *
 * So the vertical is read the way the rest of the platform reads it - off the feed tags - with
 * the type kept as the fast path: a music TYPE or the `music` TAG makes it music, anything else
 * is sports. Deliberately one-directional: a sports type carrying a music tag is music (the tag
 * is the editorial truth), and no tag can turn a music type into sports.
 *
 * `tagSlugs` omitted = type-only, exactly the old behaviour: every caller that cannot load tags
 * (or whose load failed) degrades to the previous classification rather than to a wrong one.
 */
export function kindOf(e: Pick<PricedEvent, "type">, tagSlugs?: readonly string[]): EventKind {
  if (e.type === "music_event" || e.type === "music_live_event_dynamic") return "music";
  return tagSlugs?.includes(MUSIC_TAG_SLUG) ? "music" : "sports";
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
export interface Normalized {
  normalizedUsd: number;
  adjustments: Adjustment[];
  partial: boolean;
  /** USD the nights side of this comparison could still be wrong by (nightsUncertaintyUsd). */
  uncertaintyUsd: number;
  /** What each side's duration was taken to be - what the tooltip shows the reader. */
  nights: { ours: number | null; theirs: number | "unknown" };
}

/**
 * `ours.nights` null = our own travel window is missing: the nights GAP is then unknowable, so
 * no gap adjustment is made and the comparison is partial. Per-night scaling that still has to
 * happen (stars, breakfast) falls back to NIGHTS_FALLBACK rather than dropping the adjustment
 * entirely - a 4★ hotel is still worth less to us than a 3★ one whatever the length.
 *
 * `ours.nightRateUsd` is what a night costs on THIS event (ourNightRateUsd); omitted = NIGHT_USD.
 */
export function normalize(
  priceUsd: number,
  attrs: Partial<ExtractedAttrs> | null | undefined,
  ours: { nights: number | null; nightRateUsd?: number },
  airlines?: { ours: string | null; theirs: string | null },
): Normalized {
  const a = attrs ?? {};
  const adjustments: Adjustment[] = [];
  let partial = false;
  const known = <T>(v: T | "unknown" | undefined): v is T => v !== undefined && v !== "unknown";
  const scaleNights = ours.nights ?? NIGHTS_FALLBACK;
  const nightRate = ours.nightRateUsd != null && Number.isFinite(ours.nightRateUsd) && ours.nightRateUsd > 0
    ? Math.round(ours.nightRateUsd)
    : NIGHT_USD;

  if (known(a.bag_included)) { if (a.bag_included) adjustments.push({ key: "bag", usd: -BAG_USD, label: `+bag −$${BAG_USD}` }); }
  else partial = true;
  if (known(a.direct_flight)) { if (!a.direct_flight) adjustments.push({ key: "connection", usd: CONNECTION_USD, label: `connection +$${CONNECTION_USD}` }); }
  else partial = true;
  if (known(a.hotel_stars)) {
    const usd = (3 - a.hotel_stars) * STAR_STEP_USD * scaleNights;
    if (usd !== 0) adjustments.push({ key: "stars", usd, label: `${a.hotel_stars}★ ${usd > 0 ? "+" : "−"}$${Math.abs(usd)}` });
  } else partial = true;
  // Same ceiling as `listingNights`: an impossible duration is an unknown one, never an adjustment.
  if (known(a.nights) && a.nights <= MAX_WINDOW_DAYS && ours.nights != null) {
    const usd = (ours.nights - a.nights) * nightRate;
    // English, like the other five labels: these are engine strings, and the Hebrew duration
    // line the staff actually read is built in the UI (`nightsLine`). One mixed-language label
    // in a row of English ones is a presentation decision leaking into the engine.
    if (usd !== 0) {
      adjustments.push({
        key: "nights",
        usd,
        label: `${a.nights}n vs ${ours.nights}n ${usd > 0 ? "+" : "−"}$${Math.abs(usd)}`,
      });
    }
  } else partial = true;
  if (known(a.breakfast)) { if (a.breakfast) adjustments.push({ key: "breakfast", usd: -BREAKFAST_USD * scaleNights, label: `+breakfast −$${BREAKFAST_USD * scaleNights}` }); }
  else partial = true;
  if (known(a.transfers)) { if (a.transfers) adjustments.push({ key: "transfers", usd: -TRANSFER_USD, label: `+transfers −$${TRANSFER_USD}` }); }
  else partial = true;
  if (airlines && isLowCostAirline(airlines.theirs) === true && isLowCostAirline(airlines.ours) === false) {
    adjustments.push({ key: "low_cost", usd: LOW_COST_USD, label: `low-cost +$${LOW_COST_USD}` });
  }

  const normalizedUsd = Math.round(priceUsd + adjustments.reduce((s, x) => s + x.usd, 0));
  const theirNights = known(a.nights) && a.nights <= MAX_WINDOW_DAYS ? a.nights : "unknown";
  return {
    normalizedUsd,
    adjustments,
    partial,
    uncertaintyUsd: nightsUncertaintyUsd(theirNights, ours.nights, nightRate),
    nights: { ours: ours.nights, theirs: theirNights },
  };
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
  /** From `nightsUncertaintyUsd` - filled by the store, which has the event the rate comes from. */
  uncertainty_usd?: number;
  nights?: { ours: number | null; theirs: number | "unknown" } | null;
  reason?: UncheckedReason | null; // carried from a failed crawl
  /** The competitor sells this event but publishes no price (LiveEvents sports: "לקבלת הצעת מחיר"). */
  quote_only?: boolean;
}

function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

/**
 * The light for one gap, widened by whatever that comparison could not see.
 *
 * A duration we could not measure is not a price difference: widening both thresholds by the
 * nights doubt is what stops a 3-night competitor package sitting next to our 4-night one from
 * reading as a confident red (63 of 77 matched package listings on 2026-09-13 published no nights
 * at all). Inside the widened band the answer is orange - "look at it", not "act".
 *
 * One function, used for BOTH the scope's verdict and each competitor's own, so a per-competitor
 * light can never be computed by a slightly different rule than the light beside it.
 */
/** A real verdict other than red - what may lift a "השאר בפיד" mute or auto-close a red task.
 *  `unchecked` (data gone stale, a crawl failing) is the absence of a verdict, not a resolution. */
export function lightSettled(light: Light | null | undefined): boolean {
  return light != null && light !== "red" && light !== "unchecked";
}

export function lightFor(diffUsd: number, uncertaintyUsd: number): Light {
  if (diffUsd < LIGHT_GREEN_USD - uncertaintyUsd) return "green";
  if (diffUsd > LIGHT_RED_USD + uncertaintyUsd) return "red";
  return "orange";
}

/**
 * What a markup edit on /price-light WOULD do, before anything is saved - the "הוזל" popover's
 * live line ("מחיר ← X · פער ← Y · אור ← Z"). Same price functions and the same `lightFor`
 * band as the engine, so the preview can never promise a light the recompute will not give.
 *
 * package: the per-event extra (`event_additional_markup`) - null reads as 0.
 * ticket: `ticket_only_markup` - null CLEARS the ticket-only price (ourUsd null, no light).
 */
export function previewMarkupChange(
  e: PricedEvent,
  scope: Scope,
  value: number | null,
  competitorUsd: number | null,
  uncertaintyUsd = 0,
): { ourUsd: number | null; diffUsd: number | null; light: Light | null } {
  const clone: PricedEvent = scope === "package"
    ? { ...e, event_additional_markup: value ?? 0 }
    : { ...e, ticket_only_markup: value };
  const ourUsd = scope === "package" ? ourFromUsd(clone) : ourTicketUsd(clone);
  if (ourUsd == null || competitorUsd == null) return { ourUsd, diffUsd: null, light: null };
  const diffUsd = Math.round(ourUsd - competitorUsd);
  return { ourUsd, diffUsd, light: lightFor(diffUsd, Math.max(0, Math.round(uncertaintyUsd))) };
}

const LIGHT_RANK: Record<Light, number> = { green: 1, alone: 1, orange: 2, red: 3, unchecked: 0, na: 0 };

/** A per-competitor staff call stands while that competitor's normalized price stays within
 *  OVERRIDE_DRIFT_USD of the one it was made against; with no number on either side it stands
 *  only while the competitor still has a price at all (nothing to compare = nothing to force). */
export function competitorOverrideHolds(o: Pick<CompetitorOverride, "normalized_usd">, normalizedUsd: number | null): boolean {
  if (normalizedUsd == null) return false;
  if (o.normalized_usd == null) return true;
  return Math.abs(normalizedUsd - o.normalized_usd) <= OVERRIDE_DRIFT_USD;
}

export function computeScopeLight(input: {
  ourUsd: number | null;
  matches: LatestMatch[];
  competitors: readonly CompetitorKey[];
  now: string;
  staleDays?: number;
  /** Per-competitor staff calls that still hold (see CompetitorOverride). */
  forced?: Partial<Record<CompetitorKey, Pick<CompetitorOverride, "light" | "note" | "by" | "at">>>;
}): LightScopeDetail {
  const staleDays = input.staleDays ?? LIGHT_STALE_DAYS;
  const empty: LightScopeDetail = {
    light: "unchecked", diff_usd: null, our_usd: input.ourUsd, competitor: null, raw: null,
    raw_currency: null, normalized_usd: null, adjustments: [], partial: false,
    uncertainty_usd: 0, nights: null, reason: null,
    crawled_at: null, match_id: null, per_competitor: {},
  };
  if (input.ourUsd == null) return { ...empty, light: "na" };
  if (input.competitors.length === 0) return { ...empty, reason: "never" };

  const per: Partial<Record<CompetitorKey, PerCompetitor>> = {};
  const valid: LatestMatch[] = [];
  let newestReason: UncheckedReason = "never";
  // Competitors that SELL the event but publish no number ("לקבלת הצעת מחיר" - every LiveEvents
  // sports row, 2026-09-17: 164 live listings) vs. every other reason a competitor gave no usable
  // answer. Only the first kind is a fact about the market; the second is a hole in our data.
  let quoteOnly = 0;
  let holes = 0;
  for (const c of input.competitors) {
    const match = input.matches.find((x) => x.competitor === c) ?? null;
    if (!match) { holes += 1; per[c] = { status: "skipped", normalized_usd: null, crawled_at: null }; continue; }
    // Each competitor gets its OWN verdict, by the same rule and its own doubt - so a reader can
    // see whether we are dear against everyone or only against one aggressive site. The scope's
    // light below still answers to the cheapest of them: that is the decision.
    const ownDiff = match.normalized_usd == null ? null : Math.round(input.ourUsd - match.normalized_usd);
    const ownUnc = Math.max(0, Math.round(match.uncertainty_usd ?? 0));
    per[c] = {
      status: match.status,
      normalized_usd: match.normalized_usd,
      crawled_at: match.crawled_at,
      diff_usd: ownDiff,
      uncertainty_usd: ownUnc,
      ...(match.status === "found" && ownDiff != null ? { light: lightFor(ownDiff, ownUnc) } : {}),
      ...(match.quote_only ? { quote_only: true } : {}),
    };
    const fresh = !!match.crawled_at && daysBetween(match.crawled_at, input.now) <= staleDays;
    if ((match.status === "found" || match.status === "not_selling") && fresh) valid.push(match);
    else if (fresh && match.quote_only) quoteOnly += 1;
    else {
      holes += 1;
      newestReason = !fresh && match.crawled_at ? "stale" : match.status === "unsure" ? "unsure" : (match.reason ?? "crawl_failed");
    }
  }

  // Someone sells it by quote and nobody else left a hole: there is nothing to compare and
  // nothing more to check - "alone" would be false and "partial coverage" sends staff hunting
  // for a crawl problem that does not exist (175 of 248 "לא נבדק" package lights, 2026-09-17).
  const onlyQuotes = quoteOnly > 0 && holes === 0;
  if (valid.length === 0) return { ...empty, reason: onlyQuotes ? "quote_only" : newestReason, per_competitor: per };
  const found = valid.filter((x) => x.status === "found" && x.normalized_usd != null);
  if (found.length === 0) {
    if (valid.length === input.competitors.length) return { ...empty, light: "alone", per_competitor: per };
    if (onlyQuotes) return { ...empty, reason: "quote_only", per_competitor: per };
    return { ...empty, reason: "partial_coverage", per_competitor: per };
  }
  // Staff calls against single competitors (CompetitorOverride): that competitor's verdict is the
  // forced one, and it no longer competes for "cheapest on the shelf" - the rest decide among
  // themselves, and the scope takes the WORSE of their light and every forced one. The caller
  // hands in only overrides that still hold (`competitorOverrideHolds`).
  const forcedLight = (c: CompetitorKey): Light | null => {
    const o = input.forced?.[c];
    return o && per[c]?.light != null ? o.light : null;
  };
  for (const c of input.competitors) {
    const o = input.forced?.[c];
    const own = per[c];
    if (!o || !own || own.light == null) continue;
    per[c] = { ...own, light: o.light, forced: { note: o.note, by: o.by, at: o.at, computed: own.light } };
  }
  const cheapest = (xs: LatestMatch[]) => xs.reduce((a, b) => ((b.normalized_usd as number) < (a.normalized_usd as number) ? b : a));
  const free = found.filter((x) => forcedLight(x.competitor) == null);
  // The cheapest normalized competitor is still the one we answer to, uncertainty or not - a
  // light must describe the toughest offer on the shelf. The doubt attached to THAT match then
  // widens the band around it.
  let best = cheapest(free.length > 0 ? free : found);
  let diff = Math.round(input.ourUsd - (best.normalized_usd as number));
  let uncertainty = Math.max(0, Math.round(best.uncertainty_usd ?? 0));
  let light: Light = free.length > 0 ? lightFor(diff, uncertainty) : (forcedLight(best.competitor) as Light);
  // A forced verdict worse than the free one wins, and then IT is the competitor the light names.
  const worse = found
    .filter((x) => { const f = forcedLight(x.competitor); return f != null && LIGHT_RANK[f] > LIGHT_RANK[light]; })
    .sort((a, b) => LIGHT_RANK[forcedLight(b.competitor) as Light] - LIGHT_RANK[forcedLight(a.competitor) as Light]
      || (a.normalized_usd as number) - (b.normalized_usd as number))[0];
  if (worse) {
    best = worse;
    diff = Math.round(input.ourUsd - (worse.normalized_usd as number));
    uncertainty = Math.max(0, Math.round(worse.uncertainty_usd ?? 0));
    light = forcedLight(worse.competitor) as Light;
  }
  return {
    light, diff_usd: diff, our_usd: input.ourUsd, competitor: best.competitor, raw: best.raw,
    raw_currency: best.raw_currency, normalized_usd: best.normalized_usd, adjustments: best.adjustments ?? [],
    partial: !!best.partial, uncertainty_usd: uncertainty, nights: best.nights ?? null,
    reason: null, crawled_at: best.crawled_at, match_id: best.match_id, per_competitor: per,
  };
}

/**
 * When THIS SCOPE'S light value last changed - what "השתנה השבוע" on /price-light means.
 *
 * It used to mean "the newest competitor_matches row is younger than 7 days", which was true for
 * essentially every event (match rows are rewritten whenever a listing's price, attrs or even its
 * freshness moves), so the view listed all 436 of them and said nothing. The stamp is therefore
 * carried on the light itself: renewed only when the light the reader sees actually moved.
 *
 * `previous` is taken from the COLUMN first (`light_package`/`light_ticket`) and only then from
 * `light_detail[scope].light`, because the column is the EFFECTIVE light - the one an override
 * forced - while the detail keeps the computed one underneath it. Reading the detail first would
 * see "computed orange vs shown red" on every overridden event and re-stamp it nightly.
 *
 * No previous stamp and an unchanged light = the stamp stays absent: rows written before this
 * existed do not know when their light last moved, and "we do not know" is not "changed".
 */
export function stampLightChange(
  detail: LightScopeDetail,
  effective: Light | null,
  previousColumn: Light | null,
  previousDetail: LightScopeDetail | undefined,
  now: string,
): LightScopeDetail {
  const previous = previousColumn ?? previousDetail?.light ?? null;
  const changedAt = previous !== null && previous === effective
    ? previousDetail?.light_changed_at ?? null
    : now;
  return changedAt == null ? detail : { ...detail, light_changed_at: changedAt };
}

// ---- price-drop tag --------------------------------------------------------------
export interface PriceDropDecision { usd: number; from: number; until: string }

export function addDays(day: string, days: number): string {
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
// Words that name a competition, a club's legal form or the product rather than WHO is playing.
// Measured 2026-09-14: "ליגת האלופות: ארסנל - ליל" scored 0.5 against Golasso's "ארסנל vs ליל"
// only because two of its four tokens were the competition's name.
const STOP = new Set([
  "vs", "v", "fc", "cf", "afc", "sc", "ac", "as", "us", "cd", "ssc", "club", "de", "del", "di",
  "the", "and", "at", "in", "match", "game", "tickets", "package", "live", "tour",
  "champions", "league", "premier", "uefa", "cup", "laliga", "liga", "serie", "bundesliga",
  "משחק", "נגד", "מול", "חבילה", "כרטיסים", "ליגת", "האלופות", "צמפיונס", "הליגה", "ליגה", "גביע", "הופעה", "הופעת",
  "איי", "סי", "אס",
]);

export function nameTokens(value: string): string[] {
  return [...new Set(value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    // A geresh/apostrophe is PART of a Hebrew transliteration ("מנצ'סטר", "לצ'ה", "ז'רמן"), not a
    // word break: splitting on it left "מנצ" + "סטר" and made every such name half a match.
    .replace(/['’׳`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d{4}$/.test(t)))];
}

export interface MatchCandidate {
  id: number;
  title: string;
  title_he?: string | null;
  event_date: string | null;
  /** Phase 2: sites that publish a travel window instead of the match date (ISSTA, OnTour). */
  travel_depart?: string | null;
  travel_return?: string | null;
  /** Only the tie-break between duplicate listings reads it (the cheaper copy wins). */
  price_usd?: number | null;
  /** Its detail page says it bundles several fixtures (offer-detail.ts `isMultiMatchText`) - a
   *  title alone cannot tell: Golasso names such a package after its first game. */
  multi?: boolean;
}

/** Optimal-string-alignment distance, capped: returns `cap + 1` as soon as it cannot be ≤ cap. */
function editDistanceWithin(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > cap) return cap + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Letters Hebrew glues onto the front of a word ("במדריד", "ולונדון"). */
const HE_PREFIX = /^[ובהלמשכ](?=[א-ת]{3})/;

/**
 * Two tokens name the same thing: equal, equal once a Hebrew prefix letter is dropped, or - for
 * words of 5+ letters - one typo apart. Every one of these was a real miss on 2026-09-14:
 * "הילרי"/"הילארי" (Hilary Duff), "ויאריאל"/"וויאריאל", "סיביליה"/"סביליה", "מנצ'טסר" (our own typo).
 * Five letters, not four: at four a single letter separates different places ("ליון"/"ליאון").
 */
function tokensAlike(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.replace(HE_PREFIX, "") === b || a === b.replace(HE_PREFIX, "")) return true;
  return Math.min(a.length, b.length) >= 5 && editDistanceWithin(a, b, 1) <= 1;
}

function coverage(from: string[], into: string[]): number {
  if (from.length === 0) return 0;
  return from.filter((t) => into.some((u) => tokensAlike(t, u))).length / from.length;
}

/**
 * 0..1 - how well a candidate title names the same event as ours, best over our names.
 *
 * Measured BOTH ways: the share of our tokens the title covers, and the share of the title's
 * tokens our name covers. The second is what a short competitor title needs - "מילאן | לצ'ה"
 * against our "איי סי מילאן - לצ'ה" is a perfect title, but only half of OUR words. It only
 * counts when the title names TWO SIDES (a "vs" / "|" / "-" / "נגד" between them): a bare club
 * title ("ריאל מדריד" - Golasso emits one when a card shows a single team) is fully contained in
 * every Real Madrid fixture, and must never claim one by being so.
 */
export function ruleMatchScore(ours: { names: string[] }, candidate: MatchCandidate): number {
  const raw = [...new Set([candidate.title, candidate.title_he ?? ""].filter(Boolean))];
  const titles = raw.map((t) => ({ tokens: nameTokens(t), twoSides: namesTwoSides(t) }));
  const theirsAll = [...new Set(titles.flatMap((t) => t.tokens))];
  let best = 0;
  for (const name of ours.names) {
    const tokens = nameTokens(name);
    if (tokens.length === 0) continue;
    best = Math.max(best, coverage(tokens, theirsAll));
    for (const title of titles) {
      if (title.twoSides && title.tokens.length >= 2) best = Math.max(best, coverage(title.tokens, tokens));
    }
  }
  return best;
}

/**
 * A title that names two sides of a fixture: "X vs Y", "X | Y", "X - Y", "X -Y", "ברצלונה-קומו", "X נגד Y".
 * A Latin hyphen with no spaces is a NAME ("Paris Saint-Germain"), not a separator.
 */
function namesTwoSides(title: string): boolean {
  return /\s(?:vs\.?|v|נגד|מול)\s|\||\s[-–]|[-–]\s|[א-ת][-–][א-ת]/i.test(title);
}

/**
 * A listing that bundles several fixtures ("ליברפול-סיטי+יונייטד-טוטנהאם"). It DOES sell our
 * match, so it is never evidence of absence - but its price covers two games, so it is never
 * the like-for-like offer a light may be computed against either.
 */
export function isMultiMatchTitle(title: string): boolean {
  return /\+/.test(title);
}

/** At or above this a title is plausibly our event; below it, plainly a different one. */
export const RULE_ABSENT_BELOW = 0.4;

/**
 * Every candidate the date window produced is plainly SOME OTHER event - so the competitor does
 * not sell ours, and the answer is `not_selling`, not "ambiguous".
 *
 * Before this, any listing within a day of our date made the match `unsure`: 403 of the 840
 * unsure package answers on 2026-09-14 had on-date candidates sharing not one word with our event
 * (Hilary Duff "unsure" because LiveEvents sells Sam Smith that night). That blocked every
 * `alone`, hid who really does not sell, and - with the AI on - would have spent a call on each.
 * A candidate a day off with a strong name still counts: that is a date disagreement, not absence.
 */
export function ruleSaysAbsent(ours: { names: string[] }, candidates: MatchCandidate[]): boolean {
  return candidates.every((c) => ruleMatchScore(ours, c) < RULE_ABSENT_BELOW);
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
 * that contains it) whose title scores >= 0.8 (`ruleMatchScore`). Two qualifying
 * candidates with the same score = ambiguous = null (the AI judge decides) - UNLESS they are
 * the same title listed twice (Golasso lists one fixture once per hotel tier: "ארסנל vs ליל" at
 * $1,484 and at $1,686), in which case the cheaper copy is the offer on the shelf. A ±1-day
 * dated candidate and a multi-fixture bundle are never picked by rule.
 */
export function pickRuleMatch(
  ours: { names: string[]; date: string },
  candidates: MatchCandidate[],
): { candidate: MatchCandidate; score: number } | null {
  const onDate = candidates.filter((c) => candidateCoversDate(c, ours.date) && !c.multi && !isMultiMatchTitle(c.title));
  const scored = onDate
    .map((candidate) => ({ candidate, score: ruleMatchScore(ours, candidate) }))
    .filter((x) => x.score >= RULE_MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const top = scored.filter((x) => x.score === scored[0].score);
  if (top.length === 1) return top[0];
  // "Same title" tolerates spelling: Golasso lists Barcelona-Villarreal as both "ויאריאל" and
  // "וויאריאל" on one night - one fixture, three copies, not three different events.
  const first = nameTokens(top[0].candidate.title);
  const sameTitle = (c: MatchCandidate) => {
    const t = nameTokens(c.title);
    return coverage(t, first) === 1 && coverage(first, t) === 1;
  };
  if (first.length > 0 && top.every((x) => sameTitle(x.candidate))) {
    const price = (x: { candidate: MatchCandidate }) => x.candidate.price_usd ?? Number.POSITIVE_INFINITY;
    return top.reduce((a, b) => (price(b) < price(a) ? b : a));
  }
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

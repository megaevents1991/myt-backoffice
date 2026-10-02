/**
 * Pure helpers of the departures board, the departure card and the series
 * screen. No I/O and no React: the server actions
 * (lib/actions/tours-departure-actions.ts, tours-series-actions.ts) and the
 * client components import the same functions, so a rule (what blocks a
 * publish, how a code is built, which holiday a date touches) has one home.
 * Dates, times and money are formatted by lib/tours/format.ts.
 */
import type { PriceMatrix } from "@/lib/tours/pricing";
import { fmtDate, fmtDateRange, fmtPrice, formatNumber, parsePrice, todayIso } from "@/lib/tours/format";
import {
  EXCLUSIVE_PROMOTION_KINDS,
  PROMOTION_KIND_LABELS,
  type PromotionKind,
  type SaleStatus,
} from "@/types/tours.types";

// ---------------------------------------------------------------- codes
/**
 * Departure code = series code + month (no leading zero) + two-digit day:
 * BBC + 3 July -> `BBC703`, CBP + 3 December -> `CBP1203` (functional spec, rule 1).
 */
export function departureCode(seriesCode: string, startDate: string): string {
  const [, m, d] = startDate.slice(0, 10).split("-");
  return `${seriesCode.trim().toUpperCase()}${Number(m)}${d}`;
}

export const seasonYearOf = (startDate: string): number => Number(startDate.slice(0, 4));

/** Three letters, upper case, or null for an empty field. `undefined` = not a valid code. */
export function normalizeAirport(value: string | null | undefined): string | null | undefined {
  const v = (value ?? "").trim().toUpperCase();
  if (v === "") return null;
  return /^[A-Z]{3}$/.test(v) ? v : undefined;
}

// ---------------------------------------------------------------- route
export interface RouteEnds {
  arrival_airport: string | null;
  return_airport: string | null;
}

/** The route of a departure: its own airports, each end falling back to the series. */
export function effectiveRoute(departure: RouteEnds, series: RouteEnds | null | undefined): RouteEnds {
  return {
    arrival_airport: departure.arrival_airport ?? series?.arrival_airport ?? null,
    return_airport: departure.return_airport ?? series?.return_airport ?? null,
  };
}

// ---------------------------------------------------------------- promotions
export interface PromotionLike {
  kind: string;
  value: number | null;
  label: string | null;
  valid_until: string | null;
  is_active: boolean;
}

/**
 * The fixed per-passenger discount that is switched on. `valid_until` is shown
 * but not enforced - the site view (20261001100400_company_site_api.sql) keeps
 * an "expired" discount exactly like the WordPress site did, so the board must
 * show the same price the customer sees.
 */
export function activeFixedDiscount(promotions: PromotionLike[]): number {
  let total = 0;
  for (const p of promotions) if (p.is_active && p.kind === "fixed_per_pax" && p.value) total += Number(p.value);
  return total;
}

export const isExpired = (validUntil: string | null | undefined, today: string = todayIso()): boolean =>
  Boolean(validUntil) && String(validUntil).slice(0, 10) < today;

/** One short line for a promotion: `$80 per traveler`, `10% off the order`, `Gift: a suitcase`. */
export function promotionSummary(p: PromotionLike, currency: string | null | undefined): string {
  const amount = p.value == null ? null : Number(p.value);
  switch (p.kind as PromotionKind) {
    case "percent_order":
      return `${formatNumber(amount)}% off the order`;
    case "fixed_per_pax":
      return `${fmtPrice(amount, currency)} per traveler`;
    case "fixed_per_order":
      return `${fmtPrice(amount, currency)} per order`;
    case "named_per_pax":
      return `${p.label ?? "Discount"}: ${fmtPrice(amount, currency)} per traveler`;
    case "gift":
      return `Gift: ${p.label ?? ""}`.trim();
    default:
      return PROMOTION_KIND_LABELS[p.kind as PromotionKind] ?? p.kind;
  }
}

/** Kinds of which one departure holds at most one active promotion. `named_per_pax` may repeat (different names). */
export const SINGLE_ACTIVE_PROMOTION_KINDS: PromotionKind[] = ["percent_order", "fixed_per_pax", "fixed_per_order", "gift"];

/**
 * Why a promotion of `kind` cannot be switched on next to `others` (the active
 * promotions that already apply to the departure). Null = allowed.
 */
export function promotionConflict(kind: PromotionKind, others: { kind: string }[]): string | null {
  if (EXCLUSIVE_PROMOTION_KINDS.includes(kind)) {
    const rival = EXCLUSIVE_PROMOTION_KINDS.find((k) => k !== kind);
    if (rival && others.some((o) => o.kind === rival)) {
      return `"${PROMOTION_KIND_LABELS.percent_order}" and "${PROMOTION_KIND_LABELS.fixed_per_pax}" can't both be active on the same departure. Switch off the active promotion first.`;
    }
  }
  if (SINGLE_ACTIVE_PROMOTION_KINDS.includes(kind) && others.some((o) => o.kind === kind)) {
    return `This departure already has an active "${PROMOTION_KIND_LABELS[kind]}" promotion. Edit it or switch it off first.`;
  }
  return null;
}

// ---------------------------------------------------------------- prices
export interface OptionLike {
  kind: string;
  position: number;
  price: number | null;
  room_prices: unknown;
}

export interface RoomPrices {
  double: number | null;
  triple: number | null;
  quad: number | null;
}

export function readRoomPrices(value: unknown): RoomPrices {
  const src = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { double: num(src.double), triple: num(src.triple), quad: num(src.quad) };
}

const firstOf = (options: OptionLike[], kind: string): OptionLike | undefined =>
  options.filter((o) => o.kind === kind).sort((a, b) => a.position - b.position)[0];

/**
 * A vacation package has no occupancy matrix. Its "from" price per person in a
 * double room is put together from the default choices, the same way the site
 * does (mega-family/scripts/parse-packages.py): hotel double / 2 + ticket +
 * flight (when the flight is priced separately) + fixed markup.
 * Null when there is no hotel with a double-room price.
 */
export function vacationDoublePerPerson(input: {
  options: OptionLike[];
  flight_mode: string;
  flight_price: number | null;
  markup_fixed: number | null;
}): number | null {
  const hotel = firstOf(input.options, "hotel");
  const double = hotel ? readRoomPrices(hotel.room_prices).double : null;
  if (double == null || double <= 0) return null;
  const ticket = firstOf(input.options, "ticket")?.price ?? 0;
  const flight = input.flight_mode === "priced" ? Number(input.flight_price ?? 0) : 0;
  const total = double / 2 + Number(ticket ?? 0) + flight + Number(input.markup_fixed ?? 0);
  return Math.round(total * 100) / 100;
}

export interface DoublePriceInput {
  prices: PriceMatrix;
  options: OptionLike[];
  flight_mode: string;
  flight_price: number | null;
  markup_fixed: number | null;
}

/** Price per person in a double room: the matrix row, else the vacation estimate. `derived` = not typed in. */
export function doublePricePerPerson(d: DoublePriceInput): { price: number | null; derived: boolean } {
  const matrix = d.prices["adult:2"];
  if (matrix != null && matrix > 0) return { price: matrix, derived: false };
  const vacation = vacationDoublePerPerson(d);
  return { price: vacation, derived: vacation != null };
}

// ---------------------------------------------------------------- publishing
export interface PublishInput extends DoublePriceInput {
  start_date: string | null;
  end_date: string | null;
  currency: string | null;
  route: RouteEnds;
}

/**
 * What stops a departure from going on the site (functional spec 4.4): dates,
 * both route ends, a currency and a double-room price. Empty = may publish.
 */
export function publishBlockers(d: PublishInput): string[] {
  const out: string[] = [];
  if (!d.start_date || !d.end_date) out.push("Missing dates");
  else if (d.end_date < d.start_date) out.push("Return date is before the departure date");
  if (!d.route.arrival_airport) out.push("Missing arrival city (on the departure or the series)");
  if (!d.route.return_airport) out.push("Missing return city (on the departure or the series)");
  if (!d.currency) out.push("Missing currency");
  if (doublePricePerPerson(d).price == null) out.push("Missing double-room price");
  return out;
}

export const NO_LIVE_FLIGHT_WARNING = "No live flight block - the site will show \"Flight details to follow\"";

// ---------------------------------------------------------------- sale status
/** Badge colours, matching the tag the site prints next to a date. */
export const SALE_STATUS_STYLES: Record<SaleStatus, string> = {
  open: "bg-success-muted text-success border-success/30",
  guaranteed: "bg-success text-success-foreground border-success",
  last_places: "bg-warning-muted text-warning border-warning/40",
  sold_out: "bg-destructive/10 text-destructive border-destructive/30",
  closed: "bg-muted text-muted-foreground border-border",
};

export const LAST_PLACES_THRESHOLD = 5;

/**
 * The sale status the site shows - the same rule as the site view
 * c_<slug>.departures (migration 20261002130000): the operator's "closed" and
 * "sold_out" always win; otherwise a date with flight seats allocated and none
 * left is sold out, and one with LAST_PLACES_THRESHOLD or fewer is "last
 * places". Seats freed by a cancellation bring the operator's status back.
 */
export function siteSaleStatus(input: { sale_status: string; allocated: number; remaining: number }): string {
  if (input.sale_status === "closed" || input.sale_status === "sold_out") return input.sale_status;
  if (input.allocated > 0 && input.remaining <= 0) return "sold_out";
  if (input.allocated > 0 && input.remaining <= LAST_PLACES_THRESHOLD) return "last_places";
  return input.sale_status;
}

// ---------------------------------------------------------------- holiday calendar
export interface PeriodLike {
  id: string;
  name: string;
  kind: string;
  holiday_date: string | null;
  start_date: string | null;
  end_date: string | null;
}

/** First and last day of a calendar period, whichever of its three dates are filled. */
export function periodRange(p: PeriodLike): { from: string; to: string } | null {
  const from = p.start_date ?? p.holiday_date ?? p.end_date;
  const to = p.end_date ?? p.start_date ?? p.holiday_date;
  if (!from || !to) return null;
  if (from <= to) return { from, to };
  // An end before the start is a period that crosses New Year typed with one year (Hanukkah 26.12 - 01.01).
  return { from, to: `${Number(to.slice(0, 4)) + 1}${to.slice(4)}` };
}

/** The periods a trip touches (any shared day). */
export function periodsOverlapping<T extends PeriodLike>(periods: T[], start: string, end: string): T[] {
  const out: T[] = [];
  for (const p of periods) {
    const range = periodRange(p);
    if (range && range.from <= end && range.to >= start) out.push(p);
  }
  return out;
}

export function periodLabel(p: PeriodLike): string {
  const range = periodRange(p);
  if (!range) return p.name;
  return range.from === range.to ? `${p.name} (${fmtDate(range.from)})` : `${p.name} (${fmtDateRange(range.from, range.to)})`;
}

// ---------------------------------------------------------------- paste from Excel
export interface PastedPriceRow {
  line: number;
  code: string;
  /** Six prices in PRICE_MATRIX_ROWS order. null = empty cell (the price is removed). */
  prices: (number | null)[];
  error: string | null;
}

/**
 * Rows copied from a spreadsheet: `code <tab> six prices`, one departure per
 * line, the prices in PRICE_MATRIX_ROWS order. A header line is skipped.
 */
export function parsePastedPrices(text: string, columns = 6): PastedPriceRow[] {
  const rows: PastedPriceRow[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  lines.forEach((raw, index) => {
    if (raw.trim() === "") return;
    const cells = raw.split("\t").map((c) => c.trim());
    const code = (cells[0] ?? "").toUpperCase();
    const priceCells = cells.slice(1);
    // A header row ("code", "pck_number", "קוד") has no digits in its price cells.
    if (index === 0 && priceCells.length > 0 && priceCells.every((c) => c !== "" && parsePrice(c) === undefined)) return;
    const prices: (number | null)[] = [];
    let error: string | null = null;
    if (!code) error = "Missing departure code";
    if (priceCells.length > columns && priceCells.slice(columns).some((c) => c !== "")) {
      error = error ?? `More than ${columns} price columns`;
    }
    for (let i = 0; i < columns; i++) {
      const parsed = parsePrice(priceCells[i] ?? "");
      if (parsed === undefined) {
        error = error ?? `Invalid price in column ${i + 1}: "${priceCells[i]}"`;
        prices.push(null);
      } else prices.push(parsed);
    }
    rows.push({ line: index + 1, code, prices, error });
  });
  return rows;
}

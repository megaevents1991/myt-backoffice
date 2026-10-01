/**
 * Pure helpers of the departures board, the departure card and the series
 * screen. No I/O and no React: the server actions
 * (lib/actions/tours-departure-actions.ts, tours-series-actions.ts) and the
 * client components import the same functions, so a rule (what blocks a
 * publish, how a code is built, which holiday a date touches) has one home.
 */
import type { PriceMatrix } from "@/lib/tours/pricing";
import {
  EXCLUSIVE_PROMOTION_KINDS,
  PROMOTION_KIND_LABELS,
  type PromotionKind,
  type SaleStatus,
} from "@/types/tours.types";

// ---------------------------------------------------------------- dates
const DAY_MS = 86_400_000;

/** A `YYYY-MM-DD` string as a UTC midnight timestamp. Date maths never touches the local zone. */
const utc = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

export const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(utc(value));

/** `2026-10-14` -> `14.10.26` */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

/** `14.10.26 - 20.10.26` */
export const fmtDateRange = (start: string | null | undefined, end: string | null | undefined): string =>
  `${fmtDate(start)} - ${fmtDate(end)}`;

/** `2026-10-14T10:10:00` (a block's local wall time) -> `14.10.26 10:10` */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const time = value.slice(11, 16);
  return time ? `${fmtDate(value)} ${time}` : fmtDate(value);
}

export function addDays(iso: string, days: number): string {
  return new Date(utc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function nightsBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const nights = Math.round((utc(end) - utc(start)) / DAY_MS);
  return Number.isFinite(nights) ? nights : null;
}

/** Days between two dates, ignoring the time part. */
export const dayDiff = (a: string, b: string): number => Math.abs(Math.round((utc(a) - utc(b)) / DAY_MS));

/** 0 = Sunday ... 6 = Saturday, the convention of tours.series.arrival_weekday. */
export const weekdayOf = (iso: string): number => new Date(utc(iso)).getUTCDay();

export const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;
export const WEEKDAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"] as const;

/** Today in Israel as `YYYY-MM-DD` - the date a soft delete is stamped with. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

/** Wall-clock parts of an instant in Israel. */
function jerusalemParts(date: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const out: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** A stored instant -> the value of a `datetime-local` input, in Israel time. */
export function isoToJerusalemLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = jerusalemParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The value of a `datetime-local` input, read as Israel time -> an ISO instant (null when empty or invalid). */
export function jerusalemLocalToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return null;
  const [y, mo, d, h, mi] = match.slice(1).map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  // Start from "as if UTC", measure how far Israel is from UTC at that moment, correct once.
  const p = jerusalemParts(new Date(wanted));
  const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(wanted - (shown - wanted)).toISOString();
}

/** `14.10.26 07:30` for a stored instant, in Israel time. */
export function fmtInstant(iso: string | null | undefined): string {
  const local = isoToJerusalemLocal(iso);
  return local ? fmtDateTime(local) : "";
}

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

// ---------------------------------------------------------------- money
const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", ILS: "₪" };
export const currencySymbol = (currency: string | null | undefined): string =>
  CURRENCY_SYMBOLS[currency ?? ""] ?? currency ?? "";

export function fmtMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** A typed or pasted price: `2,145`, ` 2145 `, `$2145` -> 2145. Empty -> null. Anything else -> undefined. */
export function parsePrice(raw: string | number | null | undefined): number | null | undefined {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  const cleaned = raw.replace(/[\s,$€£₪]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined;
  return Number(cleaned);
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

/** One short line for a promotion: `-80$ לנוסע`, `10% מההזמנה`, `מתנה: מזוודה`. */
export function promotionSummary(p: PromotionLike, currency: string | null | undefined): string {
  const sym = currencySymbol(currency);
  const value = p.value == null ? "" : fmtMoney(Number(p.value));
  switch (p.kind as PromotionKind) {
    case "percent_order":
      return `${value}% מההזמנה`;
    case "fixed_per_pax":
      return `${value}${sym} לנוסע`;
    case "fixed_per_order":
      return `${value}${sym} להזמנה`;
    case "named_per_pax":
      return `${p.label ?? "הנחה"}: ${value}${sym} לנוסע`;
    case "gift":
      return `מתנה: ${p.label ?? ""}`.trim();
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
      return `"${PROMOTION_KIND_LABELS.percent_order}" ו"${PROMOTION_KIND_LABELS.fixed_per_pax}" לא יכולות להיות פעילות יחד באותה יציאה. בטלו קודם את ההטבה הפעילה.`;
    }
  }
  if (SINGLE_ACTIVE_PROMOTION_KINDS.includes(kind) && others.some((o) => o.kind === kind)) {
    return `כבר קיימת ביציאה הטבה פעילה מסוג "${PROMOTION_KIND_LABELS[kind]}". ערכו אותה או בטלו אותה קודם.`;
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
  if (!d.start_date || !d.end_date) out.push("חסרים תאריכים");
  else if (d.end_date < d.start_date) out.push("תאריך החזרה מוקדם מתאריך היציאה");
  if (!d.route.arrival_airport) out.push("חסרה עיר נחיתה (ביציאה או בסדרה)");
  if (!d.route.return_airport) out.push("חסרה עיר חזרה (ביציאה או בסדרה)");
  if (!d.currency) out.push("חסר מטבע");
  if (doublePricePerPerson(d).price == null) out.push("חסר מחיר לחדר זוגי");
  return out;
}

export const NO_LIVE_FLIGHT_WARNING = "אין בלוק טיסה חי - האתר יציג \"פרטי הטיסות יעודכנו\"";

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
 * The status the seat count hints at, or null. Never applied by the system -
 * the screen offers it and the operator decides (functional spec 4.4).
 */
export function suggestedSaleStatus(input: {
  sale_status: string;
  allocated: number;
  remaining: number;
}): SaleStatus | null {
  if (input.allocated <= 0) return null;
  if (input.remaining <= 0) return input.sale_status === "sold_out" || input.sale_status === "closed" ? null : "sold_out";
  if (input.remaining <= LAST_PLACES_THRESHOLD) {
    return input.sale_status === "open" || input.sale_status === "guaranteed" ? "last_places" : null;
  }
  return null;
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
    if (!code) error = "חסר קוד יציאה";
    if (priceCells.length > columns && priceCells.slice(columns).some((c) => c !== "")) {
      error = error ?? `יותר מ-${columns} עמודות מחיר`;
    }
    for (let i = 0; i < columns; i++) {
      const parsed = parsePrice(priceCells[i] ?? "");
      if (parsed === undefined) {
        error = error ?? `מחיר לא תקין בעמודה ${i + 1}: "${priceCells[i]}"`;
        prices.push(null);
      } else prices.push(parsed);
    }
    rows.push({ line: index + 1, code, prices, error });
  });
  return rows;
}

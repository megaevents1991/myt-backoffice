/**
 * Dates, times and numbers as the tours screens show them - one module for
 * every tours screen. Date maths on `yyyy-mm-dd` strings lives in
 * lib/tours/deadlines.ts and is re-exported here, so a screen imports from one
 * place. Client and server safe: no imports beyond deadlines.ts.
 */
export {
  addDays,
  daysBetween,
  daysLeft,
  formatDateShort,
  isDateOnly,
  toDateOnly,
  todayIso,
} from "@/lib/tours/deadlines";
import { formatDateShort } from "@/lib/tours/deadlines";

// ---------------------------------------------------------------- dates
const DAY_MS = 86_400_000;
/** A `YYYY-MM-DD` string as a UTC midnight timestamp. Date maths never touches the local zone. */
const utc = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** `2026-10-14` -> `14.10.26` (the same as formatDateShort). */
export const fmtDate = (iso: string | null | undefined): string => formatDateShort(iso);

/** `14.10.26 - 20.10.26` */
export const fmtDateRange = (start: string | null | undefined, end: string | null | undefined): string =>
  `${fmtDate(start)} - ${fmtDate(end)}`;

/** `2026-10-14T10:10:00` (a block's local wall time) -> `14.10.26 10:10` */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const time = value.slice(11, 16);
  return time ? `${fmtDate(value)} ${time}` : fmtDate(value);
}

/** `HH:MM` of a timestamp as written (no timezone conversion). */
export function timeOf(timestamp: string | null | undefined): string {
  return timestamp && timestamp.length >= 16 ? timestamp.slice(11, 16) : "";
}

export function nightsBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const nights = Math.round((utc(end) - utc(start)) / DAY_MS);
  return Number.isFinite(nights) ? nights : null;
}

/** 0 = Sunday ... 6 = Saturday, the convention of tours.series.arrival_weekday. */
export const weekdayOf = (iso: string): number => new Date(utc(iso)).getUTCDay();
export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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

/** `14.10.26 07:30` for a stored instant, in Israel time - the operators' clock. */
export function fmtInstant(iso: string | null | undefined): string {
  const local = isoToJerusalemLocal(iso);
  return local ? fmtDateTime(local) : "";
}

/** What a cell shows when there is no value - the Mega Events tables show "-" too. */
export const EMPTY = "-";

// ---------------------------------------------------------------- numbers and money
/** Every currency a tours company prices, costs or pays in. */
export const ALL_CURRENCIES = ["USD", "EUR", "GBP", "ILS"] as const;

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", ILS: "₪" };
export const currencySymbol = (currency: string | null | undefined): string =>
  CURRENCY_SYMBOLS[currency ?? ""] ?? currency ?? "";

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "1,234.5" - plain number, no currency; "" when there is none. */
export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : NUMBER.format(value);
}

/** The board's price cell: "2,145" (no currency sign), "" when there is none. */
export const fmtMoney = (value: number | null | undefined): string => formatNumber(value);

/**
 * A price or a cost as every tours screen shows it, in the order of the Mega
 * Events screens: "$2,145", "€1,234.5", "₪350"; a currency with no symbol is
 * written after the number ("2,145 CHF"); "-" when there is no amount.
 */
export function fmtPrice(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const symbol = CURRENCY_SYMBOLS[currency ?? ""];
  if (symbol) return `${symbol}${NUMBER.format(value)}`;
  return currency ? `${NUMBER.format(value)} ${currency}` : NUMBER.format(value);
}

/** The same as fmtPrice - kept for the callers that already use the name. */
export const formatMoney = fmtPrice;

/** A typed number field: "" -> null, a number -> itself, anything else -> undefined (invalid). */
export function parseNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
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

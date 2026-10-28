/**
 * The marketing dashboard's period (spec 2026-10-14 section 1). Pure; scripts/marketing-range-selftest.ts.
 *
 * Every day here is an ISRAEL calendar day: both ad accounts report their days in Asia/Jerusalem, so an order placed
 * at 01:30 Israel time belongs to that Israel day, not to the UTC day before it. A window that cannot be trusted (a
 * custom range with garbage, `from` after `to`, a `to` in the future, more than MAX_SPAN_DAYS) falls back to the
 * default 30 days rather than throwing - the URL is user input.
 */

export const MARKETING_PERIODS = ["today", "yesterday", "7d", "30d", "90d", "month", "last_month", "custom"] as const;
export type MarketingPeriod = (typeof MARKETING_PERIODS)[number];

export const DEFAULT_PERIOD: MarketingPeriod = "30d";
/** A custom window spans at most this many days (inclusive). */
export const MAX_SPAN_DAYS = 366;

export interface MarketingWindow {
  range: MarketingPeriod;
  since: string;
  until: string;
}

const TZ = "Asia/Jerusalem";
const DAY_MS = 864e5;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** yyyy-mm-dd of an instant in Israel. */
function israelDayOfDate(d: Date): string {
  return dayFormat.format(d);
}

export function israelToday(now: Date = new Date()): string {
  return israelDayOfDate(now);
}

/** The Israel date of a timestamp (a reservation's created_at). */
export function israelDayOf(iso: string): string {
  return israelDayOfDate(new Date(iso));
}

/** A real calendar day in yyyy-mm-dd ("2026-02-30" is not). */
export function isIsoDay(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Calendar arithmetic on a yyyy-mm-dd (no time zone involved). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Every day from `since` to `until`, both included. */
export function daysBetween(since: string, until: string): string[] {
  const out: string[] = [];
  for (let d = since; d <= until; d = addDays(d, 1)) out.push(d);
  return out;
}

const offsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Israel's offset from UTC at an instant, in minutes (+180 in summer, +120 in winter). */
function israelOffsetMinutes(at: Date): number {
  const parts = offsetFormat.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** The UTC instant at which an Israel day starts (00:00 Asia/Jerusalem), as ISO. */
export function israelDayStartUtc(day: string): string {
  const midnightUtc = Date.parse(`${day}T00:00:00Z`);
  // Two passes: the offset at the first guess settles the day a DST switch happens on.
  let t = midnightUtc - israelOffsetMinutes(new Date(midnightUtc)) * 60_000;
  t = midnightUtc - israelOffsetMinutes(new Date(t)) * 60_000;
  return new Date(t).toISOString();
}

function rolling(today: string, days: number): { since: string; until: string } {
  return { since: addDays(today, -(days - 1)), until: today };
}

export function resolveWindow(input: { range?: string | null; from?: string | null; to?: string | null }, now: Date = new Date()): MarketingWindow {
  const today = israelToday(now);
  const range = (MARKETING_PERIODS as readonly string[]).includes(input.range ?? "") ? (input.range as MarketingPeriod) : DEFAULT_PERIOD;
  const fallback = (): MarketingWindow => ({ range: DEFAULT_PERIOD, ...rolling(today, 30) });
  switch (range) {
    case "today":
      return { range, since: today, until: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { range, since: y, until: y };
    }
    case "7d":
      return { range, ...rolling(today, 7) };
    case "30d":
      return { range, ...rolling(today, 30) };
    case "90d":
      return { range, ...rolling(today, 90) };
    case "month":
      return { range, since: `${today.slice(0, 7)}-01`, until: today };
    case "last_month": {
      const lastPrev = addDays(`${today.slice(0, 7)}-01`, -1);
      return { range, since: `${lastPrev.slice(0, 7)}-01`, until: lastPrev };
    }
    case "custom": {
      const { from, to } = input;
      if (!isIsoDay(from) || !isIsoDay(to) || from > to || to > today) return fallback();
      if (daysBetween(from, to).length > MAX_SPAN_DAYS) return fallback();
      return { range, since: from, until: to };
    }
  }
}

/** The window of the same length right before `since..until` - what a trend is measured against ("vs the previous
 *  period"). 2026-10-01..2026-10-30 -> 2026-09-01..2026-09-30. */
export function previousWindow(since: string, until: string): { since: string; until: string } {
  const length = daysBetween(since, until).length;
  return { since: addDays(since, -length), until: addDays(since, -1) };
}

/**
 * Deadlines of a group flight block (functional spec 4.3).
 *
 * Four of them come from the block's airline contract: the contract says "N days
 * before departure" and the block's outbound date turns that into a date. The
 * other two (payment / deposit, option expiry) are typed in by hand.
 *
 * Every deadline is editable on the block, and a hand-edited value must never be
 * overwritten silently. So nothing here writes "all four": `pickDeadlines` returns
 * only what the caller asked for - the missing ones, or an explicit list of fields.
 *
 * Dates are plain `yyyy-mm-dd` strings end to end. The arithmetic runs on UTC
 * midnights, so no timezone or daylight-saving shift can move a day.
 *
 * Pure functions, no I/O.
 */

/** The four deadlines a contract drives, in the order the screen shows them. */
export const CONTRACT_DEADLINE_FIELDS = [
  "first_cancellation_date",
  "last_cancellation_date",
  "names_deadline",
  "ticketing_deadline",
] as const;
export type ContractDeadlineField = (typeof CONTRACT_DEADLINE_FIELDS)[number];

/** Every deadline column of a block: the four contract ones plus the two manual ones. */
export const DEADLINE_FIELDS = [...CONTRACT_DEADLINE_FIELDS, "payment_deadline", "option_expiry"] as const;
export type DeadlineField = (typeof DEADLINE_FIELDS)[number];

export const DEADLINE_LABELS: Record<DeadlineField, string> = {
  first_cancellation_date: "ביטול ראשון",
  last_cancellation_date: "ביטול אחרון",
  names_deadline: "שמות",
  ticketing_deadline: "כרטוס",
  payment_deadline: "תשלום / מקדמה",
  option_expiry: "תפוגת אופציה",
};

/** The contract columns the deadlines are derived from. */
export interface ContractOffsets {
  cxx1_days_before: number | null;
  cxx2_days_before: number | null;
  names_days_before: number | null;
  ticketing_days_before: number | null;
}

const OFFSET_OF: Record<ContractDeadlineField, keyof ContractOffsets> = {
  first_cancellation_date: "cxx1_days_before",
  last_cancellation_date: "cxx2_days_before",
  names_deadline: "names_days_before",
  ticketing_deadline: "ticketing_days_before",
};

export type ComputedDeadlines = Record<ContractDeadlineField, string | null>;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_MS = 86_400_000;

/** True for a real calendar date written as `yyyy-mm-dd` (2026-02-30 is not one). */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 10) return false;
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/**
 * The date part of a date or a timestamp, as written. `2026-07-01T00:30:00` is the
 * 1st of July wherever the server runs - the string is cut, never parsed into a zone.
 */
export function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const head = value.slice(0, 10);
  return isDateOnly(head) ? head : null;
}

const utcDay = (date: string): number => {
  const m = DATE_ONLY.exec(date);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

/** `date` plus `days` (negative = earlier), as `yyyy-mm-dd`. */
export function addDays(date: string, days: number): string {
  return new Date(utcDay(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

/** Today as `yyyy-mm-dd` in the operators' timezone (the server itself runs in UTC). */
export function todayIso(now: Date = new Date(), timeZone = "Asia/Jerusalem"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Days left until a deadline: 0 = today, negative = overdue, null = no deadline. */
export function daysLeft(deadline: string | null | undefined, today: string): number | null {
  const date = toDateOnly(deadline);
  return date ? daysBetween(today, date) : null;
}

/** `dd.mm.yy`, the date format of every tours screen. */
export function formatDateShort(value: string | null | undefined): string {
  const date = toDateOnly(value);
  if (!date) return "";
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
}

/**
 * The four contract deadlines of a block that departs on `outboundDate`.
 * A missing offset, a missing contract or a missing date gives null for that deadline.
 */
export function computeDeadlines(
  outboundDate: string | null | undefined,
  contract: ContractOffsets | null | undefined,
): ComputedDeadlines {
  const date = toDateOnly(outboundDate);
  const result: ComputedDeadlines = {
    first_cancellation_date: null,
    last_cancellation_date: null,
    names_deadline: null,
    ticketing_deadline: null,
  };
  if (!date || !contract) return result;
  for (const field of CONTRACT_DEADLINE_FIELDS) {
    const offset = contract[OFFSET_OF[field]];
    if (offset === null || offset === undefined || !Number.isFinite(offset)) continue;
    result[field] = addDays(date, -Math.trunc(offset));
  }
  return result;
}

/**
 * Which computed deadlines to write onto a block.
 *  - "missing": only the fields the block has no value for (entering "confirmed").
 *  - a list of fields: exactly those ("recompute from the contract", the operator ticked them).
 * A field the contract cannot compute (null) is never returned, so a recompute
 * can fill or replace a date but never erase one.
 */
export function pickDeadlines(
  computed: ComputedDeadlines,
  current: Partial<Record<ContractDeadlineField, string | null>>,
  fields: "missing" | readonly ContractDeadlineField[],
): Partial<Record<ContractDeadlineField, string>> {
  const wanted = fields === "missing" ? CONTRACT_DEADLINE_FIELDS.filter((f) => !current[f]) : fields;
  const patch: Partial<Record<ContractDeadlineField, string>> = {};
  for (const field of wanted) {
    const value = computed[field];
    if (value) patch[field] = value;
  }
  return patch;
}

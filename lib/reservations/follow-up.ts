// lib/reservations/follow-up.ts
// A reservation in "Follow-up" (Dor, 04.10): the customer is waiting for us to get back to
// them. The status was already there; what was missing is the DAY we said we would call
// (`reservations.follow_up_date`) and anything that makes the pile stand out - the dashboard,
// the reservations table and the morning mail all hang off the rules in this file.
// Pure - no DB, no session (scripts/reservation-follow-up-selftest.ts).
import { daysLate } from "@/lib/tasks/reminders";

/** The status staff pick. Main never writes it. */
export const FOLLOW_UP_STATUS = "Follow-up";

/** The status box also takes free text, so "follow up" and "FollowUp " are the same pile. */
export function isFollowUpStatus(status: string | null | undefined): boolean {
  return /^follow[\s_-]?up$/i.test((status ?? "").trim());
}

/** A real calendar day, YYYY-MM-DD - what the column holds and what a date input sends. */
export function isFollowUpDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** `undated` = in Follow-up, and nobody said when (every row from before the date existed). */
export type FollowUpState = "overdue" | "today" | "undated" | "upcoming";

/** Where the call-back day stands against `today` (both on Israel's calendar). */
export function followUpState(date: string | null | undefined, today: string): FollowUpState {
  if (!isFollowUpDate(date)) return "undated";
  if (date < today) return "overdue";
  return date === today ? "today" : "upcoming";
}

/** The customer is waiting NOW: the day came, passed, or was never set. Only a later day is
 *  quiet - that is the one case staff decided on. */
export function needsCallNow(state: FollowUpState): boolean {
  return state !== "upcoming";
}

/** The next day the office works (Sunday-Thursday) after `today` - the default call-back day. */
export function nextWorkingDay(today: string): string {
  const day = new Date(`${today}T00:00:00Z`);
  do {
    day.setUTCDate(day.getUTCDate() + 1);
  } while (day.getUTCDay() === 5 || day.getUTCDay() === 6);
  return day.toISOString().slice(0, 10);
}

/**
 * The call-back date a save leaves behind. `undefined` = do not touch the column.
 *
 * - `nextStatus` undefined = the save does not change the status (a comment, the date alone).
 * - `requested` undefined = the caller did not send the date; null / junk = sent it empty.
 *
 * A reservation that ENTERS Follow-up always gets a day: the one picked, else a stored day
 * that is still ahead, else the next working day. The edit form sends the whole row back, so
 * a past day identical to the stored one is a leftover of an older round, not a choice.
 * Leaving Follow-up clears nothing - everything reads the date only while the status holds.
 */
export function followUpDateOnSave(input: {
  prevStatus: string | null | undefined;
  nextStatus: string | null | undefined;
  current: string | null | undefined;
  requested?: string | null;
  today: string;
}): string | null | undefined {
  const { prevStatus, nextStatus, current, requested, today } = input;
  const sent = requested !== undefined;
  const picked = isFollowUpDate(requested) ? requested : null;
  const willBe = nextStatus === undefined ? prevStatus : nextStatus;

  if (!isFollowUpStatus(willBe)) return sent ? picked : undefined;

  const entering = !isFollowUpStatus(prevStatus);
  if (!entering) return sent ? picked : undefined;

  const leftover = picked !== null && picked === current && picked < today;
  if (picked !== null && !leftover) return picked;
  return isFollowUpDate(current) && current >= today ? current : nextWorkingDay(today);
}

const STATE_ORDER: Record<FollowUpState, number> = { overdue: 0, today: 1, undated: 2, upcoming: 3 };

interface PileRow {
  follow_up_date?: string | null;
  created_at: string;
}

/** The order to work the pile in: longest overdue, today, nobody said when, then the nearest
 *  day. Inside a group with no day to compare, the booking that has waited longest is first. */
export function compareFollowUps(a: PileRow, b: PileRow, today: string): number {
  const stateA = followUpState(a.follow_up_date, today);
  const stateB = followUpState(b.follow_up_date, today);
  if (stateA !== stateB) return STATE_ORDER[stateA] - STATE_ORDER[stateB];
  if (stateA === "overdue" || stateA === "upcoming") {
    const byDay = (a.follow_up_date ?? "").localeCompare(b.follow_up_date ?? "");
    if (byDay !== 0) return byDay;
  }
  return a.created_at.localeCompare(b.created_at);
}

export interface FollowUpCounts {
  total: number;
  overdue: number;
  today: number;
  undated: number;
  upcoming: number;
  /** Customers waiting right now = overdue + today + undated. */
  now: number;
}

export function followUpCounts(rows: Array<Pick<PileRow, "follow_up_date">>, today: string): FollowUpCounts {
  const counts: FollowUpCounts = { total: rows.length, overdue: 0, today: 0, undated: 0, upcoming: 0, now: 0 };
  for (const row of rows) {
    const state = followUpState(row.follow_up_date, today);
    counts[state] += 1;
    if (needsCallNow(state)) counts.now += 1;
  }
  return counts;
}

/** What a row says about its day - English on the screens, Hebrew in the mail. */
export function followUpLabel(date: string | null | undefined, today: string, lang: "en" | "he"): string {
  const state = followUpState(date, today);
  if (state === "undated" || !date) return lang === "he" ? "בלי תאריך" : "No date";
  if (state === "today") return lang === "he" ? "היום" : "Today";
  const days = Math.abs(daysLate(date, today));
  if (state === "overdue") {
    if (lang === "he") return days === 1 ? "באיחור של יום" : `באיחור של ${days} ימים`;
    return days === 1 ? "1 day late" : `${days} days late`;
  }
  if (days === 1) return lang === "he" ? "מחר" : "Tomorrow";
  return lang === "he" ? `בעוד ${days} ימים` : `In ${days} days`;
}

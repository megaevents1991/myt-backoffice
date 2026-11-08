/**
 * Working time for Mega Events' unanswered alert (spec 2026-11-08 section 8, B-6): Sunday-Thursday 09:00-17:00 in
 * Israel (Alon's hours, C-12). A chat is unanswered once 60 WORKING minutes passed since its newest live inbound
 * message with no answer - a message at 16:30 alerts at 09:30 the next working morning. Pure; DST via Intl.
 */
const TZ = "Asia/Jerusalem";
const START_HOUR = 9;
const END_HOUR = 17;
/** Sunday (0) .. Thursday (4). */
const WORK_DAYS = new Set([0, 1, 2, 3, 4]);
export const UNANSWERED_AFTER_MINUTES = 60;
/** A gap longer than this is counted only over its last days (a chat quiet for months needs no exact count). */
const MAX_DAYS = 60;

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Wall = { y: number; m: number; d: number; h: number; min: number; weekday: number };

function wallOf(at: Date): Wall {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, weekday: WEEKDAYS.indexOf(p.weekday) };
}

/** How far Israel's wall clock is ahead of UTC at this instant, in ms. */
function offsetMs(at: Date): number {
  const w = wallOf(at);
  const s = +(Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value])).second);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant of an Israel wall-clock time (the second guess settles a DST edge). */
function israelWallToUtc(y: number, m: number, d: number, h: number): number {
  const guess = Date.UTC(y, m - 1, d, h, 0);
  const first = guess - offsetMs(new Date(guess));
  const second = guess - offsetMs(new Date(first));
  return second;
}

/** Working minutes between two instants (0 when `to` is not after `from`). */
export function workingMinutesBetween(from: Date, to: Date): number {
  const a = from.getTime();
  const b = to.getTime();
  if (!(b > a)) return 0;
  const start = Math.max(a, b - MAX_DAYS * 24 * 60 * 60 * 1000);
  let total = 0;
  const first = wallOf(new Date(start));
  let day = Date.UTC(first.y, first.m - 1, first.d);
  for (let i = 0; i <= MAX_DAYS + 1; i++, day += 24 * 60 * 60 * 1000) {
    const cal = new Date(day);
    const y = cal.getUTCFullYear();
    const m = cal.getUTCMonth() + 1;
    const d = cal.getUTCDate();
    const open = israelWallToUtc(y, m, d, START_HOUR);
    if (open > b) break;
    if (!WORK_DAYS.has(cal.getUTCDay())) continue;
    const close = israelWallToUtc(y, m, d, END_HOUR);
    total += Math.max(0, Math.min(b, close) - Math.max(start, open));
  }
  return Math.floor(total / 60_000);
}

/** The working minutes a chat has waited (60+) for an answer to its newest live inbound message, else null. */
export function unansweredFor(lastInAt: string | null, answeredAt: string | null, now: Date): number | null {
  if (!lastInAt) return null;
  if (answeredAt && Date.parse(answeredAt) >= Date.parse(lastInAt)) return null;
  const minutes = workingMinutesBetween(new Date(lastInAt), now);
  return minutes >= UNANSWERED_AFTER_MINUTES ? minutes : null;
}

/** Inside working hours now - when the alert cron mails. */
export function isAlertTime(now: Date): boolean {
  const w = wallOf(now);
  return WORK_DAYS.has(w.weekday) && w.h >= START_HOUR && w.h < END_HOUR;
}

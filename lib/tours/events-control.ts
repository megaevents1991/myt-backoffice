/**
 * What a tours company shows of Mega Events' packages (19.10.2026 - Dor: "שליטה מלאה מה אנחנו מציגים
 * באתר של פמילי, כולל סינכרון ידני ולא רק cron, וגם אופציה לבחירה ידנית"; Alon: "שאני אוכל לבחור איזה
 * סיילים של מוזיקה וספורט מוצגים... אופציה לבחור אוטומטית את המבוקשים ביותר והחדשים ביותר").
 *
 * Staff keep it on Website > Mega Events Packages. It is the document 'events_control' of
 * tours.site_content (migration 20261019120000); the sync (lib/services/tours-events-feed-sync.ts)
 * reads it for every company and builds that company's list from it: the picks first, in their
 * order, then Mega Events' automatic rows the company follows ("המבוקשים ביותר", "החדשים" or both),
 * never an event it hid, at most `max`. A company that never saved one gets DEFAULT_EVENTS_CONTROL -
 * the list it had before (Mega Events' most wanted, 12). Pure: no DB, no network.
 */
import { z } from "zod";

import { toRef, type RowRef, type ShowFlags } from "@/lib/homepage/merge";
import {
  EVENTS_FEED_MAX,
  HOT_ROW_KEY,
  NEWEST_ROW_KEY,
  feedCutoffDate,
  feedItemOf,
  isFeedEventSoldOut,
  isListedFeedEvent,
  type EventsFeedItem,
  type EventsFeedRowKey,
  type FeedEventRow,
} from "@/lib/tours/events-feed";

/** tours.site_content key of the document. */
export const EVENTS_CONTROL_KEY = "events_control";
/** The most packages a site may show. */
export const EVENTS_SHOWN_MAX = 24;
/** The most events staff may pin. */
export const EVENTS_PICKS_MAX = 24;
/** The most events staff may hide. */
export const EVENTS_HIDDEN_MAX = 500;

/** Mega Events' rows a company may follow, in the order the screen offers them. */
export const EVENTS_AUTO_ROWS = [HOT_ROW_KEY, NEWEST_ROW_KEY] as const;

export type EventsControl = {
  /** Mega Events' rows that fill the list after the picks, in this order; [] = the picks alone. */
  auto: EventsFeedRowKey[];
  /** Events shown first, in this order (Mega Events event ids). */
  picks: number[];
  /** Events never shown: not in the list, not in the search. */
  hidden: number[];
  /** How many packages the site shows. */
  max: number;
  /** The site's sport & music search lists Mega Events' events (false = this site's own tours only). */
  search: boolean;
};

/** What a company that never saved the screen gets: the list every company had until 19.10.2026. */
export const DEFAULT_EVENTS_CONTROL: EventsControl = {
  auto: [HOT_ROW_KEY],
  picks: [],
  hidden: [],
  max: EVENTS_FEED_MAX,
  search: true,
};

const eventId = z.number().int().positive();
const distinct = (list: readonly unknown[]) => new Set(list).size === list.length;

export const eventsControlSchema = z
  .object({
    auto: z
      .array(z.enum(EVENTS_AUTO_ROWS))
      .max(EVENTS_AUTO_ROWS.length)
      .refine(distinct, "A Mega Events row is chosen twice"),
    picks: z
      .array(eventId)
      .max(EVENTS_PICKS_MAX, `Pin at most ${EVENTS_PICKS_MAX} events`)
      .refine(distinct, "An event is pinned twice"),
    hidden: z
      .array(eventId)
      .max(EVENTS_HIDDEN_MAX, `Hide at most ${EVENTS_HIDDEN_MAX} events`)
      .refine(distinct, "An event is hidden twice"),
    max: z
      .number()
      .int()
      .min(1, "Show at least one package")
      .max(EVENTS_SHOWN_MAX, `Show at most ${EVENTS_SHOWN_MAX} packages`),
    search: z.boolean(),
  })
  .refine((c) => !c.picks.some((id) => c.hidden.includes(id)), "An event can't be both pinned and hidden");

/**
 * The stored document as the sync and the screen use it. Read defensively: a field that is not what
 * it should be takes its default, so a broken document never empties a site's list.
 */
export function readEventsControl(data: unknown): EventsControl {
  const whole = eventsControlSchema.safeParse(data);
  if (whole.success) return whole.data;
  const o = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const ids = (v: unknown, max: number) =>
    Array.isArray(v) ? Array.from(new Set(v.filter((n): n is number => Number.isInteger(n) && n > 0))).slice(0, max) : [];
  const stored = Array.isArray(o.auto) ? (o.auto as unknown[]) : null;
  const auto = stored
    ? EVENTS_AUTO_ROWS.filter((row) => stored.includes(row)).sort((a, b) => stored.indexOf(a) - stored.indexOf(b))
    : DEFAULT_EVENTS_CONTROL.auto;
  const picks = ids(o.picks, EVENTS_PICKS_MAX);
  const hidden = ids(o.hidden, EVENTS_HIDDEN_MAX).filter((id) => !picks.includes(id));
  const max = Number.isInteger(o.max) && (o.max as number) >= 1 ? Math.min(o.max as number, EVENTS_SHOWN_MAX) : DEFAULT_EVENTS_CONTROL.max;
  return { auto, picks, hidden, max, search: typeof o.search === "boolean" ? o.search : DEFAULT_EVENTS_CONTROL.search };
}

/**
 * A company's list: its picks that can be sold (`picked` holds those - an event past the window, sold
 * out or with no price is not there), in the order staff set, then the rows it follows in its order,
 * never an event twice, never a hidden one, at most `max`. A pick holds its place (`pinned`).
 */
export function composeEventsFeed(
  control: EventsControl,
  picked: ReadonlyMap<number, EventsFeedItem>,
  rows: Partial<Record<EventsFeedRowKey, readonly EventsFeedItem[]>>,
): EventsFeedItem[] {
  const hidden = new Set(control.hidden);
  const seen = new Set<number>();
  const out: EventsFeedItem[] = [];
  const add = (item: EventsFeedItem, pinned: boolean) => {
    if (out.length >= control.max || seen.has(item.id) || hidden.has(item.id)) return;
    seen.add(item.id);
    out.push(item.pinned === pinned ? item : { ...item, pinned });
  };
  for (const id of control.picks) {
    const item = picked.get(id);
    if (item) add(item, true);
  }
  for (const row of control.auto) for (const item of rows[row] ?? []) add(item, item.pinned);
  return out;
}

/**
 * The picks that can be sold, by id, from their full rows: listed (not past the window, not taken off),
 * not sold out (the row's tickets, and the site's own card flag when the site was read and knows the
 * card), with a name, a picture and a price. A pick that is not here is skipped, and its place goes to
 * the next one.
 */
export function pickedFeedItems(
  rows: readonly FeedEventRow[],
  now: Date,
  flags?: ReadonlyMap<RowRef, ShowFlags> | null,
): Map<number, EventsFeedItem> {
  const cutoff = feedCutoffDate(now);
  const out = new Map<number, EventsFeedItem>();
  for (const row of rows) {
    if (!isListedFeedEvent(row, cutoff) || isFeedEventSoldOut(row)) continue;
    if (flags?.get(toRef("event", row.id))?.soldOut === true) continue;
    const item = feedItemOf(row, { pinned: true });
    if (item) out.set(row.id, item);
  }
  return out;
}

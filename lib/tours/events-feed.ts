/**
 * Mega Events' hot packages, as the sites of the tours companies show them (Mega Family: its
 * header menu and its "ספורט ומוזיקה" world). Dor approved 14.10.2026.
 *
 * The list is "המבוקשים ביותר" of mega-events.co.il, card for card: staff pins of that row
 * (homepage_items, section 'most_wanted') hold their places, the row's automatic pool fills the
 * rest - the Prioritized events, then the fill - with the same merge the site renders with
 * (lib/homepage/merge.ts, byte-identical in myt-main). The pool comes from the site itself
 * (myt-main /api/homepage-pools, lib/homepage/rows.ts buildPools) when it can be read;
 * otherwise `fallbackPool` rebuilds it from the event rows. The price is the number the site's
 * card prints (siteCardPrice, lib/package-price.ts) - never a third copy of the price rule.
 *
 * The cron (/api/cron/toursEventsFeed, lib/services/tours-events-feed-sync.ts) stores the
 * result in tours.site_content under key 'events_feed', and the company site reads it through
 * <schema>.site_content at build time. It reads in two steps: the few columns that order the
 * list for every listed event, then the tickets and prices only of the events the list can
 * reach (buildEventsFeedInPages) - every event's tickets in one read (~7 MB) timed the cron out
 * on 14.10.2026. Pure: no DB, no network (the paged builder is handed its reader).
 *
 * The same document carries `index` (15.10.2026, Dor): EVERY event Mega Events lists, light fields
 * only, for the live search of a company site (typing "סלין" lists every Celine Dion show). It
 * is built from the first pass alone (buildEventsIndex) - never a ticket read for it - and only
 * the events of `items` carry a price, copied from them.
 *
 * Since 19.10.2026 each company decides what its list holds (lib/tours/events-control.ts, Website >
 * Mega Events Packages): its own picks first, then one or both of Mega Events' automatic rows -
 * "המבוקשים ביותר" or "החדשים" (`row` of the build; `newestPool` rebuilds the latter when the site
 * cannot be read) - minus what it hid.
 */
import { defaultPinnable, defaultShowable, mergeRow, refId, refKind, toRef } from "@/lib/homepage/merge";
import type { RowPin, RowRef, ShowFlags } from "@/lib/homepage/merge";
import { eventCityName, hasEventCity, placeLabel, type LodgingPoint } from "@/lib/lodging";
import { isTicketOnlyEvent } from "@/lib/package-mode";
import { siteCardPrice, type SiteCardPriceEvent } from "@/lib/package-price";
import { eventSiteUrl, PUBLIC_SITE_URL } from "@/lib/site";

/** tours.site_content key of the list (migration 20261014190000 lets the key in). */
export const EVENTS_FEED_KEY = "events_feed";
/** How many packages a company site gets. */
export const EVENTS_FEED_MAX = 12;
/** How many events the search index holds at most: the soonest. */
export const EVENTS_INDEX_MAX = 400;
/**
 * How many events the cron reads in full (tickets and prices) at a time: four lists' worth, so
 * the sold-out and unpriced events the list skips rarely cost a second read.
 */
export const EVENTS_FEED_PAGE = 4 * EVENTS_FEED_MAX;
/** The Mega Events homepage row the list follows. */
export const HOT_ROW_KEY = "most_wanted";
/** Mega Events' "החדשים" row - the latest uploads - which a company may follow instead or after (19.10.2026). */
export const NEWEST_ROW_KEY = "newest";
/** The Mega Events homepage rows a company list can follow. */
export type EventsFeedRowKey = typeof HOT_ROW_KEY | typeof NEWEST_ROW_KEY;
/**
 * An event lists only from this many days ahead - myt-main lib/eventsData.ts
 * AVAILABILITY_WINDOW_DAYS: the order page stops selling 3 days before the event.
 */
export const AVAILABILITY_WINDOW_DAYS = 3;

/** What the cards of Mega Events print beside the price (myt-main components/ClientSideHomepage.tsx). */
export const PRICE_LABEL = "מחיר ממוצע";
const PRICE_NOTE_PACKAGE = "לנוסע · כולל טיסה, מלון וכרטיס";
const PRICE_NOTE_TICKET_ONLY = "לכרטיס · כרטיס בלבד";

export type EventsFeedCategory = "sports" | "music" | "other";

/** One package, as a company site draws it. */
export type EventsFeedItem = {
  id: number;
  /** The Hebrew name Mega Events' card prints. */
  name: string;
  /** The event's start as stored (ISO). */
  date: string;
  /** "DD/MM/YY" - the date Mega Events' cards print. */
  dateLabel: string;
  /** Where it is, as Mega Events prints it: "לונדון, בריטניה", or "מנצ'סטר · טיסה ללונדון". */
  place: string;
  /** The city of the show itself. */
  city: string | null;
  country: string | null;
  countryCode: string | null;
  /** Absolute URL: the event's own photo, else its cut-out art (`imageIsCutout`). */
  image: string;
  /** A transparent cut-out (Mega Events draws it on a coloured blob), not a full photo. */
  imageIsCutout: boolean;
  category: EventsFeedCategory;
  /** Sold as a ticket alone (no flight or hotel). */
  ticketOnly: boolean;
  /** USD per traveler (per ticket when ticketOnly) - what Mega Events' card prints. */
  price: number;
  currency: "USD";
  priceLabel: string;
  /** The line under the price on Mega Events' card. */
  priceNote: string;
  /** The event's order page on mega-events.co.il. */
  href: string;
  /** Staff pinned it to "המבוקשים ביותר". */
  pinned: boolean;
  prioritized: boolean;
};

/**
 * One event of the search index: every listed event that is not sold out, as far as the first
 * pass knows (buildEventsIndex). The price fields only on an event of `items`.
 */
export type EventsIndexItem = {
  id: number;
  name: string;
  /** The event's start as stored (ISO). */
  date: string;
  /** "DD/MM/YY". */
  dateLabel: string;
  /** As EventsFeedItem.place. */
  place: string;
  category: EventsFeedCategory;
  /** The event's order page on mega-events.co.il. */
  href: string;
  /** The picture `items` would use (photo, else cut-out art), only when it is https; else null. */
  image: string | null;
} & Partial<Pick<EventsFeedItem, "price" | "currency" | "priceLabel" | "priceNote">>;

/** The stored document (tours.site_content.data). */
export type EventsFeedDoc = {
  /** When the list (or the index) last changed. */
  updatedAt: string;
  /** Where the order came from: the site's own row, or rebuilt from the database. */
  source: "site" | "database";
  items: EventsFeedItem[];
  /** Every listed event by date, at most EVENTS_INDEX_MAX - for the site's search. */
  index: EventsIndexItem[];
  /** False = staff took Mega Events' events out of the site's search (the index is then empty on purpose). */
  search?: boolean;
};

/** The event columns the builder reads (the cron selects exactly these). */
export type FeedEventRow = SiteCardPriceEvent & {
  id: number;
  name: string | null;
  type: string | null;
  date: string;
  location: LodgingPoint | null;
  event_location?: LodgingPoint | null;
  card_image_url?: string | null;
  art_image_url?: string | null;
  tags?: string | null;
  is_prioritized?: boolean | null;
  is_test?: boolean | null;
  deactivated_reason?: string | null;
  is_deleted?: string | null;
  /** When the event was uploaded - the order of "החדשים". */
  created_at?: string | null;
};

/**
 * The columns that decide whether an event lists and where it stands in the list - all the
 * cron reads of EVERY listed event. No tickets: they are the heavy part of the row.
 */
export const FEED_ORDER_COLUMNS = [
  "id",
  "type",
  "date",
  "tags",
  "is_prioritized",
  "is_test",
  "deactivated_reason",
  "is_deleted",
  "created_at",
] as const;
export type FeedOrderRow = Pick<FeedEventRow, (typeof FEED_ORDER_COLUMNS)[number]>;

/** What the search index prints of every listed event, read in the same first pass. Still no tickets. */
export const FEED_INDEX_COLUMNS = ["name", "location", "event_location", "card_image_url", "art_image_url"] as const;
/** The cron's first read of every listed event: what orders the list + what the index prints. */
export const FEED_LIGHT_COLUMNS = [...FEED_ORDER_COLUMNS, ...FEED_INDEX_COLUMNS] as const;
export type FeedLightRow = Pick<FeedEventRow, (typeof FEED_LIGHT_COLUMNS)[number]>;

/** The site's own row, as /api/homepage-pools sends it. */
export type SiteHotRow = {
  /** The row's automatic pool, in the site's order. */
  pool: RowRef[];
  /** Per card: whether it can be shown (the site's isEventSoldOut). */
  flags: ReadonlyMap<RowRef, ShowFlags>;
};

export type EventsFeedInput = {
  events: FeedEventRow[];
  /** The row's pins (homepage_items of section 'most_wanted'). */
  pins: RowPin[];
  /** Cards staff removed from the row (homepage_sections.config.hidden). */
  hidden?: RowRef[];
  /** The site's row; null = rebuild the pool from `events`. */
  site?: SiteHotRow | null;
  now: Date;
  max?: number;
  /** Mega Events' row to follow; "most_wanted" when not said. */
  row?: EventsFeedRowKey;
};

/** "YYYY-MM-DD" from which an event lists - myt-main futureDateISO(AVAILABILITY_WINDOW_DAYS). */
export function feedCutoffDate(now: Date): string {
  return new Date(now.getTime() + AVAILABILITY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/**
 * May the event appear on a Mega Events listing: not deleted, at least the window ahead, not a QA
 * event, not taken off the site (myt-main lib/eventsData.ts getEvents + isListedEvent).
 */
export function isListedFeedEvent(e: FeedOrderRow, cutoff: string): boolean {
  if (e.is_deleted != null || e.is_test === true || e.deactivated_reason) return false;
  const at = Date.parse(e.date);
  return Number.isFinite(at) && at >= Date.parse(`${cutoff}T00:00:00Z`);
}

/** myt-main lib/events/price.ts isEventSoldOut, minus the locked-flight flag only the site computes. */
export function isFeedEventSoldOut(e: FeedEventRow): boolean {
  return !(e.tickets_and_rates || []).some((t) => t?.available !== false) || e.tags === "Sold";
}

const time = (iso: string) => Date.parse(iso) || 0;

// myt-main lib/homepage/rows.ts byTagThenDate: events with a tag first, then by date.
const byTagThenDate = (a: FeedOrderRow, b: FeedOrderRow) => {
  if (a.tags && !b.tags) return -1;
  if (!a.tags && b.tags) return 1;
  return time(a.date) - time(b.date);
};

/**
 * The pool of "המבוקשים ביותר" rebuilt from the rows, for when the site cannot be read: the
 * Prioritized events, then the fill - not Prioritized, not VIP, not a fixed sports_event - each
 * part tags first, then soonest (myt-main lib/homepage/rows.ts buildPools). The site also keeps
 * one card per artist / team page in the fill; that needs the people tables and is left out here.
 * `soldOut` is a parameter because the order is first worked out before the tickets are read:
 * isFeedEventSoldOut on a row without tickets says "sold out" and would empty the pool.
 */
export function fallbackPool<T extends FeedOrderRow>(listed: T[], soldOut: (e: T) => boolean): RowRef[] {
  const live = listed.filter((e) => !soldOut(e));
  const prioritized = live.filter((e) => e.is_prioritized === true).sort(byTagThenDate);
  const fill = live
    .filter((e) => e.is_prioritized === false && e.tags !== "VIPevent" && e.type !== "sports_event")
    .sort(byTagThenDate);
  return [...prioritized, ...fill].map((e) => toRef("event", e.id));
}

/**
 * The pool of "החדשים" rebuilt from the rows, for when the site cannot be read: every live event
 * but the VIP ones, the latest upload first (myt-main lib/homepage/rows.ts buildPools - which also
 * keeps one card per artist / team page; left out here, as in fallbackPool).
 */
export function newestPool<T extends FeedOrderRow>(listed: T[], soldOut: (e: T) => boolean): RowRef[] {
  return listed
    .filter((e) => !soldOut(e) && e.tags !== "VIPevent")
    .sort((a, b) => time(b.created_at ?? "") - time(a.created_at ?? "") || b.id - a.id)
    .map((e) => toRef("event", e.id));
}

const SPORTS_TYPES = new Set(["sports_event", "sports_event_dynamic", "sports_live_event_dynamic"]);
const MUSIC_TYPES = new Set(["music_event", "music_live_event_dynamic"]);

/**
 * A TixStock event named like a fixture: "ווסטהאם יונייטד - סאוטהמפטון", "A vs B", "ליגת האלופות: A - B". A concert
 * name has no spaced dash ("ג'יי-זי" keeps its dash unspaced), and a colon alone ("קולדפליי: סיבוב") says nothing.
 */
const FIXTURE_NAME = /\s[-–]\s|\svs\.?\s/i;

/**
 * sports / music by event type; a TixStock event is music unless it is the World Cup (myt-main rows.ts isMusic) or
 * is named like a fixture - Mega Family's "ספורט" pill listed no football at all until 16.10 (every match of the
 * hot row is a tx_event).
 */
export function feedCategory(e: Pick<FeedEventRow, "type" | "name">): EventsFeedCategory {
  const type = e.type ?? "";
  if (SPORTS_TYPES.has(type)) return "sports";
  if (MUSIC_TYPES.has(type)) return "music";
  if (type === "tx_event") {
    const name = e.name ?? "";
    return name.startsWith("מונדיאל 2026") || FIXTURE_NAME.test(name) ? "sports" : "music";
  }
  return "other";
}

/** An absolute http(s) URL, or null. A site-relative path is read on mega-events.co.il. */
function absoluteUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.startsWith("//")) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${PUBLIC_SITE_URL}${value}`;
  return null;
}

/** The event's picture as feedItemOf takes it - the photo, else the cut-out art - absolute, or null. */
export function eventImageUrl(e: Pick<FeedEventRow, "card_image_url" | "art_image_url">): string | null {
  return absoluteUrl(e.card_image_url) ?? absoluteUrl(e.art_image_url);
}

/** "DD/MM/YY" of the stored date (its UTC day - the day staff typed, as main's board prints it). */
export function feedDateLabel(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCFullYear() % 100)}`;
}

/** "Country" of "City, Country", or null. */
function countryPart(name: string | null | undefined): string | null {
  const parts = (name ?? "").split(",");
  const last = parts.length > 1 ? parts[parts.length - 1].trim() : "";
  return last || null;
}

/** One event as a company site draws it; null when it has no name, no picture, no price or no date. */
export function feedItemOf(e: FeedEventRow, flags: { pinned: boolean }): EventsFeedItem | null {
  const name = (e.name ?? "").trim();
  if (!name) return null;
  const photo = absoluteUrl(e.card_image_url);
  const image = photo ?? absoluteUrl(e.art_image_url);
  if (!image) return null;
  const price = siteCardPrice(e);
  if (price === null || !Number.isFinite(price)) return null;
  const dateLabel = feedDateLabel(e.date);
  if (!dateLabel) return null;
  const ticketOnly = isTicketOnlyEvent(e);
  // `location` is the flight city; `event_location` the city of the show when it differs (lib/lodging.ts)
  const lodging = e.location ? { location: e.location, event_location: e.event_location ?? null } : null;
  const show = lodging && hasEventCity(lodging) ? lodging.event_location : e.location;
  return {
    id: e.id,
    name,
    date: e.date,
    dateLabel,
    place: placeLabel(lodging),
    city: eventCityName(lodging) || null,
    country: countryPart(show?.name) ?? countryPart(e.location?.name),
    countryCode: show?.country_code ?? e.location?.country_code ?? null,
    image,
    imageIsCutout: !photo,
    category: feedCategory(e),
    ticketOnly,
    price,
    currency: "USD",
    priceLabel: PRICE_LABEL,
    priceNote: ticketOnly ? PRICE_NOTE_TICKET_ONLY : PRICE_NOTE_PACKAGE,
    href: eventSiteUrl(e.id),
    pinned: flags.pinned,
    prioritized: e.is_prioritized === true,
  };
}

type LayoutItem = { section: string; kind: string; ref_id: string | number; position: number | null };

/** homepage_items rows of the row → its pins (myt-main lib/homepageLayout.ts getHomepageLayout). */
export function hotRowPins(items: LayoutItem[]): RowPin[] {
  return rowPins(items, HOT_ROW_KEY);
}

/** homepage_items rows of one row (`row`) → its pins. */
export function rowPins(items: LayoutItem[], row: string): RowPin[] {
  return items
    .filter((it) => it.section === row)
    .map((it) => {
      const slot = Number(it.position);
      return { ref: toRef(it.kind, String(it.ref_id)), slot: Number.isFinite(slot) && slot >= 0 ? Math.floor(slot) : 0 };
    })
    .sort((a, b) => a.slot - b.slot);
}

const REF_RE = /^(event|artist|team|review):\S{1,200}$/;

/** The row's hidden cards: `config.hidden`, plus the older `hidden_event_ids` (myt-main hiddenRefs). */
export function hotRowHidden(config: unknown): RowRef[] {
  const c = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const out: RowRef[] = [];
  for (const v of Array.isArray(c.hidden) ? c.hidden : []) {
    if (typeof v === "string" && REF_RE.test(v) && !out.includes(v)) out.push(v);
  }
  for (const v of Array.isArray(c.hidden_event_ids) ? c.hidden_event_ids : []) {
    const n = Number(v);
    const ref = toRef("event", n);
    if (Number.isInteger(n) && n > 0 && !out.includes(ref)) out.push(ref);
  }
  return out;
}

/** What orders the row: everything of EventsFeedInput but the rows and the length. */
type FeedRowInput = Omit<EventsFeedInput, "events" | "max">;

const NOTHING_UNREAD: ReadonlySet<number> = new Set();

/**
 * The row as the site merges it (pins in their places, then the pool), with no length of its
 * own, plus the listed events by id and the sold-out test it was ordered with. `rows` are full
 * rows except the ids in `unread`, whose tickets are not read yet: such an event counts as on
 * sale unless it is tagged "Sold" (the one part of the test its light row answers), so it keeps
 * its place in the order instead of dropping out the way an event with no tickets does.
 */
function feedRow(rows: FeedOrderRow[], unread: ReadonlySet<number>, input: FeedRowInput) {
  const cutoff = feedCutoffDate(input.now);
  const listed = rows.filter((e) => isListedFeedEvent(e, cutoff));
  const byId = new Map(listed.map((e) => [e.id, e]));
  // every row not in `unread` is a full row (planEventsFeed / buildEventsFeed build them so)
  const soldOut = (e: FeedOrderRow) => (unread.has(e.id) ? e.tags === "Sold" : isFeedEventSoldOut(e as FeedEventRow));

  const rowKey = input.row ?? HOT_ROW_KEY;
  let pool: RowRef[];
  let flags: ReadonlyMap<RowRef, ShowFlags>;
  if (input.site) {
    pool = input.site.pool;
    flags = input.site.flags;
  } else {
    pool = rowKey === NEWEST_ROW_KEY ? newestPool(listed, soldOut) : fallbackPool(listed, soldOut);
    flags = new Map(listed.map((e) => [toRef("event", e.id), { soldOut: soldOut(e) }]));
  }

  const row = mergeRow(pool, input.pins, {
    hidden: input.hidden ?? [],
    max: null,
    showable: (ref) => defaultShowable(flags.get(ref), rowKey, ref),
    pinnable: (ref) => defaultPinnable(flags.get(ref), rowKey, ref),
  });
  return { cards: row.cards, byId, soldOut };
}

export type EventsFeedPlan = {
  items: EventsFeedItem[];
  /**
   * False = the list may still change once more rows are read in full: its walk reached an
   * event not read yet before it was full, or a pinned event is not read yet.
   */
  complete: boolean;
};

/**
 * The walk over the row: every card that is not a listed, unsold event with a name, a picture
 * and a price is dropped, and the first `max` stay. It stops at the first event not read yet -
 * up to there the row is exactly the one the full rows give (an unread event can only turn out
 * sold out and leave the pool, which moves the cards after it, never the ones before), past it
 * nothing is certain.
 */
function walkFeed(rows: FeedOrderRow[], unread: ReadonlySet<number>, input: FeedRowInput & { max?: number }): EventsFeedPlan {
  const max = input.max ?? EVENTS_FEED_MAX;
  const { cards, byId, soldOut } = feedRow(rows, unread, input);
  // a listed event that may be on sale, whose tickets are not read yet (a feedCandidateIds id)
  const waiting = (ref: RowRef) => {
    if (refKind(ref) !== "event") return false;
    const event = byId.get(Number(refId(ref)));
    return !!event && unread.has(event.id) && !soldOut(event);
  };
  // a pin's own state moves the pins after it (mergeRow closes up behind a dead pin), so nothing
  // is final while a pinned event is unread - the cron reads the pinned ones first for that
  const pinsRead = !cards.some((card) => card.pinned && waiting(card.ref));

  const items: EventsFeedItem[] = [];
  const seen = new Set<number>();
  for (const card of cards) {
    if (items.length >= max) break;
    if (refKind(card.ref) !== "event") continue;
    const event = byId.get(Number(refId(card.ref)));
    if (!event || seen.has(event.id) || soldOut(event)) continue;
    if (unread.has(event.id)) return { items, complete: false };
    const item = feedItemOf(event as FeedEventRow, { pinned: card.pinned });
    if (!item) continue;
    seen.add(event.id);
    items.push(item);
  }
  return { items, complete: pinsRead };
}

/**
 * The list from full rows: the row as the site merges it, then every card that is not a listed
 * event with a name, a picture and a price is dropped, and the first `max` stay.
 */
export function buildEventsFeed(input: EventsFeedInput): EventsFeedItem[] {
  return walkFeed(input.events, NOTHING_UNREAD, input).items;
}

/**
 * The events the list can reach, in the order its walk meets them, worked out from the light
 * rows alone (every event counted as on sale): the pinned ones first, since a pin decides where
 * the pins after it stand, then the rest of the row. The cron reads the full rows in this order.
 */
export function feedCandidateIds(input: FeedRowInput & { events: FeedOrderRow[] }): number[] {
  const unread = new Set(input.events.map((e) => e.id));
  const { cards, byId, soldOut } = feedRow(input.events, unread, input);
  const ids: number[] = [];
  const taken = new Set<number>();
  for (const pinned of [true, false]) {
    for (const card of cards) {
      if (card.pinned !== pinned || refKind(card.ref) !== "event") continue;
      const event = byId.get(Number(refId(card.ref)));
      if (!event || soldOut(event) || taken.has(event.id)) continue;
      taken.add(event.id);
      ids.push(event.id);
    }
  }
  return ids;
}

export type PagedFeedInput = FeedRowInput & {
  /** Every listed event, light columns, in the order the database gave them (by date). */
  order: FeedOrderRow[];
  max?: number;
};

/**
 * The list from rows read in part: `read` holds the full rows read so far by id (null = asked
 * for but no longer there). An event of `order` not in `read` holds its place as if on sale, and
 * the walk stops before it (`complete: false`). With every event read it is buildEventsFeed.
 */
export function planEventsFeed(input: PagedFeedInput & { read: ReadonlyMap<number, FeedEventRow | null> }): EventsFeedPlan {
  const rows: FeedOrderRow[] = [];
  const unread = new Set<number>();
  for (const e of input.order) {
    if (!input.read.has(e.id)) {
      rows.push(e);
      unread.add(e.id);
      continue;
    }
    const full = input.read.get(e.id);
    if (full) rows.push(full);
  }
  return walkFeed(rows, unread, input);
}

/**
 * The list, reading tickets and prices only where it needs them: the candidates
 * (feedCandidateIds) are read in full a page at a time, in order, until the list is final - so
 * it comes out exactly as buildEventsFeed would from every row, usually after one page.
 * `readFull` returns the full rows of the ids it is given (missing = gone).
 */
export async function buildEventsFeedInPages(
  input: PagedFeedInput,
  readFull: (ids: number[]) => Promise<FeedEventRow[]>,
  pageSize = EVENTS_FEED_PAGE,
): Promise<EventsFeedPlan & { pages: number; read: number; rows: ReadonlyMap<number, FeedEventRow | null> }> {
  const candidates = feedCandidateIds({ ...input, events: input.order });
  const read = new Map<number, FeedEventRow | null>();
  let next = 0;
  let pages = 0;
  for (;;) {
    const plan = planEventsFeed({ ...input, read });
    if (plan.complete || next >= candidates.length) return { ...plan, pages, read: read.size, rows: read };
    const ids = candidates.slice(next, next + Math.max(1, Math.floor(pageSize)));
    next += ids.length;
    pages += 1;
    for (const id of ids) read.set(id, null);
    for (const row of await readFull(ids)) if (read.has(row.id)) read.set(row.id, row);
  }
}

export type EventsIndexInput = {
  /** Every listed event, light columns (the cron's first read). */
  events: FeedLightRow[];
  now: Date;
  /** The site's card flags (its own sold-out test), when its row was read: no card or sold out = left out. */
  flags?: ReadonlyMap<RowRef, ShowFlags> | null;
  /** The rows the list read in full (null = gone since the first read): a sold-out one is left out. */
  read?: ReadonlyMap<number, FeedEventRow | null>;
  /** The list's items: their price is copied onto their events - the index never prices anything. */
  priced?: readonly EventsFeedItem[];
  max?: number;
};

/** The picture feedItemOf would take (photo, else cut-out art), only when it is https - a site never loads http. */
const indexImage = (e: Pick<FeedEventRow, "card_image_url" | "art_image_url">): string | null => {
  const url = absoluteUrl(e.card_image_url) ?? absoluteUrl(e.art_image_url);
  return url && /^https:\/\//i.test(url) ? url : null;
};

/**
 * The search index: every event a Mega Events listing may show (isListedFeedEvent) that is not
 * sold out as far as the cron knows - the "Sold" tag of the light row, the site's card flags when
 * the site was read (the feed's showable test), the tickets of the rows the list read in full -
 * soonest first, at most `max`. Light fields only; no ticket is read and nothing is priced for it.
 */
export function buildEventsIndex(input: EventsIndexInput): EventsIndexItem[] {
  const cutoff = feedCutoffDate(input.now);
  const hot = new Map((input.priced ?? []).map((item) => [item.id, item]));
  const seen = new Set<number>();
  const out: EventsIndexItem[] = [];
  for (const e of input.events) {
    if (seen.has(e.id) || !isListedFeedEvent(e, cutoff) || e.tags === "Sold") continue;
    const ref = toRef("event", e.id);
    if (input.flags && !defaultShowable(input.flags.get(ref), HOT_ROW_KEY, ref)) continue;
    if (input.read?.has(e.id)) {
      const full = input.read.get(e.id);
      if (!full || isFeedEventSoldOut(full)) continue;
    }
    const name = (e.name ?? "").trim();
    const dateLabel = feedDateLabel(e.date);
    if (!name || !dateLabel) continue;
    seen.add(e.id);
    const lodging = e.location ? { location: e.location, event_location: e.event_location ?? null } : null;
    const priced = hot.get(e.id);
    out.push({
      id: e.id,
      name,
      date: e.date,
      dateLabel,
      place: placeLabel(lodging),
      category: feedCategory(e),
      href: eventSiteUrl(e.id),
      image: indexImage(e),
      ...(priced
        ? { price: priced.price, currency: priced.currency, priceLabel: priced.priceLabel, priceNote: priced.priceNote }
        : {}),
    });
  }
  out.sort((a, b) => time(a.date) - time(b.date) || a.id - b.id);
  return out.slice(0, Math.max(0, Math.floor(input.max ?? EVENTS_INDEX_MAX)));
}

/** JSON with every object's keys sorted - jsonb hands keys back in its own order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Whether two lists say the same thing (the stamp and the source are not part of it). */
export function sameFeedItems(a: unknown, b: unknown): boolean {
  return stableJson(a ?? []) === stableJson(b ?? []);
}

/** The items of a stored document, or null when there is none worth comparing with. */
export function storedFeedItems(data: unknown): unknown[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items) ? items : null;
}

/** The index of a stored document, or null (a document written before 15.10.2026 has none). */
export function storedFeedIndex(data: unknown): unknown[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const index = (data as { index?: unknown }).index;
  return Array.isArray(index) ? index : null;
}

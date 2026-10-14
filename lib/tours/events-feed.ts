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
 * <schema>.site_content at build time. Pure: no DB, no network.
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
/** The Mega Events homepage row the list follows. */
export const HOT_ROW_KEY = "most_wanted";
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

/** The stored document (tours.site_content.data). */
export type EventsFeedDoc = {
  /** When the list last changed. */
  updatedAt: string;
  /** Where the order came from: the site's own row, or rebuilt from the database. */
  source: "site" | "database";
  items: EventsFeedItem[];
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
};

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
};

/** "YYYY-MM-DD" from which an event lists - myt-main futureDateISO(AVAILABILITY_WINDOW_DAYS). */
export function feedCutoffDate(now: Date): string {
  return new Date(now.getTime() + AVAILABILITY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/**
 * May the event appear on a Mega Events listing: not deleted, at least the window ahead, not a QA
 * event, not taken off the site (myt-main lib/eventsData.ts getEvents + isListedEvent).
 */
export function isListedFeedEvent(e: FeedEventRow, cutoff: string): boolean {
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
const byTagThenDate = (a: FeedEventRow, b: FeedEventRow) => {
  if (a.tags && !b.tags) return -1;
  if (!a.tags && b.tags) return 1;
  return time(a.date) - time(b.date);
};

/**
 * The pool of "המבוקשים ביותר" rebuilt from the rows, for when the site cannot be read: the
 * Prioritized events, then the fill - not Prioritized, not VIP, not a fixed sports_event - each
 * part tags first, then soonest (myt-main lib/homepage/rows.ts buildPools). The site also keeps
 * one card per artist / team page in the fill; that needs the people tables and is left out here.
 */
export function fallbackPool(listed: FeedEventRow[]): RowRef[] {
  const live = listed.filter((e) => !isFeedEventSoldOut(e));
  const prioritized = live.filter((e) => e.is_prioritized === true).sort(byTagThenDate);
  const fill = live
    .filter((e) => e.is_prioritized === false && e.tags !== "VIPevent" && e.type !== "sports_event")
    .sort(byTagThenDate);
  return [...prioritized, ...fill].map((e) => toRef("event", e.id));
}

const SPORTS_TYPES = new Set(["sports_event", "sports_event_dynamic", "sports_live_event_dynamic"]);
const MUSIC_TYPES = new Set(["music_event", "music_live_event_dynamic"]);

/** sports / music by event type; a TixStock event is music unless it is the World Cup (myt-main rows.ts isMusic). */
export function feedCategory(e: Pick<FeedEventRow, "type" | "name">): EventsFeedCategory {
  const type = e.type ?? "";
  if (SPORTS_TYPES.has(type)) return "sports";
  if (MUSIC_TYPES.has(type)) return "music";
  if (type === "tx_event") return (e.name ?? "").startsWith("מונדיאל 2026") ? "sports" : "music";
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

/** homepage_items rows of the row → its pins (myt-main lib/homepageLayout.ts getHomepageLayout). */
export function hotRowPins(
  items: { section: string; kind: string; ref_id: string | number; position: number | null }[],
): RowPin[] {
  return items
    .filter((it) => it.section === HOT_ROW_KEY)
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

/**
 * The list: the row as the site merges it (pins in their places, then the pool), with no length
 * of its own, then every card that is not a listed event with a name, a picture and a price is
 * dropped, and the first `max` stay.
 */
export function buildEventsFeed(input: EventsFeedInput): EventsFeedItem[] {
  const cutoff = feedCutoffDate(input.now);
  const max = input.max ?? EVENTS_FEED_MAX;
  const listed = input.events.filter((e) => isListedFeedEvent(e, cutoff));
  const byId = new Map(listed.map((e) => [e.id, e]));

  let pool: RowRef[];
  let flags: ReadonlyMap<RowRef, ShowFlags>;
  if (input.site) {
    pool = input.site.pool;
    flags = input.site.flags;
  } else {
    pool = fallbackPool(listed);
    flags = new Map(listed.map((e) => [toRef("event", e.id), { soldOut: isFeedEventSoldOut(e) }]));
  }

  const row = mergeRow(pool, input.pins, {
    hidden: input.hidden ?? [],
    max: null,
    showable: (ref) => defaultShowable(flags.get(ref), HOT_ROW_KEY, ref),
    pinnable: (ref) => defaultPinnable(flags.get(ref), HOT_ROW_KEY, ref),
  });

  const items: EventsFeedItem[] = [];
  const seen = new Set<number>();
  for (const card of row.cards) {
    if (items.length >= max) break;
    if (refKind(card.ref) !== "event") continue;
    const event = byId.get(Number(refId(card.ref)));
    if (!event || seen.has(event.id) || isFeedEventSoldOut(event)) continue;
    const item = feedItemOf(event, { pinned: card.pinned });
    if (!item) continue;
    seen.add(event.id);
    items.push(item);
  }
  return items;
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

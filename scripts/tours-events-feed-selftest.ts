// scripts/tours-events-feed-selftest.ts - `npx tsx scripts/tours-events-feed-selftest.ts`
// Pure only: the Mega Events packages list of the tours company sites (lib/tours/events-feed.ts).
// No DB, no network.
//
// What it guards: the list follows "המבוקשים ביותר" of mega-events.co.il - staff pins in their
// places, then the Prioritized events, then the rest by date (or the site's own pool when it was
// read) - holds 12 at most, never lists an event the site does not (QA, taken off, deleted, inside
// the 3-day window, sold out) or one with no picture / name, prints the card's price, and links
// to the event's order page. And the cron's two-step read (14.10.2026 - reading every event's
// tickets at once timed it out): the order from the light columns, the tickets a page at a time
// for the events the list can reach, and the result exactly what every full row would give.
// And the search index (15.10.2026): every listed event that is not sold out, by date, capped,
// built from the light read alone, priced only where the list priced it.
import assert from "node:assert/strict";
import {
  EVENTS_FEED_MAX,
  EVENTS_FEED_PAGE,
  EVENTS_INDEX_MAX,
  FEED_LIGHT_COLUMNS,
  FEED_ORDER_COLUMNS,
  PRICE_LABEL,
  buildEventsFeed,
  buildEventsFeedInPages,
  buildEventsIndex,
  fallbackPool,
  feedCandidateIds,
  feedCategory,
  feedCutoffDate,
  feedDateLabel,
  feedItemOf,
  hotRowHidden,
  hotRowPins,
  isFeedEventSoldOut,
  isListedFeedEvent,
  planEventsFeed,
  sameFeedItems,
  storedFeedIndex,
  storedFeedItems,
  type FeedEventRow,
  type FeedLightRow,
  type SiteHotRow,
} from "../lib/tours/events-feed";
import type { RowPin, RowRef, ShowFlags } from "../lib/homepage/merge";
import { siteCardPrice } from "../lib/package-price";
import { PUBLIC_SITE_URL } from "../lib/site";
import type { EventTicket } from "../types/app.types";

const NOW = new Date("2026-10-14T09:00:00Z");
const ticket = (price: number, available = true) => ({ price, available }) as unknown as EventTicket;
const london = { name: "לונדון, בריטניה", latitude: 51.5, longitude: -0.12, city_iata: "LON", country_code: "GB" };
const manchester = { name: "מנצ'סטר, בריטניה", latitude: 53.48, longitude: -2.24, country_code: "GB" };

let nextId = 100;
const ev = (over: Partial<FeedEventRow> = {}): FeedEventRow => ({
  id: nextId++,
  name: "אירוע",
  type: "music_event",
  date: "2026-11-20T19:00:00+00:00",
  location: london,
  event_location: null,
  card_image_url: "https://cdn.example/card.jpg",
  art_image_url: null,
  tags: null,
  is_prioritized: false,
  is_test: false,
  deactivated_reason: null,
  is_deleted: null,
  tickets_and_rates: [ticket(300), ticket(200)],
  base_flight_price: 400,
  base_hotel_price: 250,
  event_additional_markup: null,
  markup_ticket: null,
  markup_flight: null,
  markup_hotel: null,
  package_mode: "package",
  ticket_only_markup: null,
  ready_package_token: null,
  ready_package_mode: null,
  ready_package_price_usd: null,
  ...over,
});
const ids = (items: { id: number }[]) => items.map((i) => i.id);
/** What the cron's first read returns of an event: the order columns + what the index prints, no tickets. */
const light = (e: FeedEventRow): FeedLightRow =>
  Object.fromEntries(FEED_LIGHT_COLUMNS.map((k) => [k, e[k]])) as FeedLightRow;
assert.ok(FEED_ORDER_COLUMNS.every((k) => (FEED_LIGHT_COLUMNS as readonly string[]).includes(k)));
assert.ok(!(FEED_LIGHT_COLUMNS as readonly string[]).includes("tickets_and_rates"), "the first read never takes tickets");

/* the 3-day window: an event lists from today + 3 (myt-main AVAILABILITY_WINDOW_DAYS) */
assert.equal(feedCutoffDate(NOW), "2026-10-17");
assert.equal(isListedFeedEvent(ev({ date: "2026-10-17T00:00:00+00:00" }), "2026-10-17"), true);
assert.equal(isListedFeedEvent(ev({ date: "2026-10-16T21:00:00+00:00" }), "2026-10-17"), false, "inside the window");
assert.equal(isListedFeedEvent(ev({ is_test: true }), "2026-10-17"), false, "QA event");
assert.equal(isListedFeedEvent(ev({ deactivated_reason: "tx_sold_out" }), "2026-10-17"), false, "taken off the site");
assert.equal(isListedFeedEvent(ev({ is_deleted: "10-01-2026" }), "2026-10-17"), false, "soft-deleted");

/* ordering without the site: pins in their places > Prioritized (tagged first, then soonest) > the rest by date */
nextId = 1;
const late = ev({ date: "2026-12-30T19:00:00+00:00" }); // 1
const early = ev({ date: "2026-10-25T19:00:00+00:00" }); // 2
const prioLate = ev({ is_prioritized: true, date: "2026-12-01T19:00:00+00:00" }); // 3
const prioEarly = ev({ is_prioritized: true, date: "2026-11-01T19:00:00+00:00" }); // 4
const prioTagged = ev({ is_prioritized: true, tags: "HOT", date: "2026-12-20T19:00:00+00:00" }); // 5
const pinnedFar = ev({ date: "2027-03-01T19:00:00+00:00" }); // 6
const vip = ev({ tags: "VIPevent" }); // 7 - VIP fills nothing (myt-main rows.ts)
const fixedSports = ev({ type: "sports_event" }); // 8 - a fixed sports_event is not in the fill
const nullPrio = ev({ is_prioritized: null }); // 9 - the fill takes is_prioritized === false only
const events = [late, early, prioLate, prioEarly, prioTagged, pinnedFar, vip, fixedSports, nullPrio];
assert.deepEqual(fallbackPool(events, isFeedEventSoldOut), ["event:5", "event:4", "event:3", "event:2", "event:1", "event:6"]);

const pins = hotRowPins([
  { section: "most_wanted", kind: "event", ref_id: "6", position: 1 },
  { section: "newest", kind: "event", ref_id: "1", position: 0 }, // another row's pin
]);
assert.deepEqual(pins, [{ ref: "event:6", slot: 1 }]);
const ordered = buildEventsFeed({ events, pins, now: NOW });
assert.deepEqual(ids(ordered), [5, 6, 4, 3, 2, 1], "the pin holds place 2, the pool fills the rest");
assert.equal(ordered[1].pinned, true);
assert.equal(ordered[0].pinned, false);
assert.equal(ordered[0].prioritized, true);

/* hidden cards leave the row; a pin beats hidden */
assert.deepEqual(hotRowHidden({ hidden: ["event:4", "junk", 5], hidden_event_ids: [3, "x"] }), ["event:4", "event:3"]);
assert.deepEqual(hotRowHidden(null), []);
assert.deepEqual(ids(buildEventsFeed({ events, pins, hidden: ["event:4", "event:6"], now: NOW })), [5, 6, 3, 2, 1]);

/* the site's own pool wins over the rebuilt one, and its flags decide what can be shown */
const site = {
  pool: ["event:1", "event:2", "event:9", "event:3"],
  flags: new Map([
    ["event:1", { soldOut: false }],
    ["event:2", { soldOut: true }], // the site knows it is sold out (a locked flight, own stock)
    ["event:9", { soldOut: false }],
    ["event:3", { soldOut: false }],
    ["event:6", { soldOut: false }],
  ]),
};
assert.deepEqual(ids(buildEventsFeed({ events, pins, site, now: NOW })), [1, 6, 9, 3]);
// a pin the site has no card for (off its catalog) is dead and the pins after it close up
const deadPin = hotRowPins([
  { section: "most_wanted", kind: "event", ref_id: "999", position: 0 },
  { section: "most_wanted", kind: "event", ref_id: "6", position: 2 },
]);
assert.deepEqual(ids(buildEventsFeed({ events, pins: deadPin, site, now: NOW })), [1, 6, 9, 3]);

/* the light pass: candidates from the order columns alone, the pinned ones first */
const lightEvents = events.map(light);
assert.ok(lightEvents.every((e) => !("tickets_and_rates" in e)), "the first read carries no tickets");
assert.deepEqual(feedCandidateIds({ events: lightEvents, pins, now: NOW }), [6, 5, 4, 3, 2, 1]);
assert.deepEqual(feedCandidateIds({ events: lightEvents, pins, site, now: NOW }), [6, 1, 9, 3], "the site's row, its sold-out cards out");
{
  // no tickets read must not mean "sold out" (isFeedEventSoldOut would empty the pool) - only the Sold tag is known
  nextId = 300;
  const byTickets = ev({ is_prioritized: true, tickets_and_rates: [ticket(100, false)] }); // 300
  const byTag = ev({ is_prioritized: true, tags: "Sold" }); // 301
  const onSale = ev({ is_prioritized: true, date: "2026-12-01T19:00:00+00:00" }); // 302
  const row = [byTickets, byTag, onSale];
  assert.deepEqual(feedCandidateIds({ events: row.map(light), pins: [], now: NOW }), [300, 302]);
  // nothing read yet: the walk waits at the first candidate
  const order = row.map(light);
  assert.deepEqual(planEventsFeed({ order, read: new Map(), pins: [], now: NOW }), { items: [], complete: false });
  // the first read in full turns out sold out and drops; the next one waits
  const first = planEventsFeed({ order, read: new Map([[300, byTickets]]), pins: [], now: NOW });
  assert.deepEqual(first, { items: [], complete: false });
  const all = planEventsFeed({ order, read: new Map([[300, byTickets], [302, onSale]]), pins: [], now: NOW });
  assert.equal(all.complete, true);
  assert.deepEqual(ids(all.items), [302]);
  // asked for but gone (deleted between the two reads) = not listed
  const gone = planEventsFeed({ order, read: new Map([[300, byTickets], [302, null]]), pins: [], now: NOW });
  assert.deepEqual(gone, { items: [], complete: true });
  // a pinned event not read yet keeps the list open, even when the walk is full before it
  const farPin = hotRowPins([{ section: "most_wanted", kind: "event", ref_id: "302", position: 5 }]);
  const pinUnread = planEventsFeed({ order, read: new Map([[300, byTickets]]), pins: farPin, now: NOW, max: 0 });
  assert.equal(pinUnread.complete, false);
}

/* sold out, skipped and capped */
nextId = 200;
const soldOut = ev({ is_prioritized: true, tickets_and_rates: [ticket(100, false)] });
const soldTag = ev({ is_prioritized: true, tags: "Sold" });
const noImage = ev({ is_prioritized: true, card_image_url: null, art_image_url: "" });
const noName = ev({ is_prioritized: true, name: "  " });
const tooSoon = ev({ is_prioritized: true, date: "2026-10-15T19:00:00+00:00" });
const qa = ev({ is_prioritized: true, is_test: true });
const many = Array.from({ length: 20 }, (_, i) =>
  ev({ date: `2026-11-${String(i + 1).padStart(2, "0")}T19:00:00+00:00` }),
);
const capped = buildEventsFeed({ events: [soldOut, soldTag, noImage, noName, tooSoon, qa, ...many], pins: [], now: NOW });
assert.equal(capped.length, EVENTS_FEED_MAX);
assert.deepEqual(ids(capped), ids(many.slice(0, 12)), "skipped events never take a place");
// a pinned imageless event does not hold its place either
const pinnedNoImage = hotRowPins([{ section: "most_wanted", kind: "event", ref_id: String(noImage.id), position: 0 }]);
assert.equal(buildEventsFeed({ events: [noImage, ...many], pins: pinnedNoImage, now: NOW })[0].id, many[0].id);
assert.equal(buildEventsFeed({ events: many, pins: [], now: NOW, max: 3 }).length, 3);

/* one item: the card's price, date, place, picture and link */
nextId = 500;
const one = feedItemOf(ev({ name: " אואזיס " }), { pinned: false });
assert.ok(one);
assert.equal(one.name, "אואזיס");
assert.equal(one.price, siteCardPrice(ev()), "the price is siteCardPrice - never a copy of the rule");
assert.equal(one.price, 400 + 250 + 200 + 175, "bases + the cheapest available ticket + the package markup");
assert.equal(one.currency, "USD");
assert.equal(one.priceLabel, PRICE_LABEL);
assert.equal(one.priceNote, "לנוסע · כולל טיסה, מלון וכרטיס");
assert.equal(one.dateLabel, "20/11/26");
assert.equal(one.place, "לונדון, בריטניה");
assert.equal(one.city, "לונדון");
assert.equal(one.country, "בריטניה");
assert.equal(one.countryCode, "GB");
assert.equal(one.image, "https://cdn.example/card.jpg");
assert.equal(one.imageIsCutout, false);
assert.equal(one.category, "music");
assert.equal(one.href, `${PUBLIC_SITE_URL}/order/${one.id}`);
assert.ok(one.href.startsWith("https://"), one.href);

const ticketOnly = feedItemOf(ev({ package_mode: "ticket_only", ticket_only_markup: 60 }), { pinned: true });
assert.ok(ticketOnly);
assert.equal(ticketOnly.price, 260, "ticket-only: the cheapest ticket + its own markup");
assert.equal(ticketOnly.ticketOnly, true);
assert.equal(ticketOnly.priceNote, "לכרטיס · כרטיס בלבד");
assert.equal(ticketOnly.pinned, true);

const twoCities = feedItemOf(ev({ event_location: manchester, type: "sports_event_dynamic" }), { pinned: false });
assert.ok(twoCities);
assert.equal(twoCities.place, "מנצ'סטר · טיסה ללונדון", "the show's city and the flight city, as the card prints");
assert.equal(twoCities.city, "מנצ'סטר");
assert.equal(twoCities.category, "sports");

const cutout = feedItemOf(ev({ card_image_url: null, art_image_url: "//cdn.example/art.png" }), { pinned: false });
assert.ok(cutout);
assert.equal(cutout.image, "https://cdn.example/art.png");
assert.equal(cutout.imageIsCutout, true);
assert.equal(feedItemOf(ev({ card_image_url: "card.jpg" }), { pinned: false }), null, "not a URL = no picture");
assert.equal(feedItemOf(ev({ tickets_and_rates: [] }), { pinned: false }), null, "no price = no card");

assert.equal(feedDateLabel("2027-01-05T23:30:00+00:00"), "05/01/27", "the stored day, not the day in Israel");
assert.equal(feedDateLabel("not a date"), null);
assert.equal(feedCategory({ type: "tx_event", name: "מונדיאל 2026: ארגנטינה" }), "sports");
assert.equal(feedCategory({ type: "tx_event", name: "קולדפליי" }), "music");
// a TixStock fixture is sport (16.10: every match of the hot row came out "music")
assert.equal(feedCategory({ type: "tx_event", name: "ווסטהאם יונייטד - סאוטהמפטון" }), "sports");
assert.equal(feedCategory({ type: "tx_event", name: "ליגת האלופות: א.א.ק אתונה - א.ס רומא" }), "sports");
assert.equal(feedCategory({ type: "tx_event", name: "Real Madrid vs Barcelona" }), "sports");
assert.equal(feedCategory({ type: "tx_event", name: "ג'יי-זי" }), "music");
assert.equal(feedCategory({ type: "tx_event", name: "קולדפליי: מיוזיק אוף דה ספירס" }), "music");
assert.equal(feedCategory({ type: "something_new", name: "x" }), "other");

/* change detection: jsonb hands the keys back in its own order; the stamp is not part of the list */
assert.equal(sameFeedItems([{ a: 1, b: [1, 2] }], [{ b: [1, 2], a: 1 }]), true);
assert.equal(sameFeedItems([{ a: 1 }], [{ a: 2 }]), false);
assert.equal(sameFeedItems(capped, JSON.parse(JSON.stringify(capped))), true);
assert.deepEqual(storedFeedItems({ updatedAt: "x", items: [1] }), [1]);
assert.equal(storedFeedItems(null), null);
assert.equal(storedFeedItems({ items: "no" }), null);
assert.deepEqual(storedFeedIndex({ items: [], index: [{ id: 1 }] }), [{ id: 1 }]);
assert.equal(storedFeedIndex({ items: [] }), null, "a document from before 15.10 has no index");
assert.equal(storedFeedIndex([1]), null);
// a stored document without an index differs from any index with an event in it (the first run writes it)
assert.equal(sameFeedItems(storedFeedIndex({ items: [] }), [{ id: 1 }]), false);
assert.equal(sameFeedItems(storedFeedIndex({ items: [] }), []), true);

/* the search index: every listed event, light fields only, by date */
{
  nextId = 700;
  const celine1 = ev({ name: "סלין דיון בפריז", date: "2027-05-10T19:00:00+00:00" }); // 700
  const celine2 = ev({ name: " סלין דיון בלונדון ", date: "2026-12-01T19:00:00+00:00", event_location: manchester }); // 701
  const celine3 = ev({ name: "סלין דיון בלאס וגאס", date: "2027-01-15T19:00:00+00:00", card_image_url: null }); // 702
  const ticketsGone = ev({ name: "סלין דיון - אזל", tickets_and_rates: [ticket(100, false)] }); // 703 - the light read cannot see it
  const tagged = ev({ name: "סלין דיון - Sold", tags: "Sold" }); // 704
  const soon = ev({ name: "סלין דיון מחר", date: "2026-10-15T19:00:00+00:00" }); // 705 - inside the 3-day window
  const qaEvent = ev({ name: "סלין QA", is_test: true }); // 706
  const offSite = ev({ name: "סלין off", deactivated_reason: "tx_sold_out" }); // 707
  const deleted = ev({ name: "סלין deleted", is_deleted: "10-01-2026" }); // 708
  const nameless = ev({ name: "   " }); // 709
  const httpOnly = ev({ name: "http", card_image_url: "http://cdn.example/card.jpg" }); // 710
  const cutoutArt = ev({ name: "cutout", card_image_url: null, art_image_url: "//cdn.example/art.png" }); // 711
  const relative = ev({ name: "relative", card_image_url: "/images/x.jpg", type: "tx_event" }); // 712
  const all = [celine1, celine2, celine3, ticketsGone, tagged, soon, qaEvent, offSite, deleted, nameless, httpOnly, cutoutArt, relative];
  const lightAll = all.map(light);

  const index = buildEventsIndex({ events: lightAll, now: NOW });
  // the light read knows the Sold tag only; 703 stays until its tickets are read (the list reads the hot ones)
  assert.deepEqual(ids(index), [703, 710, 711, 712, 701, 702, 700], "listed, by date then id, the dead ones out");
  assert.deepEqual(
    index.filter((i) => i.name.includes("סלין")).map((i) => i.id),
    [703, 701, 702, 700],
    'typing "סלין" finds every listed Celine Dion show',
  );
  const inLondon = index.find((i) => i.id === 701);
  assert.deepEqual(
    inLondon,
    {
      id: 701,
      name: "סלין דיון בלונדון",
      date: "2026-12-01T19:00:00+00:00",
      dateLabel: "01/12/26",
      place: "מנצ'סטר · טיסה ללונדון",
      category: "music",
      href: `${PUBLIC_SITE_URL}/order/701`,
      image: "https://cdn.example/card.jpg",
    },
    "the exact shape - no price on an event the list did not price",
  );
  assert.equal(index.find((i) => i.id === 702)?.image, null, "no picture still lists (the search finds it)");
  assert.equal(index.find((i) => i.id === 710)?.image, null, "an http picture is dropped, the event stays");
  assert.equal(index.find((i) => i.id === 711)?.image, "https://cdn.example/art.png", "the cut-out when there is no photo");
  assert.equal(index.find((i) => i.id === 712)?.image, `${PUBLIC_SITE_URL}/images/x.jpg`);
  assert.equal(index.find((i) => i.id === 712)?.category, "music", "a TixStock event is music");

  // tickets read in full (the list's candidates): a sold-out one leaves, a gone one leaves, an unread one stays
  const read = new Map<number, FeedEventRow | null>([
    [703, ticketsGone],
    [700, celine1],
    [702, null],
  ]);
  assert.deepEqual(ids(buildEventsIndex({ events: lightAll, now: NOW, read })), [710, 711, 712, 701, 700]);

  // the site's card flags (its own sold-out test) when its row was read: no card = not on the site
  const flags = new Map<RowRef, ShowFlags>([
    ["event:700", { soldOut: false }],
    ["event:701", { soldOut: true }],
    ["event:703", { soldOut: false }],
    ["event:704", { soldOut: false }], // the Sold tag still wins
  ]);
  assert.deepEqual(ids(buildEventsIndex({ events: lightAll, now: NOW, flags })), [703, 700]);

  // the price only where the list priced it, copied from its item - the index never prices anything
  const item = feedItemOf(celine1, { pinned: false });
  assert.ok(item);
  const priced = buildEventsIndex({ events: lightAll, now: NOW, priced: [item] });
  const hot = priced.find((i) => i.id === 700);
  assert.ok(hot);
  assert.equal(hot.price, item.price);
  assert.equal(hot.currency, "USD");
  assert.equal(hot.priceLabel, PRICE_LABEL);
  assert.equal(hot.priceNote, item.priceNote);
  assert.ok(priced.filter((i) => i.id !== 700).every((i) => !("price" in i) && !("priceLabel" in i)));

  // capped at EVENTS_INDEX_MAX, the soonest; a repeated row counts once
  nextId = 5000;
  const lots = Array.from({ length: EVENTS_INDEX_MAX + 50 }, (_, i) =>
    ev({ date: new Date(Date.parse("2027-06-01T19:00:00Z") - i * 3_600_000).toISOString() }),
  );
  const capped = buildEventsIndex({ events: [...lots, lots[0]].map(light), now: NOW });
  assert.equal(capped.length, EVENTS_INDEX_MAX);
  assert.deepEqual(ids(capped), ids(lots.slice(50).reverse()), "the 400 soonest, by date");
  assert.equal(buildEventsIndex({ events: lots.map(light), now: NOW, max: 3 }).length, 3);
  assert.deepEqual(buildEventsIndex({ events: [], now: NOW }), []);
  // 400 events stay a small document (the site copies it at every build)
  assert.ok(JSON.stringify(capped).length < 200_000, `${JSON.stringify(capped).length} bytes`);
}

/* the cron's paged read: tickets only where the list needs them, the same list as from every row */

/** A reader over `full` that records what it was asked for, the way the cron's page read is called. */
function fakeReader(full: FeedEventRow[], drop: ReadonlySet<number> = new Set()) {
  const byId = new Map(full.map((e) => [e.id, e]));
  const calls: number[][] = [];
  const read = async (ids: number[]) => {
    calls.push(ids);
    return ids.flatMap((id) => (byId.has(id) && !drop.has(id) ? [byId.get(id)!] : []));
  };
  return { read, calls };
}

/** Deterministic random numbers (mulberry32), so a failing case can be replayed. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function testPagedRead(): Promise<void> {
  // a catalog where nothing drops: one page of EVENTS_FEED_PAGE, not the whole catalog
  nextId = 10_000;
  const catalog = Array.from({ length: 2000 }, (_, i) =>
    ev({ date: new Date(Date.parse("2026-10-20T19:00:00Z") + i * 3_600_000).toISOString() }),
  );
  const easy = fakeReader(catalog);
  const easyPlan = await buildEventsFeedInPages({ order: catalog.map(light), pins: [], now: NOW }, easy.read);
  assert.deepEqual(easyPlan.items, buildEventsFeed({ events: catalog, pins: [], now: NOW }));
  assert.equal(easyPlan.complete, true);
  assert.equal(easy.calls.length, 1, "one page");
  assert.equal(easy.calls[0].length, EVENTS_FEED_PAGE);

  // the first 60 sold out (the light read cannot see it): a second page, the same list
  const soldFirst = catalog.map((e, i) => (i < 60 ? { ...e, tickets_and_rates: [ticket(100, false)] } : e));
  const hard = fakeReader(soldFirst);
  const hardPlan = await buildEventsFeedInPages({ order: soldFirst.map(light), pins: [], now: NOW }, hard.read);
  assert.deepEqual(hardPlan.items, buildEventsFeed({ events: soldFirst, pins: [], now: NOW }));
  assert.deepEqual(ids(hardPlan.items), ids(catalog.slice(60, 60 + EVENTS_FEED_MAX)));
  assert.equal(hard.calls.length, 2);

  // a pin far down the row is read in the first page, before the pool
  const farPin = hotRowPins([{ section: "most_wanted", kind: "event", ref_id: String(catalog[1500].id), position: 3 }]);
  const pinned = fakeReader(catalog);
  const pinnedPlan = await buildEventsFeedInPages({ order: catalog.map(light), pins: farPin, now: NOW }, pinned.read);
  assert.equal(pinned.calls[0][0], catalog[1500].id);
  assert.equal(pinnedPlan.items[3].id, catalog[1500].id);
  assert.equal(pinnedPlan.items[3].pinned, true);

  // nothing to list: no read at all
  const none = fakeReader([]);
  const nonePlan = await buildEventsFeedInPages({ order: [], pins: [], now: NOW }, none.read);
  assert.deepEqual(nonePlan, { items: [], complete: true, pages: 0, read: 0, rows: new Map() });
  assert.equal(none.calls.length, 0);

  // random catalogs, with and without the site's row, every page size: always the full-row list
  const rand = random(20261014);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  for (let trial = 0; trial < 300; trial++) {
    nextId = 1;
    const rows = Array.from({ length: 10 + Math.floor(rand() * 70) }, () => {
      const r = rand();
      return ev({
        // few distinct days, so ties of the date order are common
        date: `2026-${pick(["10-16", "10-20", "11-02", "11-20", "12-24"])}T19:00:00+00:00`,
        type: pick(["music_event", "sports_event", "sports_event_dynamic", "tx_event"]),
        is_prioritized: r < 0.3 ? true : r < 0.9 ? false : null,
        tags: pick([null, null, null, null, "HOT", "Sold", "VIPevent"]),
        is_test: rand() < 0.05,
        deactivated_reason: rand() < 0.05 ? "tx_sold_out" : null,
        is_deleted: rand() < 0.03 ? "10-01-2026" : null,
        card_image_url: rand() < 0.1 ? null : "https://cdn.example/card.jpg",
        tickets_and_rates: pick([[ticket(100, false)], [], [ticket(120), ticket(90)], [ticket(300)], [ticket(80)]]),
      });
    });
    const refOf = () => (rand() < 0.1 ? "event:99999" : `event:${pick(rows).id}`);
    const pins: RowPin[] = hotRowPins(
      Array.from({ length: Math.floor(rand() * 6) }, () => ({
        section: "most_wanted",
        kind: "event",
        ref_id: refOf().slice("event:".length),
        position: Math.floor(rand() * 8), // small slots: several pins on one place happen
      })),
    );
    const hidden: RowRef[] = Array.from({ length: Math.floor(rand() * 4) }, refOf);
    let site: SiteHotRow | null = null;
    if (rand() < 0.5) {
      const pool = rows.filter(() => rand() < 0.7).map((e) => `event:${e.id}`).sort(() => rand() - 0.5);
      const flags = new Map<RowRef, ShowFlags>();
      for (const ref of [...pool, ...pins.map((p) => p.ref)]) if (rand() < 0.95) flags.set(ref, { soldOut: rand() < 0.2 });
      site = { pool: [...pool, "event:99998"], flags };
    }
    const max = pick([EVENTS_FEED_MAX, 3, 1]);
    const expected = buildEventsFeed({ events: rows, pins, hidden, site, now: NOW, max });
    for (const pageSize of [1, 2, 5, EVENTS_FEED_PAGE]) {
      const reader = fakeReader(rows);
      const plan = await buildEventsFeedInPages(
        { order: rows.map(light), pins, hidden, site, now: NOW, max },
        reader.read,
        pageSize,
      );
      const context = `trial ${trial}, page ${pageSize}`;
      assert.deepEqual(plan.items, expected, context);
      assert.equal(plan.complete, true, context);
      assert.ok(reader.calls.every((c) => c.length <= pageSize), context);
      const asked = reader.calls.flat();
      assert.equal(new Set(asked).size, asked.length, `${context}: an event read twice`);
    }
    // an event deleted between the two reads drops out, as if it was never listed
    const goneId = pick(rows).id;
    const goneReader = fakeReader(rows, new Set([goneId]));
    const gonePlan = await buildEventsFeedInPages(
      { order: rows.map(light), pins, hidden, site, now: NOW, max },
      goneReader.read,
    );
    const without = buildEventsFeed({ events: rows.filter((e) => e.id !== goneId), pins, hidden, site, now: NOW, max });
    assert.deepEqual(gonePlan.items, without, `trial ${trial}, gone ${goneId}`);

    // the index of the same run: no sold-out event among those whose tickets were read, every priced
    // event of the list in it with the list's own price, nothing else priced, by date
    const fullPlan = await buildEventsFeedInPages(
      { order: rows.map(light), pins, hidden, site, now: NOW, max },
      fakeReader(rows).read,
    );
    const index = buildEventsIndex({
      events: rows.map(light),
      now: NOW,
      flags: site?.flags ?? null,
      read: fullPlan.rows,
      priced: fullPlan.items,
    });
    const indexContext = `trial ${trial}, index`;
    assert.ok(
      index.every((i) => {
        const full = fullPlan.rows.get(i.id);
        return full === undefined || (full !== null && !isFeedEventSoldOut(full));
      }),
      indexContext,
    );
    for (const item of fullPlan.items) {
      assert.equal(index.find((i) => i.id === item.id)?.price, item.price, `${indexContext}: item ${item.id}`);
    }
    const pricedIds = new Set(fullPlan.items.map((i) => i.id));
    assert.ok(index.every((i) => (i.price === undefined) === !pricedIds.has(i.id)), indexContext);
    assert.ok(index.every((i, k) => k === 0 || Date.parse(index[k - 1].date) <= Date.parse(i.date)), indexContext);
  }
}

testPagedRead()
  .then(() => console.log("tours-events-feed selftest: all passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

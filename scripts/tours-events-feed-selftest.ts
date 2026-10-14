// scripts/tours-events-feed-selftest.ts - `npx tsx scripts/tours-events-feed-selftest.ts`
// Pure only: the Mega Events packages list of the tours company sites (lib/tours/events-feed.ts).
// No DB, no network.
//
// What it guards: the list follows "המבוקשים ביותר" of mega-events.co.il - staff pins in their
// places, then the Prioritized events, then the rest by date (or the site's own pool when it was
// read) - holds 12 at most, never lists an event the site does not (QA, taken off, deleted, inside
// the 3-day window, sold out) or one with no picture / name, prints the card's price, and links
// to the event's order page.
import assert from "node:assert/strict";
import {
  EVENTS_FEED_MAX,
  PRICE_LABEL,
  buildEventsFeed,
  fallbackPool,
  feedCategory,
  feedCutoffDate,
  feedDateLabel,
  feedItemOf,
  hotRowHidden,
  hotRowPins,
  isListedFeedEvent,
  sameFeedItems,
  storedFeedItems,
  type FeedEventRow,
} from "../lib/tours/events-feed";
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
assert.deepEqual(fallbackPool(events), ["event:5", "event:4", "event:3", "event:2", "event:1", "event:6"]);

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
assert.equal(feedCategory({ type: "something_new", name: "x" }), "other");

/* change detection: jsonb hands the keys back in its own order; the stamp is not part of the list */
assert.equal(sameFeedItems([{ a: 1, b: [1, 2] }], [{ b: [1, 2], a: 1 }]), true);
assert.equal(sameFeedItems([{ a: 1 }], [{ a: 2 }]), false);
assert.equal(sameFeedItems(capped, JSON.parse(JSON.stringify(capped))), true);
assert.deepEqual(storedFeedItems({ updatedAt: "x", items: [1] }), [1]);
assert.equal(storedFeedItems(null), null);
assert.equal(storedFeedItems({ items: "no" }), null);

console.log("tours-events-feed selftest: all passed");

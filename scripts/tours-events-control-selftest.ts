// scripts/tours-events-control-selftest.ts - `npx tsx scripts/tours-events-control-selftest.ts`
// Pure only: what a tours company shows of Mega Events' packages (lib/tours/events-control.ts, 19.10.2026)
// and the "החדשים" row the list may follow (lib/tours/events-feed.ts newestPool / row "newest").
// No DB, no network.
//
// What it guards: a company that never saved the screen keeps the list it had (most wanted, 12, search
// on); a broken document never empties a list; the picks come first in staff's order and are skipped
// when Mega Events no longer sells them; a hidden event never shows; nothing twice; never more than
// `max`; "only my pinned" shows the picks alone; "החדשים" is the latest uploads, VIP and sold out out.
import assert from "node:assert/strict";
import {
  DEFAULT_EVENTS_CONTROL,
  EVENTS_SHOWN_MAX,
  composeEventsFeed,
  eventsControlSchema,
  pickedFeedItems,
  readEventsControl,
  type EventsControl,
} from "../lib/tours/events-control";
import { buildEventsFeed, feedItemOf, isFeedEventSoldOut, newestPool, type EventsFeedItem, type FeedEventRow } from "../lib/tours/events-feed";
import type { RowRef, ShowFlags } from "../lib/homepage/merge";
import type { EventTicket } from "../types/app.types";

const NOW = new Date("2026-10-19T09:00:00Z");
const ticket = (price: number, available = true) => ({ price, available }) as unknown as EventTicket;
const london = { name: "לונדון, בריטניה", latitude: 51.5, longitude: -0.12, city_iata: "LON", country_code: "GB" };

let nextId = 1;
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
  created_at: "2026-09-01T10:00:00+00:00",
  tickets_and_rates: [ticket(300)],
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
const item = (e: FeedEventRow, pinned = false): EventsFeedItem => {
  const out = feedItemOf(e, { pinned });
  assert.ok(out, `event ${e.id} makes an item`);
  return out;
};
const control = (over: Partial<EventsControl> = {}): EventsControl => ({ ...DEFAULT_EVENTS_CONTROL, ...over });

/* the default: what every company had before the screen */
assert.deepEqual(readEventsControl(null), DEFAULT_EVENTS_CONTROL);
assert.deepEqual(DEFAULT_EVENTS_CONTROL, { auto: ["most_wanted"], picks: [], hidden: [], max: 12, search: true });

/* a broken document: each bad field takes its default, the good ones stay */
assert.deepEqual(readEventsControl({ auto: ["newest", "bogus", "most_wanted"], picks: [3, 3, -1, "x", 4], hidden: [4, 5], max: 99, search: "yes" }), {
  auto: ["newest", "most_wanted"],
  picks: [3, 4],
  hidden: [5], // a pin beats a hide
  max: EVENTS_SHOWN_MAX,
  search: true,
});
assert.deepEqual(readEventsControl({ auto: [] }).auto, [], "an empty list of rows is a choice (only my pinned)");
assert.equal(readEventsControl({ max: 0 }).max, 12);

/* the schema the screen and the save check */
assert.ok(eventsControlSchema.safeParse(control({ picks: [1, 2], hidden: [3], max: 6 })).success);
assert.ok(!eventsControlSchema.safeParse(control({ picks: [1], hidden: [1] })).success, "pinned and hidden");
assert.ok(!eventsControlSchema.safeParse(control({ picks: [1, 1] })).success, "pinned twice");
assert.ok(!eventsControlSchema.safeParse(control({ max: 0 })).success);
assert.ok(!eventsControlSchema.safeParse(control({ max: EVENTS_SHOWN_MAX + 1 })).success);
assert.ok(!eventsControlSchema.safeParse(control({ auto: ["most_wanted", "most_wanted"] })).success);

/* composing: picks first in staff's order, then the rows in the company's order, no repeats, no hidden, max */
nextId = 1;
const [a, b, c, d, e, f] = [ev(), ev(), ev(), ev(), ev(), ev()];
const hot = [item(a), item(b), item(c)];
const newest = [item(c), item(d), item(e)];
const picked = new Map([
  [f.id, item(f, true)],
  [b.id, item(b, true)],
]);
assert.deepEqual(
  ids(composeEventsFeed(control({ picks: [f.id, 999, b.id], hidden: [c.id], auto: ["most_wanted", "newest"] }), picked, { most_wanted: hot, newest })),
  [f.id, b.id, a.id, d.id, e.id],
  "a pick Mega Events no longer sells (999) gives its place to the next",
);
const composed = composeEventsFeed(control({ picks: [b.id] }), picked, { most_wanted: hot });
assert.deepEqual(ids(composed), [b.id, a.id, c.id]);
assert.equal(composed[0].pinned, true, "a pick holds its place");
assert.equal(composed[1].pinned, false);
assert.deepEqual(ids(composeEventsFeed(control({ max: 2 }), picked, { most_wanted: hot, newest })), [a.id, b.id], "at most max");
assert.deepEqual(ids(composeEventsFeed(control({ auto: ["newest"] }), picked, { most_wanted: hot, newest })), [c.id, d.id, e.id]);
assert.deepEqual(ids(composeEventsFeed(control({ auto: [], picks: [f.id] }), picked, { most_wanted: hot })), [f.id], "only my pinned");
assert.deepEqual(composeEventsFeed(control({ auto: [] }), picked, { most_wanted: hot }), [], "nothing pinned, nothing automatic");

/* the picks that can be sold */
nextId = 50;
const good = ev();
const past = ev({ date: "2026-10-20T19:00:00+00:00" }); // inside the 3-day window
const soldTickets = ev({ tickets_and_rates: [ticket(300, false)] });
const soldOnSite = ev();
const noPicture = ev({ card_image_url: null });
const flags = new Map<RowRef, ShowFlags>([[`event:${soldOnSite.id}`, { soldOut: true }]]);
const sellable = pickedFeedItems([good, past, soldTickets, soldOnSite, noPicture], NOW, flags);
assert.deepEqual([...sellable.keys()], [good.id]);
assert.equal(sellable.get(good.id)?.pinned, true);
assert.equal(pickedFeedItems([soldOnSite], NOW, null).size, 1, "without the site's flags only the row decides");

/* "החדשים": the latest upload first, VIP and sold out left out */
nextId = 80;
const old = ev({ created_at: "2026-08-01T00:00:00+00:00" });
const fresh = ev({ created_at: "2026-10-18T00:00:00+00:00" });
const mid = ev({ created_at: "2026-09-15T00:00:00+00:00" });
const vipNew = ev({ created_at: "2026-10-19T00:00:00+00:00", tags: "VIPevent" });
const soldNew = ev({ created_at: "2026-10-19T00:00:00+00:00", tickets_and_rates: [ticket(10, false)] });
const pool = [old, fresh, mid, vipNew, soldNew];
assert.deepEqual(newestPool(pool, isFeedEventSoldOut), [`event:${fresh.id}`, `event:${mid.id}`, `event:${old.id}`]);
assert.deepEqual(
  ids(buildEventsFeed({ events: pool, pins: [], site: null, now: NOW, row: "newest" })),
  [fresh.id, mid.id, old.id],
  "the row 'newest' follows newestPool when the site is not read",
);
assert.deepEqual(
  ids(buildEventsFeed({ events: pool, pins: [], hidden: [`event:${mid.id}`], site: null, now: NOW, row: "newest" })),
  [fresh.id, old.id],
  "a company's hidden event is out of the row",
);

console.log("tours-events-control selftest: all passed");

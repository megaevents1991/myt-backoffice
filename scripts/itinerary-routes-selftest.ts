// Run: npx tsx scripts/itinerary-routes-selftest.ts
// The Euro Trip staff-trips check (lib/itinerary/routes.ts): the form validator (title 2..80 once trimmed,
// 2..3 distinct positive integer event ids, whole sort order - the DB CHECKs of itinerary_routes) and the
// "will the site show it" status line (the site's own per-event rules), and what an events.id can be.
import assert from "node:assert/strict";
import {
  ROUTE_STATUS_SHOWN,
  isEventId,
  routeSiteStatus,
  validateItineraryRoute,
  type TripEventLite,
} from "../lib/itinerary/routes";

const good = { title: "דון טוליבר והקלאסיקר", eventIds: [11, 22], sortOrder: 0, isActive: true };

// --- validator: a good form ---------------------------------------------------------------------------
{
  const r = validateItineraryRoute(good);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.route, good, "a valid form comes back as it is (no id key when none was given)");

  const three = validateItineraryRoute({ ...good, eventIds: [3, 2, 1], sortOrder: -5, isActive: false });
  assert.equal(three.ok, true, "three events, a negative sort order and inactive are all valid");
  if (three.ok) assert.deepEqual(three.route.eventIds, [3, 2, 1], "staff order is kept (the site sorts by date)");

  const withId = validateItineraryRoute({ ...good, id: 7 });
  assert.equal(withId.ok, true);
  if (withId.ok) assert.equal(withId.route.id, 7, "an edit keeps its id");
}

// --- validator: the title is trimmed, and what comes back is the trimmed value -----------------------
{
  const r = validateItineraryRoute({ ...good, title: "  שלום וברכה  " });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.route.title, "שלום וברכה", "spaces are cut");

  // The DB CHECK is char_length(btrim(title)) - btrim cuts spaces only, JS trim also tabs / newlines. The
  // validator hands back the JS-trimmed title and the action writes THAT value, never the raw input.
  const wrapped = validateItineraryRoute({ ...good, title: "\t\nשלום וברכה\r\n\t" });
  assert.equal(wrapped.ok, true);
  if (wrapped.ok) assert.equal(wrapped.route.title, "שלום וברכה", "tabs / newlines around the title are cut too");

  // Length is counted in characters (Postgres char_length), not UTF-16 units: an emoji is one.
  const emoji = validateItineraryRoute({ ...good, title: "\u{1F3DF}\u{1F3DF}" });
  assert.equal(emoji.ok, true, "two emoji = two characters");
  const eighty = validateItineraryRoute({ ...good, title: "א".repeat(80) });
  assert.equal(eighty.ok, true, "80 characters is the top");
  const emoji80 = validateItineraryRoute({ ...good, title: "\u{1F3DF}".repeat(80) });
  assert.equal(emoji80.ok, true, "80 emoji are 80 characters (160 UTF-16 units)");
}

// --- validator: rejections, each blames only its field ------------------------------------------------
const bad = (patch: Record<string, unknown>, field: "title" | "eventIds" | "sortOrder", text: string, why: string) => {
  const r = validateItineraryRoute({ ...good, ...patch });
  assert.equal(r.ok, false, why);
  if (!r.ok) {
    assert.equal(r.errors[field], text, why);
    assert.deepEqual(Object.keys(r.errors), [field], `${why}: only that field is blamed`);
  }
};
const TITLE_ERR = "כותרת של 2-80 תווים";
const IDS_ERR = "בחרו 2 או 3 אירועים שונים";
const ORDER_ERR = "מספר שלם";

bad({ title: "א" }, "title", TITLE_ERR, "one character");
bad({ title: "" }, "title", TITLE_ERR, "empty");
bad({ title: "   " }, "title", TITLE_ERR, "only spaces");
bad({ title: "\t\n א \n\t" }, "title", TITLE_ERR, "one character wrapped in tabs / newlines");
bad({ title: "א".repeat(81) }, "title", TITLE_ERR, "81 characters");
bad({ title: 12 }, "title", TITLE_ERR, "not a string");
bad({ title: undefined }, "title", TITLE_ERR, "missing");

bad({ eventIds: [5] }, "eventIds", IDS_ERR, "one id");
bad({ eventIds: [] }, "eventIds", IDS_ERR, "no ids");
bad({ eventIds: [1, 2, 3, 4] }, "eventIds", IDS_ERR, "four ids");
bad({ eventIds: [4, 4] }, "eventIds", IDS_ERR, "duplicate ids");
bad({ eventIds: [4, 5, 4] }, "eventIds", IDS_ERR, "a duplicate among three");
bad({ eventIds: [-3, 5] }, "eventIds", IDS_ERR, "a negative id");
bad({ eventIds: [0, 5] }, "eventIds", IDS_ERR, "zero is not an id");
bad({ eventIds: [1.5, 5] }, "eventIds", IDS_ERR, "a fractional id");
bad({ eventIds: ["abc", 5] }, "eventIds", IDS_ERR, "a non-numeric id");
bad({ eventIds: [Number.NaN, 5] }, "eventIds", IDS_ERR, "NaN");
bad({ eventIds: [Number.POSITIVE_INFINITY, 5] }, "eventIds", IDS_ERR, "Infinity");
bad({ eventIds: "1,2" }, "eventIds", IDS_ERR, "not an array");
bad({ eventIds: undefined }, "eventIds", IDS_ERR, "missing");
bad({ eventIds: [Number.MAX_SAFE_INTEGER + 2, 5] }, "eventIds", IDS_ERR, "beyond the safe integers");

bad({ sortOrder: 1.5 }, "sortOrder", ORDER_ERR, "a fraction");
bad({ sortOrder: "abc" }, "sortOrder", ORDER_ERR, "text");
bad({ sortOrder: Number.NaN }, "sortOrder", ORDER_ERR, "NaN");
bad({ sortOrder: undefined }, "sortOrder", ORDER_ERR, "missing");
bad({ sortOrder: 2_147_483_648 }, "sortOrder", ORDER_ERR, "past a Postgres integer");
bad({ sortOrder: -2_147_483_649 }, "sortOrder", ORDER_ERR, "below a Postgres integer");

// Ids as numeric strings are what a form field hands over: accepted, as numbers.
{
  const r = validateItineraryRoute({ ...good, eventIds: ["7", "8"], sortOrder: "3" });
  assert.equal(r.ok, true, "digit strings are numbers");
  if (r.ok) {
    assert.deepEqual(r.route.eventIds, [7, 8]);
    assert.equal(r.route.sortOrder, 3);
  }
}

// isActive must be a boolean; anything else is a broken form, not a silent default.
{
  const r = validateItineraryRoute({ ...good, isActive: "yes" });
  assert.equal(r.ok, false);
}

// Everything wrong at once blames all three fields.
{
  const r = validateItineraryRoute({ title: "", eventIds: [], sortOrder: "x", isActive: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ["eventIds", "sortOrder", "title"]);
}

// A non-object is a broken form.
for (const junk of [null, undefined, "x", 5, [], [1, 2]]) {
  const r = validateItineraryRoute(junk);
  assert.equal(r.ok, false, `junk ${JSON.stringify(junk)}`);
}

// --- events.id is a Postgres integer -------------------------------------------------------------------
{
  for (const ok of [1, 22, 1_000_000, 2_147_483_647]) assert.equal(isEventId(ok), true, `${ok} can be an event id`);
  for (const no of [2_147_483_648, Number.MAX_SAFE_INTEGER, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5", null, undefined]) {
    assert.equal(isEventId(no), false, `${String(no)} cannot be an event id`);
  }
  // The validator itself still takes a bigint[]-sized id (the table can hold it); the actions are what refuse it.
  assert.equal(validateItineraryRoute({ ...good, eventIds: [2_147_483_648, 5] }).ok, true);
}

// --- site status ---------------------------------------------------------------------------------------
const TODAY = "2026-10-22";
const ev = (id: number, patch: Partial<TripEventLite> = {}): TripEventLite => ({
  id,
  name: `אירוע ${id}`,
  date: "2027-03-01",
  is_deleted: null,
  is_hidden: false,
  deactivated_reason: null,
  tags: null,
  is_test: false,
  package_mode: "regular",
  country_code: "GB",
  place: "לונדון",
  ...patch,
});
const NOT_SHOWN = "לא יוצג באתר: ";

{
  const all = routeSiteStatus([1, 2], [ev(1), ev(2)], TODAY);
  assert.deepEqual(all, { shown: true, text: "מוצג באתר אם כל האירועים עדיין מתאימים זה לזה" });
  assert.equal(ROUTE_STATUS_SHOWN, all.text);

  const missing = routeSiteStatus([1, 2], [ev(1)], TODAY);
  assert.equal(missing.shown, false);
  assert.equal(missing.text, `${NOT_SHOWN}#2 - האירוע לא נמצא`, "a missing event is named by its id");

  const deleted = routeSiteStatus([1, 2], [ev(1), ev(2, { is_deleted: "10-01-2026" })], TODAY);
  assert.deepEqual(deleted, { shown: false, text: `${NOT_SHOWN}אירוע 2 - האירוע נמחק` });

  const hidden = routeSiteStatus([1, 2], [ev(1, { is_hidden: true }), ev(2)], TODAY);
  assert.deepEqual(hidden, { shown: false, text: `${NOT_SHOWN}אירוע 1 - האירוע מוסתר` });

  const off = routeSiteStatus([1, 2], [ev(1), ev(2, { deactivated_reason: "supplier_gap" })], TODAY);
  assert.deepEqual(off, { shown: false, text: `${NOT_SHOWN}אירוע 2 - האירוע הוסר מהמכירה` });

  const sold = routeSiteStatus([1, 2], [ev(1, { tags: ["Hot", "Sold"] }), ev(2)], TODAY);
  assert.deepEqual(sold, { shown: false, text: `${NOT_SHOWN}אירוע 1 - אזל` });

  const past = routeSiteStatus([1, 2], [ev(1), ev(2, { date: "2026-10-21" })], TODAY);
  assert.deepEqual(past, { shown: false, text: `${NOT_SHOWN}אירוע 2 - האירוע כבר עבר` });

  // Today itself is not past - but it is inside the site's 3-day sell window (below). A timestamp is compared by its day.
  assert.equal(routeSiteStatus([1, 2], [ev(1, { date: "2026-10-25" }), ev(2, { date: "2026-10-25T20:00:00+00:00" })], TODAY).shown, true);
  // No date: nothing says it is past.
  assert.equal(routeSiteStatus([1, 2], [ev(1, { date: null }), ev(2)], TODAY).shown, true);
  // A tag list that does not hold Sold, or is null, is fine.
  assert.equal(routeSiteStatus([1, 2], [ev(1, { tags: ["Hot"] }), ev(2, { tags: [] })], TODAY).shown, true);
  // is_hidden null (column not read / legacy row) is not hidden.
  assert.equal(routeSiteStatus([1, 2], [ev(1, { is_hidden: null }), ev(2)], TODAY).shown, true);
}

// The rest of the site's eligibility (myt-main isItineraryEligible), each with its own text.
{
  const test = routeSiteStatus([1, 2], [ev(1, { is_test: true }), ev(2)], TODAY);
  assert.deepEqual(test, { shown: false, text: `${NOT_SHOWN}אירוע 1 - אירוע בדיקה` });

  const ticketOnly = routeSiteStatus([1, 2], [ev(1), ev(2, { package_mode: "ticket_only" })], TODAY);
  assert.deepEqual(ticketOnly, { shown: false, text: `${NOT_SHOWN}אירוע 2 - כרטיס בלבד, בלי חבילה` });

  const us = routeSiteStatus([1, 2], [ev(1, { country_code: "US" }), ev(2)], TODAY);
  assert.deepEqual(us, { shown: false, text: `${NOT_SHOWN}אירוע 1 - אירוע בארה״ב` });
  assert.equal(routeSiteStatus([1, 2], [ev(1, { country_code: "us" }), ev(2)], TODAY).shown, false, "the code is read case-insensitively");
  assert.equal(routeSiteStatus([1, 2], [ev(1, { country_code: null }), ev(2)], TODAY).shown, true, "no country is not the US");

  const soon = (date: string) => routeSiteStatus([1, 2], [ev(1), ev(2, { date })], TODAY);
  assert.deepEqual(soon("2026-10-22"), { shown: false, text: `${NOT_SHOWN}אירוע 2 - פחות מ-3 ימים לאירוע` }, "today");
  assert.equal(soon("2026-10-24").shown, false, "two days away");
  assert.equal(soon("2026-10-24T23:30:00+00:00").shown, false, "a timestamp is read by its day");
  assert.equal(soon("2026-10-25").shown, true, "three days away is the first sellable day");
  assert.equal(soon("2026-10-21").text, `${NOT_SHOWN}אירוע 2 - האירוע כבר עבר`, "yesterday is past, not 'too close'");
  assert.equal(routeSiteStatus([1, 2], [ev(1, { package_mode: null, is_test: null }), ev(2)], TODAY).shown, true, "null columns are fine");
}

// The FIRST reason in the order missing / deleted / hidden / deactivated / Sold / past wins - for one event ...
{
  const everything = ev(1, {
    is_deleted: "10-01-2026", is_hidden: true, deactivated_reason: "x", tags: ["Sold"], date: "2020-01-01",
  });
  const text = (e: TripEventLite) => routeSiteStatus([1, 2], [e, ev(2)], TODAY).text;
  assert.match(text(everything), /נמחק$/, "deleted beats the rest");
  assert.match(text({ ...everything, is_deleted: null }), /מוסתר$/, "then hidden");
  assert.match(text({ ...everything, is_deleted: null, is_hidden: false }), /הוסר מהמכירה$/, "then deactivated");
  assert.match(text({ ...everything, is_deleted: null, is_hidden: false, deactivated_reason: null }), /אזל$/, "then Sold");
  const live = { ...everything, is_deleted: null, is_hidden: false, deactivated_reason: null, tags: null };
  assert.match(text(live), /עבר$/, "then past");
  // The site's other rules come after those, in this order: test, ticket-only, US, too close.
  const future = { ...live, date: "2026-10-23", is_test: true, package_mode: "ticket_only", country_code: "US" };
  assert.match(text(future), /אירוע בדיקה$/, "then a test event");
  assert.match(text({ ...future, is_test: false }), /כרטיס בלבד, בלי חבילה$/, "then ticket-only");
  assert.match(text({ ...future, is_test: false, package_mode: "regular" }), /אירוע בארה״ב$/, "then the US");
  assert.match(text({ ...future, is_test: false, package_mode: "regular", country_code: "GB" }), /פחות מ-3 ימים לאירוע$/, "then too close");
}

// ... and across events: the first event of the trip (staff order) that fails names the status.
{
  const r = routeSiteStatus([2, 1], [ev(1, { is_hidden: true }), ev(2, { tags: ["Sold"] })], TODAY);
  assert.equal(r.text, `${NOT_SHOWN}אירוע 2 - אזל`, "ids are walked in the trip's own order");
  // A missing event is reported before a bad later one.
  const m = routeSiteStatus([9, 1], [ev(1, { is_hidden: true })], TODAY);
  assert.match(m.text, /^לא יוצג באתר: #9 - /);
}

console.log("itinerary-routes-selftest: all good");

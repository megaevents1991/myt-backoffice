// scripts/tours-itinerary-pdf-selftest.ts - `npx tsx scripts/tours-itinerary-pdf-selftest.ts`
// Pure only: the itinerary PDF of a booking-link offer (lib/tours/itinerary-pdf.ts, Alon 10.11). No DB, no browser.
import assert from "node:assert/strict";
import {
  ITINERARY_FRESH_MS,
  SITE_REBUILD_MS,
  isItineraryFresh,
  itineraryLine,
  itineraryPageUrl,
  itineraryPdfPath,
  roomsKey,
  versionedUrl,
} from "../lib/tours/itinerary-pdf";
import { linkMessage } from "../lib/tours/cases";

// one file per date and choice of rooms - the same choice again replaces it
const DEP = { id: "3f1c2b9a-0000-4000-8000-000000000000", code: "BBC413" };
const path2 = itineraryPdfPath("mega-family", DEP, ["double_room", "single_room"]);
assert.match(path2, /^itineraries\/mega-family\/BBC413-3f1c2b9a-[0-9a-z]+\.pdf$/);
assert.equal(itineraryPdfPath("mega-family", DEP, ["single_room", "double_room"]), path2, "the order picked does not matter");
assert.notEqual(itineraryPdfPath("mega-family", DEP, ["double_room"]), path2, "another choice is another file");
assert.notEqual(itineraryPdfPath("mega-family", DEP, ["double_room", "double_room"]), itineraryPdfPath("mega-family", DEP, ["double_room"]), "two doubles are not one");
assert.equal(roomsKey(["a", "b"]), roomsKey(["b", "a"]));
assert.match(itineraryPdfPath("../x", { id: "ab/cd-ef", code: "BB C/4.1" }, []), /^itineraries\/x\/BBC41-abcd-ef-[0-9a-z]+\.pdf$/, "nothing climbs out of the folder");

// the page whose print sheet is the PDF: the tour on that date with the offer's rooms - no link token
assert.equal(
  itineraryPageUrl("https://megatr.co.il/", "/package/wonders/?x=1", 4321, ["double_room", "single_room"]),
  "https://megatr.co.il/package/wonders/?product_id=4321&rooms=double_room%2Csingle_room",
);
assert.equal(itineraryPageUrl("https://megatr.co.il", "/package/wonders/", 4321, []), "https://megatr.co.il/package/wonders/?product_id=4321");

// fresh: under half an hour, and printed after the site could show the last edit
const NOW = Date.parse("2026-11-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
assert.equal(isItineraryFresh(null, null, NOW), false, "no file yet");
assert.equal(isItineraryFresh(ago(60_000), null, NOW), true);
assert.equal(isItineraryFresh(ago(ITINERARY_FRESH_MS), null, NOW), false, "half an hour old: print again (prices move)");
assert.equal(isItineraryFresh(ago(60_000), ago(5 * 60_000), NOW), false, "printed 4 minutes after an edit: the site may not show it yet");
assert.equal(isItineraryFresh(ago(60_000), ago(60_000 + SITE_REBUILD_MS), NOW), true, "printed well after the edit");
assert.equal(isItineraryFresh(ago(-10 * 60_000), null, NOW), false, "a time from the future is not trusted");
assert.equal(isItineraryFresh("nonsense", null, NOW), false);

// the address carries the print's time
assert.equal(versionedUrl("https://x.supabase.co/a.pdf", "2026-11-10T12:00:00Z"), "https://x.supabase.co/a.pdf?v=1794312000");
assert.equal(versionedUrl("https://x.supabase.co/a.pdf?t=1", "2026-11-10T12:00:00Z"), "https://x.supabase.co/a.pdf?t=1&v=1794312000");
assert.equal(versionedUrl("https://x.supabase.co/a.pdf", "?"), "https://x.supabase.co/a.pdf");

// the offer's message: the link, then the itinerary on a line of its own - and as before when there is none
const plain = linkMessage("דנה", "מראות ופלאים", "https://site/p?product_id=1");
assert.equal(plain, "היי דנה, מצרפים קישור להזמנה למראות ופלאים עם ההרכב שדיברנו עליו. ממלאים את פרטי הנוסעים ושולחים: https://site/p?product_id=1");
assert.equal(linkMessage("דנה", "מראות ופלאים", "https://site/p?product_id=1", null), plain);
assert.equal(
  linkMessage("דנה", "מראות ופלאים", "https://site/p?product_id=1", "https://x/a.pdf?v=1"),
  `${plain}\n${itineraryLine("https://x/a.pdf?v=1")}`,
);

console.log("tours-itinerary-pdf selftest: ok");

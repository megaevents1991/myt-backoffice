// Self-test for the Meta feed's pure helpers. No DB writes, no network.
//   npx tsx --env-file=.env.local scripts/meta-feed-selftest.ts
import assert from "node:assert/strict";
import {
  campaignInputHash,
  creativeGap,
  creativeVersion,
  creativeWorkOrder,
  expectedCampaignHash,
  resolveCreativeSubject,
  type CampaignEventRow,
  type PersonRow,
  type SubjectRow,
} from "../lib/creative/auto";
import { activityIdsOf } from "../lib/feed/publish-meta-feed";

/* creatives: an event that never got one goes first (date order kept), then the least
   recently drawn - a far-out event must not wait behind near ones whose price moves daily */
const order = creativeWorkOrder([
  { id: 1, campaign_image_url: "a.png", campaign_generated_at: "2026-10-01T04:16:00+00:00" }, // soonest, redrawn this morning
  { id: 2, campaign_image_url: null }, // new, far out
  { id: 3, campaign_image_url: "c.png", campaign_generated_at: "2026-08-16T12:11:00+00:00" }, // far out, drawn in August
  { id: 4 }, // new, never checked
  { id: 5, campaign_image_url: "e.png", campaign_generated_at: "2026-10-01T04:16:00+00:00" }, // same stamp as 1 - date order kept
  { id: 6, campaign_image_url: "f.png", campaign_generated_at: null }, // a picture with no stamp is the oldest
]).map((e) => e.id);
assert.deepEqual(order, [2, 4, 6, 3, 1, 5]);

/* feed file: the ids Meta will list */
const csv = 'id,image_link,title\r\n1154,https://x/a.png,"אואזיס, מדריד"\r\n"717",https://x/b.png,ריאל\r\n';
assert.deepEqual(activityIdsOf(csv), [1154, 717]);
assert.deepEqual(activityIdsOf("id,image_link\r\n"), []);

/* image URL version: a forced redraw at an unchanged hash still gets a NEW ?v=, or Meta keeps its cached picture */
assert.equal(creativeVersion("abc123def456"), "abc123def456");
assert.equal(creativeVersion("abc123def456", null), "abc123def456");
const forced = creativeVersion("abc123def456", 1_790_000_000_000);
assert.ok(forced.startsWith("abc123def456."), forced);
assert.notEqual(forced, creativeVersion("abc123def456"));
assert.notEqual(forced, creativeVersion("abc123def456", 1_790_000_000_001));

/* creative gap: what is missing decides the look, and the look is in the hash */
const person = (over: Partial<PersonRow>): PersonRow => ({
  id: 1,
  name: "",
  name_english: null,
  logo_url: null,
  art_image_url: null,
  image_url: null,
  ...over,
});
const crest = (id: number, he: string, en: string, logo: string | null): SubjectRow => ({
  ...person({ id, name: he, name_english: en, logo_url: logo }),
  ref: `logo:${id}`,
});
const ev = (over: Partial<CampaignEventRow>): CampaignEventRow =>
  ({
    id: 10,
    name: "",
    name_english: "",
    type: "tx_event",
    date: "2027-07-11T20:00:00",
    art_image_url: null,
    card_image_url: null,
    base_flight_price: 400,
    base_hotel_price: 300,
    tickets_and_rates: [{ id: "a", price: 200, available: true }],
    ...over,
  }) as CampaignEventRow;

const harryPhoto = [person({ id: 5, name: "הארי סטיילס", name_english: "Harry Styles", image_url: "https://x/photo.jpg" })];
const harryCutout = [{ ...harryPhoto[0], art_image_url: "https://x/cutout.png" }];
const harry = ev({ name: "הארי סטיילס", name_english: "Harry Styles" });
const gapOf = (e: CampaignEventRow, a: PersonRow[], s: SubjectRow[]) =>
  creativeGap(resolveCreativeSubject(e, a, s), e);

// tx_event artist found by the in-memory probe; a flat photo = small circle, a cut-out = full look
assert.equal(resolveCreativeSubject(harry, harryPhoto, []).kind, "artist");
assert.equal(gapOf(harry, harryPhoto, []), "photo-circle");
assert.equal(gapOf(harry, harryCutout, []), null);
// uploading the cut-out to the ARTIST changes the event's hash (the whole point)
assert.notEqual(expectedCampaignHash(harry, harryPhoto, []), expectedCampaignHash(harry, harryCutout, []));
// full look: the hash is byte-identical to the pre-gap format - no mass re-render on deploy
assert.equal(expectedCampaignHash(harry, harryCutout, []), campaignInputHash(harry, null));

const bayern = crest(1, "באיירן מינכן", "Bayern Munich", "https://x/bayern.png");
const schalke = crest(2, "שאלקה 04", "FC Schalke 04", "https://x/schalke.png");
const fixture = ev({ name: "באיירן מינכן - שאלקה 04", name_english: "Bayern Munich - Schalke 04" });
assert.equal(gapOf(fixture, [], [bayern]), "one-team");
assert.equal(gapOf(fixture, [], [bayern, schalke]), null);
assert.notEqual(expectedCampaignHash(fixture, [], [bayern]), expectedCampaignHash(fixture, [], [bayern, schalke]));
// no subject picture at all: the event's own photo, else a bare card
assert.equal(gapOf(fixture, [], []), "bare");
assert.equal(gapOf({ ...fixture, card_image_url: "https://x/card.jpg" }, [], []), "event-photo");
// a team matched on both sides but one has no picture is not the full look either
assert.equal(gapOf(fixture, [], [bayern, { ...schalke, logo_url: null }]), "bare");

console.log("meta-feed selftest: all assertions passed");
process.exit(0);

/**
 * Staff corrections - the pure rules (lib/services/price-light-corrections.ts), synthetic rows,
 * no DB, no API. Run: npx tsx scripts/price-light-corrections-selftest.ts
 */
import assert from "node:assert/strict";
import {
  correctAttrs, correctCandidates, correctOffer, correctionLessonText, crawledValue, liveCorrections,
  sameValue, validateCorrection, type ListingCorrection,
} from "../lib/services/price-light-corrections";
import type { ListingRow, OfferDetail } from "../types/price-light.types";

const listing = (over: Partial<ListingRow> = {}): ListingRow => ({
  id: 1, competitor: "golasso", external_key: "p1", scope: "package", title: "רומא - ריאל מדריד", title_he: null,
  event_date: "2026-10-13", city: null, venue: null, price_from: 389, currency: "EUR", price_usd: 450,
  travel_depart: "2026-10-12", travel_return: "2026-10-15",
  attrs: { bag_included: "unknown", direct_flight: true, hotel_stars: 3, nights: 3, breakfast: "unknown", transfers: "unknown" },
  detail_text: "x", url: "https://example.test/p1", first_seen_at: "2026-09-01T00:00:00Z",
  last_seen_at: "2026-09-18T00:00:00Z", last_changed_at: "2026-09-10T00:00:00Z", run_id: 1,
  ...over,
} as ListingRow);

const fix = (over: Partial<ListingCorrection>): ListingCorrection => ({
  id: 10, listing_id: 1, event_id: null, competitor: "golasso", field: "price", original: { amount: 389, currency: "EUR" },
  value: { amount: 1389, currency: "EUR" }, reason: "parser_misread", note: "המחיר בדף 1,389", source: "page",
  created_by: "a@b.c", created_at: "2026-09-18T10:00:00Z", revoked_at: null, ...over,
});

const usd = (amount: number) => Math.round(amount * 1.17);
const EVENT = 500;

// ---- sameValue ---------------------------------------------------------------------------------
assert.ok(sameValue(null, "unknown" as never), "unknown reads as null");
assert.ok(sameValue(3, 3) && !sameValue(3, 4));
assert.ok(sameValue({ amount: 389, currency: "EUR" }, { amount: 389, currency: "EUR" }));
assert.ok(!sameValue({ amount: 389, currency: "EUR" }, { amount: 389, currency: "GBP" }), "currency is part of a price");
assert.ok(!sameValue({ amount: 389, currency: "EUR" }, 389), "a price never equals a bare number");

// ---- a price correction is what the matcher sees -----------------------------------------------
{
  const { candidates } = correctCandidates([listing()], [fix({})], EVENT, usd);
  assert.equal(candidates[0].price_from, 1389);
  assert.equal(candidates[0].price_usd, usd(1389), "usd recomputed from the corrected price");
}
// ...until the crawl itself shows a different price: the market moved, the correction is stale.
{
  const { candidates } = correctCandidates([listing({ price_from: 420 })], [fix({})], EVENT, usd);
  assert.equal(candidates[0].price_from, 420, "stale correction is not applied");
  // and live again should the old (misread) value come back
  const again = correctCandidates([listing({ price_from: 389 })], [fix({})], EVENT, usd);
  assert.equal(again.candidates[0].price_from, 1389);
}
// A revoked correction never applies.
assert.equal(correctCandidates([listing()], [fix({ revoked_at: "2026-09-19T00:00:00Z" })], EVENT, usd).candidates[0].price_from, 389);
// A quote-only listing (no crawled price) can be given one - staff got the quote by phone.
{
  const quote = listing({ price_from: null, currency: null, price_usd: null });
  const { candidates } = correctCandidates([quote], [fix({ original: null })], EVENT, usd);
  assert.equal(candidates[0].price_usd, usd(1389));
}

// ---- "not our event" belongs to ONE (event, listing) pair --------------------------------------
{
  const mark = fix({ field: "not_same_event", event_id: EVENT, original: null, value: true });
  assert.equal(correctCandidates([listing()], [mark], EVENT, usd).candidates.length, 0, "gone for that event");
  assert.equal(correctCandidates([listing()], [mark], 501, usd).candidates.length, 1, "still a candidate for every other event");
  // A listing-wide correction that somehow carries an event id is ignored rather than guessed at.
  assert.equal(liveCorrections([fix({ event_id: EVENT })], listing(), null, EVENT).length, 0);
}

// ---- attributes: staff > page > AI, per field ---------------------------------------------------
{
  const stars = fix({ id: 11, field: "hotel_stars", original: 3, value: 4 });
  const { attrFixes } = correctCandidates([listing()], [stars], EVENT, usd);
  const merged = correctAttrs({ hotel_stars: 3, nights: 3, breakfast: true }, attrFixes.get(1) ?? []);
  assert.equal(merged.hotel_stars, 4);
  assert.equal(merged.breakfast, true, "untouched fields stay");
  // null = "we do not know": the adjustment leaves the comparison.
  const unknownBag = fix({ id: 12, field: "bag_included", original: null, value: null });
  assert.equal(correctAttrs({ bag_included: true }, [unknownBag]).bag_included, "unknown");
  // The page later learns a different value -> the correction made against "unknown" is stale.
  const breakfast = fix({ id: 13, field: "breakfast", original: null, value: true });
  assert.equal(liveCorrections([breakfast], listing(), null, EVENT).length, 1);
  assert.equal(liveCorrections([breakfast], listing({ attrs: { breakfast: false } as never }), null, EVENT).length, 0);
}

// ---- the sheet: a corrected attribute has to win over the PARSED text too -----------------------
{
  const parsed: OfferDetail = {
    flight: { airline: "וויז אייר", direct: true, bag: "תיק גב בלבד", out: null, back: null },
    hotel: { name: "Best Western", stars: 3, board: "room_only" }, ticket: "קטגוריה 3", multiMatch: false,
  };
  const out = correctOffer(parsed, [
    fix({ id: 20, field: "hotel_stars", original: 3, value: 4 }),
    fix({ id: 21, field: "bag_included", original: null, value: true }),
    fix({ id: 22, field: "ticket", original: "קטגוריה 3", value: "קטגוריה 2 · מאחורי השער" }),
  ]);
  assert.equal(out.hotel?.stars, 4);
  assert.equal(out.flight?.bag, "כולל מזוודה");
  assert.equal(out.ticket, "קטגוריה 2 · מאחורי השער");
  assert.equal(parsed.hotel?.stars, 3, "the parsed detail itself is not mutated");
  // Text corrections need the parsed text to be compared with - the matcher passes none.
  const ticketFix = fix({ id: 23, field: "ticket", original: "קטגוריה 3", value: "קטגוריה 2" });
  assert.equal(liveCorrections([ticketFix], listing(), null, EVENT).length, 0);
  assert.equal(liveCorrections([ticketFix], listing(), parsed, EVENT).length, 1);
  assert.equal(liveCorrections([ticketFix], listing(), { ...parsed, ticket: "קטגוריה 1" }, EVENT).length, 0, "parser now reads another value");
  assert.equal(crawledValue("hotel_name", listing(), parsed), "Best Western");
  // A listing with no parsed hotel at all can still be given one.
  assert.equal(correctOffer({ flight: null, hotel: null, ticket: null, multiMatch: false }, [fix({ field: "hotel_name", original: null, value: "Hotel X" })]).hotel?.name, "Hotel X");
}

// ---- validation ---------------------------------------------------------------------------------
assert.deepEqual(validateCorrection("price", { amount: "1389.4", currency: "EUR" }), { ok: true, value: { amount: 1389, currency: "EUR" } });
assert.equal(validateCorrection("price", { amount: 0, currency: "EUR" }).ok, false);
assert.equal(validateCorrection("price", { amount: 500, currency: "XYZ" }).ok, false);
assert.equal(validateCorrection("price", null).ok, false, "a price cannot be set to unknown");
assert.equal(validateCorrection("hotel_stars", 6).ok, false);
assert.deepEqual(validateCorrection("hotel_stars", null), { ok: true, value: null });
assert.equal(validateCorrection("nights", 2.5).ok, false);
assert.equal(validateCorrection("breakfast", "yes").ok, false);
assert.deepEqual(validateCorrection("ticket", "  קטגוריה   2 "), { ok: true, value: "קטגוריה 2" });
assert.equal(validateCorrection("ticket", "x".repeat(200)).ok, false);
assert.equal(validateCorrection("not_same_event", false).ok, false);

// ---- lesson wording -----------------------------------------------------------------------------
{
  const ai = correctionLessonText({ competitor: "golasso", field: "hotel_stars", from: 3, to: 4, source: "ai", reason: "ai_wrong", note: "בדף כתוב 4 כוכבים" });
  assert.ok(ai?.includes("the AGENT's hotel stars from 3 to 4") && ai.includes("בדף כתוב 4 כוכבים"), ai ?? "");
  const pair = correctionLessonText({ competitor: "issta", field: "not_same_event", source: "ai", note: "זה משחק הגומלין", listing_title: "ברצלונה-ריאל", event_name: "ריאל - ברצלונה" });
  assert.ok(pair?.includes("the AGENT paired listing \"ברצלונה-ריאל\"") && pair.includes("NOT the same event"), pair ?? "");
  const price = correctionLessonText({ competitor: "golasso", field: "price", from: { amount: 389, currency: "EUR" }, to: { amount: 1389, currency: "EUR" }, source: "page", note: "חסרה ספרה" });
  assert.ok(price?.includes("from 389 EUR to 1389 EUR"), price ?? "");
  assert.equal(correctionLessonText({ field: "hotel_stars", from: 3, to: 4 }), null, "no note, no lesson");
  assert.equal(correctionLessonText({ field: "nonsense", note: "x" }), null);
}

console.log("price-light corrections selftest: all assertions passed");

import assert from "node:assert/strict";
import { ARTISTS_URL, attrsFromText, parseArtists, parsePerformer } from "../../lib/services/competitor-scrapers/ontour.ts";
import { formatOfferLines, parseOfferDetail } from "../../lib/services/offer-detail.ts";
import type { FixtureSpec } from "./types.ts";

// A performer that sold packages at recon time (2026-09-10: Shakira, Celine Dion, André Rieu).
// If --save 404s here, take the first URL parseArtists() returns from the freshly saved
// artists.html and update this constant.
const PERFORMER_URL = "https://ontour.co.il/performer/shakira/";

const spec: FixtureSpec = {
  files: {
    "artists.html": { url: ARTISTS_URL, via: "fetch" },
    "performer.html": { url: PERFORMER_URL, via: "fetch" },
  },
  check(read) {
    const performers = parseArtists(read("artists.html"), ARTISTS_URL);
    assert.ok(performers.length >= 1, "at least one selling performer");
    for (const u of performers) assert.match(u, /^https:\/\/ontour\.co\.il\/performer\/[^/]+\/$/, u);
    assert.ok(new Set(performers).size === performers.length, "performer urls unique");

    const listings = parsePerformer(read("performer.html"), PERFORMER_URL);
    assert.ok(listings.length >= 1, `expected >= 1 listing, got ${listings.length}`);
    const keys = new Set<string>();
    for (const l of listings) {
      assert.match(l.external_key, /^[^#]+#\d{4}-\d{2}-\d{2}$/, l.external_key);
      assert.ok(!keys.has(l.external_key), `duplicate ${l.external_key}`);
      keys.add(l.external_key);
      assert.ok(l.title, "title");
      assert.match(l.travel_depart ?? "", /^\d{4}-\d{2}-\d{2}$/);
      assert.match(l.travel_return ?? "", /^\d{4}-\d{2}-\d{2}$/);
      if (l.event_date) assert.ok(l.event_date >= (l.travel_depart ?? "") && l.event_date <= (l.travel_return ?? ""), "event_date inside window");
      assert.ok(typeof l.attrs?.nights === "number", "nights from the window");
      assert.ok((l.detail_text ?? "").length > 100, "detail_text");
      if (l.price_from != null) assert.equal(l.currency, "EUR");
    }
    const priced = listings.filter((l) => l.price_from != null);
    assert.ok(priced.length >= 1 || listings.every((l) => l.price_from == null), "priced or consistently quote-only");

    // marker unit checks (independent of the live page)
    assert.deepEqual(attrsFromText("טיסות ישירות עם אייר אירופה כולל תיק גב וטרולי עד 8 ק\"ג. מלון 4 כוכבים ע\"ב לינה וארוחת בוקר"),
      { bag_included: false, direct_flight: true, hotel_stars: 4, nights: "unknown", breakfast: true, transfers: "unknown" });
    assert.equal(attrsFromText("לינה בלבד").breakfast, false);
    assert.equal(attrsFromText("כולל מזוודה 23 ק\"ג").bag_included, true);
    // Contents lines (lib/services/offer-detail.ts) for every package on the page.
    for (const l of listings) {
      const offer = formatOfferLines(parseOfferDetail("ontour", l.detail_text, l.attrs));
      console.log("offer lines:", l.external_key, offer);
      assert.ok(offer.flight, `flight ${l.external_key}`);
    }
    console.log(`ontour: ${performers.length} performers, ${listings.length} listings (${priced.length} priced)`);
    console.log("sample:", listings[0]);
  },
};
export default spec;

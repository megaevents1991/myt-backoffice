import assert from "node:assert/strict";
import { coversEvent, detailUrl, LEAGUE_URLS, parseCatalog, parseDetail } from "../../lib/services/competitor-scrapers/issta.ts";
import { formatOfferLines, parseOfferDetail } from "../../lib/services/offer-detail.ts";
import type { FixtureSpec } from "./types.ts";

const spec: FixtureSpec = {
  files: {
    "catalog.html": { url: LEAGUE_URLS[0], via: "fetch" }, // spanish-league (~23 cards at recon time)
    // The page BEHIND a card's `/loader?url=` link - server-rendered, read by detail() (2026-09-18).
    "detail.html": { url: "https://www.issta.co.il/sport/details?sid=3&vid=15&pid=7750&dport=BCN&fdate=22/10/2026", via: "fetch" },
  },
  check(read) {
    const listings = parseCatalog(read("catalog.html"));
    assert.ok(listings.length >= 10, `expected >= 10 listings, got ${listings.length}`);
    const keys = new Set<string>();
    let priced = 0;
    for (const l of listings) {
      assert.match(l.external_key, /^pid=\d+$/, `key ${l.external_key}`);
      assert.ok(!keys.has(l.external_key), `duplicate ${l.external_key}`);
      keys.add(l.external_key);
      assert.ok(l.title, "title");
      assert.equal(l.event_date, null, "issta cards carry no match date");
      assert.match(l.travel_depart ?? "", /^\d{4}-\d{2}-\d{2}$/, `depart ${l.travel_depart}`);
      assert.match(l.travel_return ?? "", /^\d{4}-\d{2}-\d{2}$/, `return ${l.travel_return}`);
      assert.ok((l.travel_return ?? "") > (l.travel_depart ?? ""), `window order ${l.travel_depart}..${l.travel_return}`);
      // The card carries neither: its tagline used to pose as a detail text and blocked enrichment.
      assert.equal(l.attrs, null, "catalog attrs stay null - the detail page fills them");
      assert.equal(l.detail_text, null, "catalog detail_text stays null");
      assert.match(detailUrl(l.url) ?? "", /^https:\/\/www\.issta\.co\.il\/sport\/details\?/, `detail url of ${l.url}`);
      assert.match(l.city ?? "", /^[A-Z]{3}$/, `city ${l.city}`);
      assert.match(l.url, /^https:\/\/www\.issta\.co\.il\//, `url ${l.url}`);
      if (l.price_from != null) { assert.equal(l.currency, "EUR"); assert.ok(l.price_from > 100, `price ${l.price_from}`); priced += 1; }
    }
    assert.ok(priced >= 5, `expected >= 5 priced listings, got ${priced}`);

    const detail = parseDetail(read("detail.html"), { depart: "2026-10-22", ret: "2026-10-26" });
    assert.equal(detail.attrs?.nights, 4, "nights from the listing window");
    assert.equal(typeof detail.attrs?.hotel_stars, "number", `hotel stars ${String(detail.attrs?.hotel_stars)}`);
    assert.equal(typeof detail.attrs?.direct_flight, "boolean", "direct flight read off the strip");
    const offer = formatOfferLines(parseOfferDetail("issta", detail.detail_text, detail.attrs));
    assert.match(offer.flight ?? "", /הלוך \d{1,2}:\d{2}–\d{1,2}:\d{2}/, `flight line ${offer.flight}`);
    assert.ok(offer.hotel, "hotel line");
    assert.ok(offer.ticket, "ticket line");
    console.log("issta detail:", offer);
    // Coverage (final review, I1): LEAGUES is soccer-only, so only a football-tagged event may
    // ever be told "ISSTA does not sell this". Everything else must come back false -> `skipped`.
    assert.equal(coversEvent({ tagSlugs: ["football", "laliga"] }), true, "football event is covered");
    assert.equal(coversEvent({ tagSlugs: [] }), false, "untagged event is not covered");
    assert.equal(coversEvent({ tagSlugs: ["basketball"] }), false, "non-football event is not covered");
    console.log(`issta: ${listings.length} listings parsed (${priced} priced)`);
    console.log("sample:", listings[0]);
  },
};
export default spec;

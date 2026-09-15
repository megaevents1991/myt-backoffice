import assert from "node:assert/strict";
import { coversEvent, LEAGUE_URLS, parseCatalog } from "../../lib/services/competitor-scrapers/issta.ts";
import type { FixtureSpec } from "./types.ts";

const spec: FixtureSpec = {
  files: {
    "catalog.html": { url: LEAGUE_URLS[0], via: "fetch" }, // spanish-league (~23 cards at recon time)
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
      assert.ok(typeof l.attrs?.nights === "number" && l.attrs.nights >= 1, `nights ${String(l.attrs?.nights)}`);
      assert.match(l.city ?? "", /^[A-Z]{3}$/, `city ${l.city}`);
      assert.match(l.url, /^https:\/\/www\.issta\.co\.il\//, `url ${l.url}`);
      if (l.price_from != null) { assert.equal(l.currency, "EUR"); assert.ok(l.price_from > 100, `price ${l.price_from}`); priced += 1; }
    }
    assert.ok(priced >= 5, `expected >= 5 priced listings, got ${priced}`);
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

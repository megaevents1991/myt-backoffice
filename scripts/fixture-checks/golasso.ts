/**
 * catalog.html needs a real browser (the all-packages list hydrates client-side). Note the
 * saved fixture holds exactly ONE un-paginated page of cards - `scrape-fixture.ts` only
 * waits for the selector, it does not click the site's "לטעון עוד..." button the way the
 * crawler's loadCatalog() does - so the >= 6 floor below is "one page parsed", not "the whole
 * catalog". detail.html (/pdetails/<id>) is server-rendered and uses a plain stealth fetch.
 */
import assert from "node:assert/strict";
import { ALL_PACKAGES_URL, parseCatalog, parseDetail } from "../../lib/services/competitor-scrapers/golasso.ts";
import { DETAIL_TEXT_MAX } from "../../lib/services/competitor-scrapers/shared.ts";
import { formatOfferLines, parseOfferDetail } from "../../lib/services/offer-detail.ts";
import type { FixtureSpec } from "./types.ts";

// Recon detail page (Roma vs Real Madrid, 2026-10-14). If it 404s at --save time, take the
// first `url` parseCatalog() returns from the freshly saved catalog.html and update this.
const DETAIL_URL = "https://www.goalzo.co.il/pdetails/20627";
const CURRENCIES = ["EUR", "GBP", "ILS", "USD"];

const spec: FixtureSpec = {
  files: {
    "catalog.html": { url: ALL_PACKAGES_URL, via: "browser", waitFor: 'a[href*="/pdetails/"]' },
    "detail.html": { url: DETAIL_URL, via: "fetch" },
  },
  check(read) {
    const listings = parseCatalog(read("catalog.html"));
    assert.ok(listings.length >= 6, `expected >= 6 listings, got ${listings.length}`);
    const keys = new Set<string>();
    for (const l of listings) {
      assert.match(l.external_key, /^\d+$/, l.external_key);
      assert.ok(!keys.has(l.external_key), `duplicate ${l.external_key}`);
      keys.add(l.external_key);
      assert.ok(l.title, "title");
      if (l.event_date) assert.match(l.event_date, /^\d{4}-\d{2}-\d{2}$/, `date ${l.event_date}`);
      else { assert.match(l.travel_depart ?? "", /^\d{4}-\d{2}-\d{2}$/, "tour window depart"); assert.match(l.travel_return ?? "", /^\d{4}-\d{2}-\d{2}$/, "tour window return"); }
      assert.match(l.url, /^https:\/\/www\.goalzo\.co\.il\/pdetails\/\d+$/, l.url);
      // The site prices in the DESTINATION's currency (£ on the English-league cards, € on a
      // Champions-League one) - a hard-coded "EUR" here would have hidden that.
      if (l.price_from != null) { assert.ok(CURRENCIES.includes(l.currency ?? ""), `currency ${l.currency}`); assert.ok(l.price_from >= 100, `price ${l.price_from}`); }
      assert.equal(l.price_usd, null, "price_usd is filled by crawl(), not the parser");
    }
    const dated = listings.filter((l) => l.event_date);
    assert.ok(dated.length >= listings.length / 2, "most cards carry a match date");
    assert.ok(listings.filter((l) => l.price_from != null).length >= 5, "priced cards");
    // Every card also publishes its travel window (`.package-dates span` ×2) - guards that
    // selector, which is what feeds the phase-2 window matching.
    const windowed = listings.filter((l) => l.travel_depart && l.travel_return);
    assert.ok(windowed.length >= listings.length / 2, `expected travel windows, got ${windowed.length}/${listings.length}`);
    for (const l of windowed) assert.ok((l.travel_return ?? "") > (l.travel_depart ?? ""), `window ${l.travel_depart}..${l.travel_return}`);

    const first = listings[0];
    const detail = parseDetail(read("detail.html"), { event_date: "2026-10-14", travel_depart: null });
    assert.ok(detail.attrs, "detail attrs");
    assert.ok(typeof detail.attrs?.hotel_stars === "number", `stars ${String(detail.attrs?.hotel_stars)}`);
    assert.ok(typeof detail.attrs?.nights === "number", `nights ${String(detail.attrs?.nights)}`);
    assert.notEqual(detail.attrs?.bag_included, "unknown", "bag marker");
    assert.notEqual(detail.attrs?.breakfast, "unknown", "breakfast marker");
    assert.notEqual(detail.attrs?.direct_flight, "unknown", "direct-flight marker");
    assert.ok((detail.price_from ?? 0) >= 100, `detail price ${detail.price_from}`);
    assert.ok(CURRENCIES.includes(detail.currency ?? ""), `detail currency ${detail.currency}`);
    // The per-person "מחיר החבילה", never the "סך הכל לתשלום" 2-passenger total.
    assert.ok((detail.price_from ?? 0) < 1500, `detail price looks like the 2-pax total: ${detail.price_from}`);
    assert.match(detail.travel_depart ?? "", /^\d{4}-\d{2}-\d{2}$/, `detail depart ${detail.travel_depart}`);
    assert.match(detail.travel_return ?? "", /^\d{4}-\d{2}-\d{2}$/, `detail return ${detail.travel_return}`);
    assert.ok((detail.detail_text ?? "").length > 200, "detail_text");
    assert.ok((detail.detail_text ?? "").length <= DETAIL_TEXT_MAX, `detail_text <= ${DETAIL_TEXT_MAX} chars`);
    // Contents lines (lib/services/offer-detail.ts): the flight table, the hotel item, the included seat.
    const offer = formatOfferLines(parseOfferDetail("golasso", detail.detail_text, detail.attrs));
    console.log("offer lines:", offer);
    assert.ok(offer.flight?.includes("הלוך"), `flight times ${offer.flight}`);
    assert.ok(/★/.test(offer.hotel ?? ""), `hotel ${offer.hotel}`);
    assert.ok(/קטגוריה/.test(offer.ticket ?? ""), `ticket ${offer.ticket}`);
    assert.deepEqual(parseDetail("<html><body>nothing here</body></html>", first), {}, "no-price page -> {}");

    // C1 (final review): the site prices in the DESTINATION's currency, so a detail page can
    // disagree with its own catalog card (£ cards, a € Champions-League detail). Both halves of
    // the pair must round-trip together or the row ends up storing a € amount labelled GBP -
    // a ~17% lie on the one number staff cross-check before deciding "הוזל"/"הסר מהאתר".
    const priced = listings.find((l) => l.price_from != null && l.currency != null);
    assert.ok(priced, "at least one priced catalog card");
    assert.notEqual(priced.currency, detail.currency, `fixture must exercise a currency change (card ${priced.currency} vs detail ${detail.currency})`);
    // Mirrors the write-back in lib/services/price-light-crawl.ts's detail loop - keep in step.
    const merged = {
      price_from: detail.price_from ?? priced.price_from,
      currency: detail.currency ?? priced.currency,
    };
    assert.equal(merged.price_from, detail.price_from, "detail price wins");
    assert.equal(merged.currency, detail.currency, "detail currency wins - never left at the card's");
    const currencyMoved = detail.price_from != null &&
      (Number(detail.price_from) !== Number(priced.price_from) || merged.currency !== priced.currency);
    assert.equal(currencyMoved, true, "a currency change counts as a price move (last_changed_at)");
    console.log("currency round-trip (C1):", { card: `${priced.price_from} ${priced.currency}`, detail: `${detail.price_from} ${detail.currency}`, stored: `${merged.price_from} ${merged.currency}` });
    console.log(`golasso: ${listings.length} listings (${dated.length} dated, ${windowed.length} windowed), detail ok`);
    console.log("sample:", first);
    console.log("detail:", detail);

    // Important #1 (review 2026-09-11): a card whose only date text is a
    // "DD.MM.YY-DD.MM.YY" tour range must yield event_date: null + a travel window, never the
    // range's start day as the match date - candidateCoversDate() short-circuits on event_date
    // and would otherwise never look at the window. This is the same card shape as the real
    // fixture (`.package-item` / `.games-name-package h3` x2 / `.gamesDates h4` x3 /
    // `.package-dates span` x2 / `.price-package h3`), copied and re-filled with a range in the
    // `.gamesDates` date slot instead of a single date, so the regression is caught without a
    // network fetch or a live tour card actually being on sale right now.
    const rangeCardHtml = `
      <div class="package-item">
        <a href="/pdetails/99999">
          <div class="games-name-package games-name-package-visible">
            <h3>קבוצה א</h3>
            <h3>קבוצה ב</h3>
          </div>
          <div class="gamesDates">
            <h4>16:30</h4>
            <h4>25.09.26-01.10.26</h4>
            <h4>הליגה האנגלית</h4>
          </div>
          <div class="package-dates">
            <span>25.09.26</span>
            <span>01.10.26</span>
          </div>
          <div class="price-package">
            <h3><small>€</small>650</h3>
          </div>
        </a>
      </div>`;
    const [rangeListing] = parseCatalog(rangeCardHtml);
    assert.ok(rangeListing, "range card should still parse to a listing");
    assert.equal(rangeListing.event_date, null, "range card must not get a match event_date");
    assert.equal(rangeListing.travel_depart, "2026-09-25", "range card travel_depart");
    assert.equal(rangeListing.travel_return, "2026-10-01", "range card travel_return");
    console.log("range-card regression (I1):", { event_date: rangeListing.event_date, travel_depart: rangeListing.travel_depart, travel_return: rangeListing.travel_return });
  },
};
export default spec;

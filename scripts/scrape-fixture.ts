/**
 * Runs a crawler's pure parsers on saved HTML - regression without network.
 * Run: node --env-file=.env.local scripts/scrape-fixture.ts liveevents
 *
 * --save fetches the recon doc's four fixture URLs once (the only network access this
 * script makes) and writes them under scripts/fixtures/liveevents/:
 * Run: node --env-file=.env.local scripts/scrape-fixture.ts liveevents --save
 *
 * catalog.html (`/events/`) needs a real browser: its `div.line` rows hydrate via a
 * client-side WP AJAX call, so a plain fetch only returns the empty `.accord-crap` shells
 * (discovered empirically - see the note in liveevents.ts and the recon doc's own fallback
 * clause). catalog-sports.html, detail.html and show.html are confirmed server-rendered and
 * use a plain fetch with the same stealth headers the crawler uses. show.html
 * (`/show/<slug>/`) is fetched last, after the pause following detail.html, purely to
 * exercise parseDetail's `{}` short-circuit for the tier-list page shape.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { withBrowser } from "../lib/services/browser.ts";
import { parseCatalog, parseDetail, parseHeDate, stealthHeaders } from "../lib/services/competitor-scrapers/liveevents.ts";

const site = process.argv[2];
assert.equal(site, "liveevents", "only liveevents has fixtures so far");
const save = process.argv.includes("--save");
const dir = `scripts/fixtures/${site}`;

const FIXTURE_URLS = {
  "catalog.html": "https://livevents.co.il/events/",
  "catalog-sports.html": "https://livevents.co.il/matches/",
  "detail.html": "https://livevents.co.il/package/muse-mil-gold/",
  // `/show/<slug>/` tier-list page - exercises parseDetail's `{}` short-circuit (no
  // per-person price marker). Same slug family as detail.html (Muse Milan).
  "show.html": "https://livevents.co.il/show/muse-mil/",
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchViaBrowser(url: string): Promise<string> {
  return withBrowser(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".accord-crap div.line", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    return page.content();
  });
}

async function saveFixtures(): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const entries = Object.entries(FIXTURE_URLS);
  for (let i = 0; i < entries.length; i++) {
    const [file, url] = entries[i];
    console.error(`fetching ${url} ...`);
    const html = file === "catalog.html"
      ? await fetchViaBrowser(url)
      : await (async () => {
          const res = await fetch(url, { headers: stealthHeaders() });
          if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
          return res.text();
        })();
    writeFileSync(`${dir}/${file}`, html, "utf8");
    console.error(`saved ${dir}/${file} (${html.length} bytes)`);
    if (i < entries.length - 1) {
      console.error("pausing 20s ...");
      await sleep(20_000);
    }
  }
}

function runAssertions(): void {
  const catalog = readFileSync(`${dir}/catalog.html`, "utf8");
  const music = parseCatalog(catalog, FIXTURE_URLS["catalog.html"]);
  assert.ok(music.length >= 200, `expected >= 200 music listings, got ${music.length}`);
  const seenKeys = new Set<string>();
  // Most /events/ rows are quote-only too (same "לקבלת הצעת מחיר" button as /matches/ -
  // confirmed against the fixture: only 25 of 268 rows carry a priced /package/ or /show/
  // link). So price_from/currency are only asserted on the rows that DO have a link; every
  // row still needs a real title/date/key, and there must be a healthy number of priced
  // listings or the price-link selector itself has regressed.
  let priced = 0;
  for (const l of music) {
    assert.ok(l.title, "title");
    assert.ok(l.external_key, "external_key");
    assert.ok(!seenKeys.has(l.external_key), `duplicate external_key ${l.external_key}`);
    seenKeys.add(l.external_key);
    assert.match(l.event_date ?? "", /^\d{4}-\d{2}-\d{2}$/, `date ${l.event_date}`);
    assert.match(l.url, /^https:\/\//, `url ${l.url}`);
    if (l.currency != null || l.price_from != null) {
      assert.ok((l.price_from ?? 0) > 0, `price_from ${l.title}`);
      assert.ok(l.currency === "EUR" || l.currency === "GBP" || l.currency === "ILS", `currency ${l.currency} for ${l.title}`);
      priced += 1;
    }
  }
  assert.ok(priced >= 10, `expected >= 10 priced music listings, got ${priced}`);

  const catalogSports = readFileSync(`${dir}/catalog-sports.html`, "utf8");
  const sports = parseCatalog(catalogSports, FIXTURE_URLS["catalog-sports.html"]);
  assert.ok(sports.length >= 200, `expected >= 200 sports listings, got ${sports.length}`);
  const seenSportsKeys = new Set<string>();
  for (const l of sports) {
    assert.ok(l.title, "title");
    assert.ok(l.external_key, "external_key");
    assert.ok(
      !seenSportsKeys.has(l.external_key),
      `duplicate external_key within sports: ${l.external_key} (title "${l.title}")`,
    );
    seenSportsKeys.add(l.external_key);
    assert.match(l.event_date ?? "", /^\d{4}-\d{2}-\d{2}$/, `date ${l.event_date}`);
    assert.equal(l.price_from, null, `sports price_from should be null for ${l.title}`);
    assert.equal(l.currency, null, `sports currency should be null for ${l.title}`);
  }

  // Combined uniqueness: music and sports share the "game/<slug>#<date>" scheme for
  // quote-only rows (the ~92% of /events/ that have no priced link reuse the sports
  // fallback key, per liveevents.ts), so a collision could in principle span both sets
  // even though each set is individually unique above.
  const combinedKeys = new Map<string, string>();
  for (const l of [...music, ...sports]) {
    const prior = combinedKeys.get(l.external_key);
    assert.ok(
      !prior,
      `duplicate external_key across combined music+sports: ${l.external_key} (first "${prior}", second "${l.title}")`,
    );
    combinedKeys.set(l.external_key, l.title);
  }

  const detailHtml = readFileSync(`${dir}/detail.html`, "utf8");
  const detail = parseDetail(detailHtml);
  assert.ok(detail.attrs, "detail attrs");
  assert.equal(detail.attrs?.hotel_stars, 4, `hotel_stars ${detail.attrs?.hotel_stars}`);
  assert.equal(detail.attrs?.breakfast, true, `breakfast ${detail.attrs?.breakfast}`);
  assert.equal(detail.attrs?.bag_included, false, `bag_included ${detail.attrs?.bag_included}`);
  assert.equal(detail.attrs?.nights, 3, `nights ${detail.attrs?.nights}`);
  assert.equal(detail.travel_depart, "2026-11-19", `travel_depart ${detail.travel_depart}`);
  assert.equal(detail.travel_return, "2026-11-22", `travel_return ${detail.travel_return}`);
  assert.ok((detail.detail_text ?? "").length > 200, "detail_text");
  assert.ok((detail.detail_text ?? "").length <= 2000, "detail_text <= 2000 chars");

  // `/show/<slug>/` is a tier-list page (no per-person price marker) - parseDetail must
  // short-circuit to `{}` rather than half-fill attrs from unrelated page text.
  const showHtml = readFileSync(`${dir}/show.html`, "utf8");
  const showDetail = parseDetail(showHtml);
  assert.deepEqual(showDetail, {}, `expected parseDetail(show.html) to be {}, got ${JSON.stringify(showDetail)}`);

  // parseHeDate must reject calendar-invalid dates (round-trip check) rather than silently
  // rolling over to March.
  assert.equal(parseHeDate("31.02.2026"), null, "31.02.2026 is not a real date");

  console.log(`${site}: ${music.length} music listings, ${sports.length} sports listings parsed, detail ok`);
  console.log("sample music listing:", music[0]);
  console.log("sample sports listing:", sports[0]);
  console.log("detail:", detail);
  console.log("show detail (expect {}):", showDetail);
}

async function main(): Promise<void> {
  if (save) {
    await saveFixtures();
  } else {
    runAssertions();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

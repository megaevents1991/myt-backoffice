// ISSTA Sport package crawler. Selectors + URLs from docs/superpowers/scrapers/phase2-recon.md.
// Server-rendered league pages with schema.org/Product microdata - plain fetch, no browser.
// The card publishes the TRAVEL WINDOW only (no match date): event_date is null and the
// matcher pairs it by `travel_depart <= event.date <= travel_return` (price-light.ts
// candidateCoversDate). Detail pages are a JS loader -> skipped in v1 (attrs unknown except
// nights, which the window gives us).
import { UNKNOWN_ATTRS } from "../../../types/price-light.types.ts";
import type { Currency } from "../../../types/price-light.types.ts";
import { currencyFromSymbol, doc, isoOrNull, nightsBetween, parsePrice, stealthHeaders } from "./shared.ts";
import type { CompetitorScraper, CrawlContext, Listing } from "./types";

const BASE = "https://www.issta.co.il";
// `uefa-europa-league` was dropped 2026-09-15: the URL answers 404 and only ever counted as a failed page.
const LEAGUES = ["spanish-league", "premier-league", "italian", "german-league", "champions-league", "superclasico", "french-league"];
export const LEAGUE_URLS = LEAGUES.map((l) => `${BASE}/sportcategory/soccer/${l}`);

/** "23/10/2026" -> "2026-10-23" (the loader link's fdate; DD/MM/YYYY only). */
function parseFdate(text: string): string | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? isoOrNull(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** "27/10" with the outbound year; rolls into the next year when the return month is earlier. */
function parseReturn(text: string, depart: string): string | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const departMonth = Number(depart.slice(5, 7));
  let year = Number(depart.slice(0, 4));
  if (Number(m[2]) < departMonth) year += 1;
  const iso = isoOrNull(year, Number(m[2]), Number(m[1]));
  return iso && iso >= depart ? iso : null;
}

function attr(el: Element | null, name: string): string {
  return el?.getAttribute(name)?.trim() ?? "";
}

/** One Listing per Product card. Cards without a pid or a usable window are dropped. */
export function parseCatalog(html: string): Listing[] {
  const d = doc(html);
  const out: Listing[] = [];
  for (const card of Array.from(d.querySelectorAll('div.deal-item-container[itemscope]'))) {
    const link = card.querySelector('a[itemprop="url"]');
    let href = attr(link, "href");
    try { href = decodeURIComponent(href); } catch { /* keep raw */ }
    const pid = href.match(/[?&]pid=(\d+)/)?.[1];
    if (!pid) continue;
    const dport = href.match(/[?&]dport=([A-Za-z]{3})/)?.[1]?.toUpperCase() ?? null;
    const depart = parseFdate(href.match(/[?&]fdate=([^&]+)/)?.[1] ?? "");
    if (!depart) continue;
    // .directions-to holds 3 sibling spans (label / weekday name / "DD/MM"); the first-child
    // selector from the recon only grabs the "חזור: " label with no digits. Read the whole
    // div's text instead - the regex in parseReturn finds the date wherever it sits.
    const ret = parseReturn(card.querySelector(".directions-to")?.textContent ?? "", depart);
    if (!ret) continue;

    const nameEl = card.querySelector('[itemprop="name"]');
    const title = (nameEl?.textContent?.trim() || attr(nameEl, "content")).replace(/\s+/g, " ");
    if (!title) continue;
    const description = (card.querySelector('[itemprop="description"]')?.textContent ?? "").replace(/\s+/g, " ").trim();

    const priceEl = card.querySelector('[itemprop="price"]');
    const price_from = parsePrice(attr(priceEl, "content") || (priceEl?.textContent ?? ""));
    const currency: Currency | null = currencyFromSymbol(attr(card.querySelector('[itemprop="priceCurrency"]'), "content") || "€");

    out.push({
      competitor: "issta",
      external_key: `pid=${pid}`,
      scope: "package",
      title,
      title_he: title,
      event_date: null,
      city: dport,
      venue: null,
      price_from,
      currency: price_from == null ? null : currency,
      price_usd: null, // crawl() fills via toUsd (dynamic import - see the file banner)
      travel_depart: depart,
      travel_return: ret,
      attrs: { ...UNKNOWN_ATTRS, nights: nightsBetween(depart, ret) },
      detail_text: description ? `${title}. ${description}` : title,
      url: href.startsWith("http") ? href : `${BASE}${href.startsWith("/") ? "" : "/"}${href}`,
    });
  }
  return out;
}

/**
 * LEAGUES is seven SOCCER competitions, all under /sportcategory/soccer/ - the crawler never
 * opens ISSTA's basketball, tennis or motorsport sections. So for a non-football event the
 * absence of a candidate proves nothing, and this returns false: the matcher then records
 * `skipped` instead of `not_selling`, which keeps the scope at `partial_coverage` rather than
 * claiming "alone" off a catalog we never crawled (final review, I1). Football is decided by
 * the vertical tag the auto-tagger implies from any league/team tag (lib/services/auto-tagger.ts).
 */
export function coversEvent(event: { tagSlugs: string[] }): boolean {
  return event.tagSlugs.includes("football");
}

export const issta: CompetitorScraper = {
  key: "issta",
  scopes: ["package"],
  kinds: ["sports"],
  // 72h - see the note on golasso.ts: one site per hourly tick, each site every ~3 days.
  intervalHours: 72,
  mode: "fetch",
  // Vercel's IP gets card-less pages (see the field's doc in types.ts); an Israeli machine runs
  // scripts/crawl-local.ts every ~3 days instead, and Vercel only reads the run it leaves behind.
  crawlFrom: "local",
  covers: coversEvent,
  async *crawl(ctx: CrawlContext): AsyncGenerator<Listing> {
    const { toUsd } = await import("./livetickets-api.ts");
    const seen = new Set<string>();
    let failures = 0;
    let emptyPages = 0;
    let lastError = "";
    for (let i = 0; i < LEAGUE_URLS.length; i++) {
      const url = LEAGUE_URLS[i];
      let html: string;
      try {
        const res = await ctx.fetch(url, { headers: stealthHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      } catch (err) {
        // One bad league page is survivable - but if EVERY page failed the run is blocked,
        // not an empty catalog, and must throw so runCrawl classifies it (final review, M3).
        // Otherwise the run records `ok` with 0 listings and `hadGoodCrawl` then reports
        // `not_selling` for every sports event off a catalog that was never read.
        failures += 1;
        lastError = (err as Error).message;
        ctx.log(`issta: ${url} -> ${lastError}`);
        await ctx.pauseShort();
        continue;
      }
      const listings = parseCatalog(html);
      const cardsInHtml = (html.match(/deal-item-container/g) ?? []).length;
      ctx.log(`issta: ${url} -> ${listings.length} listings (${html.length} chars, ${cardsInHtml} cards in html)`);
      // A single empty page is normal - three of the leagues genuinely had no packages on
      // 2026-09-15. What is NOT normal is every page coming back empty, which is what Vercel's IP
      // saw while an Israeli connection got cards from four of them. Cards left in the HTML mean
      // the selector changed instead; say which, so the run note answers it without a re-run.
      if (listings.length === 0) {
        emptyPages += 1;
        ctx.log(`issta: no listings on ${url} - ${cardsInHtml > 0 ? "cards ARE in the HTML, selectors changed" : "no cards in the HTML (empty category, or the page was served without them)"}`);
      }
      for (const l of listings) {
        if (seen.has(l.external_key)) continue; // the same package sits on several league pages
        seen.add(l.external_key);
        yield {
          ...l,
          price_usd: l.price_from == null || l.currency == null ? null : Math.round(toUsd(l.price_from, l.currency)),
        };
      }
      if (i < LEAGUE_URLS.length - 1) await ctx.pauseShort();
    }
    if (failures === LEAGUE_URLS.length) throw new Error(`issta: all ${failures} league pages failed (last: ${lastError})`);
    // Every page answered and not one card came back anywhere - that is a failure with a reason,
    // not an empty catalog (the leagues are never all empty at once; four of them served
    // cards to an Israeli connection the same hour Vercel's IP got none). Thrown so runCrawl
    // records it with this note and the circuit counts it.
    if (seen.size === 0 && emptyPages > 0) {
      throw new Error(`issta: all ${emptyPages} answering league pages carried no cards - the site likely served this IP a card-less page`);
    }
  },
};

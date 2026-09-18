// ISSTA Sport package crawler. Selectors + URLs from docs/superpowers/scrapers/phase2-recon.md.
// Server-rendered league pages with schema.org/Product microdata - plain fetch, no browser.
// The card publishes the TRAVEL WINDOW only (no match date): event_date is null and the
// matcher pairs it by `travel_depart <= event.date <= travel_return` (price-light.ts
// candidateCoversDate). The card links to a `/loader?url=` page; the page it opens
// (`/sport/details?...`) is server-rendered and is what detail() reads (2026-09-18).
import { UNKNOWN_ATTRS } from "../../../types/price-light.types.ts";
import type { Currency } from "../../../types/price-light.types.ts";
import { currencyFromSymbol, doc, isoOrNull, nightsBetween, parsePrice, stealthHeaders } from "./shared.ts";
import type { CompetitorScraper, CrawlContext, DetailInput, Listing } from "./types";

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
      // Both null on purpose (2026-09-18). The card used to store its marketing tagline as
      // `detail_text` and window-only `attrs`: the tagline made every listing read as "detail
      // page already opened" (so none was ever queued), and the card's attrs overwrote whatever a
      // detail page had taught on every crawl. Nights still reach the light - `listingNights()`
      // derives them from the stored travel window when attrs are absent.
      attrs: null,
      detail_text: null,
      url: href.startsWith("http") ? href : `${BASE}${href.startsWith("/") ? "" : "/"}${href}`,
    });
  }
  return out;
}

const flat = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** "כלול" / "לא כלול" / "לא ידוע" after the suitcase label - null when the page never says. */
function bagIncluded(text: string): boolean | null {
  const m = text.match(/מזוודה\s*:?\s*(לא\s*כלול[הא]?|ללא|כלול[הא]?|כולל)/);
  if (!m) return null;
  return !/^(לא|ללא)/.test(m[1]);
}

/**
 * The real package page behind the `/loader?url=` link (2026-09-18: it is server-rendered and
 * answers a plain GET from an Israeli address - v1 skipped it as "a JS loader"). What the price
 * buys is the PRE-SELECTED choice in each block: the flight strip, the `selected` hotel and the
 * seat category at "תוספת €0". The stored `detail_text` is a compact summary written here, not the
 * page's text - the page is ~14k characters of site navigation around these three blocks, and the
 * star rating is icons, not words. `offer-detail.ts` `parseIssta` reads this exact wording back.
 */
export function parseDetail(html: string, window: { depart: string | null; ret: string | null }): Partial<Listing> {
  const d = doc(html);
  const legs = Array.from(d.querySelectorAll(".flight-direction")).map((dir) => ({
    label: flat(dir.querySelector(".flight-direction-title")),
    airline: flat(dir.querySelector(".airline-name")),
    depart: flat(dir.querySelector(".flight-from .time")),
    arrive: flat(dir.querySelector(".flight-to .time")),
    // Empty on a direct leg; a connection prints its stop here.
    stops: flat(dir.querySelector(".flight-timeline .second-row")),
  })).filter((l) => /^\d{1,2}:\d{2}$/.test(l.depart) && /^\d{1,2}:\d{2}$/.test(l.arrive));
  const hotelEl = d.querySelector(".hotel-data-container.selected") ?? d.querySelector(".hotel-data-container");
  const hotelName = hotelEl?.getAttribute("hotel-name")?.trim() || flat(hotelEl?.querySelector(".hotel-card-name"));
  if (legs.length === 0 && !hotelName) return {};

  const stars = hotelEl?.querySelectorAll(".hotel-card-stars i").length ?? 0;
  const facilities = Array.from(hotelEl?.querySelectorAll(".hotel-card-facility-name") ?? []).map((f) => flat(f));
  // A facility list that names breakfast says it is included; one that does not says nothing.
  const breakfast = facilities.some((f) => /ארוחת\s*בוקר/.test(f));
  const bagText = flat(d.querySelector(".flight-baggage-food-terms-info-container"));
  const bag = bagIncluded(bagText);
  const direct = legs.length > 0 ? legs.every((l) => l.stops === "") : null;

  const categories = Array.from(d.querySelectorAll(".category-option")).map((c) => ({
    title: flat(c.querySelector(".category-title")),
    description: flat(c.querySelector(".category-description")),
    extra: parsePrice(flat(c.querySelector(".price-value")).replace(/[^\d,]/g, "") || "0") ?? 0,
  })).filter((c) => c.title);
  const seat = categories.find((c) => c.extra === 0) ?? categories[0] ?? null;

  const flightLine = legs.length > 0
    ? [
        ...legs.map((l) => `${l.label} ${l.airline} ${l.depart}-${l.arrive}`),
        direct ? "ישירה" : "עם עצירה",
        bag == null ? null : bag ? "מזוודה: כלולה" : "מזוודה: לא כלולה",
      ].filter(Boolean).join(" · ")
    : null;
  const hotelLine = hotelName
    ? [hotelName, stars >= 1 && stars <= 5 ? `${stars} כוכבים` : null, breakfast ? "ארוחת בוקר" : null].filter(Boolean).join(" · ")
    : null;
  const seatLine = seat ? [seat.title, seat.description].filter(Boolean).join(" · ") : null;

  return {
    attrs: {
      ...UNKNOWN_ATTRS,
      nights: nightsBetween(window.depart, window.ret),
      hotel_stars: stars >= 1 && stars <= 5 ? stars : "unknown",
      direct_flight: direct ?? "unknown",
      bag_included: bag ?? "unknown",
      breakfast: breakfast ? true : "unknown",
    },
    detail_text: [
      flightLine ? `טיסה: ${flightLine}` : null,
      hotelLine ? `מלון: ${hotelLine}` : null,
      seatLine ? `כרטיס: ${seatLine}` : null,
    ].filter(Boolean).join(" | "),
  };
}

/** `/loader?url=/sport/details?...` -> the page the loader opens. */
export function detailUrl(listingUrl: string): string | null {
  const at = listingUrl.indexOf("/loader?url=");
  if (at < 0) return /\/sport\/details\?/.test(listingUrl) ? listingUrl : null;
  const path = listingUrl.slice(at + "/loader?url=".length);
  return path.startsWith("/sport/details?") ? `${BASE}${path}` : null;
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
  // Weekly (168h) - see the note on golasso.ts: one site per tick, each site once a week.
  intervalHours: 168,
  mode: "fetch",
  // Vercel's IP gets card-less pages (see the field's doc in types.ts); an Israeli machine runs
  // scripts/crawl-local.ts once a week instead, and Vercel only reads the run it leaves behind.
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
  // Runs wherever crawl() runs - the local machine (`crawlFrom`), so the same Israeli address.
  async detail(listing: DetailInput, ctx: CrawlContext): Promise<Partial<Listing>> {
    const url = listing.scope === "package" ? detailUrl(listing.url) : null;
    if (!url) return {};
    try {
      const res = await ctx.fetch(url, { headers: stealthHeaders() });
      if (!res.ok) {
        ctx.log(`issta: detail ${url} -> HTTP ${res.status}`);
        return {};
      }
      return parseDetail(await res.text(), { depart: listing.travel_depart, ret: listing.travel_return });
    } catch (err) {
      ctx.log(`issta: detail ${url} -> ${(err as Error).message}`);
      return {};
    }
  },
};

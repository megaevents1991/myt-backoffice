// OnTour (ISSTA's music arm, ontour.co.il) package crawler. Selectors from
// docs/superpowers/scrapers/phase2-recon.md. WordPress, server-rendered - plain fetch.
// Crawl = /artists/ (which performers currently sell) + one GET per selling performer.
// Everything (flights / hotel / tickets) sits on the performer page, so there is no detail().
// The card gives a TRAVEL WINDOW; the concert date is only taken when the ticket block
// prints one inside that window - otherwise event_date is null and the matcher uses the window.
import { UNKNOWN_ATTRS } from "../../../types/price-light.types.ts";
import type { ExtractedAttrs } from "../../../types/price-light.types.ts";
import { absoluteUrl, currencyFromSymbol, doc, flatText, nightsBetween, parseHeDate, parsePrice, stealthHeaders } from "./shared.ts";
import type { CompetitorScraper, CrawlContext, Listing } from "./types";

const BASE = "https://ontour.co.il";
export const ARTISTS_URL = `${BASE}/artists/`;
const SELLING_MARKER = "חבילות זמינות";
const MAX_PERFORMERS = 10; // recon: 3 selling at the time; 10 GETs + short pauses still fit the 240s budget

/** Performer URLs whose card on /artists/ says "חבילות זמינות" (walks up to 4 ancestors from the link). */
export function parseArtists(html: string, pageUrl: string): string[] {
  const d = doc(html);
  const urls: string[] = [];
  for (const a of Array.from(d.querySelectorAll('a[href*="/performer/"]'))) {
    const href = a.getAttribute("href") ?? "";
    if (!/\/performer\/[^/]+\/?$/.test(href)) continue;
    let el: Element | null = a;
    let sells = false;
    for (let i = 0; el && i < 5; i++) {
      if ((el.textContent ?? "").includes(SELLING_MARKER)) { sells = true; break; }
      el = el.parentElement;
    }
    if (!sells) continue;
    const url = absoluteUrl(href.endsWith("/") ? href : `${href}/`, pageUrl);
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** Hebrew markers on the performer page's flight / hotel / ticket blocks. */
export function attrsFromText(flat: string): Partial<ExtractedAttrs> {
  const a: Partial<ExtractedAttrs> = { ...UNKNOWN_ATTRS };
  if (/קונקשן|עצירת\s*ביניים|חניית\s*ביניים|טיסת\s*המשך/.test(flat)) a.direct_flight = false;
  else if (/טיסות?\s*ישיר/.test(flat)) a.direct_flight = true;
  if (/מזוודה|כבודה\s*רשומה|כבודת\s*בטן/.test(flat)) a.bag_included = true;
  else if (/תיק\s*גב|טרולי|כבודת\s*יד/.test(flat)) a.bag_included = false;
  const stars = flat.match(/(\d)\s*כוכבים/);
  if (stars) a.hotel_stars = Number(stars[1]);
  if (/לינה\s*בלבד|ללא\s*ארוחת\s*בוקר/.test(flat)) a.breakfast = false;
  else if (/ארוחת\s*בוקר/.test(flat)) a.breakfast = true;
  if (/ללא\s*העברות|לא\s*כולל\s*העברות|העברות\s*אינן\s*כלולות/.test(flat)) a.transfers = false;
  else if (/העברות/.test(flat)) a.transfers = true;
  return a;
}

/**
 * The expanded flight/hotel/ticket blocks are NOT siblings of `div.event-details` (the recon's
 * assumption) - they live nested inside a `div.event-details-expanded` sibling, one level down,
 * as `#flights<id>` / `#hotel<id>` / `#tickets<id>` (see the "Addendum" in phase2-recon.md). A
 * WordPress/Elementor quirk also nests a second, mostly-empty placeholder with a *different*
 * numeric id inside the real one (e.g. `#flights6196` inside `#flights9060`) - harmless here,
 * `querySelectorAll` picks up both and the extra text is empty or a duplicate substring, never
 * wrong content, so no de-duplication is needed for marker matching.
 */
function blockText(expanded: Element | null, prefix: "flights" | "hotel" | "tickets"): string {
  if (!expanded) return "";
  return Array.from(expanded.querySelectorAll(`[id^="${prefix}"]`))
    .map((el) => flatText(el))
    .join(" ");
}

export function parsePerformer(html: string, pageUrl: string): Listing[] {
  const d = doc(html);
  const slug = pageUrl.match(/\/performer\/([^/]+)\/?/)?.[1] ?? "unknown";
  const out: Listing[] = [];
  // Card = `div.event-card` (a `card_<id>` class carries the numeric id used by the expanded
  // block's #flights<id>/#hotel<id>/#tickets<id>). It has three children: `.event-image`
  // (title lives in its nested `.event-name h2`, NOT inside `.event-details`), `.event-details`
  // (dates/price/venue summary) and `.event-details-expanded` (flights/hotel/tickets content) -
  // see the "Addendum" in phase2-recon.md for what the recon got wrong here.
  for (const card of Array.from(d.querySelectorAll("div.event-card"))) {
    const details = card.querySelector(".event-details");
    if (!details) continue;

    const heading = (card.querySelector(".event-name h2")?.textContent ?? "").replace(/\s+/g, " ").trim();
    const [rawTitle, rawCity] = heading.split("|").map((s) => s.trim());
    const title = rawTitle || heading;
    if (!title) continue;

    const dates = Array.from(details.querySelectorAll(".flight-dates strong")).map((el) => parseHeDate(el.textContent ?? ""));
    const depart = dates[0] ?? null;
    const ret = dates[1] ?? null;
    if (!depart || !ret || ret <= depart) continue;

    const priceText = details.querySelector("p.hide-mobile strong")?.textContent ?? "";
    const price_from = parsePrice(priceText);
    const currency = price_from == null ? null : (currencyFromSymbol(priceText) ?? "EUR");

    const expanded = card.querySelector(".event-details-expanded");
    const flights = blockText(expanded, "flights");
    const hotel = blockText(expanded, "hotel");
    const tickets = blockText(expanded, "tickets");
    const cardText = flatText(details);
    const flat = `${cardText} ${flights} ${hotel} ${tickets}`.replace(/\s+/g, " ").trim();

    // Concert date: only a date printed in the ticket block, and only if it sits inside the window.
    let event_date: string | null = null;
    for (const m of tickets.matchAll(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/g)) {
      const iso = parseHeDate(m[0]);
      if (iso && iso >= depart && iso <= ret) { event_date = iso; break; }
    }

    out.push({
      competitor: "ontour",
      external_key: `${slug}#${depart}`,
      scope: "package",
      title,
      title_he: null,
      event_date,
      city: rawCity || null,
      venue: details.querySelector(".event-location small")?.textContent?.replace(/\s+/g, " ").trim() || null,
      price_from,
      currency,
      price_usd: null, // crawl() fills via toUsd
      travel_depart: depart,
      travel_return: ret,
      attrs: { ...attrsFromText(flat), nights: nightsBetween(depart, ret) },
      detail_text: flat.slice(0, 2000),
      url: pageUrl,
    });
  }
  return out;
}

export const ontour: CompetitorScraper = {
  key: "ontour",
  scopes: ["package"],
  kinds: ["music"],
  intervalHours: 48,
  mode: "fetch",
  async *crawl(ctx: CrawlContext): AsyncGenerator<Listing> {
    const { toUsd } = await import("./livetickets-api.ts");
    let performers: string[];
    try {
      const res = await ctx.fetch(ARTISTS_URL, { headers: stealthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      performers = parseArtists(await res.text(), ARTISTS_URL);
    } catch (err) {
      throw new Error(`ontour: ${ARTISTS_URL} -> ${(err as Error).message}`); // no index page = failed run
    }
    ctx.log(`ontour: ${performers.length} selling performers`);
    if (performers.length === 0) ctx.log("ontour: ZERO selling performers - marker or selectors may have changed");
    const seen = new Set<string>();
    for (const url of performers.slice(0, MAX_PERFORMERS)) {
      await ctx.pauseShort();
      let html: string;
      try {
        const res = await ctx.fetch(url, { headers: stealthHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      } catch (err) {
        ctx.log(`ontour: ${url} -> ${(err as Error).message}`);
        continue;
      }
      const listings = parsePerformer(html, url);
      ctx.log(`ontour: ${url} -> ${listings.length} listings`);
      for (const l of listings) {
        if (seen.has(l.external_key)) continue;
        seen.add(l.external_key);
        yield {
          ...l,
          price_usd: l.price_from == null || l.currency == null ? null : Math.round(toUsd(l.price_from, l.currency)),
        };
      }
    }
  },
};

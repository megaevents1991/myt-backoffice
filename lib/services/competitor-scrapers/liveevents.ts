// LiveEvents package crawler. Selectors + URLs from docs/superpowers/scrapers/liveevents.md.
// Pure parsers (parseCatalog/parseDetail) are tested on scripts/fixtures/liveevents/*.html.
//
// mode: "browser" - the controller's initial ruling was "fetch" (the recon doc reads as
// fully server-rendered, no bot wall), and /matches/ + /package/ detail pages really are;
// but /events/ hydrates its rows via a client-side WP AJAX call, so a plain fetch there
// only returns the empty containers (see the "Addendum" section the recon doc gained while
// building this). `fetchCatalogHtml()` below is the only place that actually drives
// `ctx.page` (Playwright, for /events/ only) vs `ctx.fetch` (for /matches/ and detail).
//
// This crawler also reuses the Israeli UA rotation, which now comes via ./shared.ts (which
// reads it from lib/services/ua.ts - a dependency-free module) so a plain `node script.ts`
// invocation of the pure parsers below never needs to resolve a "@/..." alias, nor pull
// playwright/chromium in through browser.ts. For the same reason `toUsd` (Task 5,
// lib/services/competitor-scrapers/livetickets-api.ts) - which transitively imports
// "@/lib/supabase-server" - is loaded via a *dynamic* import only inside crawl()/detail(),
// never at module top level: that keeps `parseCatalog`/`parseDetail` themselves free of any
// unresolvable specifier so the fixture script (which imports only those two functions) can
// run under plain node.
import type { Currency, ExtractedAttrs } from "@/types/price-light.types";
import { DETAIL_TEXT_MAX, bagExcluded, currencyFromSymbol, doc, parseHeDate, parsePrice, stealthHeaders } from "./shared.ts";
export { parseHeDate, parsePrice, stealthHeaders } from "./shared.ts";
import type { CompetitorScraper, CrawlContext, DetailInput, Listing } from "./types";

const BASE = "https://livevents.co.il"; // one "e" - liveevents.co.il does not resolve (recon)
// From the recon doc "Catalog pages".
const CATALOG_URLS: { url: string; kind: "sports" | "music" }[] = [
  { url: `${BASE}/events/`, kind: "music" },
  { url: `${BASE}/matches/`, kind: "sports" },
];

/** Walks up the tree - linkedom's `closest()` is present, but this avoids depending on it. */
function insideSlider(el: Element): boolean {
  let p: Element | null = el;
  while (p) {
    if (p.classList?.contains("slider-long")) return true;
    p = p.parentElement;
  }
  return false;
}

/** "טוטנהאם | אברטון" -> "טוטנהאם-vs-אברטון" (recon: `game/<slug>` external_key for sports). */
function slugifyHeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s*\|\s*/g, "-vs-").replace(/\s+/g, "-");
}

/**
 * One Listing PER DATE in a `div.line` row (a tour row with N dates yields N listings
 * sharing title/city/price/url). `.slider-long` (featured duplicates) is skipped.
 * Music rows link to a priced `/package/<slug>-<tier>/` or `/show/<slug>/` page; sports
 * rows have a quote-only button (no href, no price) - see docs/superpowers/scrapers/liveevents.md.
 */
export function parseCatalog(html: string, baseUrl: string): Listing[] {
  const d = doc(html);
  const origin = new URL(baseUrl).origin;
  const out: Listing[] = [];
  const rows = Array.from(d.querySelectorAll("div.line")).filter((el) => !insideSlider(el));

  for (const row of rows) {
    const title = row.querySelector(".td.artist")?.textContent?.trim() ?? "";
    if (!title) continue;

    const dateSpans = Array.from(row.querySelectorAll(".td.date span.d"));
    const dates: string[] = [];
    for (const span of dateSpans) {
      // Strip the nested "מועד לא סופי" (date not final) marker before parsing.
      const text = Array.from(span.childNodes)
        .filter((n) => n.nodeType === 3 /* TEXT_NODE */)
        .map((n) => n.textContent ?? "")
        .join(" ");
      const iso = parseHeDate(text || (span.textContent ?? ""));
      if (iso) dates.push(iso);
    }
    if (dates.length === 0) continue;

    const city = row.querySelector(".td.place")?.textContent?.trim() || null;
    const statusText = row.querySelector(".td.status")?.textContent?.trim() || "";
    const linkA = row.querySelector(".td.link-rap a.button[href]");

    let priceFrom: number | null = null;
    let currency: Currency | null = null;
    let url: string;
    let keyBase: string;

    if (linkA) {
      const href = linkA.getAttribute("href") ?? "";
      url = href.startsWith("http") ? href : `${origin}${href.startsWith("/") ? "" : "/"}${href}`;
      priceFrom = parsePrice(linkA.querySelector("span.p")?.textContent ?? "");
      currency = currencyFromSymbol(linkA.querySelector("span.c")?.textContent ?? "");
      keyBase = url.replace(/^https?:\/\/[^/]+/, "").replace(/^\/+|\/+$/g, "");
    } else {
      // Sports: no href, no price - "לקבלת הצעת מחיר" (quote only).
      url = baseUrl;
      keyBase = `game/${slugifyHeTitle(title)}`;
    }

    for (const isoDate of dates) {
      out.push({
        competitor: "liveevents",
        external_key: `${keyBase}#${isoDate}`,
        scope: "package",
        title,
        title_he: title,
        event_date: isoDate,
        city,
        venue: null,
        price_from: priceFrom,
        currency,
        // Filled by crawl() via a dynamically-imported toUsd - see the file banner for why
        // this pure parser never imports it directly.
        price_usd: null,
        travel_depart: null,
        travel_return: null,
        attrs: null,
        detail_text: statusText || null,
        url,
      });
    }
  }
  return out;
}

const PRICE_LINE_RE = /החל\s*מ-?\s*([\d,]{3,6})\s*([€£₪])/;
// Noise to drop before reading text: script/style/noscript (textContent includes their raw
// source), the header's live-search dropdown (a full artist/city index sits in the DOM,
// hidden), and leftover form controls (their content lives in the surrounding static text).
const NOISE_SELECTOR = "script, style, noscript, .search-list, input, select, option, label";

/**
 * `/package/<slug>-<tier>/` pages only - `/show/<slug>/` tier-list pages have no flight/
 * hotel/price detail and return `{}` (detected here by the absence of the per-person price
 * marker, so this needs no URL to decide - see docs/superpowers/scrapers/liveevents.md).
 *
 * Text comes from `div.site.single-package` (the page's real content wrapper) rather than
 * `<body>` - the theme also stamps a `single-package` class onto `<body>` itself, so a bare
 * `.single-package` selector matches body first and pulls in the whole page (nav, footer,
 * inline scripts/styles as literal text).
 */
export function parseDetail(html: string): Partial<Listing> {
  const d = doc(html);
  const container = d.querySelector("div.site.single-package") ?? d.body;
  const clone = container?.cloneNode(true) as Element | null;
  clone?.querySelectorAll(NOISE_SELECTOR).forEach((n) => n.remove());
  const flat = (clone?.textContent ?? "").replace(/\s+/g, " ").trim();

  const isPackagePage = /מחיר\s*לאדם\s*בחדר\s*זוגי/.test(flat);
  if (!isPackagePage) return {};

  const priceMatch = flat.match(PRICE_LINE_RE);
  const price_from = priceMatch ? parsePrice(priceMatch[1]) : null;
  const currency = priceMatch ? currencyFromSymbol(priceMatch[2]) : null;

  // Labeled outbound/return lines ("תאריך יציאה: 19.11.2026" / "תאריך חזרה: 22.11.2026") -
  // scanning the whole flattened body for ANY date-shaped substring picks up unrelated
  // dates elsewhere on the page (nav, footer, policy text), so anchor on the label.
  const departMatch = flat.match(/תאריך\s*יציאה[:\s]*?(\d{1,2}[./]\d{1,2}[./]\d{2,4})/);
  const returnMatch = flat.match(/תאריך\s*חזרה[:\s]*?(\d{1,2}[./]\d{1,2}[./]\d{2,4})/);
  const travel_depart = departMatch ? parseHeDate(departMatch[1]) : null;
  const travel_return = returnMatch ? parseHeDate(returnMatch[1]) : null;
  let nights: number | "unknown" = "unknown";
  if (travel_depart && travel_return) {
    const d1 = new Date(`${travel_depart}T00:00:00Z`).getTime();
    const d2 = new Date(`${travel_return}T00:00:00Z`).getTime();
    const diff = Math.round((d2 - d1) / 86_400_000);
    if (Number.isFinite(diff) && diff > 0) nights = diff;
  }

  const starsMatch = flat.match(/מלון\s*ברמת\s*(\d)\s*כוכב/);
  // Package pages don't say "ישירה" outright (that marker is on /show/ pages per the recon
  // doc) - a single timed leg each way, with no connection wording, implies direct.
  const directFlight = /קונקשן|עצירה|חניית ביניים/.test(flat)
    ? false
    : travel_depart && travel_return
      ? true
      : "unknown";
  const bagIncluded = bagExcluded(flat) || /כבודת\s*יד/.test(flat) ? false : /מזוודה|כבודה/.test(flat) ? true : "unknown";
  const breakfast = /ארוחת\s*בוקר/.test(flat) ? !/ללא\s*ארוחת\s*בוקר|לא\s*כולל\s*ארוחת\s*בוקר/.test(flat) : "unknown";
  // "Not included" list mentions transfers by name somewhere after the "אינו כולל" (does
  // not include) header, or an explicit "לא כלול"/"ללא" right next to the word itself.
  const notIncludedIdx = flat.search(/אינו\s*כולל/);
  const transferMentionedInExclusion = notIncludedIdx >= 0 && /העברות/.test(flat.slice(notIncludedIdx, notIncludedIdx + 600));
  const transferExplicitlyExcluded = /העברות[^.]{0,40}(לא\s*כלול|ללא)|(?:לא\s*כלול|ללא)[^.]{0,40}העברות/.test(flat);
  const transfers = transferMentionedInExclusion || transferExplicitlyExcluded ? false : "unknown";

  const attrs: Partial<ExtractedAttrs> = {
    hotel_stars: starsMatch ? Number(starsMatch[1]) : "unknown",
    nights,
    direct_flight: directFlight,
    bag_included: bagIncluded,
    breakfast,
    transfers,
  };

  const partial: Partial<Listing> = {
    attrs,
    detail_text: flat.slice(0, DETAIL_TEXT_MAX),
    travel_depart,
    travel_return,
  };
  if (price_from != null) partial.price_from = price_from;
  if (currency != null) partial.currency = currency;
  return partial;
}

/** Only music listings whose url is a priced `/package/` (never `/show/` - no href on the
 * board leads there directly, but detail() is defensive) point at real detail content. */
function hasDetailPage(url: string): boolean {
  return /\/(package|show)\//.test(url);
}

/**
 * The `/matches/` (sports) board is fully server-rendered (confirmed against the fixture),
 * but `/events/` (music) renders its `div.line` rows via a client-side WP AJAX call into
 * initially-empty `.accord-crap` containers - a plain `ctx.fetch` gets the empty shell.
 * That contradicts the recon doc's "no XHR / fully server-rendered" note but matches its
 * own documented fallback ("if a future crawl comes back without div.line rows ... switch
 * mode to browser"), so this scraper is `mode: "browser"` and only actually drives the
 * Playwright page for the music catalog; the sports catalog and package detail pages still
 * go through the cheaper `ctx.fetch` path since both are confirmed server-rendered.
 */
async function fetchCatalogHtml(kind: "sports" | "music", url: string, ctx: CrawlContext): Promise<string> {
  if (kind === "sports") {
    const res = await ctx.fetch(url, { headers: stealthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
  const page = ctx.page;
  if (!page) throw new Error("liveevents: music catalog needs a browser page");
  // Playwright resolves an HTTP error page as a normal load - check the status like the fetch path does.
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
  await page.waitForSelector(".accord-crap div.line", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  return page.content();
}

export const liveevents: CompetitorScraper = {
  key: "liveevents",
  scopes: ["package"],
  kinds: ["sports", "music"],
  // 72h - see the note on golasso.ts: one site per hourly tick, each site every ~3 days.
  intervalHours: 72,
  mode: "browser",
  // Only the /events/ (music) catalog needs the page; the /package/ detail pages below are
  // plain stealth fetches, so the crawl loop paces them with pauseShort() (final review, I2).
  detailMode: "fetch",
  async *crawl(ctx: CrawlContext): AsyncGenerator<Listing> {
    const { toUsd } = await import("./livetickets-api.ts");
    const failures: string[] = [];
    for (const { url, kind } of CATALOG_URLS) {
      let html: string;
      try {
        html = await fetchCatalogHtml(kind, url, ctx);
      } catch (err) {
        const msg = (err as Error).message;
        ctx.log(`liveevents: ${url} -> ${msg}`);
        failures.push(msg);
        // Every catalog failing is a blocked/broken site, not an empty one: throw so the run is
        // recorded as such (and the circuit can open) instead of a clean crawl with no listings.
        if (failures.length === CATALOG_URLS.length) throw new Error(`liveevents: every catalog page failed (${failures.join("; ")})`);
        await ctx.pause();
        continue;
      }
      const listings = parseCatalog(html, url);
      ctx.log(`liveevents: ${url} -> ${listings.length} listings`);
      if (listings.length === 0) ctx.log(`liveevents: ZERO listings on ${url} - selectors may have changed`);
      for (const l of listings) {
        yield {
          ...l,
          price_usd: l.price_from == null || l.currency == null ? null : Math.round(toUsd(l.price_from, l.currency)),
        };
      }
      await ctx.pause();
    }
  },
  async detail(listing: DetailInput, ctx: CrawlContext): Promise<Partial<Listing>> {
    if (listing.scope !== "package" || !hasDetailPage(listing.url)) return {};
    try {
      const res = await ctx.fetch(listing.url, { headers: stealthHeaders() });
      if (!res.ok) {
        ctx.log(`liveevents: detail ${listing.url} -> HTTP ${res.status}`);
        return {};
      }
      const html = await res.text();
      const partial = parseDetail(html);
      if (partial.price_from != null && partial.currency != null) {
        const { toUsd } = await import("./livetickets-api.ts");
        partial.price_usd = Math.round(toUsd(partial.price_from, partial.currency));
      }
      return partial;
    } catch (err) {
      ctx.log(`liveevents: detail ${listing.url} -> ${(err as Error).message}`);
      return {};
    }
  },
};

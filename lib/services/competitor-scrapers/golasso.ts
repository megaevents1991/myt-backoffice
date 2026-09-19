// Golasso (goalzo.co.il) package crawler. Selectors + markers from
// docs/superpowers/scrapers/phase2-recon.md (see its "Addendum (2026-09-11, build)"). The
// all-packages list hydrates client-side, so the catalog needs the Playwright page
// (mode "browser"); the /pdetails/<id> pages are server-rendered and go through ctx.fetch.
//
// The recon expected hashed Next.js class names and a regex-parsed card; the shipped DOM
// actually carries stable semantic classes, so the card is read structurally
// (`.package-item` -> `.gamesDates` / `.package-dates` / `.games-name-package` /
// `.price-package`) with the text-line regexes kept only as a fallback for when those
// classes churn. Two other recon facts moved: prices are the destination's currency (£ on
// the English-league cards, € on the Champions-League detail page - never assume EUR), and
// every card publishes BOTH the match date and the travel window, so `event_date` is set and
// the window rides along (the matcher judges a dated candidate by its date alone).
//
// Pure parsers only here: no "@/" imports at module top level, and `toUsd` (which
// transitively imports the Supabase client) is dynamically imported inside crawl()/detail()
// only, so the fixture script can run these under plain node - same rule as liveevents.ts.
import { UNKNOWN_ATTRS } from "../../../types/price-light.types.ts";
import type { Currency, ExtractedAttrs } from "../../../types/price-light.types.ts";
import { DETAIL_TEXT_MAX, bagExcluded, currencyFromSymbol, doc, flatText, isoOrNull, nightsBetween, parseHeDate, parsePrice, stealthHeaders, textLines } from "./shared.ts";
import type { CompetitorScraper, CrawlContext, DetailInput, Listing } from "./types";

const BASE = "https://www.goalzo.co.il";
export const ALL_PACKAGES_URL = `${BASE}/${encodeURIComponent("כל_החבילות")}.html`;
const CARD_SELECTOR = 'a[href*="/pdetails/"]';
const LOAD_MORE_SELECTOR = "button.btn-load-more";
/** The list paints 6 cards per "load more" click - 6 is one page, not a healthy crawl. */
const MIN_CARDS = 6;
/**
 * Sized from the live list, not guessed: a probe on 2026-09-11 walked the whole catalog in 21
 * clicks (132 cards, 52s). The first real crawl ran with a ceiling of 15 and stopped there with
 * 96 cards - a third of the catalog invisible, and every package past card 96 recorded as
 * `not_selling` against our events. The ceiling is a runaway guard only; `CATALOG_LOAD_BUDGET_MS`
 * is the real bound (~2.5s per round, so the deadline bites around round 35).
 */
const MAX_LOAD_MORE_CLICKS = 40;

const DATE_RE = /(\d{2})\.(\d{2})\.(\d{2})(?!\d)/;
const RANGE_RE = /(\d{2}\.\d{2}\.\d{2})\s*[-–|]\s*(\d{2}\.\d{2}\.\d{2})/;
/** Currency symbol + amount. The site prints the DESTINATION's currency (£1089, €789). */
const PRICE_RE = /([€£₪$])\s?([\d,]{3,6})/;
const TITLE_RE = /\s(vs|נגד|מול)\s|\s-\s/i;

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The card element: the `.package-item` wrapper, else the nearest ancestor (≤ 5 up) holding a price. */
function cardOf(a: Element): Element | null {
  let el: Element | null = a;
  for (let i = 0; el && i < 6; i++) {
    if (el.classList?.contains("package-item")) return el;
    el = el.parentElement;
  }
  el = a;
  for (let i = 0; el && i < 6; i++) {
    if (PRICE_RE.test(el.textContent ?? "")) return el;
    el = el.parentElement;
  }
  return null;
}

/** "מנצ'סטר יונייטד" + "מנצ'סטר סיטי" -> "מנצ'סטר יונייטד vs מנצ'סטר סיטי". */
function titleOf(card: Element, lines: string[]): string | null {
  const names = Array.from(card.querySelectorAll(".games-name-package h3")).map(textOf).filter(Boolean);
  if (names.length >= 2) return `${names[0]} vs ${names[1]}`;
  if (names.length === 1) return names[0];
  return lines.find((l) => TITLE_RE.test(l) && !DATE_RE.test(l) && !PRICE_RE.test(l))?.replace(/\s+/g, " ") ?? null;
}

/**
 * `.gamesDates h4` = "16:30 |", "13.09.26 |", "<league>" - the match date is the dated one.
 * A tour card sometimes prints the whole "25.09.26-01.10.26" range in that same h4 instead of
 * a single date (Important #1, review 2026-09-11) - that means "no single event date, use the
 * travel window instead", never the range's start day, so a RANGE_RE hit is skipped rather than
 * handed to parseHeDate (which would silently resolve it to the first day). When the structural
 * container exists at all, trust it exclusively: falling through to the raw-text scan below would
 * pick up an unrelated date elsewhere on the card (e.g. a `.package-dates` span). The text-line
 * fallback only runs when `.gamesDates` itself is gone (selector churn), and even there a range
 * line is excluded for the same reason.
 */
function eventDateOf(card: Element, lines: string[]): string | null {
  const heads = Array.from(card.querySelectorAll(".gamesDates h4")).map(textOf);
  if (heads.length > 0) {
    for (const h of heads) {
      if (RANGE_RE.test(h)) return null;
      const iso = h.match(DATE_RE) ? parseHeDate(h) : null;
      if (iso) return iso;
    }
    return null;
  }
  const single = lines.filter((l) => !RANGE_RE.test(l)).map((l) => l.match(DATE_RE)).find(Boolean);
  return single ? isoOrNull(2000 + Number(single[3]), Number(single[2]), Number(single[1])) : null;
}

/** `.package-dates span` ×2 = יציאה / חזרה, else a "DD.MM.YY - DD.MM.YY" range in the text. */
function travelWindowOf(card: Element, lines: string[]): { depart: string | null; ret: string | null } {
  const spans = Array.from(card.querySelectorAll(".package-dates span")).map(textOf).filter((t) => DATE_RE.test(t));
  if (spans.length >= 2) {
    const depart = parseHeDate(spans[0]);
    const ret = parseHeDate(spans[spans.length - 1]);
    if (depart && ret && ret > depart) return { depart, ret };
  }
  const range = lines.map((l) => l.match(RANGE_RE)).find(Boolean);
  if (range) {
    const depart = parseHeDate(range[1]);
    const ret = parseHeDate(range[2]);
    if (depart && ret && ret > depart) return { depart, ret };
  }
  return { depart: null, ret: null };
}

/** `.price-package h3` = "<small>£</small>1089"; the symbol names the currency, never assume EUR. */
function priceOf(card: Element, lines: string[]): { price: number | null; currency: Currency | null } {
  const box = card.querySelector(".price-package h3");
  if (box) {
    const symbol = textOf(box.querySelector("small"));
    const currency = currencyFromSymbol(symbol) ?? currencyFromSymbol(textOf(box));
    const price = parsePrice(textOf(box).replace(symbol, " "));
    if (price != null && currency != null) return { price, currency };
  }
  const line = lines.find((l) => PRICE_RE.test(l));
  const m = line?.match(PRICE_RE);
  if (!m) return { price: null, currency: null };
  return { price: parsePrice(m[2]), currency: currencyFromSymbol(m[1]) };
}

export function parseCatalog(html: string): Listing[] {
  const d = doc(html);
  const out: Listing[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(d.querySelectorAll(CARD_SELECTOR))) {
    const id = (a.getAttribute("href") ?? "").match(/\/pdetails\/(\d+)/)?.[1];
    if (!id || seen.has(id)) continue;
    const card = cardOf(a);
    if (!card) continue;
    const lines = textLines(card);
    const title = titleOf(card, lines);
    if (!title) continue;
    const event_date = eventDateOf(card, lines);
    const { depart: travel_depart, ret: travel_return } = travelWindowOf(card, lines);
    // Constraint: a listing with neither a match date nor a full travel window is dropped.
    if (!event_date && !(travel_depart && travel_return)) continue;
    const { price, currency } = priceOf(card, lines);
    seen.add(id);
    out.push({
      competitor: "golasso",
      external_key: id,
      scope: "package",
      title,
      title_he: title,
      event_date,
      // The card's third `.gamesDates h4` is the LEAGUE ("הליגה האנגלית"), not a city - the
      // city only appears on the detail page, so this stays null rather than lying.
      city: null,
      venue: null,
      price_from: price,
      currency: price == null ? null : currency,
      price_usd: null, // crawl() fills via toUsd
      travel_depart,
      travel_return,
      attrs: null,      // detail() fills for matched / on-date listings
      detail_text: null,
      url: `${BASE}/pdetails/${id}`,
    });
  }
  return out;
}

const HE_NUMBER: Record<string, number> = { "לילה אחד": 1, "שני לילות": 2, "שלושה לילות": 3, "ארבעה לילות": 4, "חמישה לילות": 5, "שישה לילות": 6, "שבעה לילות": 7 };

function nightsFromText(flat: string): number | "unknown" {
  const n = flat.match(/(\d{1,2})\s*לילות/);
  if (n) return Number(n[1]);
  for (const [words, value] of Object.entries(HE_NUMBER)) if (flat.includes(words)) return value;
  return "unknown";
}

const MAX_ANCHOR_GAP_DAYS = 45;

function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));
}

/**
 * The detail page prints the window twice: as the header range "12.10.26 | 15.10.26" and as
 * the יציאה/חזרה pair under "מספר נוסעים". Flight rows carry the same DD.MM.YY dates glued to
 * the times ("12.10.2610:5513:45"), so they are NOT scanned. `anchor` (the listing's own date)
 * only sanity-checks the result: a window more than 45 days from it is somebody else's date.
 */
function windowFromText(flat: string, anchor: string | null): { depart: string | null; ret: string | null } {
  const none = { depart: null, ret: null };
  let depart: string | null = null;
  let ret: string | null = null;
  const header = flat.match(RANGE_RE);
  if (header) {
    depart = parseHeDate(header[1]);
    ret = parseHeDate(header[2]);
  }
  if (!depart || !ret) {
    const labelled = flat.match(/יציאה\s*חזרה[^\d]{0,40}(\d{2}\.\d{2}\.\d{2})\s*(\d{2}\.\d{2}\.\d{2})/);
    if (labelled) {
      depart = parseHeDate(labelled[1]);
      ret = parseHeDate(labelled[2]);
    }
  }
  if (!depart || !ret || ret <= depart) return none;
  if (anchor && daysBetween(depart, anchor) > MAX_ANCHOR_GAP_DAYS) return none;
  return { depart, ret };
}

export function parseDetail(html: string, listing: Pick<DetailInput, "event_date" | "travel_depart">): Partial<Listing> {
  const d = doc(html);
  const flat = flatText(d.querySelector("main") ?? d.body);
  const priceMatch = flat.match(PRICE_RE);
  if (!priceMatch) return {};
  const anchor = listing.event_date ?? listing.travel_depart;
  const win = windowFromText(flat, anchor);
  const starsMatch = flat.match(/(\d)\s*(כוכבים|★)/);
  // Nights: the flight window is arithmetic off the real dates, the copy is marketing (this
  // page says "ארבעה לילות" for a 12.10 -> 15.10 stay = 3 nights), so the window wins when we
  // have one. Same rule liveevents.ts uses, which keeps the normalization comparable.
  const nightsWindow = nightsBetween(win.depart, win.ret);
  const attrs: Partial<ExtractedAttrs> = {
    ...UNKNOWN_ATTRS,
    bag_included: bagExcluded(flat) || /תיק\s*גב\s*בלבד|כבודת\s*יד\s*בלבד/.test(flat) ? false : /מזוודה|כבודה\s*רשומה/.test(flat) ? true : "unknown",
    direct_flight: /קונקשן|עצירת\s*ביניים|חניית\s*ביניים/.test(flat) ? false : /טיס(?:ה|ות|ת)\s*ישיר/.test(flat) ? true : "unknown",
    hotel_stars: starsMatch ? Number(starsMatch[1]) : "unknown",
    nights: nightsWindow !== "unknown" ? nightsWindow : nightsFromText(flat),
    breakfast: /לינה\s*בלבד|ללא\s*ארוחת\s*בוקר/.test(flat) ? false : /ארוחת\s*בוקר/.test(flat) ? true : "unknown",
    transfers: /ללא\s*העברות|לא\s*כולל\s*העברות/.test(flat) ? false : /העברות/.test(flat) ? true : "unknown",
  };
  const partial: Partial<Listing> = { attrs, detail_text: flat.slice(0, DETAIL_TEXT_MAX) };
  if (win.depart && win.ret) { partial.travel_depart = win.depart; partial.travel_return = win.ret; }
  // First price on the page = "מחיר החבילה" (per person); "סך הכל לתשלום" is the 2-pax total.
  const price = parsePrice(priceMatch[2]);
  const currency = currencyFromSymbol(priceMatch[1]);
  if (price != null && currency != null) { partial.price_from = price; partial.currency = currency; }
  return partial;
}

/**
 * The catalog load (goto + selector wait + up to 15 "load more" rounds) must not eat the whole
 * 240s CRAWL_BUDGET_MS (`price-light-crawl.ts`) - Important #2, review 2026-09-11: on a slow
 * night the un-bounded loop could run to ~225s before `runCrawl`'s own budget check ever fires,
 * landing on the *first* yielded listing as `partial` with nothing written. The observed load is
 * ~60s, so 90s is a generous ceiling for it and still leaves ~150s of the crawl budget for the
 * parse and the per-listing detail fetches that follow `loadCatalog()` in `crawl()` - which at
 * `pauseShort()` pacing (5-15s per fetch, the detailMode ruling below) is ~10-15 detail pages a
 * run instead of the 2-4 the old 150s + full-pause combination allowed (final review, I2).
 */
const CATALOG_LOAD_BUDGET_MS = 90_000;

/**
 * One page load IS the crawl. The list paints 6 cards and then a "לטעון עוד..."
 * (`button.btn-load-more`) button - clicking it is the site's own pagination, so the loop
 * clicks it until it disappears, the card count stops growing, the click ceiling is hit, or
 * `CATALOG_LOAD_BUDGET_MS` runs out (checked before every wait in the loop).
 */
async function loadCatalog(ctx: CrawlContext): Promise<string> {
  const page = ctx.page;
  if (!page) throw new Error("golasso: catalog needs a browser page");
  const deadline = Date.now() + CATALOG_LOAD_BUDGET_MS;
  const timedOut = () => Date.now() >= deadline;
  // Playwright does not throw on an HTTP error - a 403 block page loads "successfully" and parses
  // to zero cards. Fail the run here so it is recorded `blocked`, not as a clean empty catalog.
  const response = await page.goto(ALL_PACKAGES_URL, { waitUntil: "domcontentloaded" });
  if (response && response.status() >= 400) throw new Error(`golasso: catalog HTTP ${response.status()}`);
  await page.waitForSelector(CARD_SELECTOR, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  let cards = await page.locator(CARD_SELECTOR).count().catch(() => 0);
  let rounds = 0;
  let stopReason = "click ceiling reached";
  for (let i = 0; i < MAX_LOAD_MORE_CLICKS; i++) {
    if (timedOut()) { stopReason = "deadline"; break; }
    // Lazy lists also render on scroll - nudge to the bottom before looking for the button.
    // A little jitter on top of the fixed waits keeps this loop from reading as a machine-speed
    // burst (Minor #3, review 2026-09-11).
    await page.mouse.wheel(0, 4000).catch(() => undefined);
    if (timedOut()) { stopReason = "deadline"; break; }
    await page.waitForTimeout(800 + Math.floor(Math.random() * 700));
    if (timedOut()) { stopReason = "deadline"; break; }
    const more = page.locator(LOAD_MORE_SELECTOR).first();
    if (!(await more.isVisible().catch(() => false))) { stopReason = "load-more button absent"; break; }
    // End of catalog: the site does NOT remove the button, it disables it and relabels it
    // "אין עוד נתונים לטעון" (no more data to load) - observed on the first real crawl,
    // 2026-09-11, at 132 cards. Checking `isEnabled` here is what makes a completed walk
    // report as a clean finish instead of burning a 5s click timeout and calling it a failure.
    if (!(await more.isEnabled().catch(() => false))) { stopReason = "load-more button disabled - no more data"; break; }
    if (timedOut()) { stopReason = "deadline"; break; }
    let clickError: string | null = null;
    await more.click({ timeout: 5_000 }).catch((err) => { clickError = (err as Error).message; });
    if (clickError !== null) {
      // A click can still race the disable/removal that ends the list; re-check before
      // calling it a fault, so a finished walk is never reported as a broken one.
      const done = !(await more.isEnabled().catch(() => false));
      stopReason = done ? "load-more button disabled mid-click - no more data" : "click failed";
      if (!done) ctx.log(`golasso: load-more click failed - ${String(clickError)}`);
      break;
    }
    rounds++;
    if (timedOut()) { stopReason = "deadline"; break; }
    await page.waitForTimeout(1_200 + Math.floor(Math.random() * 800));
    const next = await page.locator(CARD_SELECTOR).count().catch(() => cards);
    if (next <= cards) { stopReason = "card count stopped growing"; break; }
    cards = next;
  }
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  // Important #3, review 2026-09-11: the click loop is the one part of this file that can't be
  // exercised against a saved fixture, so the first real run needs to be readable from the log.
  ctx.log(`golasso: load-more ${rounds} round(s) -> ${cards} cards (stopped: ${stopReason})`);
  return page.content();
}

export const golasso: CompetitorScraper = {
  key: "golasso",
  scopes: ["package"],
  kinds: ["sports"],
  // 72h, not 48 (Dor, 2026-09-11: "we want to be gentle - every few days per site"). The
  // hourly tick already crawls at most ONE due site, so across the four crawlable sites this
  // is one visit per site every three days. Well inside LIGHT_STALE_DAYS (14).
  // Weekly since 2026-09-17 (Dor: the sampled sites pushed back - once a week, fewer requests).
  intervalHours: 168,
  mode: "browser",
  // The catalog needs the browser, but /pdetails/<id> is a server-rendered GET below - so the
  // crawl loop paces those with pauseShort(), not the 20-60s browser pause (final review, I2).
  detailMode: "fetch",
  async *crawl(ctx: CrawlContext): AsyncGenerator<Listing> {
    const { toUsd } = await import("./livetickets-api.ts");
    const html = await loadCatalog(ctx); // a failed load = failed run (one page IS the crawl)
    const listings = parseCatalog(html);
    ctx.log(`golasso: ${ALL_PACKAGES_URL} -> ${listings.length} listings`);
    if (listings.length <= MIN_CARDS) ctx.log(`golasso: only ${listings.length} cards (<= ${MIN_CARDS}, one un-paginated page) - the "load more" button or the card selectors may have changed`);
    for (const l of listings) {
      yield { ...l, price_usd: l.price_from == null || l.currency == null ? null : Math.round(toUsd(l.price_from, l.currency)) };
    }
    // No trailing pause: this crawler visits exactly ONE site and one catalog URL, so a
    // 20-60s wait here paces nothing and only eats the detail budget (final review, I2a).
  },
  async detail(listing: DetailInput, ctx: CrawlContext): Promise<Partial<Listing>> {
    if (listing.scope !== "package" || !/\/pdetails\/\d+/.test(listing.url)) return {};
    // A failed fetch THROWS (the `detail()` contract, same as LiveEvents and ISSTA): `{}` means
    // "read, nothing on it" and `runCrawl` stamps the listing as opened for good - so answering
    // `{}` to a timeout or a 5xx, as this did until 2026-09-19, would have closed a listing's
    // contents for ever over one bad minute. A 404/410 is read as "gone" by the loop itself.
    const res = await ctx.fetch(listing.url, { headers: stealthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${listing.url}`);
    try {
      const partial = parseDetail(await res.text(), listing);
      if (partial.price_from != null && partial.currency != null) {
        const { toUsd } = await import("./livetickets-api.ts");
        partial.price_usd = Math.round(toUsd(partial.price_from, partial.currency));
      }
      return partial;
    } catch (err) {
      ctx.log(`golasso: detail ${listing.url} -> ${(err as Error).message}`);
      return {};
    }
  },
};

# LiveEvents crawler notes (recon 2026-09-10)

Site: **https://livevents.co.il** (one "e" — `liveevents.co.il` does not resolve). WordPress
(`wp-theme-LiveEventsNew`), fully **server-rendered**: plain HTTP GET returns the complete
catalog HTML, no XHR, no bot wall (fetched fine with a plain fetch and with the in-app browser).
Custom post types are NOT exposed on the WP REST API (`/wp-json/wp/v2/types` lists only core types),
but per-type sitemaps exist (see "Sitemaps").

**Ruling (controller, 2026-09-10): crawler `mode: "fetch"`** — no Playwright for this site.
`withBrowser()` stays for sites that need it (ISSTA/Golasso/OnTour, phase 2). Same stealth
headers (UA rotation, `Accept-Language`, no referer) are sent on the fetch. If a future crawl
comes back without `div.line` rows (bot wall added), switch `mode` to `"browser"` — the parsers
are pure and unchanged.

## Catalog pages

| Kind | URL | Rows | Prices |
| --- | --- | --- | --- |
| music (concerts board) | `https://livevents.co.il/events/` | 268 `div.line` rows, Sep 2026 → Oct 2027, ALL months in one page | yes — "החל מ-" per row |
| sports (all matches) | `https://livevents.co.il/matches/` | 244 `div.line` rows, 9 month groups | **no** — every row is "לקבלת הצעת מחיר" (quote only) |

- Pagination: **none**. Month tabs (`button` "ספטמבר 2026"…) only toggle visibility; all rows are in the HTML
  (`div.more-rap` / `div.accord-crap` containers, `hiddenRows: 0` in the DOM).
- XHR JSON? **no**.
- Featured slider on `/events/` (`div.slider-long a.sitem`) duplicates 4 rows of the board — **ignore `.slider-long`**, parse `div.line` only.
- One listing = `div.line` (class `line marked`):
  - dates: `.td.date span.d` — one span per date, text `DD.MM.YYYY`; a row may carry MANY dates (a tour's stay in one
    city, e.g. Shakira Madrid = 11 dates). Sports rows nest `<span class="dc">מועד לא סופי</span>` inside `span.d`
    ("date not final") — strip it.
  - title (artist / match): `.td.artist` — Hebrew, e.g. `שאקירה`, `טוטנהאם | אברטון` (teams separated by ` | `).
    → `title_he` = this text; `title` = same (no English on the catalog; English lives in the slug).
  - city: `.td.place` — Hebrew city name (`מדריד`, `לונדון`).
  - status: `.td.status` — usually empty (occasionally a note; keep as `attrs.note` if non-empty).
  - price + link (music): `.td.link-rap a.button[href]` text `החל מ-` + `span.p` (`1,349`, thousands comma) + `span.c` (`€` | `£` | `₪`).
    `href` = `https://livevents.co.il/package/<slug>-<tier>/` (a specific tier, cheapest) or `https://livevents.co.il/show/<slug>/` (a show page listing tiers).
  - price + link (sports): `.td.link-rap button.open-tablelead[data-show="<title>"]` — no href, no price.
- `external_key`:
  - music: `<path-after-domain-without-slashes>#<YYYY-MM-DD>` e.g. `package/shakira-mad-gold#2026-09-18` — **one Listing per date** in the row
    (same price, same url); matching is per date so a tour row becomes N listings.
  - sports: `game/<slugified title>#<YYYY-MM-DD>` where slug = lowercase Hebrew title with ` | ` → `-vs-` and spaces → `-`
    (no href on the board; league pages do link `/game/<en-slug>/` but we do not crawl 5 league pages for keys).
    `url` = the catalog page (`/matches/`).

## Detail page

Only music has priced detail pages. Two shapes:

- `/show/<slug>/` (e.g. `/show/muse-mil/`): tiers list — "gold" / "platinum" (sometimes "silver") each with
  `החל מ-929€` and a one-line summary `טיסות ישירות | 19-22.11 | וויז אייר | מלון | כרטיסים להופעה`, linking to
  `/package/<slug>-gold|-plat|-silver/`. Cheapest tier = the catalog price.
- `/package/<slug>-<tier>/` (e.g. `/package/muse-mil-gold/`, `/package/korn-prg-gold/`): the real product page.
  - price line: `החל מ- 929 €`; **per person confirmed**: `סה״כ מחיר לאדם בחדר זוגי` ("total price per person in a double room").
  - travel dates default: the flight lines — outbound `19.11.2026 … תל אביב 10:50 → מילאנו 14:15`, return `22.11.2026 …`;
    nights = return − outbound. Dates cannot be changed on the page (form = travellers count, hotel, baggage, lead fields).
  - flight: airline named (`וויז אייר`, `אלעל`, `ישראייר`); one leg each way with times ⇒ direct. Text marker `טיסות ישירות` appears on show pages.
  - stars: hotel list `מלון ברמת 4 כוכבים` / `5 כוכבים` ⇒ `hotel_stars` = the INCLUDED (first, `+0€`) hotel's stars. Upgrades `תוספת30€` etc. are ignored.
  - bag: included = `כבודת יד - תיק קטן וטרולי עד 10 ק"ג` ⇒ `bag_included: false`; a 20/23 kg suitcase is an add-on (`תוספת65€` / `תוספת120€`).
  - breakfast: `לינה וארוחת בוקר` ⇒ `breakfast: true`.
  - transfers: absent or explicitly excluded (`העברות פרטיות … – לא כלול`) ⇒ `transfers: false` when the exclusion text is present, else `"unknown"`.
  - ticket category: `ישיבה טבעת תחתונה` / `עמידה` — keep as `attrs.note`, not used for normalization.
  - No embedded JSON product data.

## Semantics

- `price_from` = per person, double room, includes flight + hotel (with breakfast) + concert ticket, hand luggage only, no transfers.
  Currency per row (`€` mostly, `£` for UK, `₪` rare). `price_usd` via `toUsd`.
- Sports packages have **no public price** → the listing is stored (title/date/city/url, `price_from: null`) so we know they
  sell it; the matcher must mark such a match **`unsure` with note `quote_only`** (→ light `unchecked` / `partial_coverage`,
  never `alone`, never green). Golasso + ISSTA (phase 2) carry the real sports prices.
- Music `alone` is meaningful: LiveEvents is the only registered music-package competitor in phase 0.

## Sitemaps (alternative catalog source, not used in phase 0)

`https://livevents.co.il/wp-sitemap.xml` → per type: `wp-sitemap-posts-show-1.xml` (1,195 shows), `-package-1.xml`,
`-sevent-1.xml` (442 `/game/<slug>/` pages), `-team-1.xml`, `-league-1.xml`, `-race-1.xml` (F1), `-tennis-1.xml`,
`-rpackage-1.xml`. Useful later for F1/tennis (`/formula1/`, `/tennis/` hubs) — out of phase-0 scope.

## LiveTickets event URL scheme (for livetickets-api.ts `url`)

Not on this site — LiveTickets is `https://www.livetickets.co.il/` (separate competitor, ticket-only; phase 0 reads it from our `live_events` API table).
Event page = `https://www.livetickets.co.il/events/events.aspx?eid=<live_events.event_id>` (same ids as the API);
performer pages `/performers/<Name>.aspx`; search `/search/?PerformerName=…`.

**`brt` CONFIRMED = shelf price (2026-09-10):** Arsenal–Leeds (eid 2324946) shows £395/£450/£450/£465/£495/£595/£595, Hertha–Fürth
(eid 2326345) €80/€90/€110 — identical to `ticket_categories[].brt`; `cost` = brt × 0.92 (our net). Keep
`LIVETICKETS_RETAIL_FACTOR = 1.0`, `LIVETICKETS_RETAIL_OFFSET_USD = 0`. Day-of events show "סיימנו את מלאי הכרטיסים" (sold out) while
still `is_active` in the API — the ticket light for same-day events may compare against a price nobody can buy; acceptable (events < 1 day out are not sold on the site anyway).

## Stealth notes

- captcha / bot wall seen? **no** — plain GET returns full HTML; `robots.txt` → 404 (no crawl rules published).
- Pages are ~250 rows of static HTML; 2 catalog fetches (`/events/`, `/matches/`) + detail fetches only for matched music
  listings (≤ a handful per crawl) = well under the 240 s budget with 20–60 s pauses.
- Lead forms post to the site — never touch them.

## Fixtures

`scripts/fixtures/liveevents/catalog.html` = `/events/`, `scripts/fixtures/liveevents/catalog-sports.html` = `/matches/`,
`scripts/fixtures/liveevents/detail.html` = `/package/muse-mil-gold/`, `scripts/fixtures/liveevents/show.html` =
`/show/muse-mil/` (tier-list page, same slug family as `detail.html`; exercises `parseDetail`'s `{}` short-circuit) —
saved raw by `scripts/scrape-fixture.ts --save` (fetch mode, same headers; `catalog.html` is the one exception, fetched
via a real browser per the Addendum below).

## Addendum (Task 6 implementation, 2026-09-10): `/events/` needs a browser after all

A plain `fetch("/events/")` returns only the empty `.accord-crap` shells (each month's
`div.line` rows hydrate via a client-side WP `admin-ajax.php` call - `ajurl` is set inline
in the page's `<head>`). This directly contradicts this doc's "no XHR / fully server-
rendered" note above; that note was apparently written from a DevTools session where the
AJAX had already resolved. `/matches/` (sports) and `/package/<slug>-<tier>/` (detail) ARE
genuinely server-rendered - confirmed by diffing a plain-fetch save against a Playwright
render (identical byte count for both).

Per this doc's own fallback ("if a future crawl comes back without div.line rows ... switch
mode to browser - the parsers are pure and unchanged"), `liveevents.ts` is `mode: "browser"`
and drives `ctx.page` (`page.goto` + `waitForSelector(".accord-crap div.line")` +
`waitForLoadState("networkidle")`, both with a timeout catch since not every month tab
finishes within the same window) only for the `/events/` catalog; `/matches/` and the
`/package/` detail pages still go through the cheaper `ctx.fetch` with the same stealth
headers, since both are confirmed server-rendered. `scripts/scrape-fixture.ts --save` mirrors
this split when regenerating fixtures.

Also found while building the parser (not previously called out above): roughly 92% of
`/events/` rows (247 of 268 in the saved fixture) are ALSO quote-only
(`button.open-tablelead`, no price) - e.g. Sam Smith, KATSEYE, Andre Rieu - identical markup
to the sports board. Only ~25 rows on that page carry a priced `/package/` or `/show/` link
(Shakira, Muse, etc.). `parseCatalog` already handles this per-row (same branch as sports:
presence of `a.button[href]` vs `button.open-tablelead`), but it means "music catalog" is
not synonymous with "priced catalog" - `price_from`/`currency` must be checked per listing
regardless of which page it came from.

## Addendum 2026-09-17 - music catalog over AJAX

`/events/` ships one empty `.accord-rap.lateload` container per month (`data-string="MM.YYYY"`, `data-count`; 24 months). The theme script (`liveevents.js`) fills each by POSTing `action=events_table_action&month=<data-string>&count=<data-count>` to `/wp-admin/admin-ajax.php` and pasting the returned `div.line` rows - same row markup `parseCatalog` already reads. A plain POST with `X-Requested-With: XMLHttpRequest` + `Referer` answers 200 (October 2026: 59 rows, 67 listings, 9 priced). The crawler uses this first and keeps the Playwright page as the fallback. Rows with a `button.open-tablelead` ("לקבלת הצעת מחיר") have no href and no price - quote only, on the music board too.

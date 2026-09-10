# Phase-2 competitor recon (2026-09-10) — ISSTA · Golasso · OnTour

Done by the controller with plain `fetch` + WebFetch (no browser). Selector constants for the phase-2
crawlers come from here verbatim, like `liveevents.md` did for phase 0.

| Site | Kind | Catalog URL(s) | Rendering | Prices on catalog | Detail attrs | Mode |
| --- | --- | --- | --- | --- | --- | --- |
| ISSTA Sport | sports package | `https://www.issta.co.il/sportcategory/soccer/<league>` × 8 leagues | server-rendered, schema.org microdata | yes (€, per person double room) | detail = JS loader → **skip in v1** (attrs `unknown`) | `fetch` |
| Golasso (goalzo.co.il) | sports package | `https://www.goalzo.co.il/כל_החבילות.html` (URL-encoded) | Next.js App Router; the list hydrates client-side (API/server-action not discoverable in chunks) | yes after hydration (€) | `/pdetails/<id>` server-rendered, full composition | `browser` |
| OnTour (ontour.co.il) | music package | `https://ontour.co.il/artists/` → performer pages | WordPress, server-rendered | yes on performer page (€, per person double room) | same page, expanded block (flights/hotel/tickets) | `fetch` |

## ISSTA Sport (`issta`)

- League pages: `spanish-league`, `premier-league`, `italian`, `german-league`, `champions-league`, `uefa-europa-league`, `superclasico`, `french-league` (all under `/sportcategory/soccer/`). ~23 items on La Liga; no pagination.
- HTML is entity-encoded (`&#x5DE;…`) — decode before parsing (linkedom does).
- One listing = `div.deal-item-container[itemscope][itemtype="http://schema.org/Product"]`:
  - link: `a[itemprop=url]` href `/loader?url=/sport/details?sid=3&vid=15&pid=<id>&dport=BCN&fdate=23/10/2026`
    → `external_key = issta:pid=<id>`; `travel_depart` = `fdate` (DD/MM/YYYY), `city` = `dport` IATA (BCN/MAD/…).
  - title: `[itemprop=name]` (`ברצלונה-ריאל מדריד`, `קלאסיקו: ברצלונה-ריאל`); teams split on `-`.
  - description: `[itemprop=description]` (marketing line).
  - travel dates: `.directions-from span` (הלוך, `DD/MM`, no year) / `.directions-to span` (חזור, `DD/MM`) — year from `fdate`; return may cross new year.
  - price: `[itemprop=price][content="2599"]`, currency `[itemprop=priceCurrency][content="€ "]` (trailing space).
  - **event_date is NOT on the card** — only the travel window. Match on team names + date window (`travel_depart ≤ event.date ≤ travel_return`); store `event_date = null`, keep the window. Matcher must accept null `event_date` when the window contains the event date (small T8 extension).
- Detail: `/sport/details?...` returns the site shell; `/loader?url=...` is a JS redirect to an app page — needs a browser; **v1 skips details** (nights derivable from the window; stars/flight/bag unknown → `UNKNOWN_ATTRS`).
- Per person double room: footer "מחירי החבילות המוצגות באתר הינן לאדם בהרכב של זוג בחדר". Package = flight + hotel + ticket.
- Stealth: Dynatrace RUM script on page (ignore); no bot wall on plain fetch.

## Golasso (`golasso`, site goalzo.co.il)

- Home shows 6 featured packages server-side (`/pdetails/<id>`, €); the all-packages page renders a filter UI and loads cards client-side. Chunks reference only `/api/sendToCI`; data comes via RSC/server actions — not worth reverse-engineering → **browser mode**, wait for `a[href*="/pdetails/"]` cards (≥ 6) after load; also league pages `/ליגת_האלופות.html` etc. if the all-packages list is capped.
- Card (from rendered text): title `רומא vs ריאל מדריד`, date `14.10.26, 21:00` (DD.MM.YY, comma, time), city, price `€789`, href `/pdetails/<id>` → `external_key = golasso:<id>`. Multi-show tours (`שקירה 25.09.26-01.10.26`) carry a range.
- Detail `/pdetails/20627` (server-rendered, fetchable): "€789" per person, "סה"כ ל-2 נוסעים €1,578"; Wizz Air direct, TLV→FCO 12.10 10:55–13:45, return 15.10; "כוללת תיק גב בלבד" → `bag_included:false`; hotel "Best Western Ars Hotel" 4★, "ארבעה לילות", "לינה בלבד" → `breakfast:false`; ticket "קטגוריה 4" + upgrades; dates fixed; 1 hotel option. Rich attrs → good AI-judge input.
- Site has a strong presence of Israeli teams (Hapoel Be'er Sheva pages) — ignore, kinds = sports only.

## OnTour (`ontour`, ISSTA's music arm "און.טור איסתא מיוזיק")

- `/artists/` = 68 performer cards; only cards containing the text `חבילות זמינות` currently sell (Celine Dion, Shakira, André Rieu). Crawl = `/artists/` + one GET per performer with packages (3–10 GETs).
- Performer page `/performer/<slug>/` (WordPress): one `div.event-details` per package:
  - `.flight-dates strong` ×2 = יציאה / חזרה `DD.MM.YYYY` → `travel_depart/return`, nights.
  - price: `p.hide-mobile strong` → `€1,399`, note `*המחיר הוא לאדם בחדר זוגי` (per person double room). Some performers (André Rieu) show NO price ("השאירו פרטים") → `price_from:null` → `quote_only`.
  - `h2` heading `Shakira | MADRID` → title + city; `.event-location small` = venue.
  - expanded block `#flights<id>` / `#hotel<id>` / `#tickets<id>`: flight text "טיסות ישירות עם אייר אירופה כולל תיק גב וטרולי עד 8 ק"ג" (direct, hand luggage only), hotel stars/nights/breakfast ("ע"ב לינה וארוחת בוקר לאדם בחדר זוגי"), ticket section, upgrades (+€ per person). All in the same HTML → `detail()` not needed.
  - **event_date is NOT explicit** on the card — concert date = inside the ticket section text or absent; derive `event_date` from the ticket block if a date appears, else use the travel window like ISSTA.
- `external_key = ontour:<performer-slug>#<travel_depart>`.

## Cross-cutting decisions for the phase-2 plan

1. `Listing.event_date` may be null when the competitor lists a travel window; add `travel_depart/return`-window matching to `matchEvent` (candidate if `depart ≤ event.date ≤ return` and names match).
2. New scrapers: `issta.ts` (fetch, 48 h, 8 catalog GETs), `golasso.ts` (browser, 48 h, 1–6 page loads + detail fetches for matched only), `ontour.ts` (fetch, 48 h, 1 + ≤10 GETs).
3. Registration order in `index.ts`: liveevents, issta, golasso, ontour, livetickets — `ACTIVE_COMPETITORS` still last. Sports package light then has 3 priced competitors (LiveEvents stays quote-only).
4. Fixtures: one listing page + one detail per site under `scripts/fixtures/<site>/`, saved by `scrape-fixture.ts --save <site>`.
5. Golasso and LiveEvents both need the browser → with 48 h intervals that is ≤ 1 browser session per day.

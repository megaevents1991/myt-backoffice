# Phase-2 competitor recon (2026-09-10) — ISSTA · Golasso · OnTour

**Status: implemented 2026-09-11 — see addenda.**

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

### Addendum (2026-09-11, build)

- `.directions-to span` / `.directions-from span` (first-child selector) only grabs the
  label span (`<span>חזור: </span>`) — each div actually holds 3 sibling `<span>`s (label /
  weekday name / `DD/MM`), and a bare `querySelector("span")` returns the first one, which
  has no digits. Fixed to read the whole div's `textContent` (`.directions-to`, no `span`
  suffix) and let the existing `DD/MM` regex find the date wherever it sits among the three
  spans' concatenated text. `travel_depart` is unaffected — it comes from the `fdate` query
  param on the loader link, not from `.directions-from`.
- Verified against the saved `spanish-league` fixture (23 cards, all fields on recon):
  `pid`/`dport`/`fdate` all parse straight off the loader href, `[itemprop=name]`,
  `[itemprop=description]`, `[itemprop=price][content]` and `[itemprop=priceCurrency]`
  matched as documented with no further changes needed.

## Golasso (`golasso`, site goalzo.co.il)

- Home shows 6 featured packages server-side (`/pdetails/<id>`, €); the all-packages page renders a filter UI and loads cards client-side. Chunks reference only `/api/sendToCI`; data comes via RSC/server actions — not worth reverse-engineering → **browser mode**, wait for `a[href*="/pdetails/"]` cards (≥ 6) after load; also league pages `/ליגת_האלופות.html` etc. if the all-packages list is capped.
- Card (from rendered text): title `רומא vs ריאל מדריד`, date `14.10.26, 21:00` (DD.MM.YY, comma, time), city, price `€789`, href `/pdetails/<id>` → `external_key = golasso:<id>`. Multi-show tours (`שקירה 25.09.26-01.10.26`) carry a range.
- Detail `/pdetails/20627` (server-rendered, fetchable): "€789" per person, "סה"כ ל-2 נוסעים €1,578"; Wizz Air direct, TLV→FCO 12.10 10:55–13:45, return 15.10; "כוללת תיק גב בלבד" → `bag_included:false`; hotel "Best Western Ars Hotel" 4★, "ארבעה לילות", "לינה בלבד" → `breakfast:false`; ticket "קטגוריה 4" + upgrades; dates fixed; 1 hotel option. Rich attrs → good AI-judge input.
- Site has a strong presence of Israeli teams (Hapoel Be'er Sheva pages) — ignore, kinds = sports only.

### Addendum (2026-09-11, build)

Written while building `lib/services/competitor-scrapers/golasso.ts` against the saved fixture
(`scripts/fixtures/golasso/{catalog,detail}.html`). Five things differ from the recon above; the
fixture won, so the parser reads the card **structurally** and keeps the text-line regexes only
as a fallback.

1. **Class names are NOT hashed.** The recon assumed hashed Next.js class names and a
   regex-parsed card. The shipped DOM uses stable semantic classes:
   `div.package-item > a.package[href="/pdetails/<id>"]`, and inside it `.gamesDates h4` ×3,
   `.package-dates span` ×2, `.games-name-package h3` ×2, `.price-package h3 > small`,
   plus `.package-multi span` on multi-game packages.
2. **The card's text lines**, verbatim, for `/pdetails/20192` (first card of the fixture) —
   `textLines()` output in document order:
   `["16:30 |","13.09.26 |","הליגה האנגלית","11.09.26","14.09.26","מנצ'סטר יונייטד","מנצ'סטר סיטי","£","1089","הזמן עכשיו"]`
   and for a multi-game card (`/pdetails/20291`) the same list prefixed with
   `["מרובת משחקים","1","/2", ...]`.
   So: the title is **two `h3` team names, never a "vs"/"נגד" line** (joined here as
   `"<home> vs <away>"`); the price symbol sits in its own `<small>` node, i.e. the symbol and
   the amount are separate text lines and a single-line `€\s?N` regex matches neither.
3. **Currency is the destination's, not always €.** Every English-league card on the fixture is
   `£` (`£1089`, `£1159`, `£1219`, `£919`, `£1199`); the Champions-League detail page is `€789`.
   `price_from`/`currency` therefore come from `currencyFromSymbol()` per listing — hard-coding
   EUR (as the task brief's draft did) would have mis-converted every English package.
4. **Every card publishes BOTH the match date and the travel window** — `.gamesDates h4` holds
   `16:30 | 13.09.26 | <league>` (the third `h4` is the **league**, `הליגה האנגלית`, *not* a
   city, so `city` stays null) and `.package-dates` holds `11.09.26` → `14.09.26`. No
   `DD.MM.YY-DD.MM.YY` range card appeared in the fixture; multi-game packages instead show
   `מרובת משחקים 1/2` with the first match's date. `event_date` + window are both stored: the
   matcher judges a dated candidate by its date alone, and the window then covers the package's
   other matches for the phase-2 window rule.
5. **The all-packages page paginates by button, not by scroll.** It paints exactly 6 cards and
   then `div.load-more-container > button.btn-load-more` ("לטעון עוד..."). `loadCatalog()` clicks
   it (≤ 15 times, stopping when it vanishes or the card count stops growing) after the scroll
   nudge. `scrape-fixture.ts` does not click, so the saved fixture is exactly one page — the
   check's `>= 6` floor means "one page parses", not "the catalog is only 6 packages".

Detail page `/pdetails/20627` matched the recon: plain `fetch` works, `<main>` flattens to ~1.1k
chars, `מחיר החבילה €789` is the per-person number (`סך הכל לתשלום €1,578` is the 2-pax total, so
the parser takes the FIRST price on the page), `4 כוכבים`, `על בסיס לינה בלבד`, `כוללת תיק גב בלבד`,
`טיסה ישירה`. Two detail gotchas: the window is `12.10.26 | 15.10.26` in the header and
`יציאה/חזרה 12.10.26 15.10.26` lower down, while the flight table glues date to times
(`12.10.2610:5513:45`) — so a `DD.MM\s+HH:MM` scan finds nothing and the header range is used;
and the copy says `ארבעה לילות` / `ל-4 ימים` for a 12.10 → 15.10 stay, which is **3** nights, so
`nights` is computed from the window (matching `liveevents.ts`) with the Hebrew word count only
as a fallback.

## OnTour (`ontour`, ISSTA's music arm "און.טור איסתא מיוזיק")

- `/artists/` = 68 performer cards; only cards containing the text `חבילות זמינות` currently sell (Celine Dion, Shakira, André Rieu). Crawl = `/artists/` + one GET per performer with packages (3–10 GETs).
- Performer page `/performer/<slug>/` (WordPress): one `div.event-details` per package:
  - `.flight-dates strong` ×2 = יציאה / חזרה `DD.MM.YYYY` → `travel_depart/return`, nights.
  - price: `p.hide-mobile strong` → `€1,399`, note `*המחיר הוא לאדם בחדר זוגי` (per person double room). Some performers (André Rieu) show NO price ("השאירו פרטים") → `price_from:null` → `quote_only`.
  - `h2` heading `Shakira | MADRID` → title + city; `.event-location small` = venue.
  - expanded block `#flights<id>` / `#hotel<id>` / `#tickets<id>`: flight text "טיסות ישירות עם אייר אירופה כולל תיק גב וטרולי עד 8 ק"ג" (direct, hand luggage only), hotel stars/nights/breakfast ("ע"ב לינה וארוחת בוקר לאדם בחדר זוגי"), ticket section, upgrades (+€ per person). All in the same HTML → `detail()` not needed.
  - **event_date is NOT explicit** on the card — concert date = inside the ticket section text or absent; derive `event_date` from the ticket block if a date appears, else use the travel window like ISSTA.
- `external_key = ontour:<performer-slug>#<travel_depart>`.

**Addendum (2026-09-11, build):** against the saved fixture (`/artists/`, `/performer/shakira/`)
the actual card markup differs from the recon above in three ways:

1. **`div.event-details` is not the whole card, and it holds no `h2`.** The real per-package
   container is `div.event-card` (a second class like `card_9060` on it carries the numeric id
   also used by the expanded block below). It has three children: `.event-image` (which nests
   `.event-name h2` - "Shakira  | MADRID" - and `.event-name h3` for the venue), `.event-details`
   (the `.flight-dates`/`p.hide-mobile`/`.event-location` summary the recon describes), and
   `.event-details-expanded`. Title/city now come from `.event-name h2` on the card, not from an
   `h2` inside `.event-details` (there isn't one).
2. **The `#flights<id>`/`#hotel<id>`/`#tickets<id>` blocks are nested one level inside
   `div.event-details-expanded`**, a sibling of `.event-details` under the same `.event-card` -
   not scattered as top-level siblings following `.event-details` as the plan's file-map guessed.
   A WordPress/Elementor quirk also nests a second, mostly-empty block with a *different* numeric
   id inside the real one (e.g. `#flights6196` sits inside `#flights9060`); harmless for marker
   matching since it only adds an empty or duplicate substring.
3. **Hotel stars are icon spans (`.stars` / `fa-star`) with no digit next to them on the summary
   line** - the "N כוכבים" text the parser matches (`attrsFromText`) instead comes from a later
   descriptive paragraph inside the same hotel block ("4 לילות במלון 4 כוכבים ... Leonardo Hotel
   Madrid City Center ע"ב לינה וארוחת בוקר"), which also carries the breakfast marker. No parser
   change was needed here (`flatText` on the whole `#hotel<id>` block sees it) - noted only because
   it means `hotel_stars`/`breakfast` extraction depends on that prose paragraph existing, not on
   the icon row.

The concert date was not present in the `#tickets<id>` block on this fixture (only a seating
description) - `event_date` came back `null` with the travel window set, which the matcher accepts
by design; a `total-info` line elsewhere on the page ("Shakira | MADRID | 09/10/26") does happen to
restate the departure date but was left unused since it sits under `#upgrades<id>`, not the ticket
block the plan calls for.

## Cross-cutting decisions for the phase-2 plan

1. `Listing.event_date` may be null when the competitor lists a travel window; add `travel_depart/return`-window matching to `matchEvent` (candidate if `depart ≤ event.date ≤ return` and names match).
2. New scrapers: `issta.ts` (fetch, 48 h, 8 catalog GETs), `golasso.ts` (browser, 48 h, 1–6 page loads + detail fetches for matched only), `ontour.ts` (fetch, 48 h, 1 + ≤10 GETs).
3. Registration order in `index.ts`: liveevents, issta, golasso, ontour, livetickets — `ACTIVE_COMPETITORS` still last. Sports package light then has 3 priced competitors (LiveEvents stays quote-only).
4. Fixtures: one listing page + one detail per site under `scripts/fixtures/<site>/`, saved by `scrape-fixture.ts --save <site>`.
5. Golasso and LiveEvents both need the browser → with 48 h intervals that is ≤ 1 browser session per day.

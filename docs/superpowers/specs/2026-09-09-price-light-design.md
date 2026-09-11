# רמזור מחירים (Price Light) — Design Spec

**תאריך:** 09.09.2026 · **ברנץ':** `feat/price-light` (worktree `.claude/worktrees/feat-price-light`) · **סטטוס:** מאושר ע"י דור + השותפים, ממתין לסקירת spec

מקורות: ארטיפקט "רמזור מחירים" גרסה 3 (09.09) + תשובות השותפים ל-8 השאלות + שתי הכרעות דור
(09.09): (א) ה-scraper שלנו, בתוך הריפו, בלי שירות חיצוני ובלי גלעד; (ב) דוגמים **אתר** פעם
ב-48 שעות לכל היותר, קוטפים את כל מה שצריך בגלישה אחת ושומרים אצלנו; LiveTickets דרך ה-API
הקיים. הספק המקורי (Google Doc "רמזור אפיון") והספק החונה
`2026-09-07-price-sync-phase-b-ramzor.md` (Phase C) נבלעים כאן.

---

## החלטות נעולות

| #   | נושא                        | הכרעה                                                                                                                                                                                  |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ספים                        | `diff = ours − min(competitor_normalized)`. ירוק `diff < −150`, אדום `diff > +150`, כתום ביניהם (עם סימן). הסכום מוצג בכל אור                                                             |
| 2   | חמישה מצבים                 | `alone` (כל המתחרים של הסוג נסרקו, אף אחד לא מוכר) · `green` · `orange` · `red` · `unchecked` (טרם נסרק / סריקה נכשלה / ישן מ-14 יום / שופט לא בטוח). `unchecked` מתנהג ככתום, לעולם לא ירוק |
| 3   | שני אורות                   | חבילה (קובע לאתר ולרשימה) + כרטיס בלבד (מידע לצוות, נכנס לרשימה גם הוא)                                                                                                                 |
| 4   | מתחרים                      | חבילות ספורט: LiveEvents · ISSTA Sport · Golasso. חבילות מוזיקה: LiveEvents · OnTour. כרטיס: LiveTickets **דרך ה-API הקיים** (`live_events.ticket_categories[].brt`), בלי גלישה. "לבד" נספר רק מול המתחרים של סוג האירוע |
| 5   | נרמול                       | Claude מחלץ מה בחבילה; הקוד מתרגם לדולרים בקבועים (`BAG_USD 120` מהשותפים; השאר הצעות פתיחה לכיול). `unknown` = אין תיקון + סימון "נרמול חלקי"                                          |
| 6   | אדומים                      | שום הורדה אוטומטית — לא מהאתר, לא מהפיד. רשימה ב-`/price-light` + החלטה ידנית לאירוע: הוזל · השאר בפיד (שקט 14 יום, נרשם מי) · הסר מהאתר (מחיקה רכה) · פתח משימה                          |
| 7   | באתר                        | "המבוקשים ביותר" בעמודי אמן/קבוצה/קטגוריה = **מיון** ירוקים ראשונים ואז תאריך (לא סינון). עמוד הבית `is_prioritized` ידני, לא נוגעים                                                    |
| 8   | תג                          | "ירידת מחיר" בלבד — על המחיר הכולל **שלנו**, ירידה ≥ $50 מול לפני 14 יום, מוצג 14 יום עם המחיר הקודם מחוק. בלי תג השוואתי למתחרים                                                        |
| 9   | דפוס עבודה                  | כמו `base-price-sync`: כל ריצה נרשמת עם הסיבה, מסך ריכוז, `?dry_run=1`. ההבדל: יחידת העבודה היא **אתר** (סריקת קטלוג), לא אירוע                                                           |
| 10  | **דגימה — לפי אתר, ≤ פעם ב-48 שעות** | **(דור, 09.09)** session אחד לאתר כל 48 שעות (קבוע לאתר, לא פחות מ-24), קוטף את כל הקטלוג הרלוונטי בגלישה אחת ושומר ב-`competitor_listings`. דפי פרטים רק לאירועים שתואמו לשלנו. ההתאמה, ה-AI והאור עובדים על הנתונים השמורים — בלי גלישה |
| 11  | **scraper — שלנו, בריפו**   | **(דור, 09.09)** אין שירות חיצוני ואין קשר עם גלעד. קוד הסריקה ב-`lib/services/competitor-scrapers/`, רץ מתוך ה-cron של Vercel. LiveEvents ו-ISSTA נבנים מחדש. `NEXT_SECRET_COMPETITOR_PRICING_URL` ו-`/api/competitor-pricing` יורדים |
| 12  | עדינות                      | "אסור שידעו שזה אנחנו": IP מגורים ישראלי, דפדפן אמיתי, session אחד בכל רגע, הפסקה אקראית 20–60 שניות בין דפים, שעת סריקה אקראית, בלם. ~5–15 דפים ביום בכל האתרים יחד                     |
| 13  | דפדפן                       | D1 (פתוח, המלצה בסעיף 16): דפדפן מרוחק בשירות (Browserbase / Bright Data Scraping Browser) דרך CDP — או Chromium מקומי על Vercel + פרוקסי מגורים. אתר שמגיש JSON ב-XHR נקרא ב-`fetch` בלי דפדפן בכלל. הקוד לא יודע מי מאחורי `withBrowser()` |
| 14  | AI                          | משלב 1: `extractAndJudge()` **פעם אחת לזוג (אירוע שלנו, listing)** — הפסק נשמר ב-`competitor_matches` ולא נשאל שוב עד שה-listing משתנה. Opus 5 (`claude-opus-5`), זמן אמת. סף ביטחון 0.8, timeout 20s, כל תשובה נשמרת עם עלות. `PRICE_LIGHT_AI=off` מכבה |
| 15  | רעננות                      | סריקה לאתר כל 48 שעות · התאמה + אור לכל האירועים בלילה · אירוע חדש מותאם **מיד ביצירה** מול הקטלוג השמור (שניות, בלי גלישה) · תוקף אור 14 יום מהסריקה · אירוע < 2 ימים מהיום: לא מחושב |
| 16  | מטבע                        | ₪ / € / £ → $ בשער יום הסריקה דרך `exchange-rate-client.ts`. נשמרים גם המקור וגם הדולר                                                                                                   |
| 17  | לא רלוונטי (`na`)           | אין `ticket_only_markup` → אור כרטיס `na`. `skip_flight` או אין כרטיסים זמינים → אור חבילה `na`                                                                                          |
| 18  | דריסה ידנית                 | נשארת (אור + הערה חובה + מי + מתי), פגה אוטומטית כשמחיר המתחרה המנורמל משתנה ביותר מ-$20                                                                                                |
| 19  | מי רואה                     | פנימי בלבד. לא בפורטל הסוכנים, לא ללקוח (חוץ מהמיון והתג). האתר קורא 4 עמודות בלבד                                                                                                      |
| 20  | `comp_pricing`              | נשאר בטבלה ובטייפ עד ששלב 1 יציב שבועיים, ואז מוסר משני הריפואים ב-PR נפרד                                                                                                              |

---

## 1. מודל הנתונים

מיגרציה אחת, `npm run db:new price_light`, אחרי `git fetch origin && git merge origin/master`
(חובה — כמה אנשים כותבים מיגרציות במקביל). הכול idempotent. **לא מפעילים מהברנץ'** — נכנס
עם ה-PR למאסטר.

### 1.1 עמודות חדשות על `events` (המיין קורא 4 מהן)

```sql
alter table events
  add column if not exists light_package        text,         -- alone|green|orange|red|unchecked|na  (main reads)
  add column if not exists light_ticket         text,         -- same values                          (backoffice only)
  add column if not exists light_detail         jsonb,        -- see 1.2                              (backoffice only)
  add column if not exists light_checked_at     timestamptz,  -- newest light computation
  add column if not exists light_silenced_until timestamptz,  -- "השאר בפיד" - red hidden from the pending list until then
  add column if not exists price_drop_usd       integer,      -- (main reads) drop amount, null = no tag
  add column if not exists price_drop_from      integer,      -- (main reads) the old total price, shown struck through
  add column if not exists price_drop_until     date;         -- (main reads) tag expiry
create index if not exists events_light_package_idx on events (light_package) where is_deleted is null;
```

`null` בכל עמודת אור = `unchecked` (אירוע שנוצר לפני הפיצ'ר). המיין לא צריך להבחין.

### 1.2 `light_detail` (jsonb)

```ts
type LightDetail = {
  package?: LightScopeDetail;
  ticket?: LightScopeDetail;
  override?: {
    scope: "package" | "ticket";
    light: Light;
    note: string;
    by: string;              // user_profiles.id
    at: string;              // ISO
    competitor_normalized_usd: number; // expires when this moves > $20
  } | null;
};
type LightScopeDetail = {
  light: Light;
  diff_usd: number | null;        // ours - min normalized; null for alone/unchecked/na
  our_usd: number | null;
  competitor: CompetitorKey | null; // the one that set the min
  raw: number | null; raw_currency: string | null;
  normalized_usd: number | null;
  adjustments: Adjustment[];      // [{ key: "bag", usd: -120 }, ...]
  partial: boolean;               // some attr unknown
  reason: string | null;          // unchecked: "never" | "stale" | "crawl_failed" | "unsure" | "partial_coverage"
  crawled_at: string | null;      // the listing's crawl time
  match_id: number | null;        // competitor_matches.id
  per_competitor: Record<CompetitorKey, { status: MatchStatus; normalized_usd: number | null; crawled_at: string | null }>;
};
```

### 1.3 `competitor_crawl_runs` — סריקה אחת של אתר אחד

```sql
create table if not exists competitor_crawl_runs (
  id            bigserial primary key,
  competitor    text not null,                 -- liveevents|issta|golasso|ontour
  status        text not null,                 -- running|ok|partial|blocked|error|skipped
  trigger       text not null,                 -- schedule|manual|dry_run
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  pages         integer default 0,             -- pages visited (catalog + detail)
  listings      integer default 0,             -- listings upserted
  prev_listings integer,                       -- last ok run's count, for the -50% alarm
  note          text,                          -- error text / "circuit open" / "count dropped 62%"
  browser_mode  text                           -- remote|local|fetch
);
create index if not exists ccr_comp_idx on competitor_crawl_runs (competitor, started_at desc);
alter table competitor_crawl_runs enable row level security;
```

### 1.4 `competitor_listings` — הקטלוג של המתחרה, אצלנו

```sql
create table if not exists competitor_listings (
  id              bigserial primary key,
  competitor      text not null,
  external_key    text not null,               -- stable id from the site (url slug / id); unique per competitor
  scope           text not null,               -- package|ticket
  title           text not null,
  title_he        text,
  event_date      date,
  city            text, venue text,
  price_from      numeric,                     -- as shown, per person
  currency        text,                        -- ILS|USD|EUR|GBP
  price_usd       numeric,                     -- converted at crawl time
  travel_depart   date, travel_return date,    -- when the listing states its dates
  attrs           jsonb,                       -- what the page states directly: stars, direct, nights, bag, breakfast, transfers
  detail_text     text,                        -- <= 6k chars of the detail page (matched listings only)
  url             text not null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null,        -- crawl that last saw it; missing from a crawl = "gone" after 2 runs
  last_changed_at timestamptz not null,        -- price/attrs/date changed - invalidates the match verdict
  run_id          bigint references competitor_crawl_runs(id),
  unique (competitor, external_key)
);
create index if not exists cl_date_idx on competitor_listings (competitor, event_date);
alter table competitor_listings enable row level security;
```

Listing שנעלם משתי סריקות רצופות = המתחרה הפסיק למכור (`not_selling` בהתאמה). לא מוחקים.

### 1.5 `competitor_matches` — אירוע שלנו ↔ listing (הפסק נשמר)

```sql
create table if not exists competitor_matches (
  id              bigserial primary key,
  event_id        integer not null references events(id),
  competitor      text not null,
  scope           text not null,
  listing_id      bigint references competitor_listings(id),   -- null when not_selling/unsure
  status          text not null,               -- found|not_selling|unsure|na|skipped
  method          text not null,               -- rule|ai|manual|api
  ai_verdict      jsonb,                       -- { model, same_event, confidence, tokens_in, tokens_out, cost_usd, ms } | null
  raw_price       numeric, raw_currency text, price_usd numeric,
  normalized_usd  numeric,
  adjustments     jsonb,
  attrs           jsonb,                       -- merged: page attrs win over ai attrs
  our_usd         numeric,
  diff_usd        numeric,
  light           text,
  listing_changed_at timestamptz,             -- copy of listing.last_changed_at the verdict was made on
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists cm_event_idx on competitor_matches (event_id, created_at desc);
create index if not exists cm_listing_idx on competitor_matches (listing_id);
alter table competitor_matches enable row level security;
```

זו ההיסטוריה (הארטיפקט קרא לה `competitor_price_checks`): שורה חדשה רק כשמשהו השתנה — listing
חדש/שונה, אירוע חדש, המחיר שלנו זז, קבוע נרמול השתנה, דריסה. לילה בלי שינוי = אפס שורות.
ה-AI נשאל רק כשאין שורה `found|not_selling` לזוג עם `listing_changed_at` שווה ל-listing הנוכחי.

### 1.6 `event_price_snapshots` — צילום יומי של המחיר הכולל

```sql
create table if not exists event_price_snapshots (
  event_id      integer not null references events(id),
  day           date not null,
  package_usd   integer,          -- null when na
  ticket_usd    integer,          -- null when no ticket_only_markup
  min_ticket    integer, base_flight integer, base_hotel integer, markup integer,
  primary key (event_id, day)
);
alter table event_price_snapshots enable row level security;
```

מתחיל להצטבר מהיום הראשון של שלב 0 — התג בשלב 3 צריך 14 יום של היסטוריה.

### 1.7 `tasks.source`

`TASK_SOURCES` מקבל `price_light`. `source_ref = { kind: "price_light_red", table: "events", row_id, label, url: "/events/{id}#fix-price" }`. אין CHECK על העמודה — שינוי טייפ בלבד.

### 1.8 טייפים

`types/price-light.types.ts` (חדש): `Light`, `CompetitorKey`, `MatchStatus`, `LightDetail`, `Adjustment`, `ExtractedAttrs`, `CrawlRunRow`, `ListingRow`, `MatchRow`, `PriceSnapshotRow`.
`types/app.types.ts` `Event`: 8 עמודות חדשות, כולן אופציונליות. **מסונכרן למיין** `lib/app.types.ts` באותו יום (המיין קורא 4). `comp_pricing` נשאר עד החלטה 20.
עד `npm run db:types` אחרי המרג' — `const db = supabase as any` boundary cast אחד לקובץ, כמו בטבלאות החדשות האחרות.

---

## 2. מנוע החוקים — `lib/services/price-light.ts`

המקום היחיד לספים, לקבועים ולחישוב האור. פונקציות טהורות למעלה, כתיבה ל-DB למטה.

### 2.1 קבועים (מיוצאים)

```ts
export const LIGHT_GREEN_USD  = -150;  // diff below this = green
export const LIGHT_RED_USD    =  150;  // diff above this = red
export const LIGHT_STALE_DAYS =  14;   // older crawl = unchecked
export const OVERRIDE_DRIFT_USD = 20;  // manual override expires when competitor moves more
export const PRICE_DROP_MIN_USD = 50;  // tag threshold
export const PRICE_DROP_LOOKBACK_DAYS = 14;
export const PRICE_DROP_SHOW_DAYS = 14;
export const DATE_TOLERANCE_DAYS = 1;  // competitor event date may differ by this much

// Normalization - what a component is worth, applied to the COMPETITOR's price
// to make it look like our default package: direct flight, no bag, 3*, our nights,
// no breakfast, no transfers. Bag is the partners' number; the rest are opening
// values to calibrate after a month of data.
export const BAG_USD        = 120;  // competitor includes a checked bag  -> -120
export const CONNECTION_USD = 100;  // competitor flight has a stop       -> +100
export const STAR_STEP_USD  = 40;   // per star per night: 4* -> -40/night, 2* -> +40/night
export const NIGHT_USD      = 90;   // per extra/missing night: more nights -> -90 each, fewer -> +90 each
export const BREAKFAST_USD  = 15;   // per night, included -> -15/night
export const TRANSFER_USD   = 30;   // included -> -30

// LiveTickets ticket light uses the API's `brt` (gross) field as their shelf price.
// If a phase-0 spot check shows brt is NOT the retail price, this multiplier /
// offset calibrates cost -> shelf instead (1.0 / 0 = trust brt).
export const LIVETICKETS_RETAIL_FACTOR = 1.0;
export const LIVETICKETS_RETAIL_OFFSET_USD = 0;
```

### 2.2 המחירים שלנו

```ts
ourPackageUsd(event): number | null   // null = na
  = base_flight_price + base_hotel_price + minAvailableTicket + totalMarkup(event)
  // totalMarkup mirrors main's getTotalMarkup: composed (markup_ticket+flight+hotel) when any set,
  // else 175, plus event_additional_markup. na when skip_flight or no available ticket.
ourTicketUsd(event): number | null   // null = na
  = minAvailableTicket + ticket_only_markup   // na when ticket_only_markup == null
ourNights(event) = days between def_date_depart and def_date_return
```

`totalMarkup` ו-`minAvailableTicket` הם העתק של הלוגיקה ב-main `lib/events/price.ts` — הבקאופיס לא
מייבא מהמיין. הערה בקוד מצביעה על המקור; `/price-audit` משווה.

### 2.3 מתחרים לסוג

```ts
kindOf(event): "sports" | "music"
  music = type in (music_event, music_live_event_dynamic); everything else (incl. tx_event) = sports
competitorsFor(kind, scope): CompetitorKey[]
  sports/package  -> [liveevents, issta, golasso]
  music/package   -> [liveevents, ontour]
  */ticket        -> [livetickets]            // source = live_events table, not a crawl
```

עד ש-crawler של מתחרה קיים בקוד, הוא לא נספר ב-"לבד": `ACTIVE_COMPETITORS` (קבוע ב-registry,
סעיף 3) מסנן. שלב 0 = `[liveevents, livetickets]`. כשמתחרה מצטרף לסוג, הסריקה הראשונה שלו
מייצרת listings, והלילה שאחריה מתאים את כל האירועים של הסוג — בלי צעד מיוחד.

### 2.4 נרמול

```ts
normalize(priceUsd, attrs: ExtractedAttrs, ours: { nights: number }): { normalizedUsd, adjustments, partial }
  bag_included === true      -> -BAG_USD
  direct_flight === false    -> +CONNECTION_USD
  hotel_stars (number)       -> (3 - stars) * STAR_STEP_USD * nights   // 4* -> -40*n, 2* -> +40*n
  nights (number)            -> (ours.nights - nights) * NIGHT_USD     // they give more -> negative
  breakfast === true         -> -BREAKFAST_USD * nights
  transfers === true         -> -TRANSFER_USD
  any attr === "unknown"     -> no adjustment for it, partial = true
  scope "ticket"             -> no normalization at all
```

### 2.5 האור

```ts
computeScopeLight({ ourUsd, matches: LatestMatchPerCompetitor, competitors, now }): LightScopeDetail
  ourUsd == null                                   -> na
  no competitor with a valid match (listing crawled <= 14d, status found|not_selling) -> unchecked (reason = newest reason)
  all competitors valid and all not_selling        -> alone
  some valid, none found, some invalid             -> unchecked ("partial_coverage" - never green on a half-checked market)
  else min over found normalized_usd:
    diff = ourUsd - min
    diff <  LIGHT_GREEN_USD -> green
    diff >  LIGHT_RED_USD   -> red
    else                    -> orange
```

"לבד" דורש **את כל** המתחרים הפעילים של הסוג עם סריקה תקפה. חצי שוק שנסרק = `unchecked`, לא ירוק.
דריסה ידנית (`light_detail.override`) גוברת כל עוד המתחרה המנורמל לא זז יותר מ-`OVERRIDE_DRIFT_USD`.

### 2.6 כתיבה — `recomputeEventLights(eventId, trigger)`

1. טוען אירוע + ההתאמה **האחרונה** לכל (מתחרה, scope) מ-`competitor_matches`, עם ה-listing שלה.
2. `computeScopeLight` לכל scope → כותב `light_package`, `light_ticket`, `light_detail`, `light_checked_at`.
3. אור חבילה יצא מאדום → סוגר משימות `price_light` פתוחות של האירוע (סעיף 6.4).
4. מחזיר `{ before, after }` — הקורא מחליט אם לרענן ISR.

נקרא: מהלילה (סעיף 6.2) לכל האירועים החיים, מיד ביצירת אירוע, ואחרי דריסה ידנית או "השאר בפיד".

---

## 3. Scraper — שלנו, בריפו, סריקת קטלוג

### 3.1 מבנה

```
lib/services/competitor-scrapers/
  index.ts          registry: SCRAPERS: Record<CompetitorKey, CompetitorScraper>, ACTIVE_COMPETITORS
                    (the crawl interval is per-scraper: `intervalHours` on CompetitorScraper)
  types.ts          CompetitorScraper, CrawlContext, Listing, DetailInput
  liveevents.ts     phase 0
  issta.ts          phase 2 ✅
  golasso.ts        phase 2 ✅
  ontour.ts         phase 2 ✅
  livetickets-api.ts phase 0 - not a crawler: reads live_events (already synced twice a day) into competitor_listings
lib/services/browser.ts   withBrowser(fn) - the only file that knows how a browser is obtained
```

```ts
interface CompetitorScraper {
  key: CompetitorKey;
  scopes: ("package" | "ticket")[];
  kinds: ("sports" | "music")[];
  intervalHours: number;                        // >= 24; default 48
  mode: "browser" | "fetch";                    // fetch = the site serves JSON, no browser at all
  /** One session: walk the catalog, yield every relevant listing. */
  crawl(ctx: CrawlContext): AsyncGenerator<Listing>;
  /** Optional: fetch the detail page for a listing we matched (attrs + detail_text). Same session. */
  detail?(listing: Listing, ctx: CrawlContext): Promise<Partial<Listing>>;
}
type CrawlContext = { page?: Page; fetch: typeof fetch; pause(): Promise<void>; log(msg: string): void; dryRun: boolean };
type Listing = Omit<ListingRow, "id" | "first_seen_at" | "last_seen_at" | "last_changed_at" | "run_id">;
```

ה-crawler לא מחליט אם listing הוא אירוע שלנו ולא מחשב — מחזיר מה שראה. `detail_text` = innerText של
אזור החבילה, קצוץ ל-6,000 תווים.

### 3.2 סריקה אחת — `runCrawl(competitor, trigger)`

1. שורת `competitor_crawl_runs` (`running`).
2. `withBrowser` (או `fetch` במצב `fetch`) → `crawl()`: דפי קטלוג בלבד, `pause()` אקראי 20–60 שניות בין דפים.
   כל listing נעשה upsert לפי `(competitor, external_key)`; `last_changed_at` מתעדכן רק אם מחיר / תאריך /
   attrs השתנו.
3. **דפי פרטים רק למתואמים:** אחרי הקטלוג, לכל listing שיש לו התאמה `found` (או שתאריכו ±1 יום מאירוע
   שלנו ואין לו הפסק) → `detail()` באותו session, אותן הפסקות. בפועל כמה עשרות דפים לסריקה.
4. סיום: `ok` / `partial` (חלק מהדפים נכשלו) / `blocked` / `error`. `listings < 50% × prev_listings` →
   `partial` + note + מייל — האתר כנראה שינה מבנה; ה-listings הישנים נשארים תקפים עד 14 יום.
5. `dryRun` → הכול נסרק ומודפס, שום כתיבה.

עומס: LiveEvents ≈ 5–15 דפי קטלוג + ~30 דפי פרטים כל 48 שעות. ארבעה אתרים יחד ≈ 5–15 דפים ביום
בממוצע — פחות מגולש אחד סקרן.

### 3.3 `withBrowser()` — D1

```ts
withBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T>
```

- **מצב א (מומלץ): דפדפן מרוחק.** `NEXT_SECRET_BROWSER_CDP_URL` מוגדר → `chromium.connectOverCDP(url)`.
  Browserbase או Bright Data Scraping Browser מספקים IP מגורים ישראלי, טביעת אצבע אמיתית, ופתרון
  captcha. אין לנו שרת, אין תחזוקת Chromium. בעומס של ~15 דפים ביום — עשרות דולרים לחודש, לא מאות;
  **לאמת מול המחירון לפני הבחירה.** חוסמים תמונות/מדיה/פונטים בכל דף.
- **מצב ב (גיבוי): מקומי.** לא מוגדר → `@sparticuz/chromium` + `playwright-core` (כמו `validate-airline`),
  עם `NEXT_SECRET_SCRAPE_PROXY_URL` (פרוקסי מגורים, `http://user:pass@host:port`). זול יותר, אבל
  headless מזוהה יותר בקלות. פונקציית ה-cron מקבלת `memory: 1024` ב-`vercel.json`.
- **מצב `fetch`:** אתר שהקטלוג שלו מגיע מ-JSON (XHR) — קוראים ל-endpoint ישירות דרך הפרוקסי, בלי דפדפן.
  הכי זול והכי שקט. מזוהה בסיור (3.5 שלב 1).

הקוד של ה-crawlers זהה בשני מצבי הדפדפן. החלפה = משתנה סביבה.

### 3.4 עדינות — נאכף בקוד, לא בהבטחה

- **session אחד בכל רגע.** שורת `competitor_crawl_runs` במצב `running` שנפתחה לפני פחות מ-6 דקות =
  נעילה; סריקה ידנית מכבדת אותה.
- **שעה אקראית.** ה-cron בודק כל שעה; אתר שעברו `intervalHours` מהסריקה התקינה האחרונה נסרק בהסתברות
  שמפזרת אותו על החלון (לא כולם ב-03:00). שני אתרים לעולם לא באותה שעה.
- **דפדפן רגיל.** UA מרשימה של 6 דפדפנים ישראליים נפוצים (Chrome/Safari/Edge, Windows/Mac/iPhone), viewport
  אקראי מרשימה, `Accept-Language: he-IL,he;q=0.9,en-US;q=0.8`, בלי referrer, בלי כניסה לחשבון, בלי כותרות
  משלנו. תמונות/מדיה/פונטים חסומים.
- **timeout** 45 שניות לדף, 240 שניות לסריקה כולה (בתוך תקציב ה-cron). לא ניסיון חוזר באותה ריצה.
- **בלם.** סריקה `blocked` → האתר מדולג 48 שעות + מייל ל-`NEXT_SECRET_ADMIN_EMAIL`. שלוש `blocked|error`
  רצופות לאתר → מדולג עד שמישהו מריץ ידנית. אף פעם לא "נלחמים".
- **`PRICE_LIGHT_SCRAPE=off`** — מכבה סריקה (ריצות `skipped`; ההתאמה והאור ממשיכים על הקטלוג השמור).

### 3.5 איך בונים crawler לאתר — השלבים (בלי גלעד)

1. **סיור ידני (1–2 שעות).** דפדפן + DevTools על האתר: איפה דפי הקטלוג (ספורט / מוזיקה / לפי ליגה),
   pagination, איך מופיע המחיר ("מ-₪X לאדם"? כולל טיסה? לאילו תאריכים?), מטבע, מה יש בדף הפרטים
   (כוכבים, ישירה, לילות, מזוודה, ארוחת בוקר, העברות). **הכי חשוב:** האם הדף טוען את הרשימה מ-JSON
   ב-XHR — אם כן, `mode: "fetch"`. התוצאה: `docs/superpowers/scrapers/<site>.md` קצר — URLs, שדות,
   סמנטיקת מחיר, סלקטורים.
2. **סקריפט מקומי.** `scripts/scrape-once.mjs <site> [--headed] [--detail <key>]` — מריץ את ה-crawler
   מקומית עם Playwright (headed לפיתוח), מדפיס את ה-listings ל-JSON. מחזורים עד ש-session אחד מחזיר את
   כל הקטלוג. שומרים HTML fixture אחד לדף קטלוג ואחד לדף פרטים ב-`scripts/fixtures/<site>/`.
3. **מודול בריפו.** `lib/services/competitor-scrapers/<site>.ts` שמממש `crawl()` (+ `detail()`), נרשם
   ב-registry. `scripts/scrape-fixture.mjs <site>` מריץ את ה-parser על ה-fixtures — רגרסיה בלי גלישה.
4. **מיפוי סמנטי.** `price_from` תמיד לאדם; אם האתר מציג לזוג — מחלקים בקוד ה-crawler עם הערה. `attrs`
   מכיל רק מה שהדף אומר במפורש; השאר `unknown` ל-Claude.
5. **הפעלה.** מוסיפים ל-`ACTIVE_COMPETITORS`, `dry_run` מפריוויו מול פרוד, סריקה ראשונה ידנית מ-`/price-light`,
   בודקים ספירת listings ומדגם 5 התאמות ידנית. הלילה שאחרי מתאים את כל האירועים.
6. **תחזוקה.** בלם ה-50% מזהה שינוי מבנה; התיקון = שלב 2 מחדש על ה-fixture החדש. סיור חוזר אחת לרבעון.

### 3.6 LiveEvents (שלב 0)

`mode: "browser"` — `/events/` (מוזיקה) נטען ב-WP AJAX בצד הלקוח (fetch רגיל מחזיר מכולות ריקות);
`/matches/` (ספורט) server-rendered אבל quote-only (אין מחיר בקטלוג) → תמיד `unsure`/`quote_only` עד שלב 2.

### 3.7 LiveTickets — API, לא סריקה (שלב 0)

`dailyLiveEventsSync` כבר כותב `live_events` פעמיים ביום. `livetickets-api.ts` "סורק" את הטבלה:
לכל `live_events` פעיל → listing `scope: "ticket"`, `external_key = event_id`, `price_from = min(ticket_categories[].brt)`
(מומר לדולר לפי `currency`), `attrs = { categories: [...] }`. ההתאמה לאירועים שלנו: אירועים מסוג
`*_live_event_dynamic` נושאים את ה-id של LiveTickets → `method: "api"`, בלי AI; שאר האירועים —
התאמה רגילה (חוק + AI). **אימות בשלב 0:** סקריפט מדפיס `cost` / `brt` / מחיר באתר שלהם ל-3 אירועים.
אם `brt` אינו מחיר המדף — `LIVETICKETS_RETAIL_FACTOR/OFFSET` מכיילים מ-`cost`, ורושמים את זה ב-`/guide`.

---

## 4. התאמה — `lib/services/price-light-match.ts`

`matchEvent(eventId, competitor, scope, trigger, dryRun)`:

1. `ourUsd` (סעיף 2.2). `null` → שורת `na` (רק אם האחרונה לא `na`) ויוצא.
2. **מועמדים** מ-`competitor_listings`: אותו `competitor` + `scope`, `event_date` בטווח ±`DATE_TOLERANCE_DAYS`
   (או null), `last_seen_at` בתוך 14 יום. אין מועמדים ושסריקה תקינה קיימת → `not_selling`.
3. **חוק לפני AI:** נרמול שמות (`lib/search.ts` `matchesSearch` על טוקנים של שני הצדדים + שמות
   קבוצות/אמן) — התאמה אחת יחידה עם תאריך זהה → `found`, `method: "rule"`, בלי AI.
4. **AI על הספק:** כמה מועמדים / תאריך ±1 / שם לא חד-משמעי → `extractAndJudge()` (סעיף 5) — פעם אחת לזוג.
   פסק קיים ב-`competitor_matches` לאותו `listing_id` עם `listing_changed_at` זהה → משתמשים בו, אפס
   קריאות. `same_event` ≥ 0.8 → `found`; `false` בביטחון → `not_selling`; אחרת `unsure`.
5. `attrs` = דף (מ-listing) גובר על AI. המרת מטבע, `normalize()`, `diff`.
6. שורה ל-`competitor_matches` **רק אם השתנה משהו** מול השורה האחרונה (status / listing / normalized /
   our_usd / light). `dryRun` → אפס כתיבות.

`recomputeEventLights` נקרא אחרי `matchEvent` לכל המתחרים של האירוע.

---

## 5. AI — `lib/services/price-light-judge.ts`

- **פונקציה אחת:** `extractAndJudge(input): Promise<Verdict>`. נקראת רק מ-`matchEvent`. רואה רק את הקלט שלה.
- **קלט** (~2,500 טוקנים): האירוע שלנו — שם עברי + אנגלי, תאריך, עיר, אולם, תאריכי נסיעה, לילות —
  ו-`detail_text` של ה-listing (≤ 6k) או עד 10 מועמדים (כותרת + תאריך + עיר + מחיר). פרומפט מערכת קבוע
  בקובץ, בעברית+אנגלית.
- **פלט מובנה** (JSON schema דרך structured output של `@anthropic-ai/sdk`):
  ```ts
  { same_event: boolean | "unknown", confidence: number,        // 0-1
    matched_candidate_index?: number,
    bag_included: boolean | "unknown", direct_flight: boolean | "unknown",
    hotel_stars: number | "unknown", nights: number | "unknown",
    breakfast: boolean | "unknown", transfers: boolean | "unknown" }
  ```
- **כללים:** `confidence < 0.8` → `unsure`. שדה `unknown` → אין תיקון + `partial`. הערך של הדף גובר על
  ה-AI כשיש שניהם. timeout 20s, כל שגיאה → `unsure` עם note. **לעולם לא מפיל התאמה.**
- **מודל:** `PRICE_LIGHT_AI_MODEL` (ברירת מחדל `claude-opus-5`). `PRICE_LIGHT_AI=off` מכבה (אז: התאמות
  חוק בלבד, בלי נרמול, `partial = true`).
- **כל תשובה נשמרת** ב-`ai_verdict` עם מודל, טוקנים, עלות מחושבת (`$5/$25` למיליון ל-Opus 5 —
  קבועים בקובץ), משך. `/price-light` מציג עלות מצטברת לחודש.
- **עלות בפועל:** backfill ראשון ≈ 442 אירועים × עד 3 מתחרים ≈ עד ~1,300 קריאות ≈ $20 חד-פעמי. אחר כך
  רק זוגות חדשים/שהשתנו — עשרות ביום ≈ $5–15 לחודש. Batch לא נדרש.
- **חילוץ רץ גם על listing שהחוק כבר מצא** (attrs בלבד, לא שיפוט same_event) כשה-`attrs` שלו כולם
  `unknown` ויש `detail_text` — לא רק בענף "החוק לא הכריע"; verdict נשמר ומטמון לפי `(event, listing,
  listing_changed_at)` כדי שקריאה אחת ל-AI תשרת אותו זוג עד שהמודעה עצמה משתנה.

---

## 6. אוטומציה

### 6.1 cron סריקה — `app/api/cron/price-light-crawl/route.ts`

`vercel.json`: `"7 * * * *"` (כל שעה), `maxDuration: 300`, `memory: 1024`. `guardCronRoute` ראשון. `?dry_run=1`,
`?competitor=<key>` לסריקה ידנית של אתר אחד. כל ריצה:

1. מתחרים פעילים שעברו `intervalHours` מהסריקה התקינה האחרונה, לא בבלם. ריק → `{ skipped: true }` (רוב הריצות).
2. בוחר **אחד** (הכי ישן; פיזור אקראי בתוך החלון כדי לא לנחות תמיד על אותה שעה).
3. `runCrawl` תחת הנעילה. סיכום JSON: `{ competitor, status, pages, listings, prevListings, ms }`.

### 6.2 cron לילי — `app/api/cron/price-light-nightly/route.ts`

`"15 0 * * *"` (לפני `base-price-sync` ב-01:30). `maxDuration: 300`. לכל אירוע חי עתידי:

1. `event_price_snapshots` upsert (`package_usd`, `ticket_usd`, הרכיבים).
2. תג "ירידת מחיר": `ref` = הצילום הקרוב ביותר ל-14 יום אחורה (≥ 10 ימים אחורה, אחרת אין רפרנס).
   `ref.package_usd − today.package_usd ≥ 50` → `price_drop_usd = ref − today`, `price_drop_from = ref.package_usd`,
   `price_drop_until = today + 14` (תג בתוקף לא מוארך ולא מקוצר). תג בתוקף שהמחיר חזר לעלות מעל
   `from − 50` → מנוקה מיד. `until` עבר → מנוקה. מחיר שעלה ואז חזר = `ref == today` = אין תג.
3. `livetickets-api` מרענן את ה-listings של הכרטיסים מ-`live_events` (טבלה, לא רשת).
4. `matchEvent` לכל (אירוע, מתחרה פעיל, scope) + `recomputeEventLights`. רוב הזוגות: פסק קיים, אפס AI,
   אפס שורות. זה גם המקום שבו "המחיר שלנו זז" (סנכרון בסיס, TixStock) נתפס תוך 24 שעות.
5. אור חבילה של מישהו השתנה או תג → קריאה אחת ל-`/api/revalidate` של המיין.
6. `?dry_run=1` — אפס כתיבות. מייל יומי רק כשיש תגים חדשים או שינויי אור אדום↔לא-אדום (ספירה, לא רשימה).
7. תקציב 270 שניות; לא הספיק → `remaining` בסיכום, ההמשך מחר (סדר: הכי-פחות-חושבו ראשון).

### 6.3 אירוע חדש / "בדוק עכשיו"

- `createEvent` → אחרי ה-insert, `matchEvent` לכל המתחרים + `recomputeEventLights` — שניות, מול הקטלוג
  השמור, בלי גלישה. נכשל → לוג בלבד, היצירה לא נחסמת; הלילה ישלים.
- "בדוק עכשיו" על אירוע (טבלה / `/price-light`) = אותו דבר, Server Action. "סרוק אתר עכשיו" (`/price-light`,
  אדמין) = `runCrawl` דרך `POST /api/price-light/crawl` (`guardAdminRoute`, `maxDuration: 300`), מכבד
  את הנעילה ואת הבלם, לא את `intervalHours`.

### 6.4 משימות

- "פתח משימה" → `createTask({ source: "price_light", source_ref, title: "אדום · חבילה · {name} {date}",
  description: המספרים (שלנו / המתחרה גולמי → מנורמל / מה נורמל / הפרש / אחרים / היסטוריה 3 התאמות),
  priority: "high" })`. dedupe: משימה פתוחה עם אותו `source_ref.row_id + kind` → נפתחת הקיימת.
- אור החבילה יוצא מאדום (סריקה חדשה, הוזלה, דריסה) → `recomputeEventLights` סוגר את המשימה
  (`status: "done"`, הערה "האור ירד מאדום אוטומטית").

---

## 7. מסכים (Backoffice)

### 7.1 טבלת אירועים — עמודת "רמזור"

מחליפה את צביעת `UsualPriceCell` ואת דיאלוג המתחרה הישן. שני pills לשורה: `חבילה −$180` · `כרטיס לבד`.
צבעים: `alone` ירוק בהיר · `green` ירוק כהה · `orange` · `red` · `unchecked` אפור · `na` מקף. ריחוף
(Tooltip של shadcn): מתחרה, גולמי → מנורמל, מה נורמל, נסרק מתי, "נרמול חלקי". לחיצה → Sheet עם היסטוריית
`competitor_matches` של האירוע + קישור ל-listing של המתחרה + "בדוק עכשיו" + דריסה ידנית (Select אור +
Textarea הערה חובה). מיון לפי עמודת הרמזור = לפי `diff_usd` של החבילה.

הדיאלוג הישן (`persistComp`, `calculateSmartDates`, `getCompetitorTravelDates`, המסלול `/api/competitor-pricing`)
נמחק ב-PR הזה.

### 7.2 `/price-light` — מסך הריכוז

`lib/nav.ts`: קבוצת Pricing ליד "Price Changes", `roles: ADMIN_ROLES`, keywords "רמזור מתחרים competitor".
`data-table.tsx` v2 (תצוגות שמורות, bulk, `defaultSorting` diff יורד), `matchesSearch`.

- **אריחים** לפי אור (5) + "ממתינים להחלטה" (אדום, לא מושתק, בלי משימה פתוחה). לחיצה = פילטר.
- **צ'יפים:** ממתין להחלטה · כל האדומים · כתום + · חבילה · כרטיס · עד 45 יום · נרמול חלקי · השתנה השבוע ·
  לא נבדק · לבדיקה ידנית (מדגם AI).
- **שורה:** אירוע + scope · שלנו · המתחרה (גולמי → מנורמל + attr chips + קישור) · הפרש · אור · נסרק · החלטה.
- **פעולות על אדום:** **הוזל** → `/events/{id}#fix-price` · **השאר בפיד** → `light_silenced_until = +14d`
  + `audit_log` (מי, מתי) · **הסר** → `softDeleteEvent` אחרי AlertDialog · **משימה** → 6.4.
- **פאנל מתחרים** (מעל הטבלה): לכל אתר — סריקה אחרונה, סטטוס, listings, הבאה מתי, בלם, כפתור "סרוק עכשיו".
- **כותרת:** עלות AI החודש, מתחרים פעילים.
- Server Actions ב-`lib/actions/price-light-actions.ts` (`requireAdmin`): `silenceRedLight`, `setLightOverride`,
  `clearLightOverride`, `recheckEvent`, `openPriceLightTask`, `listPriceLight(filters)`, `listCrawlRuns`.

### 7.3 ווידג'ט בדשבורד

ליד רדאר הפערים: פס מחולק לפי אור + "N אדומים · M ממתינים להחלטה" (לחיצה → `/price-light?f=pending`).

### 7.4 `/guide`

סעיף חדש "רמזור מחירים" ב-`guide-content.ts` (EN+HE): מה האורות, מה כל כפתור עושה, למה "לא נבדק" ולא ירוק,
איפה הקבועים, כמה פעמים סורקים אתר ולמה. **באותו PR.**

---

## 8. האתר (myt-main) — שלב 3, ברנץ' נפרד ב-`MYT_Git_Shered/myt-main`

קורא 4 עמודות: `light_package`, `price_drop_usd`, `price_drop_from`, `price_drop_until`. לא קורא
`light_detail`, לא רואה מתחרה, לא רואה צבע.

- **"המבוקשים ביותר":** `lib/taxonomy.ts getEventsInCategory` + עמוד אמן (`app/artists/[slug]`) — מיון ברירת
  מחדל: `light_package in (green, alone)` ראשונים, ואז תאריך. טאבים "המבוקשים ביותר | לפי תאריך | לפי מחיר"
  בעמודי קבוצה/אמן/קטגוריה. עמוד הבית לא נוגע (`is_prioritized`).
- **תג:** `price_drop_until >= today` → badge "ירידת מחיר −$N" על הכרטיס + `price_drop_from` מחוק ליד המחיר.
- **פיד:** ללא שינוי (החלטה 6).
- `lib/app.types.ts` — 8 העמודות (מסונכרן כבר בשלב 0, main מתעלם עד שלב 3).

---

## 9. שגיאות ובטיחות

| מצב                                 | תוצאה                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| אתר מתחרה חוסם                      | סריקה `blocked` → listings ישנים תקפים עד 14 יום, אחר כך `unchecked` (מתנהג ככתום). בלם + מייל     |
| אתר מתחרה משנה מבנה                 | ספירה נופלת > 50% → `partial` + מייל; ה-listings הישנים נשארים. תיקון = fixture חדש + parser         |
| Claude נופל / timeout               | `unsure` → `unchecked`. נרשם. הלילה הבא מנסה שוב (רק זוגות בלי פסק)                                |
| Claude מחלץ לא נכון                 | `partial` מסומן, `attrs` + `detail_text` נשמרים, מדגם ידני שבועי, סף 0.8                          |
| המחיר שלנו זז                       | הלילה מחשב מחדש מההתאמה הקיימת — בלי סריקה, בלי AI                                               |
| שינוי קבוע נרמול                    | ההיסטוריה שומרת גולמי + מנורמל + adjustments — העבר לא משתנה; להבא בלבד                           |
| חצי שוק נסרק                        | `unchecked`, לא `alone` — אין ירוק שגוי                                                          |
| `updateEvent` מהטופס                | מיפוי עמודות מפורש — הטופס לא דורס עמודות אור                                                    |
| דפדפן מרוחק לא זמין                 | סריקה `error` → בלם אחרי 3 + מייל; הקטלוג השמור ממשיך לשרת                                      |
| `brt` אינו מחיר מדף                 | אימות בשלב 0; `LIVETICKETS_RETAIL_FACTOR/OFFSET` מכיילים; מתועד ב-`/guide`                        |

---

## 10. משתני סביבה (חדשים — `.env.local` + `CLAUDE.md`)

```env
ANTHROPIC_API_KEY=                 # server only
PRICE_LIGHT_AI=on                  # off = rule matches only, no normalization
PRICE_LIGHT_AI_MODEL=claude-opus-5
PRICE_LIGHT_SCRAPE=on              # off = crawl runs log "skipped", matching keeps working on stored listings
NEXT_SECRET_BROWSER_CDP_URL=       # remote browser (mode A). Empty = local chromium (mode B)
NEXT_SECRET_SCRAPE_PROXY_URL=      # mode B + fetch mode: residential proxy http://user:pass@host:port
```

מוסרים: `NEXT_SECRET_COMPETITOR_PRICING_URL`.

---

## 11. בדיקות

אין test runner בריפו. הכיסוי:

- `lib/services/price-light.ts` — פונקציות טהורות עם `scripts/price-light-selftest.mjs` (`node`,
  assertions על טבלת מקרים: כל 5 האורות + `na`, נרמול לכל רכיב, `unknown`, חצי שוק, staleness, דריסה
  שפגה, תג ירידת מחיר כולל "עלה וחזר", התאמת חוק על שמות).
- `scripts/scrape-once.mjs <site>` — סריקה אחת מקומית; `scripts/scrape-fixture.mjs <site>` — parser על fixtures.
- `scripts/livetickets-brt-check.mjs` — `cost` / `brt` / מחיר אתר ל-3 אירועים (אימות חד-פעמי).
- `?dry_run=1` על שני ה-cron — דוח מלא, אפס כתיבות, מפריוויו מול פרוד.
- ידני לפני מרג': 5 אירועים אמיתיים (2 ספורט, 1 מוזיקה, 1 בלי `ticket_only_markup`, 1 `skip_flight`) —
  אור נכון + סכום + tooltip + היסטוריה + 4 פעולות + משימה נסגרת לבד.

---

## 12. שלבים ומאמץ (ימי פיתוח נטו, הכול אצלנו)

| שלב | תוכן                                                                                                                                                                                                  | מאמץ   | תלות                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------- |
| 0   | מיגרציה · טייפים (+ sync למיין) · מנוע חוקים + selftest · `withBrowser` (מצב ב מקומי) · סיור + crawler LiveEvents · `livetickets-api` + אימות `brt` · התאמה בחוק (בלי AI) · cron סריקה + cron לילי (צילום, תג, התאמה) · `createEvent` hook · "בדוק עכשיו" · עמודת רמזור בטבלה · מחיקת המסלול הישן | 6 ימים | אין                               |
| 1   | `extractAndJudge` · `/price-light` + פאנל מתחרים + 4 פעולות + משימות · ווידג'ט · `/guide` · D1 (דפדפן מרוחק) · env בפרוד                                                                               | 5 ימים | D1 + `ANTHROPIC_API_KEY`          |
| 2   | ISSTA Sport · Golasso · OnTour — סיור + crawler לכל אחד + `ACTIVE_COMPETITORS`                                                                                                                         | 3–6    | שלב 1 יציב                        |
| 3   | המיין: מיון "המבוקשים ביותר" + טאבים + תג                                                                                                                                                              | 3 ימים | שלב 1 רץ שבועיים · 14 יום צילומים |
| 4   | רמזור שיווק — מחוץ לתוכנית; ההיסטוריה כבר במבנה שתומך                                                                                                                                                | —      | דוח שיווק                         |

שלב 0 מוגש כ-PR למאסטר בפני עצמו (מיגרציה נכנסת עם המרג'). שלב 1 PR שני. שלב 2 PR לכל crawler.

---

## 13. השפעה על המיין (cross-project)

- `lib/app.types.ts` — 8 עמודות אופציונליות (שלב 0, `/sync-types`). `comp_pricing` נשאר עד החלטה 20.
- טבלאות חדשות — RLS בלי policies, המיין לא קורא.
- `live_events` — נקראת בלבד, אין שינוי בסנכרון.
- שלב 3 — 2 קבצים במיין + טאבים. אין שינוי בפיד, בהזמנה, במחיר.
- `/api/revalidate` — פעם בלילה + אחרי פעולה ידנית; זול.

## 14. מחוץ לתחום

- פיד/קריאייטיב לפי אור (השותפים: ידני). · רמזור שיווק. · תג השוואתי. · הצגה בפורטל הסוכנים. ·
  שינוי מחיר אוטומטי ("הוזל" = קפיצה לשדות, לא כתיבה). · quote לאירוע בזמן אמת מול מתחרה (הוחלף
  בקטלוג השמור). · Phase B של הסנכרון (חלון תאריכים) — נשאר חונה.

## 15. הכרעה פתוחה אחת

**D1 — דפדפן:** א' דפדפן מרוחק (Browserbase / Bright Data Scraping Browser, IL residential) — **מומלץ**,
כי העדינות היא דרישה קשיחה ו-headless מקומי הוא הנקודה החלשה; בעומס של ~15 דפים ביום העלות קטנה.
ב' Chromium על Vercel + פרוקסי מגורים — גיבוי. שלב 0 מפתח במצב ב' מקומית בכל מקרה; הבחירה נדרשת לפני
ששלב 1 עולה לפרוד. יחד עם ההחלטה: חשבונות חדשים שלנו (דפדפן/פרוקסי + Anthropic) ואישור הוצאה שוטפת
~$40–120 לחודש כולל AI.

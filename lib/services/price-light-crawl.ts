// One crawl of one competitor site (spec §3.2 / §3.4). Writes competitor_crawl_runs
// + competitor_listings. Never throws past its own summary.
// Lock = a competitor_crawl_runs row in status "running" younger than LOCK_STALE_MS.
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { appOrigin, sendMail } from "@/lib/email";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { browserMode, PAGE_TIMEOUT_MS, randomPause, scrapeEnabled, shortPause, withBrowser } from "@/lib/services/browser";
import { ACTIVE_COMPETITORS, scraperFor, type CompetitorScraper, type CrawlContext, type DetailInput, type Listing } from "@/lib/services/competitor-scrapers";
import { ruleMatchScore } from "@/lib/services/price-light";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";
import type { CompetitorKey, CrawlStatus, CrawlTrigger, Currency } from "@/types/price-light.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const CRAWL_BUDGET_MS = 240_000;
export const LOCK_STALE_MS = 6 * 60_000;      // a "running" row older than this is a crashed run, not a lock
export const DROP_ALARM_RATIO = 0.5;          // listings < 50% of last ok run -> partial + email
export const CIRCUIT_AFTER_FAILURES = 3;      // consecutive blocked|error -> skip until a manual crawl
export const CIRCUIT_COOLDOWN_MS = 24 * 60 * 60_000; // circuit auto-reopens 24h after the newest failing run (fix round 1, finding 1)
export const FAILED_LISTING_RATIO = 0.2;      // >=20% of listings failing to upsert -> partial (0 successes -> error)
/**
 * Listings written per upsert request. The catalog used to cost two round-trips per listing
 * (a select for the previous row + a single-row upsert, ~155ms each), which is what left the
 * 1811-listing LiveTickets catalog cut off at 1549 rows by CRAWL_BUDGET_MS - and at the
 * nightly's 60s LiveTickets budget would have covered under a quarter of it. 500 keeps one
 * request at ~500 * 19 small columns (comfortably inside PostgREST's request limits, and the
 * rows carry no detail_text unless a detail page already filled one), turns that catalog into
 * 4 writes instead of 3622 round-trips, and bounds how many rows a failed chunk has to retry
 * one at a time.
 */
export const CATALOG_CHUNK = 500;
/** competitor_listings only grows - never trust a single unpaged read (PostgREST caps at 1000). */
const LISTINGS_LOAD_MAX_ROWS = 50_000;

export interface CrawlSummary {
  competitor: CompetitorKey; status: CrawlStatus;
  /** 1 once the catalog crawl runs (one whole-catalog pass, not a literal page count) + detailPages folded in on write; see detailPages. */
  pages: number;
  listings: number;
  prevListings: number | null; changed: number;
  /** Detail pages fetched for listings worth enriching - counted separately from the catalog `pages`. */
  detailPages: number;
  /** Listings whose upsert failed - the catalog loop continues past a bad listing instead of aborting the run. */
  failed: number;
  ms: number; note: string | null; runId: number | null;
}

interface RunRowLite { id: number; status: CrawlStatus; started_at: string; listings: number }

/** Exactly the columns the detail loop selects - no `as Listing` over nine undefined fields. */
interface DetailRow extends DetailInput { id: number }

async function recentRuns(competitor: CompetitorKey, limit: number): Promise<RunRowLite[]> {
  const { data, error } = await db.from("competitor_crawl_runs")
    .select("id,status,started_at,listings").eq("competitor", competitor)
    .order("started_at", { ascending: false }).limit(limit);
  if (error) { console.error("price-light-crawl: runs load failed", JSON.stringify(error)); return []; }
  // A "running" row past LOCK_STALE_MS is a run the platform killed (maxDuration) before it could
  // record itself. Read as a failure, not as "in progress": otherwise it counts toward neither the
  // circuit nor the interval, and a site that stalls every request is re-crawled hourly for ever.
  return ((data ?? []) as RunRowLite[]).map((r) =>
    r.status === "running" && Date.now() - Date.parse(r.started_at) > LOCK_STALE_MS ? { ...r, status: "error" as const } : r);
}

/** Another crawl (any competitor) is running and started less than LOCK_STALE_MS ago. */
export async function isCrawlLocked(): Promise<boolean> {
  const { data, error } = await db.from("competitor_crawl_runs").select("id,started_at")
    .eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("price-light-crawl: lock check failed", JSON.stringify(error)); return true; }
  return !!data && Date.now() - Date.parse(data.started_at) < LOCK_STALE_MS;
}

/**
 * Circuit: the last N real runs all blocked|error. Auto-reopens CIRCUIT_COOLDOWN_MS (24h) after
 * the newest of those failing runs - the reopen attempt is a normal scheduled crawl; if it fails
 * again the failure count is still >= CIRCUIT_AFTER_FAILURES so the circuit closes for another 24h.
 * Manual crawls never consult this - runCrawl only checks it for scheduling/alerting, not to block.
 */
export async function circuitOpen(competitor: CompetitorKey): Promise<boolean> {
  const runs = (await recentRuns(competitor, CIRCUIT_AFTER_FAILURES + 2))
    .filter((r) => r.status !== "skipped" && r.status !== "running").slice(0, CIRCUIT_AFTER_FAILURES);
  if (runs.length < CIRCUIT_AFTER_FAILURES || !runs.every((r) => r.status === "blocked" || r.status === "error")) return false;
  const newestFailure = runs[0]; // recentRuns is ordered started_at desc, so index 0 is the newest
  return Date.now() - Date.parse(newestFailure.started_at) < CIRCUIT_COOLDOWN_MS;
}

/** The competitor most overdue past its interval; null when none is due. */
export async function pickDueCompetitor(now: Date = new Date()): Promise<CompetitorKey | null> {
  let best: { key: CompetitorKey; overdueMs: number } | null = null;
  for (const key of ACTIVE_COMPETITORS) {
    const scraper = scraperFor(key);
    if (scraper.mode === "table") continue;                       // refreshed by the nightly, not the tick
    if (scraper.crawlFrom === "local") continue;                  // crawled by scripts/crawl-local.ts off an Israeli address
    const runs = await recentRuns(key, 10);
    const lastGood = runs.find((r) => r.status === "ok" || r.status === "partial");
    const lastAny = runs.find((r) => r.status !== "running" && r.status !== "skipped");
    // A VISIT is a visit, successful or not: a failed one waits a full interval too, and only then
    // is the site tried again. Counting only good runs meant a site that kept failing (ISSTA on
    // 2026-09-15: HTTP 200 with an empty catalog from Vercel's IP) stayed permanently "overdue" and
    // was re-crawled every hour until the circuit opened - the opposite of "gentle, every few days".
    const since = lastAny?.status === "blocked" || lastAny?.status === "error" ? lastAny : lastGood;
    const ageMs = since ? now.getTime() - Date.parse(since.started_at) : Number.POSITIVE_INFINITY;
    const overdueMs = ageMs - scraper.intervalHours * 3_600_000;
    if (overdueMs < 0) continue;
    if (await circuitOpen(key)) continue;
    if (!best || overdueMs > best.overdueMs) best = { key, overdueMs };
  }
  return best?.key ?? null;
}

function listingChanged(
  prev: { price_from: number | null; event_date: string | null; travel_depart: string | null; travel_return: string | null; title: string; url: string; attrs: unknown } | null,
  next: Listing,
): boolean {
  if (!prev) return true;
  return Number(prev.price_from) !== Number(next.price_from) || prev.event_date !== next.event_date ||
    prev.travel_depart !== next.travel_depart || prev.travel_return !== next.travel_return ||
    prev.title !== next.title || prev.url !== next.url ||
    (next.attrs != null && JSON.stringify(prev.attrs ?? null) !== JSON.stringify(next.attrs));
}

/**
 * What a detail page taught us, kept when the catalog card cannot say it.
 *
 * The catalog pass used to write the card's values straight over the row: LiveEvents cards carry
 * no travel dates (only the detail page does), and Golasso cards price in £ while the detail page
 * prices in € - so every 72h crawl wiped the enriched dates, flipped the price's currency, marked
 * the listing "changed" (re-buying its AI verdict) and left it wrong until a detail refresh came
 * round. Rules: a date the card does not print keeps the stored one; a price the card does not
 * print, or prints in a DIFFERENT currency than an enriched row already holds, keeps the stored
 * price. A card price in the same currency is still the card's truth and always wins.
 */
function keepDetailFacts(l: Listing, prev: PrevListing | null): Listing {
  if (!prev) return l;
  const enriched = !!prev.detail_text;
  const keepPrice = enriched && prev.price_from != null && prev.currency != null &&
    (l.price_from == null || (l.currency != null && l.currency !== prev.currency));
  return {
    ...l,
    travel_depart: l.travel_depart ?? prev.travel_depart,
    travel_return: l.travel_return ?? prev.travel_return,
    ...(keepPrice ? { price_from: prev.price_from, currency: prev.currency, price_usd: prev.price_usd } : {}),
  };
}

/** The stored state of one listing - what change detection compares against and what the write merges into. */
interface PrevListing {
  /** Carried for fetchPaged's dedupe only; the id a write reports comes back from the upsert itself. */
  id: number;
  external_key: string;
  price_from: number | null;
  currency: Currency | null;
  price_usd: number | null;
  event_date: string | null;
  travel_depart: string | null;
  travel_return: string | null;
  title: string;
  url: string;
  attrs: unknown;
  detail_text: string | null;
  last_changed_at: string;
}
const PREV_LISTING_COLUMNS =
  "id,external_key,price_from,currency,price_usd,event_date,travel_depart,travel_return,title,url,attrs,detail_text,last_changed_at";

/** One buffered catalog write: the row to upsert, keyed for the response, plus its change verdict. */
interface PendingWrite { key: string; row: Record<string, unknown>; changed: boolean }

/**
 * Every listing this competitor already has, in ONE paged read, so the catalog loop can decide
 * `changed` in memory instead of selecting a row per listing. Throws on failure: a total preload
 * failure would otherwise make every row look new AND drop the `attrs` carry-forward, which is a
 * far worse outcome than reporting the run as an error (the DB is down either way).
 */
async function loadExistingListings(competitor: CompetitorKey): Promise<Map<string, PrevListing>> {
  const { rows, truncated, error } = await fetchPaged<PrevListing>(
    () => db.from("competitor_listings").select(PREV_LISTING_COLUMNS)
      .eq("competitor", competitor).order("id", { ascending: true }),
    LISTINGS_LOAD_MAX_ROWS,
  );
  if (error) {
    console.error("price-light-crawl: listings preload failed", JSON.stringify(error));
    throw new Error(`listings preload ${competitor}: ${error.message}`);
  }
  if (truncated) {
    // Same reasoning as the error branch above, and the same remedy: a partial map is WORSE than
    // no run at all, because every listing past the cap looks new (fresh `last_changed_at`, which
    // re-triggers matching and any AI verdict) and loses its `attrs`/`detail_text` carry-forward.
    // Unreachable today (cap 50k vs ~1.9k rows) - this exists so that stops being true loudly.
    console.error(`price-light-crawl: ${competitor} listings preload hit the ${LISTINGS_LOAD_MAX_ROWS}-row cap - raise it`);
    throw new Error(`listings preload ${competitor}: truncated at ${LISTINGS_LOAD_MAX_ROWS} rows`);
  }
  const byKey = new Map<string, PrevListing>();
  for (const row of rows) byKey.set(row.external_key, row);
  return byKey;
}

/**
 * The row to upsert plus the state it leaves behind (what a repeat of the same external_key
 * later in the run compares against - the old path re-selected the row and saw exactly this).
 *
 * Every row in a bulk upsert MUST carry the SAME keys: PostgREST writes NULL into a column that
 * some rows in the array omit, which would wipe `detail_text` and violate `last_changed_at`'s
 * NOT NULL. So both are always present, carrying the stored value forward when this listing
 * doesn't supply one - the exact equivalent of the old "only set this column when ..." rules,
 * since rewriting a column with its own value is a no-op.
 */
function buildListingWrite(
  l: Listing, prev: PrevListing | null, runId: number | null, nowIso: string, changed: boolean,
): { row: Record<string, unknown>; next: PrevListing } {
  const next: PrevListing = {
    id: prev?.id ?? 0,
    external_key: l.external_key,
    price_from: l.price_from, currency: l.currency, price_usd: l.price_usd, event_date: l.event_date,
    travel_depart: l.travel_depart, travel_return: l.travel_return,
    title: l.title, url: l.url,
    attrs: l.attrs ?? prev?.attrs ?? null,
    detail_text: l.detail_text ?? prev?.detail_text ?? null,
    last_changed_at: changed ? nowIso : prev?.last_changed_at ?? nowIso,
  };
  const row: Record<string, unknown> = {
    competitor: l.competitor, external_key: l.external_key, scope: l.scope, title: l.title, title_he: l.title_he,
    event_date: l.event_date, city: l.city, venue: l.venue, price_from: l.price_from, currency: l.currency,
    price_usd: l.price_usd, travel_depart: l.travel_depart, travel_return: l.travel_return,
    attrs: next.attrs, detail_text: next.detail_text, url: l.url,
    last_seen_at: nowIso, last_changed_at: next.last_changed_at, run_id: runId,
  };
  return { row, next };
}

/** `.in(...)` is a URL filter - a whole catalog's ids in one call risks an over-long query string. */
const IN_CHUNK = 200;

function chunkIds(ids: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(ids.slice(i, i + IN_CHUNK));
  return out;
}

/** Enrichment slots a run may spend REFRESHING listings it already has a detail page for.
 *  Capped so refreshes can never crowd out listings nobody has ever opened - that is what
 *  kept the queue standing still (2026-09-13: 18 of 570 enriched, run after run). */
export const DETAIL_REFRESH_SLICE = 6;
/** Name overlap that makes a listing plausibly ours. Deliberately looser than the matcher's
 *  RULE_MATCH_MIN_SCORE: this only decides what is worth READING, and a page we never fetch
 *  can never be matched by anything - not by the rule, not by the AI. */
export const DETAIL_NAME_MIN_SCORE = 0.5;
/** Our own future events - already past PostgREST's 1000-row cap, so this read is paged. */
const EVENTS_LOAD_MAX_ROWS = 5_000;

/** Ids whose full rows are actually fetched. A run can enrich ~20 pages inside the budget, and
 *  every fetched row drags its `detail_text` along (up to 2000 chars) - reading the whole
 *  570-long queue to use its head would be a ~1MB round trip per crawl for nothing. */
export const DETAIL_FETCH_MAX = 80;

interface DetailPick {
  id: number; event_date: string | null; detail_text: string | null;
  title: string; title_he: string | null; last_changed_at: string | null;
}

function dayWindow(day: string): string[] {
  const d = new Date(`${day}T00:00:00.000Z`);
  return [-1, 0, 1].map((delta) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + delta);
    return x.toISOString().slice(0, 10);
  });
}

/**
 * The detail queue, in the order it should be spent - most useful page first.
 *
 * A crawl affords roughly twenty detail pages inside CRAWL_BUDGET_MS, and LiveEvents alone puts
 * 570 listings on one of our dates, so WHICH twenty is the whole question. Before this the
 * answer was "whatever PostgREST returned first, including every already-enriched matched
 * listing": the same head of the list was re-fetched every run while 568 listings stayed blank
 * (measured 2026-09-13). A listing with no detail page has no nights, no stars and - on
 * LiveEvents, where the price only appears there - no price at all, so it can never become a
 * real comparison.
 *
 * Order:
 *   1. matched, never enriched        - it is setting a light RIGHT NOW and we cannot see inside
 *   2. plausibly ours, never enriched - same date, and the title covers our event's name
 *   3. on one of our dates, never enriched - the long tail, unchanged from before
 *   4. matched, already enriched      - at most DETAIL_REFRESH_SLICE per run, because a matched
 *      listing's price does move and on LiveEvents that price lives on the detail page
 *
 * Every read checks its `error`: a swallowed failure would return an empty queue, so the run
 * enriches NOTHING while still reporting `ok` - a silent wrong answer that looks like success.
 */
async function listingIdsWorthDetail(competitor: CompetitorKey, ids: number[]): Promise<number[]> {
  const matched = new Set<number>();
  for (const chunk of chunkIds(ids)) {
    const { data, error } = await db.from("competitor_matches").select("listing_id")
      .eq("competitor", competitor).eq("status", "found").in("listing_id", chunk);
    if (error) { console.error("price-light-crawl: matched-listings read failed", JSON.stringify(error)); throw new Error(`detail targets ${competitor}: ${error.message}`); }
    for (const m of (data ?? []) as { listing_id: number }[]) matched.add(m.listing_id);
  }

  // `id` is selected for `fetchPaged`'s dedup key, not for its own sake - a row that slides
  // across a page boundary mid-pagination must not be counted twice.
  const { rows: events, error: eventsError, truncated } = await fetchPaged<{ id: number; name: string; name_english: string | null; date: string }>(
    () => db.from("events").select("id,name,name_english,date").is("is_deleted", null)
      .gte("date", new Date().toISOString().slice(0, 10)).order("date", { ascending: true }),
    EVENTS_LOAD_MAX_ROWS,
  );
  if (eventsError) { console.error("price-light-crawl: event dates read failed", JSON.stringify(eventsError)); throw new Error(`detail targets ${competitor}: ${eventsError.message}`); }
  if (truncated) console.error(`price-light-crawl: event list truncated at ${EVENTS_LOAD_MAX_ROWS} - detail queue may miss late events`);
  const namesByDay = new Map<string, string[]>();
  for (const e of events) {
    const day = e.date.slice(0, 10);
    const list = namesByDay.get(day) ?? [];
    list.push(e.name, ...(e.name_english ? [e.name_english] : []));
    namesByDay.set(day, list);
  }

  const rows: DetailPick[] = [];
  for (const chunk of chunkIds(ids)) {
    const { data, error } = await db.from("competitor_listings")
      .select("id,event_date,detail_text,title,title_he,last_changed_at").in("id", chunk);
    if (error) { console.error("price-light-crawl: listing dates read failed", JSON.stringify(error)); throw new Error(`detail targets ${competitor}: ${error.message}`); }
    rows.push(...((data ?? []) as DetailPick[]));
  }

  const matchedFresh: DetailPick[] = [];
  const matchedBlank: number[] = [];
  const plausible: number[] = [];
  const onDate: number[] = [];
  for (const r of rows) {
    // `!= null`, not truthiness: an EMPTY string is the marker for "we opened this page and it
    // had no package detail on it" (LiveEvents' /show/ tier pages return `{}`). Without that
    // distinction such a listing is queued again every single run, forever, and - now that the
    // queue has a stable order - permanently occupies the same early slots, starving the rest.
    const enriched = r.detail_text != null;
    if (matched.has(r.id)) {
      if (enriched) matchedFresh.push(r); else matchedBlank.push(r.id);
      continue;
    }
    if (enriched || !r.event_date) continue;
    const ourNames = dayWindow(r.event_date).flatMap((day) => namesByDay.get(day) ?? []);
    if (ourNames.length === 0) continue;
    const score = ruleMatchScore({ names: ourNames }, { id: r.id, title: r.title, title_he: r.title_he, event_date: r.event_date });
    (score >= DETAIL_NAME_MIN_SCORE ? plausible : onDate).push(r.id);
  }
  // Refresh the matched listings whose row has sat unchanged the longest, not simply the first
  // six the database handed back: that order is stable, so the same six would be refreshed for
  // ever while every other matched listing went stale untouched.
  const refresh = matchedFresh
    .sort((a, b) => (a.last_changed_at ?? "").localeCompare(b.last_changed_at ?? ""))
    .slice(0, DETAIL_REFRESH_SLICE)
    .map((r) => r.id);
  // The cap is applied to the NEW pages, not to the whole list: slicing the concatenation would
  // drop the refresh tail entirely whenever the backlog is long, which is exactly when a matched
  // listing's price has had the most time to move.
  const fresh = [...matchedBlank, ...plausible, ...onDate].slice(0, Math.max(0, DETAIL_FETCH_MAX - refresh.length));
  return [...fresh, ...refresh];
}

export async function runCrawl(
  competitor: CompetitorKey,
  trigger: CrawlTrigger,
  opts: { dryRun?: boolean; budgetMs?: number } = {},
): Promise<CrawlSummary> {
  const start = Date.now();
  const dryRun = !!opts.dryRun;
  const budget = opts.budgetMs ?? CRAWL_BUDGET_MS;

  // Guard scraperFor: an unregistered key must never throw past this function - report it as its
  // own error summary instead of crashing the caller (fix round 1, finding 5).
  let scraper: CompetitorScraper;
  try {
    scraper = scraperFor(competitor);
  } catch {
    return finish({
      competitor, status: "error", pages: 0, listings: 0, prevListings: null, changed: 0,
      detailPages: 0, failed: 0, ms: 0, note: `no scraper registered for ${competitor}`, runId: null,
    }, start);
  }

  const mode = scraper.mode === "browser" ? browserMode() : scraper.mode;
  const summary: CrawlSummary = { competitor, status: "running", pages: 0, listings: 0, prevListings: null, changed: 0, detailPages: 0, failed: 0, ms: 0, note: null, runId: null };

  if (!scrapeEnabled() && scraper.mode !== "table") {
    summary.status = "skipped"; summary.note = "PRICE_LIGHT_SCRAPE=off";
    if (!dryRun) await insertRun(summary, trigger, mode);
    return finish(summary, start);
  }
  if (scraper.mode !== "table" && (await isCrawlLocked())) {
    summary.status = "skipped"; summary.note = "locked: another crawl is running";
    if (!dryRun) await insertRun(summary, trigger, mode);
    return finish(summary, start);
  }
  // A local-only site is never crawled from Vercel, whatever asked (tick, "crawl now", the cron's
  // ?competitor= override): the answer would be a card-less page recorded as a failure, and three of
  // those open the circuit and mail. VERCEL is set on every Vercel runtime and on nothing local.
  if (scraper.crawlFrom === "local" && process.env.VERCEL) {
    summary.status = "skipped"; summary.note = "crawled only from a local (Israeli) machine - scripts/crawl-local.ts";
    if (!dryRun) await insertRun(summary, trigger, mode);
    return finish(summary, start);
  }

  const prev = (await recentRuns(competitor, 10)).find((r) => r.status === "ok" || r.status === "partial");
  summary.prevListings = prev?.listings ?? null;
  if (!dryRun) summary.runId = await insertRun(summary, trigger, mode);
  await multiCurrencyExchangeRateService.updateAllExchangeRates().catch((e) => console.error("price-light-crawl: rates refresh failed", e));

  const nowIso = new Date().toISOString();
  const ids: number[] = [];
  // Every plain GET is bounded like a page load. Node's own fetch waits ~5 minutes on a stalled
  // socket - longer than the function's maxDuration - and a site that stalls on purpose (an anti-bot
  // tactic) would otherwise kill the run before it can record itself as failed.
  const boundedFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(PAGE_TIMEOUT_MS) });
  const ctx = (page: CrawlContext["page"]): CrawlContext => ({
    page, fetch: boundedFetch, pause: scraper.mode === "table" ? async () => undefined : randomPause,
    pauseShort: scraper.mode === "table" ? async () => undefined : shortPause,
    // Page-fetch counting via a "->" substring in scraper logs was unreliable across scrapers;
    // `pages` now just marks that the (one) catalog crawl ran - detailPages counts enrichment
    // separately and both are folded together when the run row is written (fix round 1, minor).
    log: (m) => console.log(`[price-light-crawl:${competitor}] ${m}`), dryRun,
  });

  const work = async (page: CrawlContext["page"]) => {
    const c = ctx(page);
    summary.pages = 1;
    let budgetHit = false;
    // Batched catalog write path: ONE paged preload of this competitor's listings, then one
    // upsert per CATALOG_CHUNK rows. dryRun writes nothing, so it doesn't read anything either.
    const prevByKey = dryRun ? new Map<string, PrevListing>() : await loadExistingListings(competitor);
    const buffer: PendingWrite[] = [];
    const bufferedKeys = new Set<string>();

    /**
     * Writes the buffered rows in one request and folds the result into the counters:
     * `summary.listings` counts SUCCESSFUL writes only, `summary.changed` the changed ones,
     * `summary.failed` the rows that could not be written.
     * A chunk-level error must NOT lose 500 rows silently (a single bad row - e.g. one that
     * trips the phase-2 partial unique index on (competitor, scope, travel_depart,
     * travel_return) - fails the whole statement), so the chunk is retried row by row and only
     * the genuinely bad rows count as `failed`, exactly as the old per-listing path behaved.
     */
    const flushBuffer = async (): Promise<void> => {
      if (buffer.length === 0) return;
      const chunk = buffer.splice(0, buffer.length);
      bufferedKeys.clear();
      const { data, error } = await db.from("competitor_listings")
        .upsert(chunk.map((b) => b.row), { onConflict: "competitor,external_key" })
        .select("id,external_key");
      if (!error) {
        const idByKey = new Map<string, number>();
        for (const r of (data ?? []) as { id: number; external_key: string }[]) idByKey.set(r.external_key, r.id);
        for (const b of chunk) {
          summary.listings += 1;
          if (b.changed) summary.changed += 1;
          const id = idByKey.get(b.key);
          // The write succeeded, so it counts; without an id it just can't be offered to the
          // detail step below (never observed - the upsert echoes every row it wrote).
          if (id == null) { console.error(`price-light-crawl: ${competitor} upsert returned no id for ${b.key}`); continue; }
          ids.push(id);
        }
        return;
      }
      console.error(`price-light-crawl: ${competitor} chunk upsert failed (${chunk.length} rows), retrying row by row`, JSON.stringify(error));
      for (const b of chunk) {
        const { data: one, error: rowError } = await db.from("competitor_listings")
          .upsert(b.row, { onConflict: "competitor,external_key" }).select("id").single();
        if (rowError) {
          console.error(`price-light-crawl: ${competitor} listing ${b.key} upsert failed`, JSON.stringify(rowError));
          summary.failed += 1;
          continue;
        }
        summary.listings += 1;
        if (b.changed) summary.changed += 1;
        const id: number = one.id;
        ids.push(id);
      }
    };

    for await (const listing of scraper.crawl(c)) {
      if (Date.now() - start > budget) { summary.note = "budget exhausted during catalog"; summary.status = "partial"; budgetHit = true; break; }
      // `summary.listings` counts SUCCESSFUL upserts only - it's incremented once the write
      // resolves (or immediately under dryRun, which performs no upsert at all), never up front,
      // so a failed upsert is counted once via `failed` and never double-counted into `total`
      // below (fix round 2, re-review finding).
      if (dryRun) { summary.listings += 1; continue; }
      const prev = prevByKey.get(listing.external_key) ?? null;
      const merged = keepDetailFacts(listing, prev);
      const changed = listingChanged(prev, merged);
      const { row, next } = buildListingWrite(merged, prev, summary.runId, nowIso, changed);
      // The same external_key twice inside one chunk would make ON CONFLICT touch a row twice
      // ("cannot affect row a second time") and fail the whole statement - flush first so the
      // repeat lands in the next chunk, i.e. as a second write, like the old row-at-a-time path.
      if (bufferedKeys.has(listing.external_key)) await flushBuffer();
      buffer.push({ key: listing.external_key, row, changed });
      bufferedKeys.add(listing.external_key);
      // Keep the map in step with what was just queued, so a repeat of this key compares against
      // the value that will be stored - what the old per-listing select would have returned.
      prevByKey.set(listing.external_key, next);
      if (buffer.length >= CATALOG_CHUNK) await flushBuffer();
    }
    // Flush the tail - also after a budget break, so listings already crawled are stored rather
    // than thrown away; that costs one request, not another pass over the catalog.
    if (!dryRun) await flushBuffer();
    // A budget break already spent the whole run's time budget on the catalog alone - skip
    // detail enrichment entirely rather than immediately re-hitting the same budget check.
    if (budgetHit) return;
    if (!dryRun && summary.failed > 0) {
      const total = summary.listings + summary.failed;
      if (summary.listings === 0) {
        summary.status = "error";
        summary.note = `all ${summary.failed} listings failed to upsert`;
      } else if (summary.failed >= Math.ceil(FAILED_LISTING_RATIO * total)) {
        summary.status = "partial";
        summary.note = `${summary.failed} of ${total} listings failed to upsert`;
      }
    }
    if (dryRun || !scraper.detail || ids.length === 0) return;
    // The catalog is already written at this point, so a failure picking enrichment targets must
    // not throw away a good run - record it on the summary and skip enrichment for tonight. The
    // listings themselves are fine; only their attrs stay unknown until the next crawl.
    let want: number[];
    try {
      want = await listingIdsWorthDetail(competitor, ids);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`price-light-crawl: ${competitor} detail targets failed`, msg);
      const note = `detail targets unavailable (${msg.slice(0, 120)}) - catalog written, enrichment skipped`;
      summary.note = summary.note ? `${summary.note} | ${note}` : note;
      return;
    }
    // Explicit select, not "*" - only what scraper.detail() reads and what the write-back
    // below merges into. `currency` and `event_date` are part of that set: the detail page
    // may price in a different currency than the catalog card (Golasso prices in the
    // DESTINATION's currency), and `event_date` is the anchor a scraper sanity-checks a
    // parsed travel window against (review 2026-09-11, C1 + I3). The row type below is the
    // same `DetailInput` the scraper contract takes, so the two can't drift apart.
    // Chunked like every other `.in(...)` here - a whole queue of ids in one URL filter is the
    // over-long query string IN_CHUNK exists to avoid.
    const fetched: DetailRow[] = [];
    for (const chunk of chunkIds(want)) {
      const { data, error } = await db.from("competitor_listings")
        .select("id,scope,url,attrs,detail_text,travel_depart,travel_return,price_from,price_usd,currency,event_date")
        .in("id", chunk);
      if (error) { console.error("price-light-crawl: detail rows read failed", JSON.stringify(error)); continue; }
      fetched.push(...((data ?? []) as DetailRow[]));
    }
    // PostgREST answers in its own order, so re-impose the queue's: the priority computed in
    // `listingIdsWorthDetail` is the whole point, and a budget cutoff must bite the tail.
    const byId = new Map(fetched.map((r) => [r.id, r]));
    const rows = want.map((id) => byId.get(id)).filter((r): r is DetailRow => r != null);
    // Golasso/LiveEvents fetch their detail pages rather than navigating the browser to them,
    // so the honest pacing is the same-site GET pause (5-15s), not the 20-60s page-load one.
    const detailPause = (scraper.detailMode ?? scraper.mode) === "fetch" ? c.pauseShort : c.pause;
    const total = rows.length;
    for (const row of rows) {
      if (Date.now() - start > budget) {
        // A details cutoff is NOT `partial`: the catalog itself completed cleanly, and marking
        // it partial would drown the "partial-coverage crawls" view in healthy runs (I2d).
        const cutNote = `details cut at budget (${summary.detailPages} of ${total} queued enriched)`;
        summary.note = summary.note ? `${summary.note} | ${cutNote}` : cutNote;
        break;
      }
      await detailPause();
      try {
        const extra = await scraper.detail(row, c);
        summary.detailPages += 1;
        const nextCurrency = extra.currency ?? row.currency;
        // A currency-only move is a real price move: 789 GBP -> 789 EUR is a different price.
        const priceMoved = extra.price_from != null &&
          (Number(extra.price_from) !== Number(row.price_from) || nextCurrency !== row.currency);
        const { error } = await db.from("competitor_listings").update({
          attrs: extra.attrs ?? row.attrs,
          // `?? ""` marks the page as OPENED even when it carried nothing (LiveEvents' /show/
          // tier pages parse to `{}`). Null means "never fetched" and re-queues the listing next
          // run; an empty string means "fetched, nothing there" and lets the queue move on. Every
          // reader of detail_text tests truthiness, so "" behaves exactly like no text.
          detail_text: extra.detail_text ?? row.detail_text ?? "",
          travel_depart: extra.travel_depart ?? row.travel_depart, travel_return: extra.travel_return ?? row.travel_return,
          price_from: extra.price_from ?? row.price_from, price_usd: extra.price_usd ?? row.price_usd,
          currency: nextCurrency,
          ...(priceMoved ? { last_changed_at: nowIso } : {}),
        }).eq("id", row.id);
        if (error) console.error("price-light-crawl: detail write failed", JSON.stringify(error));
      } catch (e) {
        console.error(`price-light-crawl: detail ${row.url} failed`, e instanceof Error ? e.message : e);
      }
    }
  };

  try {
    if (scraper.mode === "browser") await withBrowser(work); else await work(null);
    // A whole catalog that parsed to NOTHING is a block page, a login wall or a changed layout - never
    // a healthy crawl. Recorded as ok/partial it would count as a "good crawl" and let the matcher
    // mark every event not_selling (a false "alone"), and the circuit would never open.
    if (summary.status === "running" && summary.listings === 0 && summary.failed === 0) {
      summary.status = "error";
      summary.note = summary.note ? `${summary.note} | catalog parsed 0 listings` : "catalog parsed 0 listings";
      // One mail when the circuit opens, not one per attempt: the same "0 listings" arrived twice in
      // two hours on 2026-09-15 and said nothing new the second time.
      if (!dryRun && (await circuitOpen(competitor))) await alert(competitor, `error: ${summary.note}`);
    }
    if (summary.status === "running") summary.status = "ok";
    if (summary.status !== "error" && summary.prevListings != null && summary.listings < summary.prevListings * DROP_ALARM_RATIO) {
      summary.status = "partial";
      // Don't clobber a note the failed-upsert check above may have already set - append instead
      // (fix round 2, out-of-scope observation from the re-reviewer).
      const dropNote = `listings dropped ${summary.prevListings} -> ${summary.listings} - site structure may have changed`;
      summary.note = summary.note ? `${summary.note} | ${dropNote}` : dropNote;
      if (!dryRun) await alert(competitor, summary.note);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    summary.status = /403|captcha|blocked|access denied|429/i.test(msg) ? "blocked" : "error";
    summary.note = msg.slice(0, 500);
    console.error(`price-light-crawl: ${competitor} ${summary.status}`, msg);
    if (!dryRun && (summary.status === "blocked" || (await circuitOpen(competitor)))) await alert(competitor, `${summary.status}: ${summary.note}`);
  }
  if (!dryRun && summary.runId) await finishRun(summary);
  return finish(summary, start);
}

function finish(s: CrawlSummary, start: number): CrawlSummary { s.ms = Date.now() - start; return s; }

async function insertRun(s: CrawlSummary, trigger: CrawlTrigger, mode: string): Promise<number | null> {
  const { data, error } = await db.from("competitor_crawl_runs").insert({
    competitor: s.competitor, status: s.status, trigger, prev_listings: s.prevListings, note: s.note, browser_mode: mode,
    ...(s.status !== "running" ? { finished_at: new Date().toISOString() } : {}),
  }).select("id").single();
  if (error) { console.error("price-light-crawl: run insert failed", JSON.stringify(error)); return null; }
  invalidatePriceLight("runs"); // the panel shows "running" / "skipped" the moment the row exists
  return data.id as number;
}

// Retries once after a short wait - a transient write failure here would otherwise leave the run
// row stuck in "running" forever. If the retry also fails the row stays "running": isCrawlLocked()
// already treats a "running" row older than LOCK_STALE_MS (6 min) as a crashed run rather than a
// live lock, so it ages out on its own; logging the run id here is what lets it be found and
// inspected in the meantime (fix round 1, finding 4).
async function finishRun(s: CrawlSummary): Promise<void> {
  const payload = {
    status: s.status, finished_at: new Date().toISOString(), pages: s.pages + s.detailPages, listings: s.listings, note: s.note,
  };
  const { error } = await db.from("competitor_crawl_runs").update(payload).eq("id", s.runId);
  if (!error) { invalidatePriceLight("runs"); return; }
  console.error(`price-light-crawl: run ${s.runId} finish failed, retrying in 2s`, JSON.stringify(error));
  await new Promise((r) => setTimeout(r, 2_000));
  const { error: retryError } = await db.from("competitor_crawl_runs").update(payload).eq("id", s.runId);
  if (!retryError) invalidatePriceLight("runs");
  if (retryError) {
    console.error(
      `price-light-crawl: run ${s.runId} finish failed after retry - row stuck as "running", ages out of the lock after ${LOCK_STALE_MS / 60_000}min`,
      JSON.stringify(retryError),
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function alert(competitor: CompetitorKey, note: string): Promise<void> {
  const to = process.env.NEXT_SECRET_ADMIN_EMAIL;
  if (!to) return;
  try {
    await sendMail({ to, subject: `Price light: ${competitor} crawl needs attention`, html: `<p>${escapeHtml(note)}</p><p><a href="${appOrigin()}/events">Backoffice</a></p>` });
  } catch (e) { console.error("price-light-crawl: alert mail failed", e); }
}

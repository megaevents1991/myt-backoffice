// One crawl of one competitor site (spec §3.2 / §3.4). Writes competitor_crawl_runs
// + competitor_listings. Never throws past its own summary.
// Lock = a competitor_crawl_runs row in status "running" younger than LOCK_STALE_MS.
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { appOrigin, sendMail } from "@/lib/email";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { browserMode, randomPause, scrapeEnabled, shortPause, withBrowser } from "@/lib/services/browser";
import { ACTIVE_COMPETITORS, scraperFor, type CompetitorScraper, type CrawlContext, type DetailInput, type Listing } from "@/lib/services/competitor-scrapers";
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
  return (data ?? []) as RunRowLite[];
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
    const runs = await recentRuns(key, 10);
    const lastGood = runs.find((r) => r.status === "ok" || r.status === "partial");
    const lastAny = runs.find((r) => r.status !== "running" && r.status !== "skipped");
    // A blocked site waits a full interval from the block, not from the last good run.
    const since = lastAny?.status === "blocked" ? lastAny : lastGood;
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

/** The stored state of one listing - what change detection compares against and what the write merges into. */
interface PrevListing {
  /** Carried for fetchPaged's dedupe only; the id a write reports comes back from the upsert itself. */
  id: number;
  external_key: string;
  price_from: number | null;
  currency: Currency | null;
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
  "id,external_key,price_from,currency,event_date,travel_depart,travel_return,title,url,attrs,detail_text,last_changed_at";

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
    price_from: l.price_from, currency: l.currency, event_date: l.event_date,
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

/**
 * Listings already matched, or on a date (±1 day) one of our live events has - the only ones
 * worth a detail page.
 *
 * Every read here checks its `error`: a swallowed failure returns an empty want-set, so the run
 * enriches NOTHING while still reporting `ok` - a silent wrong answer that looks like success.
 * Batching the catalog write made this reachable (the whole catalog's ids now arrive at once
 * instead of trickling in), so the failure is reported and the caller skips enrichment for this
 * run rather than pretending there was nothing to enrich.
 */
async function listingIdsWorthDetail(competitor: CompetitorKey, ids: number[]): Promise<Set<number>> {
  const want = new Set<number>();
  for (const chunk of chunkIds(ids)) {
    const { data: matched, error } = await db.from("competitor_matches").select("listing_id")
      .eq("competitor", competitor).eq("status", "found").in("listing_id", chunk);
    if (error) { console.error("price-light-crawl: matched-listings read failed", JSON.stringify(error)); throw new Error(`detail targets ${competitor}: ${error.message}`); }
    for (const m of (matched ?? []) as { listing_id: number }[]) want.add(m.listing_id);
  }
  const { data: dates, error: datesError } = await db.from("events").select("date").is("is_deleted", null).gte("date", new Date().toISOString().slice(0, 10));
  if (datesError) { console.error("price-light-crawl: event dates read failed", JSON.stringify(datesError)); throw new Error(`detail targets ${competitor}: ${datesError.message}`); }
  const ourDays = new Set<string>((dates ?? []).map((e: { date: string }) => e.date.slice(0, 10)));
  const rows: { id: number; event_date: string | null; detail_text: string | null }[] = [];
  for (const chunk of chunkIds(ids)) {
    const { data, error } = await db.from("competitor_listings").select("id,event_date,detail_text").in("id", chunk);
    if (error) { console.error("price-light-crawl: listing dates read failed", JSON.stringify(error)); throw new Error(`detail targets ${competitor}: ${error.message}`); }
    rows.push(...((data ?? []) as { id: number; event_date: string | null; detail_text: string | null }[]));
  }
  for (const r of rows) {
    if (!r.event_date || r.detail_text) continue;
    const d = new Date(`${r.event_date}T00:00:00.000Z`);
    for (const delta of [-1, 0, 1]) {
      const x = new Date(d); x.setUTCDate(x.getUTCDate() + delta);
      if (ourDays.has(x.toISOString().slice(0, 10))) { want.add(r.id); break; }
    }
  }
  return want;
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

  const prev = (await recentRuns(competitor, 10)).find((r) => r.status === "ok" || r.status === "partial");
  summary.prevListings = prev?.listings ?? null;
  if (!dryRun) summary.runId = await insertRun(summary, trigger, mode);
  await multiCurrencyExchangeRateService.updateAllExchangeRates().catch((e) => console.error("price-light-crawl: rates refresh failed", e));

  const nowIso = new Date().toISOString();
  const ids: number[] = [];
  const ctx = (page: CrawlContext["page"]): CrawlContext => ({
    page, fetch, pause: scraper.mode === "table" ? async () => undefined : randomPause,
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
      const changed = listingChanged(prev, listing);
      const { row, next } = buildListingWrite(listing, prev, summary.runId, nowIso, changed);
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
    let want: Set<number>;
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
    const { data: rows } = await db.from("competitor_listings")
      .select("id,scope,url,attrs,detail_text,travel_depart,travel_return,price_from,price_usd,currency,event_date")
      .in("id", [...want]);
    // Golasso/LiveEvents fetch their detail pages rather than navigating the browser to them,
    // so the honest pacing is the same-site GET pause (5-15s), not the 20-60s page-load one.
    const detailPause = (scraper.detailMode ?? scraper.mode) === "fetch" ? c.pauseShort : c.pause;
    const total = (rows ?? []).length;
    for (const row of (rows ?? []) as DetailRow[]) {
      if (Date.now() - start > budget) {
        // A details cutoff is NOT `partial`: the catalog itself completed cleanly, and marking
        // it partial would drown the "partial-coverage crawls" view in healthy runs (I2d).
        const cutNote = `details cut at budget (${summary.detailPages} of ${total} enriched)`;
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
          attrs: extra.attrs ?? row.attrs, detail_text: extra.detail_text ?? row.detail_text,
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
    if (summary.status === "running") summary.status = "ok";
    if (summary.prevListings != null && summary.listings < summary.prevListings * DROP_ALARM_RATIO) {
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
  if (!error) return;
  console.error(`price-light-crawl: run ${s.runId} finish failed, retrying in 2s`, JSON.stringify(error));
  await new Promise((r) => setTimeout(r, 2_000));
  const { error: retryError } = await db.from("competitor_crawl_runs").update(payload).eq("id", s.runId);
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

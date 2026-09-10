// One crawl of one competitor site (spec §3.2 / §3.4). Writes competitor_crawl_runs
// + competitor_listings. Never throws past its own summary.
// Lock = a competitor_crawl_runs row in status "running" younger than LOCK_STALE_MS.
import { supabase } from "@/lib/supabase-server";
import { appOrigin, sendMail } from "@/lib/email";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { browserMode, randomPause, scrapeEnabled, withBrowser } from "@/lib/services/browser";
import { ACTIVE_COMPETITORS, scraperFor, type CompetitorScraper, type CrawlContext, type Listing } from "@/lib/services/competitor-scrapers";
import type { CompetitorKey, CrawlStatus, CrawlTrigger } from "@/types/price-light.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const CRAWL_BUDGET_MS = 240_000;
export const LOCK_STALE_MS = 6 * 60_000;      // a "running" row older than this is a crashed run, not a lock
export const DROP_ALARM_RATIO = 0.5;          // listings < 50% of last ok run -> partial + email
export const CIRCUIT_AFTER_FAILURES = 3;      // consecutive blocked|error -> skip until a manual crawl
export const CIRCUIT_COOLDOWN_MS = 24 * 60 * 60_000; // circuit auto-reopens 24h after the newest failing run (fix round 1, finding 1)
export const FAILED_LISTING_RATIO = 0.2;      // >=20% of listings failing to upsert -> partial (0 successes -> error)

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
  prev: { price_from: number | null; event_date: string | null; title: string; url: string; attrs: unknown } | null,
  next: Listing,
): boolean {
  if (!prev) return true;
  return Number(prev.price_from) !== Number(next.price_from) || prev.event_date !== next.event_date ||
    prev.title !== next.title || prev.url !== next.url ||
    (next.attrs != null && JSON.stringify(prev.attrs ?? null) !== JSON.stringify(next.attrs));
}

async function upsertListing(l: Listing, runId: number | null, nowIso: string): Promise<{ id: number; changed: boolean }> {
  const { data: prev } = await db.from("competitor_listings").select("id,price_from,event_date,title,url,attrs")
    .eq("competitor", l.competitor).eq("external_key", l.external_key).maybeSingle();
  const changed = listingChanged(prev ?? null, l);
  const row: Record<string, unknown> = {
    competitor: l.competitor, external_key: l.external_key, scope: l.scope, title: l.title, title_he: l.title_he,
    event_date: l.event_date, city: l.city, venue: l.venue, price_from: l.price_from, currency: l.currency,
    price_usd: l.price_usd, travel_depart: l.travel_depart, travel_return: l.travel_return,
    attrs: l.attrs ?? prev?.attrs ?? null, url: l.url, last_seen_at: nowIso, run_id: runId,
  };
  if (l.detail_text) row.detail_text = l.detail_text;
  if (changed) row.last_changed_at = nowIso;
  const { data, error } = await db.from("competitor_listings")
    .upsert(row, { onConflict: "competitor,external_key" }).select("id").single();
  if (error) { console.error("price-light-crawl: listing upsert failed", JSON.stringify(error)); throw new Error(`listing upsert ${l.external_key}: ${error.message}`); }
  return { id: data.id, changed };
}

/** Listings already matched, or on a date (±1 day) one of our live events has - the only ones worth a detail page. */
async function listingIdsWorthDetail(competitor: CompetitorKey, ids: number[]): Promise<Set<number>> {
  const { data: matched } = await db.from("competitor_matches").select("listing_id")
    .eq("competitor", competitor).eq("status", "found").in("listing_id", ids);
  const want = new Set<number>((matched ?? []).map((m: { listing_id: number }) => m.listing_id));
  const { data: dates } = await db.from("events").select("date").is("is_deleted", null).gte("date", new Date().toISOString().slice(0, 10));
  const ourDays = new Set<string>((dates ?? []).map((e: { date: string }) => e.date.slice(0, 10)));
  const { data: rows } = await db.from("competitor_listings").select("id,event_date,detail_text").in("id", ids);
  for (const r of (rows ?? []) as { id: number; event_date: string | null; detail_text: string | null }[]) {
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
    // Page-fetch counting via a "->" substring in scraper logs was unreliable across scrapers;
    // `pages` now just marks that the (one) catalog crawl ran - detailPages counts enrichment
    // separately and both are folded together when the run row is written (fix round 1, minor).
    log: (m) => console.log(`[price-light-crawl:${competitor}] ${m}`), dryRun,
  });

  const work = async (page: CrawlContext["page"]) => {
    const c = ctx(page);
    summary.pages = 1;
    let budgetHit = false;
    for await (const listing of scraper.crawl(c)) {
      if (Date.now() - start > budget) { summary.note = "budget exhausted during catalog"; summary.status = "partial"; budgetHit = true; break; }
      // `summary.listings` counts SUCCESSFUL upserts only - it's incremented after the upsert
      // resolves (or immediately under dryRun, which performs no upsert at all), never up front,
      // so a failed upsert is counted once via `failed` and never double-counted into `total`
      // below (fix round 2, re-review finding).
      if (dryRun) { summary.listings += 1; continue; }
      // One bad listing must not abort the whole run - upsertListing already logged the
      // Supabase error before throwing; count the failure and move on (fix round 1, finding 3).
      try {
        const { id, changed } = await upsertListing(listing, summary.runId, nowIso);
        summary.listings += 1;
        ids.push(id);
        if (changed) summary.changed += 1;
      } catch (e) {
        console.error(`price-light-crawl: ${competitor} listing upsert failed`, e instanceof Error ? e.message : e);
        summary.failed += 1;
      }
    }
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
    const want = await listingIdsWorthDetail(competitor, ids);
    // Explicit select, not "*" - only what scraper.detail() reads (scope, url) and what the
    // write-back below merges into (id, attrs, detail_text, travel_depart/return, price_from/usd).
    const { data: rows } = await db.from("competitor_listings")
      .select("id,scope,url,attrs,detail_text,travel_depart,travel_return,price_from,price_usd")
      .in("id", [...want]);
    for (const row of (rows ?? []) as (Listing & { id: number })[]) {
      if (Date.now() - start > budget) { summary.note = "budget exhausted during details"; summary.status = "partial"; break; }
      await c.pause();
      try {
        const extra = await scraper.detail(row, c);
        summary.detailPages += 1;
        const priceMoved = extra.price_from != null && Number(extra.price_from) !== Number(row.price_from);
        const { error } = await db.from("competitor_listings").update({
          attrs: extra.attrs ?? row.attrs, detail_text: extra.detail_text ?? row.detail_text,
          travel_depart: extra.travel_depart ?? row.travel_depart, travel_return: extra.travel_return ?? row.travel_return,
          price_from: extra.price_from ?? row.price_from, price_usd: extra.price_usd ?? row.price_usd,
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

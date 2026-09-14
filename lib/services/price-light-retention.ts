// Price-light retention: keep 180 days, drop what is older (Dor, 2026-09-14).
//
// These tables only ever grow, and almost none of what they hold is read again:
// `event_price_snapshots` gains ~424 rows a DAY while the price-drop rule reads 14 days back,
// `competitor_matches` gains ~170-300 a night, `competitor_listings` keeps advertising events
// that happened months ago, and the hourly tick files a crawl run every hour.
//
// WHAT THIS DELETES IS GONE - these are backoffice-only log tables, so a hard delete is the right
// policy here (the soft-delete rule is about `events`, which this never touches, and
// `purgeAuditLog` already sets the precedent). Two properties keep it safe:
//
//   1. Nothing live can be dropped. Matches and listings are cut by what they DESCRIBE, not by
//      their own age: a match dies only once its EVENT is 180 days past, and a listing only once
//      no crawl has seen it for 180 days. A quiet match row that is still the newest verdict for
//      a future event is never touched, however old it is - deleting one would silently erase
//      that event's light at the next recompute.
//   2. `dryRun` counts exactly what a real run would remove and writes nothing.
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";

// New tables predate the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** One window for everything - Dor picked 180 days, and one number is easier to reason about than
 *  four. Every read path lives far inside it: the price-drop lookback is 14 days, a light goes
 *  stale at 14, and the crawl circuit reads the last handful of runs. */
export const RETENTION_DAYS = 180;
/** Ids per `.in(...)` filter - a whole delete set in one URL is an over-long query string. */
const DELETE_CHUNK = 200;
/** Past events resolved in one paged read. Grows only with the catalog's age. */
const PAST_EVENTS_MAX = 50_000;
/** The price-light decisions the agent learns from live in `audit_log`, which `purgeAuditLog`
 *  hard-deletes after 30 days. That silently capped the agent's memory at a month while it was
 *  asked to look back 120 days, so those rows are excluded there and expire HERE instead. */
export const AUDIT_ACTION_PREFIX = "price_light.";

export interface RetentionSummary {
  dryRun: boolean;
  cutoff: string;               // YYYY-MM-DD
  snapshots: number;
  matches: number;
  listings: number;
  runs: number;
  auditRows: number;
  errors: string[];
  ms: number;
}

function chunk<T>(xs: T[], size = DELETE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Events whose date is more than RETENTION_DAYS in the past - what finally makes a match
 * irrelevant. Soft-deleted ones are included on purpose: an event pulled from the site months ago
 * is exactly the kind whose comparison history nobody will read again.
 */
async function longPastEventIds(cutoffDay: string): Promise<number[]> {
  const { rows, error, truncated } = await fetchPaged<{ id: number }>(
    () => db.from("events").select("id").lt("date", cutoffDay).order("id", { ascending: true }),
    PAST_EVENTS_MAX,
  );
  if (error) throw new Error(`events: ${error.message}`);
  if (truncated) console.error(`price-light-retention: past events hit the ${PAST_EVENTS_MAX} cap - raise it`);
  return rows.map((r) => r.id);
}

/**
 * Delete everything past the window. Never throws past its own summary: a failure on one table is
 * recorded and the rest still run, because a pass that stops halfway is how one broken table
 * quietly keeps every other one growing.
 */
export async function runPriceLightRetention(opts: { dryRun?: boolean } = {}): Promise<RetentionSummary> {
  const start = Date.now();
  const dryRun = !!opts.dryRun;
  const cutoffMs = Date.now() - RETENTION_DAYS * 86_400_000;
  const cutoffDay = new Date(cutoffMs).toISOString().slice(0, 10);
  const cutoffIso = new Date(cutoffMs).toISOString();
  const summary: RetentionSummary = {
    dryRun, cutoff: cutoffDay, snapshots: 0, matches: 0, listings: 0, runs: 0, auditRows: 0, errors: [], ms: 0,
  };

  const step = async (name: string, fn: () => Promise<number>): Promise<number> => {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`price-light-retention: ${name} failed`, msg);
      summary.errors.push(`${name}: ${msg}`);
      return 0;
    }
  };

  /** Count on a dry run, delete-and-count on a real one - same filter either way. */
  const sweep = async (table: string, apply: (q: any) => any): Promise<number> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (dryRun) {
      const { count, error } = await apply(db.from(table).select("*", { count: "exact", head: true }));
      if (error) throw new Error(error.message);
      return count ?? 0;
    }
    const { count, error } = await apply(db.from(table).delete({ count: "exact" }));
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  // 1. Our own daily price snapshots - by their own day, the simplest case and the biggest win.
  summary.snapshots = await step("snapshots", () => sweep("event_price_snapshots", (q) => q.lt("day", cutoffDay)));

  // 2. Matches - by the EVENT they describe, never by their own age (see the header). Resolving
  //    the ids and sweeping them is ONE step: if the lookup fails there is nothing to sweep, and
  //    an empty list must never be read as "nothing to delete".
  summary.matches = await step("matches", async () => {
    const pastIds = await longPastEventIds(cutoffDay);
    let total = 0;
    for (const ids of chunk(pastIds)) total += await sweep("competitor_matches", (q) => q.in("event_id", ids));
    return total;
  });

  // 3. Listings - a listing nobody has seen for six months is off their site. `last_seen_at` is
  //    stamped by every crawl, so anything still on sale is refreshed long before the window.
  summary.listings = await step("listings", () => sweep("competitor_listings", (q) => q.lt("last_seen_at", cutoffIso)));

  // 4. Crawl runs - tiny, but one an hour forever.
  summary.runs = await step("runs", () => sweep("competitor_crawl_runs", (q) => q.lt("started_at", cutoffIso)));

  // 5. The decisions the agent learns from, which purgeAuditLog now leaves alone.
  summary.auditRows = await step("audit", () => sweep(
    "audit_log",
    (q) => q.like("action", `${AUDIT_ACTION_PREFIX}%`).lt("created_at", cutoffIso),
  ));

  summary.ms = Date.now() - start;
  return summary;
}

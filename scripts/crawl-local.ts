/**
 * Crawl one competitor from THIS machine and write the result to the shared backoffice DB -
 * for sites that cannot be crawled from Vercel (`crawlFrom: "local"`, today only ISSTA: its
 * league pages answer Vercel's address with HTTP 200 and no cards, an Israeli address gets
 * them). It goes through the same `runCrawl` as the hourly tick, so the run row, the listing
 * upserts, the circuit and the panel on /price-light all read a local run exactly like a
 * Vercel one - Vercel's own tick never touches a local-only site.
 *
 *   npx tsx --env-file=.env.local scripts/crawl-local.ts issta [--force] [--dry-run]
 *
 * Meant to be run DAILY by Windows Task Scheduler (a machine that is off some days): the
 * script itself decides whether the site is due - it only crawls when the newest real run
 * (ok/partial/blocked/error, not skipped/running) is older than the scraper's `intervalHours`
 * (168h on ISSTA) - and exits 0 with "not due" otherwise. That is what turns "every day the
 * machine is on" into "once a week, catching up after off days" without a stateful trigger.
 * `--force` skips the due check (a manual refresh), `--dry-run` browses but writes nothing.
 *
 * Exit code: 0 on ok/partial/not-due/skipped, 1 on blocked/error or a crash, so the task's
 * "last run result" column in Task Scheduler is meaningful. Set up by scripts/crawl-local-task.ps1.
 */
import { ACTIVE_COMPETITORS, scraperFor } from "@/lib/services/competitor-scrapers";
import { runCrawl } from "@/lib/services/price-light-crawl";
import { supabase } from "@/lib/supabase-server";
import type { CompetitorKey } from "@/types/price-light.types";

// Backoffice-only table that predates the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(msg: string): void {
  console.log(`${stamp()} ${msg}`);
}

/** ISO start of the newest run that counts toward the interval (pickDueCompetitor's rule), or null. */
async function lastVisitAt(competitor: CompetitorKey): Promise<string | null> {
  const { data, error } = await db
    .from("competitor_crawl_runs")
    .select("started_at,status")
    .eq("competitor", competitor)
    .in("status", ["ok", "partial", "blocked", "error"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`runs load failed: ${JSON.stringify(error)}`);
  return (data as { started_at: string } | null)?.started_at ?? null;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const competitor = args.find((a) => !a.startsWith("--")) as CompetitorKey | undefined;
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  if (!competitor || !ACTIVE_COMPETITORS.includes(competitor)) {
    console.error(`usage: crawl-local.ts <${ACTIVE_COMPETITORS.join("|")}> [--force] [--dry-run]`);
    return 1;
  }
  if (process.env.VERCEL) {
    console.error("crawl-local.ts is for a local machine, not Vercel");
    return 1;
  }
  const scraper = scraperFor(competitor);

  if (!force) {
    const last = await lastVisitAt(competitor);
    const ageH = last ? (Date.now() - Date.parse(last)) / 3_600_000 : Number.POSITIVE_INFINITY;
    if (ageH < scraper.intervalHours) {
      log(`${competitor}: not due - last visit ${ageH.toFixed(1)}h ago, interval ${scraper.intervalHours}h`);
      return 0;
    }
    log(`${competitor}: due - last visit ${last ? `${ageH.toFixed(1)}h ago` : "never"}`);
  } else {
    log(`${competitor}: forced`);
  }

  const summary = await runCrawl(competitor, dryRun ? "dry_run" : "manual", { dryRun });
  log(`${competitor}: ${summary.status} - ${summary.listings} listings (prev ${summary.prevListings ?? "-"}), ` +
    `${summary.changed} changed, ${summary.detailPages} detail pages, ${summary.failed} failed, ${Math.round(summary.ms / 1000)}s` +
    `${summary.note ? ` | ${summary.note}` : ""}`);
  return summary.status === "blocked" || summary.status === "error" ? 1 : 0;
}

// No immediate process.exit: on the fast "not due" path Node 24 on Windows aborted with
// `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` (exit 127 - which Task Scheduler
// would show as a failure) because the Supabase client's socket was still closing. Set the
// exit code and let the loop drain; the unref'd timer only fires if something keeps it alive.
function done(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 3_000).unref();
}

main()
  .then(done)
  .catch((e) => {
    console.error(`${stamp()} crawl-local crashed:`, e instanceof Error ? e.stack ?? e.message : e);
    done(1);
  });

/**
 * One real crawl session, no DB writes. Prints listings as JSON to stdout, logs to stderr.
 * Run: node --env-file=.env.local scripts/scrape-once.ts liveevents [--detail <external_key>]
 *
 * Not run as part of Task 6 (fixtures already spend one visit per page against the real
 * site) - kept type-check-only for now. `scraperFor` pulls in every registered scraper
 * (including livetickets-api.ts's "@/lib/supabase-server" import), which plain `node` can't
 * resolve without a path-alias loader, so this script needs one before it can actually run.
 */
import { withBrowser, randomPause } from "../lib/services/browser.ts";
import { scraperFor } from "../lib/services/competitor-scrapers/index.ts";
import type { CrawlContext, Listing } from "../lib/services/competitor-scrapers/types.ts";
import type { CompetitorKey } from "../types/price-light.types.ts";

const key = process.argv[2] as CompetitorKey;
const detailKey = process.argv.includes("--detail") ? process.argv[process.argv.indexOf("--detail") + 1] : null;
const scraper = scraperFor(key);

const run = async (page: CrawlContext["page"]) => {
  const ctx: CrawlContext = { page, fetch, pause: randomPause, log: (m) => console.error(m), dryRun: true };
  const listings: Listing[] = [];
  for await (const l of scraper.crawl(ctx)) listings.push(l);
  console.log(JSON.stringify(listings, null, 2));
  if (detailKey && scraper.detail) {
    const target = listings.find((l) => l.external_key === detailKey);
    if (target) console.log(JSON.stringify(await scraper.detail(target, ctx), null, 2));
  }
  return listings.length;
};

async function main(): Promise<void> {
  const count = scraper.mode === "browser" ? await withBrowser(run) : await run(null);
  console.error(`${key}: ${count} listings`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

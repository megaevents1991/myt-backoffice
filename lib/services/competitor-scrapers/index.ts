import type { CompetitorKey } from "@/types/price-light.types";
import type { CompetitorScraper } from "./types";
import { liveevents } from "./liveevents";
import { livetickets } from "./livetickets-api";

// Phase 0: liveevents (Task 6) + livetickets (Task 5). Phase 2 adds issta, golasso, ontour.
// A competitor NOT in this map never counts toward "alone".
export const SCRAPERS: Partial<Record<CompetitorKey, CompetitorScraper>> = {};
SCRAPERS.liveevents = liveevents;
SCRAPERS.livetickets = livetickets;

// Keep this line LAST - it must run after every SCRAPERS.x = ... assignment.
export const ACTIVE_COMPETITORS: readonly CompetitorKey[] = Object.keys(SCRAPERS) as CompetitorKey[];

export function scraperFor(key: CompetitorKey): CompetitorScraper {
  const scraper = SCRAPERS[key];
  if (!scraper) throw new Error(`price-light: no scraper registered for ${key}`);
  return scraper;
}
export type { CompetitorScraper, CrawlContext, Listing } from "./types";

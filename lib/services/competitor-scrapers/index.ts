import type { CompetitorKey } from "@/types/price-light.types";
import type { CompetitorScraper } from "./types";
import { liveevents } from "./liveevents";
import { issta } from "./issta";
import { golasso } from "./golasso";
import { ontour } from "./ontour";
import { livetickets } from "./livetickets-api";

// Registration order = the order the crawl panel lists them. A competitor NOT in this map
// never counts toward "alone". livetickets stays last (table mode, refreshed by the nightly).
export const SCRAPERS: Partial<Record<CompetitorKey, CompetitorScraper>> = {};
SCRAPERS.liveevents = liveevents;
SCRAPERS.issta = issta;
SCRAPERS.golasso = golasso;
SCRAPERS.ontour = ontour;
SCRAPERS.livetickets = livetickets;

// Keep this line LAST - it must run after every SCRAPERS.x = ... assignment.
export const ACTIVE_COMPETITORS: readonly CompetitorKey[] = Object.keys(SCRAPERS) as CompetitorKey[];

export function scraperFor(key: CompetitorKey): CompetitorScraper {
  const scraper = SCRAPERS[key];
  if (!scraper) throw new Error(`price-light: no scraper registered for ${key}`);
  return scraper;
}
export type { CompetitorScraper, CrawlContext, DetailInput, Listing } from "./types";

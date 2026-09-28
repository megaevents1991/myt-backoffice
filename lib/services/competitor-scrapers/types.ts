import type { Page } from "playwright-core";
import type { CompetitorKey, EventKind, ListingRow, Scope } from "@/types/price-light.types";

export type Listing = Omit<ListingRow, "id" | "first_seen_at" | "last_seen_at" | "last_changed_at" | "run_id">;

/**
 * Exactly the columns `runCrawl`'s detail loop selects and hands to `scraper.detail()`
 * (price-light-crawl.ts). Narrower than `Listing` ON PURPOSE: the loop reads nine columns,
 * so a scraper that reads anything else must fail to compile rather than read `undefined`
 * at runtime (review 2026-09-11, I3).
 */
export type DetailInput = Pick<
  Listing,
  "scope" | "url" | "attrs" | "detail_text" | "travel_depart" | "travel_return" | "price_from" | "price_usd" | "currency" | "event_date"
>;

export interface CrawlContext {
  /** null in "fetch" and "table" modes. */
  page: Page | null;
  fetch: typeof fetch;
  /** Random 20-60s pause - between browser page loads and between sites. */
  pause: () => Promise<void>;
  /** Random 5-15s pause - only between paginated GETs of the same site in fetch mode. */
  pauseShort: () => Promise<void>;
  log: (msg: string) => void;
  /**
   * PART of the catalog failed or came back empty while the rest was fine (one of LiveEvents'
   * two boards). `runCrawl` records the run `partial` with this note and mails - before this
   * existed such a run read "ok", and LiveEvents' music listings went stale for two weeks
   * unnoticed (2026-09-15..28). Optional: a details pass does not listen for it.
   */
  degrade?: (note: string) => void;
  dryRun: boolean;
}

export interface CompetitorScraper {
  key: CompetitorKey;
  scopes: Scope[];
  kinds: EventKind[];
  /** Minimum hours between two crawls of this site. >= 24. */
  intervalHours: number;
  /** browser = Playwright page; fetch = the site serves JSON; table = no network (LiveTickets from live_events). */
  mode: "browser" | "fetch" | "table";
  /**
   * How `detail()` loads its page, when that differs from `mode` (default = `mode`).
   * A browser-mode catalog whose detail pages are plain server-rendered GETs declares
   * `"fetch"` here, and the crawl loop then paces them with `pauseShort()` (5-15 s, the
   * same-site GET rule) instead of the 20-60 s browser-navigation pause - which is what
   * makes detail enrichment finish inside the crawl budget (review 2026-09-11, I2).
   */
  detailMode?: "fetch" | "browser";
  /**
   * Where this site can actually be crawled from (default `"vercel"`). `"local"` = the site
   * serves foreign/datacenter addresses a page without its cards (ISSTA, 2026-09-15: HTTP 200,
   * zero `deal-item-container`s from Vercel's IP, 21 from an Israeli connection), so the
   * hourly tick never picks it, `runCrawl` records `skipped` when it runs ON Vercel, and the
   * panel shows no "סרוק עכשיו". The catalog is refreshed by `scripts/crawl-local.ts` on a
   * machine with an Israeli address - it writes the same run row, so the panel and the
   * freshness rules read it exactly like a Vercel run. LiveEvents too since 2026-09-28: its
   * music board's AJAX answers Vercel with no rows (header of liveevents.ts).
   */
  crawlFrom?: "vercel" | "local";
  crawl(ctx: CrawlContext): AsyncGenerator<Listing>;
  /** Fetch the detail page of a listing we matched: attrs + detail_text. Same session. */
  detail?(listing: DetailInput, ctx: CrawlContext): Promise<Partial<Listing>>;
  /**
   * Does this site's crawled catalog cover the event's vertical at all? Optional; absent = yes.
   * It gates ONLY the absence claim: a `false` makes the matcher record `skipped` instead of
   * `not_selling`, so the competitor drops out of the "alone" quorum and the scope lands on
   * `partial_coverage` rather than claiming "nobody sells it" off a section we never opened
   * (review 2026-09-11, I1). A found/unsure match is evidence regardless and is never gated.
   */
  covers?(event: { type: string; name: string; name_english: string | null; tagSlugs: string[] }): boolean;
}

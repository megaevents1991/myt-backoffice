import type { Page } from "playwright-core";
import type { CompetitorKey, EventKind, ListingRow, Scope } from "@/types/price-light.types";

export type Listing = Omit<ListingRow, "id" | "first_seen_at" | "last_seen_at" | "last_changed_at" | "run_id">;

export interface CrawlContext {
  /** null in "fetch" and "table" modes. */
  page: Page | null;
  fetch: typeof fetch;
  /** Random 20-60s pause - call between every page. */
  pause: () => Promise<void>;
  log: (msg: string) => void;
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
  crawl(ctx: CrawlContext): AsyncGenerator<Listing>;
  /** Fetch the detail page of a listing we matched: attrs + detail_text. Same session. */
  detail?(listing: Listing, ctx: CrawlContext): Promise<Partial<Listing>>;
}

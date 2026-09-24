// LiveTickets is our API supplier - dailyLiveEventsSync already fills live_events
// twice a day. Their shelf price is assumed to be ticket_categories[].brt (gross);
// scripts/livetickets-brt-check.ts verifies that once in phase 0.
import { supabase } from "@/lib/supabase-server";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { LIVETICKETS_RETAIL_FACTOR, LIVETICKETS_RETAIL_OFFSET_USD } from "@/lib/services/price-light";
import type { Currency } from "@/types/price-light.types";
import type { CompetitorScraper, CrawlContext, Listing } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// live_events.currency: 1=USD, 2=EUR, 3=GBP, 4=ILS (types/live-events.types.ts)
const CURRENCY_BY_CODE: Record<number, Currency> = { 1: "USD", 2: "EUR", 3: "GBP", 4: "ILS" };

interface LiveRow {
  event_id: number; event_name: string; event_name_heb: string | null; show_date: string;
  city_name: string; street_address: string | null; currency: number;
  ticket_categories: ShelfCategory[] | null; last_synced: string;
}

type ShelfCategory = { cost: number; brt: number; title: string; maxTicketAmount?: number | null };

/**
 * The party the light prices for - a couple, like every package price we compare. A category
 * LiveTickets sells one per order (`maxTicketAmount` 1) is a price two people cannot pay, so it is
 * not their shelf price (2026-09-24: it set the ticket light against seats a pair could not buy).
 * Same bar as the price advisor's LiveTickets quote (price-alternatives.ts, `maxPerOrder >= 2`).
 * A category with no `maxTicketAmount` on record is kept - older snapshots never stored it.
 */
export const MIN_PARTY = 2;

/** A couple can buy this category in one order. */
export function buyableForParty(c: { maxTicketAmount?: number | null }): boolean {
  return c.maxTicketAmount == null || Number(c.maxTicketAmount) >= MIN_PARTY;
}

export function toUsd(amount: number, currency: Currency): number {
  if (currency === "USD") return amount;
  return multiCurrencyExchangeRateService.convertToUSD(amount, currency);
}

/** Cheapest shelf price per person for one live event, in the site's currency - among the
 *  categories a couple can buy (MIN_PARTY). */
export function cheapestShelf(categories: LiveRow["ticket_categories"]): number | null {
  const prices = (categories ?? []).filter(buyableForParty).map((c) => Number(c.brt)).filter((n) => Number.isFinite(n) && n > 0);
  return prices.length ? Math.min(...prices) : null;
}

export const livetickets: CompetitorScraper = {
  key: "livetickets",
  scopes: ["ticket"],
  kinds: ["sports", "music"],
  intervalHours: 24,
  mode: "table",
  async *crawl(ctx: CrawlContext): AsyncGenerator<Listing> {
    // PostgREST hard-caps every response at 1000 rows - a plain unbounded select silently
    // dropped everything past that, so any LiveTickets listing beyond row 1000 was invisible
    // and its light falsely showed "alone". Page with `.range()`, ordered by `event_id` for a
    // stable page boundary, and stop once a page comes back short of a full page.
    const PAGE_SIZE = 1000;
    let offset = 0;
    let pages = 0;
    let count = 0;
    for (;;) {
      const { data, error } = await db
        .from("live_events")
        .select("event_id,event_name,event_name_heb,show_date,city_name,street_address,currency,ticket_categories,last_synced")
        .eq("is_active", true)
        .gte("show_date", new Date().toISOString().slice(0, 10))
        .order("event_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        console.error(JSON.stringify(error));
        throw new Error(`live_events read failed: ${error.message}`);
      }
      pages += 1;
      const rows = (data ?? []) as LiveRow[];
      for (const row of rows) {
        const shelf = cheapestShelf(row.ticket_categories);
        if (shelf == null) continue;
        const currency = CURRENCY_BY_CODE[row.currency];
        if (!currency) {
          console.warn(`livetickets: unknown currency code ${row.currency} on event ${row.event_id}, skipped`);
          continue;
        }
        const usd = Math.round(toUsd(shelf, currency) * LIVETICKETS_RETAIL_FACTOR + LIVETICKETS_RETAIL_OFFSET_USD);
        count += 1;
        yield {
          competitor: "livetickets",
          external_key: String(row.event_id),
          scope: "ticket",
          title: row.event_name,
          title_he: row.event_name_heb,
          event_date: row.show_date.slice(0, 10),
          city: row.city_name,
          venue: row.street_address,
          price_from: shelf,
          currency,
          price_usd: usd,
          travel_depart: null,
          travel_return: null,
          attrs: null,
          detail_text: null,
          // Display only; confirm the site's real event URL scheme during the Task 6 recon.
          // Real scheme (recon 2026-09-10): /events/events.aspx?eid=<event_id>
          url: `https://www.livetickets.co.il/events/events.aspx?eid=${row.event_id}`,
        };
      }
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    ctx.log(`livetickets: ${count} listings built from live_events -> ${pages} page(s)`);
  },
};

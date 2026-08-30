import { supabase } from "@/lib/supabase-server";
import type { Event, EventTicket } from "@/types/app.types";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";

const TIXSTOCK_API_URL = process.env.NEXT_SECRET_TIXSTOCK_API_URL;
const TIXSTOCK_TOKEN = process.env.NEXT_SECRET_TIXSTOCK_TOKEN;

export interface TixStockPriceSyncResult {
  eventsProcessed: number;
  ticketsUpdated: number;
  ticketsSkipped: number;
  /** tx_events the run didn't reach before the time budget ran out. */
  remaining: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
}

export interface TixStockPriceSyncOptions {
  /**
   * Stop STARTING new events once this much time has passed - in-flight ones
   * finish and `remaining` reports what's left. Callers on Vercel must keep
   * this under their route's maxDuration, or the platform kills the run
   * mid-flight with nothing reported (exactly what broke the /meta-feed
   * "sync all" once tx_events passed ~500: 503 serial API calls ≈ 15-17 min
   * against the 800s ceiling).
   */
  timeBudgetMs?: number;
  /** Parallel TixStock API fetches. Keep gentle - their feed rate-limits. */
  concurrency?: number;
}

/** The slice of a TixStock /tickets/feed listing this sync reads. */
interface TixStockFeedTicket {
  seat_details?: { category?: string };
  number_of_tickets_for_sale?: { quantity_available?: number };
  proceed_price?: { amount?: string; currency?: string };
  face_value?: { currency?: string };
}

async function fetchAllTicketsForEvent(
  tixstockEventId: string,
): Promise<TixStockFeedTicket[]> {
  if (!TIXSTOCK_TOKEN) throw new Error("TixStock API token is missing");

  const baseUrl = new URL(`${TIXSTOCK_API_URL}/tickets/feed`);
  baseUrl.searchParams.set("event_id", tixstockEventId);
  baseUrl.searchParams.set("per_page", "50");

  const allTickets: TixStockFeedTicket[] = [];
  let currentPage = 1;
  let lastPage = 1;

  do {
    const url = new URL(baseUrl.toString());
    url.searchParams.set("page", String(currentPage));

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${TIXSTOCK_TOKEN}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`TixStock API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (currentPage === 1) lastPage = data.meta?.last_page ?? 1;
    allTickets.push(...(data.data || []));
    currentPage++;
  } while (currentPage <= lastPage);

  return allTickets;
}

export async function syncTixStockPrices(
  options: TixStockPriceSyncOptions = {},
): Promise<TixStockPriceSyncResult> {
  const { timeBudgetMs, concurrency = 4 } = options;
  const startedAt = new Date();
  const deadline = timeBudgetMs ? startedAt.getTime() + timeBudgetMs : null;
  console.log(`Starting TixStock price sync at ${startedAt.toISOString()}...`);

  // Ensure fresh exchange rates before processing any prices
  try {
    await multiCurrencyExchangeRateService.updateAllExchangeRates();
    console.log("Exchange rates refreshed.");
  } catch (err) {
    console.warn("Could not refresh exchange rates, using cached values:", err);
  }

  const errors: string[] = [];
  let eventsProcessed = 0;
  let ticketsUpdated = 0;
  let ticketsSkipped = 0;
  let remaining = 0;

  try {
    // Fetch all active tx_events that have a vendor event ID. Explicit columns:
    // the full rows (500+ events with jsonb) were most of this query's weight.
    const { data, error } = await supabase
      .from("events")
      .select("id,name,tickets_and_rates")
      .eq("type", "tx_event")
      .is("is_deleted", null);

    if (error) throw error;

    const events = (data ?? []) as Pick<
      Event,
      "id" | "name" | "tickets_and_rates"
    >[];
    console.log(`Found ${events.length} tx_events to process.`);

    const processEvent = async (event: (typeof events)[number]) => {
      try {
        if (!event.tickets_and_rates?.length) {
          console.log(`Event ${event.id} has no tickets_and_rates, skipping.`);
          return;
        }

        const tixstockEventId = event.tickets_and_rates[0].eid;

        if (!tixstockEventId) {
          console.log(
            `Event ${event.id} has no TixStock event ID (eid) on first ticket, skipping.`,
          );
          return;
        }

        console.log(
          `Processing event ${event.id} (${event.name}) - TixStock ID: ${tixstockEventId}`,
        );

        const sourceTickets = await fetchAllTicketsForEvent(tixstockEventId);

        if (sourceTickets.length === 0) {
          console.log(
            `No TixStock tickets found for event ${event.id}, skipping.`,
          );
          ticketsSkipped += event.tickets_and_rates.length;
          return;
        }

        let eventUpdated = false;
        const updatedTicketsAndRates = event.tickets_and_rates.map(
          (ticket: EventTicket) => {
            // Find all TixStock listings matching this category with at least 2 available
            const matching = sourceTickets.filter((t) => {
              const sourceCategory = (t.seat_details?.category || "")
                .toLowerCase()
                .trim();
              const ourCategory = ticket.category.toLowerCase().trim();
              const qty = t.number_of_tickets_for_sale?.quantity_available ?? 0;
              return sourceCategory === ourCategory && qty >= 2;
            });

            if (matching.length === 0) {
              console.log(
                `  No matching tickets (qty>=2) for category "${ticket.category}", skipping.`,
              );
              ticketsSkipped++;
              return ticket;
            }

            // Cheapest proceed_price among matches
            const cheapest = matching.reduce((min, t) => {
              const price = parseFloat(t.proceed_price?.amount || "0");
              const minPrice = parseFloat(min.proceed_price?.amount || "0");
              return price < minPrice ? t : min;
            });

            const rawPrice = parseFloat(cheapest.proceed_price?.amount || "0");
            const currency = (
              cheapest.proceed_price?.currency ||
              cheapest.face_value?.currency ||
              "GBP"
            ).toUpperCase();

            // Convert to USD with the same markup used elsewhere in the app
            let priceInUSD: number;
            if (currency === "GBP") {
              priceInUSD = multiCurrencyExchangeRateService.convertToUSD(
                rawPrice + 35,
                "GBP",
              );
            } else if (currency === "EUR") {
              priceInUSD = multiCurrencyExchangeRateService.convertToUSD(
                rawPrice + 40,
                "EUR",
              );
            } else if (currency === "ILS") {
              priceInUSD = multiCurrencyExchangeRateService.convertToUSD(
                rawPrice + 150,
                "ILS",
              );
            } else {
              // Already USD or unknown - apply flat markup
              priceInUSD = rawPrice + 40;
            }

            const newPrice = Math.round(priceInUSD);

            if (newPrice > 0 && newPrice !== ticket.price) {
              console.log(
                `  Category "${ticket.category}": ${ticket.price} → ${newPrice}`,
              );
              ticketsUpdated++;
              eventUpdated = true;
              return { ...ticket, price: newPrice };
            }

            ticketsSkipped++;
            return ticket;
          },
        );

        if (eventUpdated) {
          const updatePayload = { tickets_and_rates: updatedTicketsAndRates };
          // tickets_and_rates jsonb isn't in the generated row type - cast like template-crud.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: updateError } = await (supabase.from("events") as any)
            .update(updatePayload)
            .eq("id", event.id);

          if (updateError) throw updateError;
        }

        eventsProcessed++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const msg = `Event ${event.id} (${event.name}): ${reason}`;
        console.error(`  ❌ ${msg}`);
        errors.push(msg);
      }
    };

    // Small worker pool: each worker pulls the next un-taken event. `cursor`
    // is race-free (single-threaded between awaits), and a worker checks the
    // deadline BEFORE taking an index, so `remaining` is exactly the events
    // nobody started.
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        if (deadline && Date.now() > deadline) return;
        const index = cursor++;
        if (index >= events.length) return;
        await processEvent(events[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, concurrency) }, () => worker()),
    );
    remaining = Math.max(0, events.length - Math.min(cursor, events.length));
    if (remaining > 0) {
      console.warn(
        `Time budget exhausted - ${remaining} tx_events not reached this run.`,
      );
    }
  } catch (err) {
    const msg = `Fatal error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(msg);
    errors.push(msg);
  }

  const completedAt = new Date();
  const durationSeconds = Math.round(
    (completedAt.getTime() - startedAt.getTime()) / 1000,
  );

  console.log(
    `TixStock price sync completed at ${completedAt.toISOString()}. ` +
      `Events: ${eventsProcessed}, Updated: ${ticketsUpdated}, Skipped: ${ticketsSkipped}, Duration: ${durationSeconds}s`,
  );

  return {
    eventsProcessed,
    ticketsUpdated,
    ticketsSkipped,
    remaining,
    errors,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds,
  };
}

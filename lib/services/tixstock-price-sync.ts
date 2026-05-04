import { supabase } from "@/lib/supabase-server";
import type { Event, EventTicket } from "@/types/app.types";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";

const TIXSTOCK_API_URL = process.env.NEXT_SECRET_TIXSTOCK_API_URL;
const TIXSTOCK_TOKEN = process.env.NEXT_SECRET_TIXSTOCK_TOKEN;

export interface TixStockPriceSyncResult {
  eventsProcessed: number;
  ticketsUpdated: number;
  ticketsSkipped: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
}

async function fetchAllTicketsForEvent(
  tixstockEventId: string,
): Promise<any[]> {
  if (!TIXSTOCK_TOKEN) throw new Error("TixStock API token is missing");

  const baseUrl = new URL(`${TIXSTOCK_API_URL}/tickets/feed`);
  baseUrl.searchParams.set("event_id", tixstockEventId);
  baseUrl.searchParams.set("per_page", "50");

  const allTickets: any[] = [];
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

export async function syncTixStockPrices(): Promise<TixStockPriceSyncResult> {
  const startedAt = new Date();
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

  try {
    // Fetch all active tx_events that have a vendor event ID
    const { data: events, error } = await supabase
      .from("events")
      .select("*")
      .eq("type", "tx_event")
      .is("is_deleted", null);

    if (error) throw error;

    console.log(`Found ${events.length} tx_events to process.`);

    for (const event of events as Event[]) {
      try {
        if (!event.tickets_and_rates?.length) {
          console.log(`Event ${event.id} has no tickets_and_rates, skipping.`);
          continue;
        }

        const tixstockEventId = event.tickets_and_rates[0].eid;

        if (!tixstockEventId) {
          console.log(
            `Event ${event.id} has no TixStock event ID (eid) on first ticket, skipping.`,
          );
          continue;
        }

        console.log(
          `Processing event ${event.id} (${event.name}) — TixStock ID: ${tixstockEventId}`,
        );

        const sourceTickets = await fetchAllTicketsForEvent(tixstockEventId);

        if (sourceTickets.length === 0) {
          console.log(
            `No TixStock tickets found for event ${event.id}, skipping.`,
          );
          ticketsSkipped += event.tickets_and_rates.length;
          continue;
        }

        let eventUpdated = false;
        const updatedTicketsAndRates = event.tickets_and_rates.map(
          (ticket: EventTicket) => {
            // Find all TixStock listings matching this category with at least 2 available
            const matching = sourceTickets.filter((t: any) => {
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
            const cheapest = matching.reduce((min: any, t: any) => {
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
              // Already USD or unknown — apply flat markup
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
          const { error: updateError } = await (supabase.from("events") as any)
            .update(updatePayload)
            .eq("id", event.id);

          if (updateError) throw updateError;
        }

        eventsProcessed++;
      } catch (err: any) {
        const msg = `Event ${event.id} (${event.name}): ${err.message}`;
        console.error(`  ❌ ${msg}`);
        errors.push(msg);
      }
    }
  } catch (err: any) {
    const msg = `Fatal error: ${err.message}`;
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
    errors,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds,
  };
}

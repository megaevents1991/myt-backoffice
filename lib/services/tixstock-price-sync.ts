import { supabase } from "@/lib/supabase-server";
import type { Event, EventTicket } from "@/types/app.types";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import {
  isSupplierCurrency,
  normalizeSupplierCategory,
  supplierEventId,
  supplierPriceUsd,
  ticketSupplier,
} from "@/lib/suppliers";
import {
  isTxDeactivation,
  nextDeactivation,
  planTixstockAvailability,
} from "@/lib/services/tixstock-availability";
import {
  closeSupplierGapTask,
  eventsWithOpenSupplierGapTask,
  openSupplierGapTask,
} from "@/lib/services/supplier-gap-tasks";
import {
  listingsTheSiteSells,
  type TixStockListingRuleFields,
} from "@/lib/tixstock-listings";
import { logAudit } from "@/lib/audit";
import { revalidateMain } from "@/lib/revalidate-main";

const TIXSTOCK_API_URL = process.env.NEXT_SECRET_TIXSTOCK_API_URL;
const TIXSTOCK_TOKEN = process.env.NEXT_SECRET_TIXSTOCK_TOKEN;

/**
 * Most events one run may take off the site. The first run after 04.10.2026
 * had 13 to take off; a number far above that means the supplier's feed is
 * lying (listings gone everywhere), and the run stops switching events off
 * instead of emptying the site. What it already did comes back on the next run.
 */
const MAX_AUTO_DEACTIVATIONS_PER_RUN = 30;

/** What a run did to one event's availability - or, on a dry run, would do. */
export interface AvailabilityChange {
  eventId: number;
  name: string;
  date: string;
  /** "unchanged" is reported only on a run asked for specific events (`eventIds`). */
  action: "deactivated" | "reactivated" | "tickets" | "unchanged";
  /** `events.deactivated_reason` after the run; null = on the site. */
  reason: string | null;
  missing: string[];
  soldOut: string[];
  ticketsTakenOff: number;
  ticketsPutBack: number;
  supplierCategories: string[] | null;
}

export interface TixStockPriceSyncResult {
  eventsProcessed: number;
  ticketsUpdated: number;
  ticketsSkipped: number;
  /** Tickets taken off sale / put back (lib/services/tixstock-availability.ts). */
  ticketsTakenOff: number;
  ticketsPutBack: number;
  /** Events taken off the customer site / put back. */
  eventsDeactivated: number;
  eventsReactivated: number;
  availability: AvailabilityChange[];
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
  /**
   * Read everything, write nothing: no price, no ticket taken off, no event
   * deactivated, no task. The result says what a real run would do.
   */
  dryRun?: boolean;
  /**
   * Only these events - the editor's "check now" after staff fixed an event
   * (recheckEventAvailability). `availability` then carries a line for each
   * of them even when nothing changed.
   */
  eventIds?: number[];
}

/**
 * The slice of a TixStock /tickets/feed listing this sync reads: what the site's
 * three listing rules look at (lib/tixstock-listings.ts) and the price.
 */
export interface TixStockFeedTicket extends TixStockListingRuleFields {
  proceed_price?: { amount?: string; currency?: string };
  face_value?: { currency?: string };
}

/** A show's feed: its listings, and every category name TixStock has for it. */
interface TixStockFeed {
  tickets: TixStockFeedTicket[];
  /** `meta.categories` names - sold-out ones included. null = the feed did not say. */
  categories: string[] | null;
}

/**
 * What a TixStock listing sells for on the site, in USD: `supplierPriceUsd`
 * (lib/suppliers.ts) - (cost + currency markup) -> USD -> +3.5% -> rounded up,
 * the formula main prices the same listing with when a customer opens the event
 * (main `lib/supplier-pricing.ts`). A currency we hold no markup for is priced
 * as USD, as this sync always did.
 *
 * Until 2026-10-07 this sync had its own formula: no 3.5%, rounded to nearest.
 * So four times a day it wrote every TixStock price 3.5% UNDER what the order
 * page charges, and the first visitor to each event wrote it back up (main's
 * live-ticket route stores the price it shows). In one day: 340 such rewrites,
 * 859 of their 1,418 ticket prices moved by exactly 3.5% - a card and a feed
 * price that dipped between the two, and a cache refresh on the site for each.
 * Refresh the rates before a batch (the run does, at its start).
 */
export function tixstockTicketPriceUsd(cost: number, currency: string): number {
  return supplierPriceUsd(
    cost,
    isSupplierCurrency(currency) ? currency : "USD",
    (amount, cur) =>
      cur === "USD"
        ? amount
        : multiCurrencyExchangeRateService.convertToUSD(amount, cur),
  );
}

/** One listing through the formula. A listing that names no currency is GBP, TixStock's own. */
const listingPriceUsd = (listing: TixStockFeedTicket): number =>
  tixstockTicketPriceUsd(
    parseFloat(listing.proceed_price?.amount || "0"),
    (
      listing.proceed_price?.currency ||
      listing.face_value?.currency ||
      "GBP"
    ).toUpperCase(),
  );

/** Also read by the price advisor's supplier quote (price-alternatives.ts) - one feed reader, not two. */
export const fetchTixStockFeed = (tixstockEventId: string): Promise<TixStockFeedTicket[]> =>
  fetchFeedForEvent(tixstockEventId).then((feed) => feed.tickets);

/** `meta.categories` is an object: every category of the show → "true" / "false" (has listings). */
function feedCategories(raw: unknown): string[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const names = Object.keys(raw);
  return names.length ? names : null;
}

async function fetchFeedForEvent(tixstockEventId: string): Promise<TixStockFeed> {
  if (!TIXSTOCK_TOKEN) throw new Error("TixStock API token is missing");

  const baseUrl = new URL(`${TIXSTOCK_API_URL}/tickets/feed`);
  baseUrl.searchParams.set("event_id", tixstockEventId);
  baseUrl.searchParams.set("per_page", "50");

  const allTickets: TixStockFeedTicket[] = [];
  let categories: string[] | null = null;
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
    if (currentPage === 1) {
      lastPage = data.meta?.last_page ?? 1;
      categories = feedCategories(data.meta?.categories);
    }
    allTickets.push(...(data.data || []));
    currentPage++;
  } while (currentPage <= lastPage);

  return { tickets: allTickets, categories };
}

export async function syncTixStockPrices(
  options: TixStockPriceSyncOptions = {},
): Promise<TixStockPriceSyncResult> {
  const { timeBudgetMs, concurrency = 4, dryRun = false, eventIds } = options;
  const startedAt = new Date();
  const deadline = timeBudgetMs ? startedAt.getTime() + timeBudgetMs : null;
  console.log(
    `Starting TixStock price sync at ${startedAt.toISOString()}${dryRun ? " (dry run)" : ""}...`,
  );

  // Ensure fresh exchange rates before processing any prices. A dry run writes
  // no price, so it does not refresh them either.
  if (!dryRun) {
    try {
      await multiCurrencyExchangeRateService.updateAllExchangeRates();
      console.log("Exchange rates refreshed.");
    } catch (err) {
      console.warn("Could not refresh exchange rates, using cached values:", err);
    }
  }

  const errors: string[] = [];
  let eventsProcessed = 0;
  let ticketsUpdated = 0;
  let ticketsSkipped = 0;
  let ticketsTakenOff = 0;
  let ticketsPutBack = 0;
  let eventsDeactivated = 0;
  let eventsReactivated = 0;
  let deactivationCapReported = false;
  const availability: AvailabilityChange[] = [];
  let remaining = 0;

  try {
    // Fetch all active tx_events that have a vendor event ID. Explicit columns:
    // the full rows (500+ events with jsonb) were most of this query's weight.
    type SyncEvent = Pick<
      Event,
      | "id"
      | "name"
      | "date"
      | "tickets_and_rates"
      | "tx_excluded_sections"
      | "deactivated_reason"
    >;
    // Upcoming events only: a show that already happened has no price to keep
    // and nothing to take off the site. They were a quarter of the run (138 of
    // 579 on 04.10.2026), every one "sold out" at the supplier - enough to use
    // up MAX_AUTO_DEACTIVATIONS_PER_RUN before a single live event was judged.
    const today = startedAt.toISOString().slice(0, 10);
    const loadEvents = (columns: string) => {
      const query = supabase
        .from("events")
        .select(columns)
        .eq("type", "tx_event")
        .is("is_deleted", null)
        .gte("date", today);
      return eventIds ? query.in("id", eventIds) : query;
    };

    // `deactivated_reason` arrives with migration 20261004090000. Until it is
    // applied the column does not exist (42703): prices and ticket flags still
    // sync, only the event-level switch waits.
    let canDeactivate = true;
    let { data, error } = await loadEvents(
      "id,name,date,tickets_and_rates,tx_excluded_sections,deactivated_reason",
    );
    if ((error as { code?: string } | null)?.code === "42703") {
      canDeactivate = false;
      ({ data, error } = await loadEvents(
        "id,name,date,tickets_and_rates,tx_excluded_sections",
      ));
    }

    if (error) throw error;

    const events = (data ?? []) as unknown as SyncEvent[];
    console.log(`Found ${events.length} tx_events to process.`);

    // One read per run: which events already have an open supplier_gap task.
    // null = tasks could not be read; the run then opens and closes none.
    let openTasks: Map<number, string> | null = null;
    if (!dryRun) {
      try {
        openTasks = await eventsWithOpenSupplierGapTask();
      } catch (err) {
        errors.push(
          `supplier_gap tasks unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const processEvent = async (event: (typeof events)[number]) => {
      try {
        if (!event.tickets_and_rates?.length) {
          console.log(`Event ${event.id} has no tickets_and_rates, skipping.`);
          return;
        }

        // From a TixStock ticket - a multi-supplier event also holds other
        // suppliers' tickets (and eids), in any order.
        const tixstockEventId = supplierEventId(
          event.tickets_and_rates,
          "tixstock",
          "tx_event",
        );

        if (!tixstockEventId) {
          console.log(
            `Event ${event.id} has no TixStock event ID (eid) on its tickets, skipping.`,
          );
          return;
        }

        console.log(
          `Processing event ${event.id} (${event.name}) - TixStock ID: ${tixstockEventId}`,
        );

        const feed = await fetchFeedForEvent(tixstockEventId);
        const sourceTickets = feed.tickets;

        // No listings and no category list: nothing to price, and too little to
        // judge availability on - a hiccup at the supplier looks the same.
        if (sourceTickets.length === 0 && !feed.categories) {
          console.log(
            `No TixStock tickets found for event ${event.id}, skipping.`,
          );
          ticketsSkipped += event.tickets_and_rates.length;
          return;
        }

        // Only a listing the site would sell to a pair sets a price - main's own
        // three rules (lib/tixstock-listings.ts): not in a section staff excluded
        // on the map, not a restricted view, and the seller splits to two. Until
        // 2026-10-07 any listing with 2+ seats did, and a ticket could be stored
        // at a third of what the order page offers. Availability, further down,
        // still reads the whole feed.
        const sellable = listingsTheSiteSells(
          sourceTickets,
          event.tx_excluded_sections ?? [],
        );

        let eventUpdated = false;
        const updatedTicketsAndRates = event.tickets_and_rates.map(
          (ticket: EventTicket) => {
            // Another supplier's ticket can share a category name with a
            // TixStock listing ("Category 1") - never price it from here.
            if (ticketSupplier(ticket, "tx_event") !== "tixstock") {
              return ticket;
            }

            // This category's listings among those the site would sell to a
            // pair. Normalized compare: TixStock restyles venue category names
            // over time (Bernabeu 2026-09), an exact match silently stopped
            // updating every Real Madrid home game.
            const ourCategory = normalizeSupplierCategory(ticket.category);
            const matching = sellable.filter(
              (t) =>
                !!ourCategory &&
                normalizeSupplierCategory(t.seat_details?.category) === ourCategory,
            );

            if (matching.length === 0) {
              console.log(
                `  No listing the site would sell to a pair for category "${ticket.category}", skipping.`,
              );
              ticketsSkipped++;
              return ticket;
            }

            // The cheapest of them AS PRICED, which is what main stores: every
            // listing through the formula, then the minimum.
            const newPrice = Math.min(...matching.map(listingPriceUsd));

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

        // What the customer can actually buy (tixstock-availability.ts): a
        // category with nothing on sale goes off the site, an event with
        // nothing left to sell is deactivated, and both come back by
        // themselves when listings return.
        const currentReason = event.deactivated_reason ?? null;
        let plan = planTixstockAvailability(updatedTicketsAndRates, "tx_event", {
          categories: feed.categories,
          listed: sourceTickets.map((t) => t.seat_details?.category ?? ""),
        });
        let reason = canDeactivate
          ? nextDeactivation(currentReason, plan)
          : currentReason;

        if (reason !== null && currentReason === null) {
          if (eventsDeactivated >= MAX_AUTO_DEACTIVATIONS_PER_RUN) {
            // Too many for one run to be true: leave this event exactly as it is.
            if (!deactivationCapReported) {
              deactivationCapReported = true;
              errors.push(
                `Stopped taking events off the site after ${MAX_AUTO_DEACTIVATIONS_PER_RUN} in one run - check TixStock's feed.`,
              );
            }
            plan = {
              tickets: updatedTicketsAndRates,
              changed: false,
              turnedOff: [],
              turnedOn: [],
              missing: [],
              soldOut: [],
              sellable: true,
            };
            reason = null;
          } else {
            eventsDeactivated++;
          }
        }
        const reasonChanged = reason !== currentReason;
        if (reasonChanged && reason === null) eventsReactivated++;
        ticketsTakenOff += plan.turnedOff.length;
        ticketsPutBack += plan.turnedOn.length;

        if (plan.changed || reasonChanged || eventIds) {
          availability.push({
            eventId: event.id,
            name: event.name,
            date: event.date,
            action: reasonChanged
              ? reason
                ? "deactivated"
                : "reactivated"
              : plan.changed
                ? "tickets"
                : "unchanged",
            reason,
            missing: plan.missing,
            soldOut: plan.soldOut,
            ticketsTakenOff: plan.turnedOff.length,
            ticketsPutBack: plan.turnedOn.length,
            supplierCategories: feed.categories,
          });
        }

        if (!dryRun && (eventUpdated || plan.changed || reasonChanged)) {
          const updatePayload = {
            tickets_and_rates: plan.tickets,
            ...(reasonChanged
              ? {
                  deactivated_reason: reason,
                  deactivated_at: reason ? new Date().toISOString() : null,
                }
              : {}),
          };
          // tickets_and_rates jsonb isn't in the generated row type - cast like template-crud.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: updateError } = await (supabase.from("events") as any)
            .update(updatePayload)
            .eq("id", event.id);

          if (updateError) throw updateError;
        }

        if (!dryRun) {
          if (reasonChanged) {
            await logAudit({
              action: reason ? "event.auto_deactivated" : "event.auto_reactivated",
              entityType: "event",
              entityId: event.id,
              metadata: {
                reason,
                previous: currentReason,
                missing: plan.missing,
                sold_out: plan.soldOut,
                auto: true,
              },
            });
          }
          // A task while the event is off by this sync, or carries a category
          // the supplier does not have; closed once neither is true.
          if (openTasks) {
            const openTaskId = openTasks.get(event.id);
            const needsTask = isTxDeactivation(reason) || plan.missing.length > 0;
            if (needsTask && !openTaskId) {
              const taskId = await openSupplierGapTask({
                eventId: event.id,
                eventName: event.name,
                eventDate: event.date,
                reason,
                missing: plan.missing,
                soldOut: plan.soldOut,
                supplierCategories: feed.categories,
              });
              if (taskId) openTasks.set(event.id, taskId);
            } else if (!needsTask && openTaskId) {
              if (await closeSupplierGapTask(event.id, openTaskId)) {
                openTasks.delete(event.id);
              }
            }
          }
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
    // The site caches the catalog for an hour - an event that just went off (or
    // came back) should not wait for it.
    if (!dryRun && availability.some((a) => a.action !== "unchanged")) {
      await revalidateMain();
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
      `Events: ${eventsProcessed}, Updated: ${ticketsUpdated}, Skipped: ${ticketsSkipped}, ` +
      `Tickets off/back: ${ticketsTakenOff}/${ticketsPutBack}, Events off/back: ${eventsDeactivated}/${eventsReactivated}, ` +
      `Duration: ${durationSeconds}s`,
  );

  return {
    eventsProcessed,
    ticketsUpdated,
    ticketsSkipped,
    ticketsTakenOff,
    ticketsPutBack,
    eventsDeactivated,
    eventsReactivated,
    availability,
    remaining,
    errors,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds,
  };
}

// lib/services/ticket-price-sync.ts

import { supabase } from "@/lib/supabase-server";
import { Event, EventTicket } from "@/types/app.types";
import { CURRENCIES } from "@/types/live-events.types";

interface ExchangeRateData {
  rate: number;
  lastUpdated: Date;
  source: "api" | "fallback";
}

type SupportedCurrency = "EUR" | "ILS" | "GBP";

interface ExchangeRates {
  EUR: ExchangeRateData;
  ILS: ExchangeRateData;
  GBP: ExchangeRateData;
}

class MultiCurrencyExchangeRateService {
  private exchangeRates: ExchangeRates = {
    EUR: {
      rate: 1.15,
      lastUpdated: new Date(0), // epoch — force refresh on first use
      source: "fallback",
    },
    ILS: {
      rate: 0.34,
      lastUpdated: new Date(0),
      source: "fallback",
    },
    GBP: {
      rate: 1.33,
      lastUpdated: new Date(0),
      source: "fallback",
    },
  };

  private readonly JSDELIVR_BASE =
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies";
  private readonly CLOUDFLARE_BASE =
    "https://latest.currency-api.pages.dev/v1/currencies";
  // Conservative bounds to reject outliers (currency -> USD per unit)
  private readonly RATE_LIMITS: Record<
    SupportedCurrency,
    { min: number; max: number }
  > = {
    EUR: { min: 0.9, max: 1.4 }, // EUR/USD
    GBP: { min: 1.0, max: 1.6 }, // GBP/USD
    ILS: { min: 0.25, max: 0.5 }, // ILS/USD
  };
  private readonly API_TIMEOUT_MS = 10000;

  private readonly STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour
  private readonly HARD_STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

  // Deduplicate concurrent updates per currency
  private inFlight: Map<SupportedCurrency, Promise<void>> = new Map();

  private async fetchWithTimeout(
    url: string,
    timeoutMs: number = this.API_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private isValidRate(currency: SupportedCurrency, rate: number): boolean {
    const bounds = this.RATE_LIMITS[currency];
    return rate >= bounds.min && rate <= bounds.max;
  }

  private async fetchCurrencyRate(
    currency: SupportedCurrency,
  ): Promise<number | null> {
    const base = currency.toLowerCase();
    const urls = [
      `${this.JSDELIVR_BASE}/${base}.json`,
      `${this.CLOUDFLARE_BASE}/${base}.json`,
    ];

    for (const url of urls) {
      try {
        console.log(`🔄 Fetching ${currency}/USD from ${url}`);
        const response = await this.fetchWithTimeout(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const rawRate = data?.[base]?.["usd"];
        if (typeof rawRate !== "number" || !Number.isFinite(rawRate)) {
          throw new Error(`Missing or invalid "usd" field in "${base}" entry`);
        }
        const rounded = Math.ceil(rawRate * 100) / 100; // Round to 2 decimals
        if (!this.isValidRate(currency, rounded)) {
          throw new Error(
            `Out-of-range rate for ${currency}: ${rounded} (limits ${this.RATE_LIMITS[currency].min}-${this.RATE_LIMITS[currency].max})`,
          );
        }
        console.log(`✅ ${currency}/USD rate fetched: ${rounded}`);
        return rounded;
      } catch (error) {
        console.warn(
          `⚠️ Currency API (${url}) ${currency}/USD failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    console.error(`❌ All endpoints failed for ${currency}/USD`);
    return null;
  }

  // Coalesce concurrent updates per currency
  private scheduleCurrencyUpdate(
    currency: SupportedCurrency,
    fn: () => Promise<void>,
  ): Promise<void> {
    const existing = this.inFlight.get(currency);
    if (existing) return existing;
    const p = fn().finally(() => this.inFlight.delete(currency));
    this.inFlight.set(currency, p);
    return p;
  }

  private async updateSingleCurrencyRate(
    currency: SupportedCurrency,
  ): Promise<void> {
    return this.scheduleCurrencyUpdate(currency, async () => {
      try {
        const rate = await this.fetchCurrencyRate(currency);

        if (rate !== null) {
          this.exchangeRates[currency] = {
            rate,
            lastUpdated: new Date(),
            source: "api",
          };
          console.log(
            `💱 ${currency}/USD rate updated: ${rate} (from currency API)`,
          );
        } else {
          const current = this.exchangeRates[currency];
          console.warn(
            `⚠️ Currency API failed for ${currency}. Maintaining previous rate: ${current.rate} (last updated: ${current.lastUpdated.toISOString()})`,
          );
          // Keep existing rate; do not overwrite timestamp to preserve staleness tracking
        }
      } catch (error) {
        console.error(`❌ Error updating ${currency}/USD rate:`, error);
        const current = this.exchangeRates[currency];
        console.warn(
          `⚠️ Keeping previous ${currency}/USD rate after error: ${current.rate} (last updated: ${current.lastUpdated.toISOString()})`,
        );
      }
    });
  }

  public async updateAllExchangeRates(): Promise<void> {
    console.log("💱 Updating all exchange rates...");
    const currencies: SupportedCurrency[] = ["EUR", "ILS", "GBP"];
    await Promise.allSettled(
      currencies.map((currency) => this.updateSingleCurrencyRate(currency)),
    );

    console.log("✅ All exchange rates updated");
  }

  public async updateExchangeRate(currency: SupportedCurrency): Promise<void> {
    await this.updateSingleCurrencyRate(currency);
  }

  public getExchangeRate(currency: SupportedCurrency): ExchangeRateData {
    const data = this.exchangeRates[currency];
    const age = Date.now() - data.lastUpdated.getTime();
    if (age > this.STALE_AFTER_MS) {
      // Kick off background refresh; coalesced per currency
      this.updateSingleCurrencyRate(currency).catch(() => {});
    }
    return data;
  }

  // Optional helper: ensure freshness if hard-stale (blocking)
  public async ensureFreshIfHardStale(
    currency: SupportedCurrency,
  ): Promise<void> {
    const data = this.exchangeRates[currency];
    const age = Date.now() - data.lastUpdated.getTime();
    if (age > this.HARD_STALE_AFTER_MS) {
      await this.updateSingleCurrencyRate(currency);
    }
  }

  public getAllExchangeRates(): ExchangeRates {
    return { ...this.exchangeRates };
  }

  public convertToUSD(amount: number, fromCurrency: SupportedCurrency): number {
    const rate = this.exchangeRates[fromCurrency].rate;
    return amount * rate;
  }
}

// Create a singleton instance
const exchangeRateService = new MultiCurrencyExchangeRateService();

interface TicketApiResponse {
  ticket_status: string;
  stock: number;
  local_rates: {
    net_rate_eur: number; // Price in EUR cents
  };
}

// LiveTickets event API response (GetOneEventByEid endpoint)
interface LiveTicketsEventApiResponse {
  id: number;
  showDate: string;
  isShowDateFinale: boolean;
  showDateRemarks: string;
  currency: number;
  stopSaleingMargin: number;
  streetAddress: string;
  eventName: string;
  streetAddressHeb: string;
  eventHebName: string;
  cityId: number;
  cityName: string;
  countryID: number;
  countryName: string;
  iata: string;
  passportRequired: boolean;
  venueMapWithBase: string;
  venueHebMapWithBase: string;
  category1: Array<{ id: number; name: string; hebName: string }>;
  category2: Array<{ id: number; name: string; hebName: string }>;
  category3: Array<{ id: number; name: string; hebName: string }>;
  performers: Array<{
    id: number;
    name: string;
    hebName: string;
    isDtPerformer: boolean;
    performerClassificationId: number | null;
    amount: number;
  }>;
  venue: Array<{
    id: number;
    name: string;
    isDtVenue: boolean;
    hebName: string;
  }>;
  ticketCategory: LiveTicketCategoryFromApi[];
}

// LiveTickets ticket category from API (part of event response)
interface LiveTicketCategoryFromApi {
  title: string;
  coments: string;
  cost: number; // Price in original currency
  specialCost: number;
  maxTicketAmount: number;
  seatingMethodId: number;
  seatingGroupMAXSize: number | null;
  seatingGroupFee: number | null;
  isOfficial: boolean;
  shippingOptions: number;
  hotelDetailsRequired: boolean;
  id: number;
  apiImmediatePurchase: boolean;
  hebTitle: string;
  hebComents: string;
}

interface XS2E_VendorTicketData {
  price: number;
  available: boolean;
  currency?: SupportedCurrency | "USD";
  originalPrice?: number;
}

interface SyncSummary {
  totalTickets: number;
  successfulUpdates: number;
  failedUpdates: number;
  eventsProcessed: number;
  startTime: Date;
  endTime: Date;
  errors: string[];
}

export class TicketPriceSyncService {
  private readonly XS2_API_BASE_URL =
    process.env.NEXT_SECRET_XS2EVENT_API_URL || "";
  private readonly XS2_API_KEY = process.env.NEXT_SECRET_XS2EVENT_API_KEY;
  private readonly LIVE_API_BASE_URL =
    process.env.NEXT_SECRET_LIVE_API_URL || "";
  private readonly LIVE_API_KEY = process.env.NEXT_SECRET_LIVE_API_KEY;
  private readonly REQUEST_DELAY = 500; // 0.5 seconds between API calls
  private readonly API_TIMEOUT = 10000; // 10 seconds timeout
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second

  constructor() {
    if (!this.XS2_API_BASE_URL) {
      throw new Error(
        "Missing XS2 API base URL (NEXT_SECRET_XS2EVENT_API_URL) in environment variables.",
      );
    }
    if (!this.XS2_API_KEY) {
      throw new Error(
        "Missing XS2 API key (NEXT_SECRET_XS2EVENT_API_KEY) in environment variables.",
      );
    }
    if (!this.LIVE_API_BASE_URL) {
      throw new Error(
        "Missing Live API base URL (NEXT_SECRET_LIVE_API_URL) in environment variables.",
      );
    }
    if (!this.LIVE_API_KEY) {
      throw new Error(
        "Missing Live API key (NEXT_SECRET_LIVE_API_KEY) in environment variables.",
      );
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private roundToNearest9(price: number): number {
    const rounded = Math.ceil(price);
    const lastDigit = rounded % 10;

    if (lastDigit <= 9) {
      return rounded - lastDigit + 9;
    }
    return rounded;
  }

  private getCurrencyFromCode(currencyCode: number): SupportedCurrency | "USD" {
    switch (currencyCode) {
      case CURRENCIES.USD:
        return "USD";
      case CURRENCIES.EUR:
        return "EUR";
      case CURRENCIES.GBP:
        return "GBP";
      case CURRENCIES.ILS:
        return "ILS";
      default:
        console.warn(
          `⚠️ Unknown currency code ${currencyCode}, defaulting to USD`,
        );
        return "USD";
    }
  }

  private convertToUSD(
    amount: number,
    currency: SupportedCurrency | "USD",
  ): number {
    if (currency === "USD") {
      return amount;
    }
    return exchangeRateService.convertToUSD(
      amount,
      currency as SupportedCurrency,
    );
  }

  // Generic fetch with timeout that supports both providers (liveTickets & XS2E) with different header schemes
  private async fetchWithTimeout(
    url: string,
    apiKey: string | undefined,
    provider: "liveTickets" | "xs2e",
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.API_TIMEOUT);

    // Build provider-specific headers with no-cache directives
    const headers: Record<string, string> =
      provider === "liveTickets"
        ? {
            Authorization: apiKey || "",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          }
        : {
            "X-Api-Key": apiKey || "",
            "Content-Type": "application/json",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          };

    try {
      console.log(`🔄 Fetching [${provider}] ${url}`);
      const response = await fetch(url, {
        signal: controller.signal,
        headers,
        cache: "no-store",
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private async fetchXS2ETicketData(
    ticketId: string,
  ): Promise<{ price: number; available: boolean } | null> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(
          `📍 Fetching ticket ${ticketId} - attempt ${attempt}/${this.MAX_RETRIES}`,
        );

        const url = `${this.XS2_API_BASE_URL}/tickets/${ticketId}`;
        const response = await this.fetchWithTimeout(
          url,
          this.XS2_API_KEY,
          "xs2e",
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: TicketApiResponse = await response.json();

        // Validate response structure
        if (
          !data ||
          typeof data.ticket_status !== "string" ||
          typeof data.stock !== "number" ||
          !data.local_rates ||
          typeof data.local_rates.net_rate_eur !== "number"
        ) {
          throw new Error(
            `Invalid API response structure for ticket ${ticketId}`,
          );
        }

        const available = data.ticket_status === "available" && data.stock > 3;

        // Convert EUR cents to EUR, add 40 EUR markup, convert to USD, then round to nearest 9
        const priceInEur = data.local_rates.net_rate_eur / 100;
        const priceWithMarkup = priceInEur + 40;

        // Convert EUR to USD using exchange rate
        const eurUsdRate = exchangeRateService.getExchangeRate("EUR");
        const priceInUsd = priceWithMarkup * eurUsdRate.rate;
        const finalPrice = this.roundToNearest9(priceInUsd);

        return {
          price: finalPrice,
          available: available,
        };
      } catch (error) {
        console.log(
          `❌ Attempt ${attempt} failed for ticket ${ticketId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        if (attempt < this.MAX_RETRIES) {
          console.log(`⏳ Retrying in ${this.RETRY_DELAY}ms...`);
          await this.delay(this.RETRY_DELAY);
        }
      }
    }

    console.error(
      `🚫 All ${this.MAX_RETRIES} attempts failed for ticket ${ticketId}`,
    );
    return null;
  }

  private async fetchLiveTicketsEventData(
    eventEid: string,
  ): Promise<LiveTicketsEventApiResponse | "SOLD_OUT" | null> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(
          `📍 Fetching Live event ${eventEid} - attempt ${attempt}/${this.MAX_RETRIES}`,
        );

        const url = `${this.LIVE_API_BASE_URL}/Events/getOneEvent?eid=${eventEid}`;
        const response = await this.fetchWithTimeout(
          url,
          this.LIVE_API_KEY,
          "liveTickets",
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: LiveTicketsEventApiResponse[] = await response.json();

        // Check for empty array (Sold Out)
        if (Array.isArray(data) && data.length === 0) {
          console.log(
            `ℹ️ Event ${eventEid} returned empty array - marking as SOLD OUT`,
          );
          return "SOLD_OUT";
        }

        // The API returns an array with one event
        if (!Array.isArray(data)) {
          throw new Error(
            `Invalid Live API response structure for event ${eventEid} - expected array with one event`,
          );
        }

        const eventData = data[0];

        // Validate response structure
        if (
          !eventData ||
          typeof eventData.id !== "number" ||
          typeof eventData.currency !== "number" ||
          !Array.isArray(eventData.ticketCategory)
        ) {
          throw new Error(
            `Invalid Live API response structure for event ${eventEid}`,
          );
        }

        return eventData;
      } catch (error) {
        if (attempt < this.MAX_RETRIES) {
          console.log(`⏳ Retrying in ${this.RETRY_DELAY}ms...`);
          await this.delay(this.RETRY_DELAY);
        }
      }
    }
    console.error(
      `🚫 All ${this.MAX_RETRIES} attempts failed for Live event ${eventEid}`,
    );
    return null;
  }

  private convertLiveTicketCategoryToVendorData(
    ticketCategory: LiveTicketCategoryFromApi,
    eventCurrency: number,
  ): XS2E_VendorTicketData {
    const available = ticketCategory.maxTicketAmount > 1;

    // Get currency from event currency code
    const currency = this.getCurrencyFromCode(eventCurrency);
    const originalPrice = ticketCategory.cost;

    // Add markup based on currency
    let priceWithMarkup: number;
    if (currency === "USD") {
      priceWithMarkup = originalPrice + 40; // $40 markup for USD
    } else if (currency === "EUR") {
      priceWithMarkup = originalPrice + 40; // €40 markup for EUR
    } else if (currency === "GBP") {
      priceWithMarkup = originalPrice + 35; // £35 markup for GBP
    } else if (currency === "ILS") {
      priceWithMarkup = originalPrice + 150; // ₪150 markup for ILS
    } else {
      priceWithMarkup = originalPrice + 40; // Default $40 markup
    }

    // Convert to USD if needed
    const priceInUsd = this.convertToUSD(priceWithMarkup, currency);
    const finalPrice = this.roundToNearest9(priceInUsd);

    console.log(
      `✅ Live Ticket ${ticketCategory.id} (${ticketCategory.title}): $${finalPrice} (${currency} ${originalPrice} + markup = ${currency} ${priceWithMarkup} → $${priceInUsd}), available: ${available}, maxAmount: ${ticketCategory.maxTicketAmount}`,
    );

    return {
      price: finalPrice,
      available: available,
      currency: currency,
      originalPrice: originalPrice,
    };
  }

  private async getEventsByTypeFromDB(
    eventType: "xs2" | "liveTickets",
  ): Promise<Event[]> {
    try {
      const isXS2 = eventType === "xs2";

      let query = supabase
        .from("events")
        .select("*")
        .is("is_deleted", null)
        .gte("date", new Date().toISOString())
        .order("date", { ascending: true });

      if (isXS2) {
        query = query.eq("type", "sports_event_dynamic");
      } else {
        query = query.in("type", [
          "sports_live_event_dynamic",
          "music_live_event_dynamic",
        ]);
      }

      const { data: events, error } = await query;

      if (error) {
        console.error(
          `❌ Error fetching ${isXS2 ? "XS2" : "liveTickets"} events:`,
          error,
        );
        return [];
      }

      const eventCount = events?.length || 0;
      console.log(
        `📊 Found ${eventCount} ${isXS2 ? "XS2" : "liveTickets"} events`,
      );

      return (events as Event[]) || [];
    } catch (error) {
      console.error(`❌ Error in getEventsByTypeFromDB (${eventType}):`, error);
      return [];
    }
  }

  private async updateTicketInDatabase(
    eventId: number,
    ticketId: string,
    ticketData: { price: number; available: boolean },
  ): Promise<void> {
    const { data: event, error: selectError } = (await supabase
      .from("events")
      .select("tickets_and_rates")
      .eq("id", eventId)
      .single()) as unknown as {
      data: { tickets_and_rates: EventTicket[] } | null;
      error: any;
    };

    if (selectError) throw selectError;

    const tickets = event?.tickets_and_rates;
    if (!tickets) throw new Error("No tickets found for event");

    const updatedTickets = tickets.map((ticket: EventTicket) => {
      if (ticket.id === ticketId) {
        return {
          ...ticket,
          price: ticketData.price,
          available: ticketData.available,
        };
      }
      return ticket;
    });

    const { error: updateError } = await (supabase.from("events") as any)
      .update({ tickets_and_rates: updatedTickets })
      .eq("id", eventId);

    if (updateError) throw updateError;
  }

  private async updateAllTicketsInDatabase(
    eventId: number,
    updatedTickets: EventTicket[],
  ): Promise<void> {
    const { error: updateError } = await (supabase.from("events") as any)
      .update({ tickets_and_rates: updatedTickets })
      .eq("id", eventId);

    if (updateError) throw updateError;
  }

  private async processLiveTicketsEvent(event: Event): Promise<{
    successCount: number;
    failureCount: number;
    failedTicketIds: string[];
  }> {
    let successCount = 0;
    let failureCount = 0;
    const failedTicketIds: string[] = [];

    if (!event.tickets_and_rates || !Array.isArray(event.tickets_and_rates)) {
      console.log(`⚠️ Event ${event.id} has no tickets to process`);
      return { successCount, failureCount, failedTicketIds };
    }

    const eventEid = event.tickets_and_rates[0].eid || "";

    try {
      // Fetch all ticket categories for this event
      const eventData = await this.fetchLiveTicketsEventData(eventEid);

      if (eventData === "SOLD_OUT") {
        console.log(
          `⚠️ Event ${event.id} is SOLD OUT (empty API response). Marking tickets unavailable.`,
        );

        const updatedTickets = event.tickets_and_rates.map(
          (ticket: EventTicket) => ({
            ...ticket,
            available: false,
          }),
        );

        // Update tags - User requested "Sold" (Capital S) as the tag
        const newTags = "Sold";

        const { error: updateError } = await (supabase.from("events") as any)
          .update({
            tickets_and_rates: updatedTickets,
            tags: newTags,
          })
          .eq("id", event.id);

        if (updateError) {
          console.error(
            `❌ Error updating sold out event ${event.id}:`,
            updateError,
          );
          failureCount += event.tickets_and_rates.length;
          event.tickets_and_rates.forEach((t) => failedTicketIds.push(t.id));
        } else {
          successCount += event.tickets_and_rates.length;
        }

        return { successCount, failureCount, failedTicketIds };
      }

      if (
        !eventData ||
        !eventData.ticketCategory ||
        !Array.isArray(eventData.ticketCategory) ||
        eventData.ticketCategory.length === 0
      ) {
        console.log(`⚠️ Failed to fetch event data for ${event.id}`);
        // If we can't fetch event data, all tickets fail
        failureCount += event.tickets_and_rates.length;
        event.tickets_and_rates.forEach((t) => failedTicketIds.push(t.id));
        return { successCount, failureCount, failedTicketIds };
      }

      // Process all tickets and prepare updated tickets array
      const updatedTickets = event.tickets_and_rates.map(
        (ticket: EventTicket) => {
          try {
            const matchingTicket = eventData.ticketCategory.find(
              (_ticket) => _ticket.id.toString() === ticket.id,
            );

            if (!matchingTicket) {
              successCount++;
              failedTicketIds.push(ticket.id);
              return {
                ...ticket,
                available: false,
              };
            } else {
              const ticketData = this.convertLiveTicketCategoryToVendorData(
                matchingTicket,
                eventData.currency,
              );
              successCount++;
              return {
                ...ticket,
                price: ticketData.price,
                available: ticketData.available,
              };
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            console.error(
              `❌ Error processing Live ticket ${ticket.id}:`,
              errorMessage,
            );
            failureCount++;
            failedTicketIds.push(ticket.id);
            return ticket; // Keep original ticket data if processing fails
          }
        },
      );

      // Update all tickets in a single database operation
      await this.updateAllTicketsInDatabase(event.id, updatedTickets);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        `❌ Error processing Live event ${event.id}:`,
        errorMessage,
      );

      // Mark all tickets as failed
      failureCount += event.tickets_and_rates.length;
      event.tickets_and_rates.forEach((t) => failedTicketIds.push(t.id));
    }

    return { successCount, failureCount, failedTicketIds };
  }

  private async processXS2ETicket(
    eventId: number,
    ticket: EventTicket,
    eventName: string,
  ): Promise<boolean> {
    try {
      console.log(
        `🎫 Processing ticket ${ticket.id} for event "${eventName}" (${ticket.category})`,
      );

      const ticketData = await this.fetchXS2ETicketData(ticket.id);

      if (ticketData !== null) {
        await this.updateTicketInDatabase(eventId, ticket.id, ticketData);
        return true;
      } else {
        console.error(`❌ Failed to fetch ticket data for ${ticket.id}`);
        return false;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Error updating ticket ${ticket.id}:`, errorMessage);
      return false;
    }
  }

  public async syncSingleEvent(eventId: number): Promise<{
    success: boolean;
    message: string;
    failedTicketIds?: string[];
  }> {
    try {
      const { data: eventData, error } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

      if (error || !eventData) {
        throw new Error(`Event ${eventId} not found`);
      }

      const event = eventData as Event;

      // Update exchange rates first to ensure accurate pricing
      await exchangeRateService.updateAllExchangeRates();

      if (
        event.type === "sports_live_event_dynamic" ||
        event.type === "music_live_event_dynamic"
      ) {
        const result = await this.processLiveTicketsEvent(event);
        return {
          success: result.failureCount === 0,
          message: `Synced ${result.successCount} tickets. Failed: ${result.failureCount}`,
          failedTicketIds: result.failedTicketIds,
        };
      } else if (event.type === "sports_event_dynamic") {
        // For XS2 events
        if (
          !event.tickets_and_rates ||
          !Array.isArray(event.tickets_and_rates)
        ) {
          return { success: true, message: "No tickets to process" };
        }

        let successCount = 0;
        let failureCount = 0;
        const failedTicketIds: string[] = [];

        for (const ticket of event.tickets_and_rates) {
          const success = await this.processXS2ETicket(
            event.id,
            ticket,
            event.name,
          );
          if (success) {
            successCount++;
          } else {
            failureCount++;
            failedTicketIds.push(ticket.id);
          }
        }

        return {
          success: failureCount === 0,
          message: `Synced ${successCount} tickets. Failed: ${failureCount}`,
          failedTicketIds,
        };
      }

      return {
        success: false,
        message: `Event type '${event.type}' not supported for sync`,
      };
    } catch (error) {
      console.error(`❌ Error syncing event ${eventId}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  public async syncAllTicketPrices(): Promise<SyncSummary> {
    const startTime = new Date();
    await exchangeRateService.updateAllExchangeRates();

    // Log current rates for transparency
    const rates = exchangeRateService.getAllExchangeRates();
    console.log(`📊 Current exchange rates:`);
    console.log(`   EUR/USD: ${rates.EUR.rate} (${rates.EUR.source})`);
    console.log(`   ILS/USD: ${rates.ILS.rate} (${rates.ILS.source})`);
    console.log(`   GBP/USD: ${rates.GBP.rate} (${rates.GBP.source})`);

    const summary: SyncSummary = {
      totalTickets: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      eventsProcessed: 0,
      startTime,
      endTime: new Date(),
      errors: [],
    };

    try {
      // Sync XS2 events (dynamic sports events)
      console.log("\n🎯 === SYNCING XS2 EVENTS ===");
      const xs2Summary = await this.syncXS2TicketPrices();

      // Sync Live/Doctor events
      console.log("\n🎯 === SYNCING LIVE/DOCTOR EVENTS ===");
      const liveSummary = await this.syncLiveTicketPrices();
      console.log("🎯 === SYNC COMPLETE ===\n");
      console.log(
        `📊 XS2 Summary: ${xs2Summary.eventsProcessed} events, ${xs2Summary.totalTickets} tickets, ${xs2Summary.successfulUpdates} successful, ${xs2Summary.failedUpdates} failed`,
      );
      console.log(
        `📊 Live Summary: ${liveSummary.eventsProcessed} events, ${liveSummary.totalTickets} tickets, ${liveSummary.successfulUpdates} successful, ${liveSummary.failedUpdates} failed`,
      );

      // Combine summaries
      summary.totalTickets = xs2Summary.totalTickets + liveSummary.totalTickets;
      summary.successfulUpdates =
        xs2Summary.successfulUpdates + liveSummary.successfulUpdates;
      summary.failedUpdates =
        xs2Summary.failedUpdates + liveSummary.failedUpdates;
      summary.eventsProcessed =
        xs2Summary.eventsProcessed + liveSummary.eventsProcessed;
      summary.errors = [...xs2Summary.errors, ...liveSummary.errors];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("❌ Fatal error in syncAllTicketPrices:", errorMessage);
      summary.errors.push(`Fatal error: ${errorMessage}`);
    }

    summary.endTime = new Date();
    if (summary.errors.length > 0) {
      console.log(`⚠️ ${summary.errors.length} errors occurred`);
    }

    return summary;
  }

  public async syncXS2TicketPrices(): Promise<SyncSummary> {
    const startTime = new Date();
    console.log(
      `🚀 Starting XS2 ticket price sync at ${startTime.toISOString()}`,
    );

    const summary: SyncSummary = {
      totalTickets: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      eventsProcessed: 0,
      startTime,
      endTime: new Date(),
      errors: [],
    };

    try {
      const xs2Events = await this.getEventsByTypeFromDB("xs2");

      if (xs2Events.length === 0) {
        console.log("ℹ️ No XS2 dynamic sports events found");
        summary.endTime = new Date();
        return summary;
      }

      for (const event of xs2Events) {
        try {
          console.log(
            `\n📅 Processing XS2 event: "${event.name}" (ID: ${event.id})`,
          );
          summary.eventsProcessed++;

          if (
            !event.tickets_and_rates ||
            !Array.isArray(event.tickets_and_rates)
          ) {
            console.log(`⚠️ Event ${event.id} has no tickets to process`);
            continue;
          }

          for (const ticket of event.tickets_and_rates) {
            summary.totalTickets++;

            const success = await this.processXS2ETicket(
              event.id,
              ticket,
              event.name,
            );

            if (success) {
              summary.successfulUpdates++;
            } else {
              summary.failedUpdates++;
              summary.errors.push(`XS2 Ticket ${ticket.id}: Failed to update`);
            }

            await this.delay(this.REQUEST_DELAY);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          console.error(
            `❌ Error processing XS2 event ${event.id}:`,
            errorMessage,
          );
          summary.errors.push(`XS2 Event ${event.id}: ${errorMessage}`);
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("❌ Fatal error in syncXS2TicketPrices:", errorMessage);
      summary.errors.push(`XS2 Fatal error: ${errorMessage}`);
    }

    summary.endTime = new Date();
    if (summary.errors.length > 0) {
      console.log(`⚠️ XS2: ${summary.errors.length} errors occurred`);
    }
    return summary;
  }

  public async syncLiveTicketPrices(): Promise<SyncSummary> {
    const startTime = new Date();
    console.log(
      `🚀 Starting Live/Doctor ticket price sync at ${startTime.toISOString()}`,
    );

    const summary: SyncSummary = {
      totalTickets: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      eventsProcessed: 0,
      startTime,
      endTime: new Date(),
      errors: [],
    };

    try {
      const liveEvents = await this.getEventsByTypeFromDB("liveTickets");

      if (liveEvents.length === 0) {
        console.log("ℹ️ No LiveTickets events found");
        summary.endTime = new Date();
        return summary;
      }

      for (const event of liveEvents) {
        try {
          summary.eventsProcessed++;

          if (
            !event.tickets_and_rates ||
            !Array.isArray(event.tickets_and_rates)
          ) {
            console.log(`⚠️ Event ${event.id} has no tickets to process`);
            continue;
          }

          const eventResults = await this.processLiveTicketsEvent(event);

          // Update summary with results
          summary.totalTickets += event.tickets_and_rates.length;
          summary.successfulUpdates += eventResults.successCount;
          summary.failedUpdates += eventResults.failureCount;

          if (eventResults.failureCount > 0) {
            summary.errors.push(
              `Live Event ${event.id}: ${eventResults.failureCount} tickets failed`,
            );
          }

          await this.delay(this.REQUEST_DELAY);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          console.error(
            `❌ Error processing Live event ${event.id}:`,
            errorMessage,
          );
          summary.errors.push(`Live Event ${event.id}: ${errorMessage}`);
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("❌ Fatal error in syncLiveTicketPrices:", errorMessage);
      summary.errors.push(`Live Fatal error: ${errorMessage}`);
    }

    summary.endTime = new Date();

    if (summary.errors.length > 0) {
      console.log(`⚠️ Live: ${summary.errors.length} errors occurred`);
    }

    return summary;
  }
}

// Export the enhanced service and singleton instance
export const multiCurrencyExchangeRateService = exchangeRateService;
export const ticketPriceSyncService = new TicketPriceSyncService();

// Export individual sync methods for flexibility
export const syncXS2Tickets = () =>
  ticketPriceSyncService.syncXS2TicketPrices();
export const syncLiveTickets = () =>
  ticketPriceSyncService.syncLiveTicketPrices();
export const syncAllTickets = () =>
  ticketPriceSyncService.syncAllTicketPrices();

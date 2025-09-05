// lib/services/ticket-price-sync.ts

import { supabase } from '@/lib/supabase-server';
import { Event, EventTicket } from '@/types/app.types';
import { CURRENCIES } from '@/types/live-events.types';

interface ExchangeRateData {
  rate: number;
  lastUpdated: Date;
  source: 'api' | 'fallback';
}

type SupportedCurrency = 'EUR' | 'ILS' | 'GBP';

interface ExchangeRates {
  EUR: ExchangeRateData;
  ILS: ExchangeRateData;
  GBP: ExchangeRateData;
}

class MultiCurrencyExchangeRateService {
  private exchangeRates: ExchangeRates = {
    EUR: {
      rate: 1.1, // fallback rate
      lastUpdated: new Date(),
      source: 'fallback'
    },
    ILS: {
      rate: 0.27, // fallback rate (approximately 3.7 ILS per USD)
      lastUpdated: new Date(),
      source: 'fallback'
    },
    GBP: {
      rate: 1.25, // fallback rate
      lastUpdated: new Date(),
      source: 'fallback'
    }
  };
  
  private readonly API_BASE_URL = "https://api.twelvedata.com/exchange_rate";
  private readonly API_KEY = "43c9bbfbf1cb4a1990c01a1a6d9ddf2f";
  // Secondary provider (used only when rate has been stale for >= 23 hours)
  private readonly FRANKFURTER_BASE_URL = 'https://api.frankfurter.app/latest';
  
  private readonly FALLBACK_RATES = {
    EUR: 1.17,
    ILS: 0.3,
    GBP: 1.25
  };
  // Conservative bounds to reject outliers (currency -> USD per unit)
  private readonly RATE_LIMITS: Record<SupportedCurrency, { min: number; max: number }> = {
    EUR: { min: 1, max: 1.4 },  // EUR/USD
    GBP: { min: 1.1, max: 1.6 },  // GBP/USD
    ILS: { min: 0.25, max: 0.35 } // ILS/USD
  };
  private readonly MAX_RETRIES = 4;
  private readonly BASE_RETRY_DELAY_MS = 800; // exponential backoff base
  private readonly API_TIMEOUT_MS = 10000;

  private readonly SECONDARY_PROVIDER_AFTER_MS = 23 * 60 * 60 * 1000; // 23 hours

  private readonly STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour
  private readonly HARD_STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

  // Deduplicate concurrent updates per currency
  private inFlight: Map<SupportedCurrency, Promise<void>> = new Map();

  private async fetchWithTimeout(url: string, timeoutMs: number = this.API_TIMEOUT_MS): Promise<Response> {
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

  private async fetchCurrencyRate(currency: SupportedCurrency): Promise<number | null> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      const backoff = Math.round(this.BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) * (0.75 + Math.random() * 0.5));
      try {
        console.log(`🔄 Fetching ${currency}/USD rate - attempt ${attempt}/${this.MAX_RETRIES}`);
        
        const url = `${this.API_BASE_URL}?symbol=${currency}/USD&apikey=${this.API_KEY}`;
        const response = await this.fetchWithTimeout(url);

        if (!response.ok) {
          // Handle 429 rate limit with Retry-After
          if (response.status === 429) {
            const retryAfterHeader = response.headers.get('retry-after');
            const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
            const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : backoff;
            console.warn(`⏳ Rate limited for ${currency}. Waiting ${waitMs}ms before retry`);
            if (attempt < this.MAX_RETRIES) await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const raw = data?.rate;
        const parsed = typeof raw === 'number' ? raw : (typeof raw === 'string' ? parseFloat(raw) : NaN);
        if (Number.isFinite(parsed)) {
          const rate = Math.ceil(parsed * 100) / 100; // Round to 2 decimals
          if (!this.isValidRate(currency, rate)) {
            throw new Error(`Out-of-range rate for ${currency}: ${rate} (limits ${this.RATE_LIMITS[currency].min}-${this.RATE_LIMITS[currency].max})`);
          }
          console.log(`✅ ${currency}/USD rate fetched: ${rate}`);
          return rate;
        }
        throw new Error(`Invalid exchange rate data structure for ${currency}`);
      } catch (error) {
        console.warn(`⚠️ ${currency}/USD rate fetch attempt ${attempt} failed:`, error instanceof Error ? error.message : 'Unknown error');
        if (attempt < this.MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }
    console.error(`🚫 All attempts failed for ${currency}/USD with primary provider`);
    return null;
  }

  // Secondary provider: Frankfurter (used only when primary fails for >= 23 hours)
  private async fetchFromFrankfurter(currency: SupportedCurrency): Promise<number | null> {
    try {
      console.log(`🔄 [Secondary] Fetching ${currency}/USD from Frankfurter`);
      const url = `${this.FRANKFURTER_BASE_URL}?from=${encodeURIComponent(currency)}&to=USD`;
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const rate = data?.rates?.USD;
      if (typeof rate === 'number' && Number.isFinite(rate)) {
        const rounded = Math.ceil(rate * 100) / 100; // Round to 2 decimals
        if (!this.isValidRate(currency, rounded)) {
          throw new Error(`Out-of-range rate from Frankfurter for ${currency}: ${rounded}`);
        }
        console.log(`✅ [Secondary] ${currency}/USD rate fetched from Frankfurter: ${rounded}`);
        return rounded;
      } else {
        throw new Error(`Invalid exchange rate data structure from Frankfurter for ${currency}`);
      }
    } catch (error) {
      console.error(`❌ [Secondary] Frankfurter fetch failed for ${currency}:`, error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  // Coalesce concurrent updates per currency
  private scheduleCurrencyUpdate(currency: SupportedCurrency, fn: () => Promise<void>): Promise<void> {
    const existing = this.inFlight.get(currency);
    if (existing) return existing;
    const p = fn().finally(() => this.inFlight.delete(currency));
    this.inFlight.set(currency, p);
    return p;
  }

  private async updateSingleCurrencyRate(currency: SupportedCurrency): Promise<void> {
    return this.scheduleCurrencyUpdate(currency, async () => {
      try {
        const rate = await this.fetchCurrencyRate(currency);
        
        if (rate !== null) {
          this.exchangeRates[currency] = {
            rate,
            lastUpdated: new Date(),
            source: 'api'
          };
          console.log(`💱 ${currency}/USD rate updated: ${rate} (from API)`);
        } else {
          // Primary provider failed. Decide whether to try secondary provider based on staleness.
          const current = this.exchangeRates[currency];
          if (current) {
            const ageMs = Date.now() - current.lastUpdated.getTime();
            if (ageMs >= this.SECONDARY_PROVIDER_AFTER_MS) {
              console.warn(`⚠️ ${currency}/USD rate stale for ${Math.round(ageMs / 3600000)}h. Trying secondary provider (Frankfurter).`);
              const secondaryRate = await this.fetchFromFrankfurter(currency);
              if (secondaryRate !== null) {
                this.exchangeRates[currency] = {
                  rate: secondaryRate,
                  lastUpdated: new Date(),
                  source: 'api' // treat as API source; provider detail noted in logs
                };
                console.log(`💱 ${currency}/USD rate updated via secondary provider: ${secondaryRate}`);
              } else {
                console.warn(`⚠️ Secondary provider also failed for ${currency}. Maintaining previous rate: ${current.rate} (from ${current.source}, last updated: ${current.lastUpdated.toISOString()})`);
                // Keep existing rate; do not overwrite timestamp to preserve staleness tracking
              }
            } else {
              console.warn(`⚠️ Primary provider failed for ${currency}, but rate is not stale yet (${Math.round(ageMs / 3600000)}h old). Keeping previous rate: ${current.rate} (from ${current.source}).`);
            }
          } else {
            // No previous rate (shouldn't happen due to initialization) — set static fallback
            const fallbackRate = this.FALLBACK_RATES[currency];
            console.warn(`⚠️ No previous ${currency}/USD rate found. Using static fallback: ${fallbackRate}`);
            this.exchangeRates[currency] = {
              rate: fallbackRate,
              lastUpdated: new Date(),
              source: 'fallback'
            };
          }
        }
      } catch (error) {
        console.error(`❌ Error updating ${currency}/USD rate:`, error);
        // On unexpected error, keep existing rate if available; only fallback if no previous
        const current = this.exchangeRates[currency];
        if (!current) {
          const fallbackRate = this.FALLBACK_RATES[currency];
          this.exchangeRates[currency] = {
            rate: fallbackRate,
            lastUpdated: new Date(),
            source: 'fallback'
          };
        } else {
          console.warn(`⚠️ Keeping previous ${currency}/USD rate after error: ${current.rate} (from ${current.source}, last updated: ${current.lastUpdated.toISOString()})`);
        }
      }
    });
  }

  public async updateAllExchangeRates(): Promise<void> {
    console.log('💱 Updating all exchange rates...');
    const currencies: SupportedCurrency[] = ['EUR', 'ILS', 'GBP'];
    await Promise.allSettled(currencies.map(currency => this.updateSingleCurrencyRate(currency)));
    
    console.log('✅ All exchange rates updated');
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
  public async ensureFreshIfHardStale(currency: SupportedCurrency): Promise<void> {
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
  performers: Array<{ id: number; name: string; hebName: string; isDtPerformer: boolean; performerClassificationId: number | null; amount: number }>;
  venue: Array<{ id: number; name: string; isDtVenue: boolean; hebName: string }>;
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
  currency?: SupportedCurrency | 'USD';
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
  private readonly XS2_API_BASE_URL = process.env.NEXT_SECRET_XS2EVENT_API_URL || "";
  private readonly XS2_API_KEY = process.env.NEXT_SECRET_XS2EVENT_API_KEY;
  private readonly LIVE_API_BASE_URL = process.env.NEXT_SECRET_LIVE_API_URL || "";
  private readonly LIVE_API_KEY = process.env.NEXT_SECRET_LIVE_API_KEY;
  private readonly REQUEST_DELAY = 500; // 0.5 seconds between API calls
  private readonly API_TIMEOUT = 10000; // 10 seconds timeout
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second

  constructor() {
    if (!this.XS2_API_BASE_URL) {
      throw new Error("Missing XS2 API base URL (NEXT_SECRET_XS2EVENT_API_URL) in environment variables.");
    }
    if (!this.XS2_API_KEY) {
      throw new Error("Missing XS2 API key (NEXT_SECRET_XS2EVENT_API_KEY) in environment variables.");
    }
    if (!this.LIVE_API_BASE_URL) {
      throw new Error("Missing Live API base URL (NEXT_SECRET_LIVE_API_URL) in environment variables.");
    }
    if (!this.LIVE_API_KEY) {
      throw new Error("Missing Live API key (NEXT_SECRET_LIVE_API_KEY) in environment variables.");
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private roundToNearest9(price: number): number {
    const rounded = Math.ceil(price);
    const lastDigit = rounded % 10;
    
    if (lastDigit <= 9) {
      return rounded - lastDigit + 9;
    }
    return rounded;
  }

  private getCurrencyFromCode(currencyCode: number): SupportedCurrency | 'USD' {
    switch (currencyCode) {
      case CURRENCIES.USD:
        return 'USD';
      case CURRENCIES.EUR:
        return 'EUR';
      case CURRENCIES.GBP:
        return 'GBP';
      case CURRENCIES.ILS:
        return 'ILS';
      default:
        console.warn(`⚠️ Unknown currency code ${currencyCode}, defaulting to USD`);
        return 'USD';
    }
  }

  private convertToUSD(amount: number, currency: SupportedCurrency | 'USD'): number {
    if (currency === 'USD') {
      return amount;
    }
    return exchangeRateService.convertToUSD(amount, currency as SupportedCurrency);
  }

  private async fetchWithTimeout(url: string, apiKey?: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.API_TIMEOUT);
    
    try {
      console.log(`🔄 Fetching: ${url}`);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'X-Api-Key': apiKey || '',
          'Content-Type': 'application/json'
        }
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private async fetchXS2ETicketData(ticketId: string): Promise<{ price: number; available: boolean } | null> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`📍 Fetching ticket ${ticketId} - attempt ${attempt}/${this.MAX_RETRIES}`);
        
        const url = `${this.XS2_API_BASE_URL}/tickets/${ticketId}`;
        const response = await this.fetchWithTimeout(url, this.XS2_API_KEY);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: TicketApiResponse = await response.json();

        // Validate response structure
        if (!data || 
            typeof data.ticket_status !== 'string' || 
            typeof data.stock !== 'number' ||
            !data.local_rates ||
            typeof data.local_rates.net_rate_eur !== 'number') {
          throw new Error(`Invalid API response structure for ticket ${ticketId}`);
        }
        
        const available = data.ticket_status === 'available' && data.stock > 3;
        
        // Convert EUR cents to EUR, add 40 EUR markup, convert to USD, then round to nearest 9
        const priceInEur = data.local_rates.net_rate_eur / 100;
        const priceWithMarkup = priceInEur + 40;
        
        // Convert EUR to USD using exchange rate
        const eurUsdRate = exchangeRateService.getExchangeRate('EUR');
        const priceInUsd = priceWithMarkup * eurUsdRate.rate;
        const finalPrice = this.roundToNearest9(priceInUsd);
                
        return {
          price: finalPrice,
          available: available
        };
      } catch (error) {
        console.log(`❌ Attempt ${attempt} failed for ticket ${ticketId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        if (attempt < this.MAX_RETRIES) {
          console.log(`⏳ Retrying in ${this.RETRY_DELAY}ms...`);
          await this.delay(this.RETRY_DELAY);
        }
      }
    }

    console.error(`🚫 All ${this.MAX_RETRIES} attempts failed for ticket ${ticketId}`);
    return null;
  }

  private async fetchLiveTicketsEventData(eventEid: string): Promise<LiveTicketsEventApiResponse | null> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`📍 Fetching Live event ${eventEid} - attempt ${attempt}/${this.MAX_RETRIES}`);
        
        const url = `${this.LIVE_API_BASE_URL}/Events/getOneEvent?eid=${eventEid}`;
        const response = await this.fetchWithTimeout(url, this.LIVE_API_KEY);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: LiveTicketsEventApiResponse[] = await response.json();

        // The API returns an array with one event
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error(`Invalid Live API response structure for event ${eventEid} - expected array with one event`);
        }

        const eventData = data[0];

        // Validate response structure
        if (!eventData || 
            typeof eventData.id !== 'number' || 
            typeof eventData.currency !== 'number' ||
            !Array.isArray(eventData.ticketCategory)) {
          throw new Error(`Invalid Live API response structure for event ${eventEid}`);
        }
                
        return eventData;
      } catch (error) {        
        if (attempt < this.MAX_RETRIES) {
          console.log(`⏳ Retrying in ${this.RETRY_DELAY}ms...`);
          await this.delay(this.RETRY_DELAY);
        }
      }
    }
    console.error(`🚫 All ${this.MAX_RETRIES} attempts failed for Live event ${eventEid}`);
    return null;
  }

  private convertLiveTicketCategoryToVendorData(ticketCategory: LiveTicketCategoryFromApi, eventCurrency: number): XS2E_VendorTicketData {
    const available = ticketCategory.maxTicketAmount > 1;
    
    // Get currency from event currency code
    const currency = this.getCurrencyFromCode(eventCurrency);
    const originalPrice = ticketCategory.cost;
    
    // Add markup based on currency
    let priceWithMarkup: number;
    if (currency === 'USD') {
      priceWithMarkup = originalPrice + 40; // $40 markup for USD
    } else if (currency === 'EUR') {
      priceWithMarkup = originalPrice + 40; // €40 markup for EUR
    } else if (currency === 'GBP') {
      priceWithMarkup = originalPrice + 35; // £35 markup for GBP
    } else if (currency === 'ILS') {
      priceWithMarkup = originalPrice + 150; // ₪150 markup for ILS
    } else {
      priceWithMarkup = originalPrice + 40; // Default $40 markup
    }
    
    // Convert to USD if needed
    const priceInUsd = this.convertToUSD(priceWithMarkup, currency);
    const finalPrice = this.roundToNearest9(priceInUsd);
    
    console.log(`✅ Live Ticket ${ticketCategory.id} (${ticketCategory.title}): $${finalPrice} (${currency} ${originalPrice} + markup = ${currency} ${priceWithMarkup} → $${priceInUsd}), available: ${available}, maxAmount: ${ticketCategory.maxTicketAmount}`);
    
    return {
      price: finalPrice,
      available: available,
      currency: currency,
      originalPrice: originalPrice
    };
  }

  private async getEventsByTypeFromDB(eventType: 'xs2' | 'liveTickets'): Promise<Event[]> {
    try {
      const isXS2 = eventType === 'xs2';
      
      let query = supabase
        .from('events')
        .select('*')
        .is('is_deleted', null)
        .gte('date', new Date().toISOString())
        .order('date', { ascending: true });

      if (isXS2) {
        query = query.eq('type', 'sports_event_dynamic');
      } else {
        query = query.in('type', ['sports_live_event_dynamic', 'music_live_event_dynamic']);
      }

      const { data: events, error } = await query;

      if (error) {
        console.error(`❌ Error fetching ${isXS2 ? 'XS2' : 'liveTickets'} events:`, error);
        return [];
      }

      const eventCount = events?.length || 0;
      console.log(`📊 Found ${eventCount} ${isXS2 ? 'XS2' : 'liveTickets'} events`);
      
      return (events as Event[]) || [];
    } catch (error) {
      console.error(`❌ Error in getEventsByTypeFromDB (${eventType}):`, error);
      return [];
    }
  }

  private async updateTicketInDatabase(eventId: number, ticketId: string, ticketData: { price: number; available: boolean }): Promise<void> {
    const { data: event, error: selectError } = await supabase
      .from('events')
      .select('tickets_and_rates')
      .eq('id', eventId)
      .single();

    if (selectError) throw selectError;

    const tickets = event?.tickets_and_rates as EventTicket[] | undefined;
    if (!tickets) throw new Error('No tickets found for event');

    const updatedTickets = tickets.map((ticket: EventTicket) => {
      if (ticket.id === ticketId) {
        return {
          ...ticket,
          price: ticketData.price,
          available: ticketData.available
        };
      }
      return ticket;
    });

    const { error: updateError } = await supabase
      .from('events')
      .update({ tickets_and_rates: updatedTickets })
      .eq('id', eventId);

    if (updateError) throw updateError;
  }

  private async updateAllTicketsInDatabase(eventId: number, updatedTickets: EventTicket[]): Promise<void> {
    const { error: updateError } = await supabase
      .from('events')
      .update({ tickets_and_rates: updatedTickets })
      .eq('id', eventId);

    if (updateError) throw updateError;
  }

  private async processLiveTicketsEvent(event: Event): Promise<{ successCount: number; failureCount: number }> {
    let successCount = 0;
    let failureCount = 0;

    if (!event.tickets_and_rates || !Array.isArray(event.tickets_and_rates)) {
      console.log(`⚠️ Event ${event.id} has no tickets to process`);
      return { successCount, failureCount };
    }

    const eventEid = event.tickets_and_rates[0].eid || '';

    try {
      // Fetch all ticket categories for this event
      const eventData = await this.fetchLiveTicketsEventData(eventEid);

      if (!eventData || !eventData.ticketCategory || !Array.isArray(eventData.ticketCategory) || eventData.ticketCategory.length === 0) {
        console.log(`⚠️ Failed to fetch event data for ${event.id}`);
        return { successCount, failureCount };
      }
      
      // Process all tickets and prepare updated tickets array
      const updatedTickets = event.tickets_and_rates.map((ticket: EventTicket) => {
        try {
          const matchingTicket = eventData.ticketCategory.find(_ticket => _ticket.id.toString() === ticket.id);
          
          if (!matchingTicket) {
            console.warn(`⚠️ No matching ticket category found for ticket ID ${ticket.id}`);
            failureCount++;
            return {
              ...ticket,
              price: 0,
              available: false
            };
          } else {
            const ticketData = this.convertLiveTicketCategoryToVendorData(matchingTicket, eventData.currency);
            successCount++;
            return {
              ...ticket,
              price: ticketData.price,
              available: ticketData.available
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Error processing Live ticket ${ticket.id}:`, errorMessage);
          failureCount++;
          return ticket; // Keep original ticket data if processing fails
        }
      });
      
      // Update all tickets in a single database operation
      await this.updateAllTicketsInDatabase(event.id, updatedTickets);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error processing Live event ${event.id}:`, errorMessage);
      
      // Mark all tickets as failed
      failureCount += event.tickets_and_rates.length;
    }
    
    return { successCount, failureCount };
  }

  private async processXS2ETicket(eventId: number, ticket: EventTicket, eventName: string): Promise<boolean> {
    try {
      console.log(`🎫 Processing ticket ${ticket.id} for event "${eventName}" (${ticket.category})`);

      const ticketData = await this.fetchXS2ETicketData(ticket.id);
      
      if (ticketData !== null) {
        await this.updateTicketInDatabase(eventId, ticket.id, ticketData);
        return true;
      } else {
        console.error(`❌ Failed to fetch ticket data for ${ticket.id}`);
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error updating ticket ${ticket.id}:`, errorMessage);
      return false;
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
      errors: []
    };

    try {
      // Sync XS2 events (dynamic sports events)
      console.log('\n🎯 === SYNCING XS2 EVENTS ===');
      const xs2Summary = await this.syncXS2TicketPrices();
      
      // Sync Live/Doctor events
      console.log('\n🎯 === SYNCING LIVE/DOCTOR EVENTS ===');
      const liveSummary = await this.syncLiveTicketPrices();
      
      // Combine summaries
      summary.totalTickets = xs2Summary.totalTickets + liveSummary.totalTickets;
      summary.successfulUpdates = xs2Summary.successfulUpdates + liveSummary.successfulUpdates;
      summary.failedUpdates = xs2Summary.failedUpdates + liveSummary.failedUpdates;
      summary.eventsProcessed = xs2Summary.eventsProcessed + liveSummary.eventsProcessed;
      summary.errors = [...xs2Summary.errors, ...liveSummary.errors];
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Fatal error in syncAllTicketPrices:', errorMessage);
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
    console.log(`🚀 Starting XS2 ticket price sync at ${startTime.toISOString()}`);
    
    const summary: SyncSummary = {
      totalTickets: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      eventsProcessed: 0,
      startTime,
      endTime: new Date(),
      errors: []
    };

    try {
      const xs2Events = await this.getEventsByTypeFromDB('xs2');

      if (xs2Events.length === 0) {
        console.log('ℹ️ No XS2 dynamic sports events found');
        summary.endTime = new Date();
        return summary;
      }

      for (const event of xs2Events) {
        try {
          console.log(`\n📅 Processing XS2 event: "${event.name}" (ID: ${event.id})`);
          summary.eventsProcessed++;
          
          if (!event.tickets_and_rates || !Array.isArray(event.tickets_and_rates)) {
            console.log(`⚠️ Event ${event.id} has no tickets to process`);
            continue;
          }

          for (const ticket of event.tickets_and_rates) {
            summary.totalTickets++;
            
            const success = await this.processXS2ETicket(event.id, ticket, event.name);
            
            if (success) {
              summary.successfulUpdates++;
            } else {
              summary.failedUpdates++;
              summary.errors.push(`XS2 Ticket ${ticket.id}: Failed to update`);
            }
            
            await this.delay(this.REQUEST_DELAY);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Error processing XS2 event ${event.id}:`, errorMessage);
          summary.errors.push(`XS2 Event ${event.id}: ${errorMessage}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Fatal error in syncXS2TicketPrices:', errorMessage);
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
    console.log(`🚀 Starting Live/Doctor ticket price sync at ${startTime.toISOString()}`);
    
    const summary: SyncSummary = {
      totalTickets: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      eventsProcessed: 0,
      startTime,
      endTime: new Date(),
      errors: []
    };

    try {
      const liveEvents = await this.getEventsByTypeFromDB('liveTickets');
      
      if (liveEvents.length === 0) {
        console.log('ℹ️ No LiveTickets events found');
        summary.endTime = new Date();
        return summary;
      }

      for (const event of liveEvents) {
        try {
          summary.eventsProcessed++;
          
          if (!event.tickets_and_rates || !Array.isArray(event.tickets_and_rates)) {
            console.log(`⚠️ Event ${event.id} has no tickets to process`);
            continue;
          }

          const eventResults = await this.processLiveTicketsEvent(event);

          // Update summary with results
          summary.totalTickets += event.tickets_and_rates.length;
          summary.successfulUpdates += eventResults.successCount;
          summary.failedUpdates += eventResults.failureCount;
          
          if (eventResults.failureCount > 0) {
            summary.errors.push(`Live Event ${event.id}: ${eventResults.failureCount} tickets failed`);
          }
          
          await this.delay(this.REQUEST_DELAY);
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Error processing Live event ${event.id}:`, errorMessage);
          summary.errors.push(`Live Event ${event.id}: ${errorMessage}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Fatal error in syncLiveTicketPrices:', errorMessage);
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
export const syncXS2Tickets = () => ticketPriceSyncService.syncXS2TicketPrices();
export const syncLiveTickets = () => ticketPriceSyncService.syncLiveTicketPrices();
export const syncAllTickets = () => ticketPriceSyncService.syncAllTicketPrices();

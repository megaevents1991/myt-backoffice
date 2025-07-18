// lib/services/ticket-price-sync.ts

import { supabase } from '@/lib/supabase-server';
import { Event, EventTicket } from '@/types/app.types';

interface ExchangeRateData {
  rate: number;
  lastUpdated: Date;
  source: 'api' | 'fallback';
}

// Simple exchange rate service for EUR to USD conversion
class SimpleExchangeRateService {
  private eurUsdRate: ExchangeRateData = {
    rate: 1.2, // fallback rate
    lastUpdated: new Date(),
    source: 'fallback'
  };
  
  private readonly API_BASE_URL = "https://api.twelvedata.com/exchange_rate";
  private readonly API_KEY = "43c9bbfbf1cb4a1990c01a1a6d9ddf2f";
  private readonly FALLBACK_RATE = 1.1;
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY = 3000; // 3 seconds

  private async fetchWithTimeout(url: string, timeoutMs: number = 8000): Promise<Response> {
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

  private async fetchEurUsdRate(): Promise<number | null> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`🔄 Fetching EUR/USD rate - attempt ${attempt}/${this.MAX_RETRIES}`);
        
        const url = `${this.API_BASE_URL}?symbol=EUR/USD&apikey=${this.API_KEY}`;
        const response = await this.fetchWithTimeout(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        if (data?.rate && typeof data.rate === 'number') {
          const rate = Math.ceil(data.rate * 100) / 100;
          console.log(`✅ EUR/USD rate fetched: ${rate}`);
          return rate;
        } else {
          throw new Error('Invalid exchange rate data structure');
        }
      } catch (error) {
        console.error(`❌ EUR/USD rate fetch attempt ${attempt} failed:`, error instanceof Error ? error.message : 'Unknown error');
        
        if (attempt < this.MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
        }
      }
    }
    return null;
  }

  public async updateEurUsdRate(): Promise<void> {
    try {
      const rate = await this.fetchEurUsdRate();
      
      if (rate !== null) {
        this.eurUsdRate = {
          rate,
          lastUpdated: new Date(),
          source: 'api'
        };
        console.log(`💱 EUR/USD rate updated: ${rate} (from API)`);
      } else {
        console.warn(`⚠️ Using fallback EUR/USD rate: ${this.FALLBACK_RATE}`);
        this.eurUsdRate = {
          rate: this.FALLBACK_RATE,
          lastUpdated: new Date(),
          source: 'fallback'
        };
      }
    } catch (error) {
      console.error('❌ Error updating EUR/USD rate:', error);
      this.eurUsdRate = {
        rate: this.FALLBACK_RATE,
        lastUpdated: new Date(),
        source: 'fallback'
      };
    }
  }

  public getEurUsdRate(): ExchangeRateData {
    return this.eurUsdRate;
  }
}

// Create a singleton instance
const exchangeRateService = new SimpleExchangeRateService();

interface TicketApiResponse {
  ticket_status: string;
  stock: number;
  local_rates: {
    net_rate_eur: number; // Price in EUR cents
  };
}

interface TicketUpdateResult {
  ticketId: string;
  eventId: number;
  success: boolean;
  updatedPrice?: number;
  available?: boolean;
  error?: string;
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
  private readonly API_BASE_URL = process.env.NEXT_SECRET_XS2EVENT_API_URL || "";
  private readonly API_KEY = process.env.NEXT_SECRET_XS2EVENT_API_KEY;
  private readonly REQUEST_DELAY = 1000; // 1 seconds between API calls
  private readonly API_TIMEOUT = 15000; // 15 seconds timeout
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 3000; // 3 seconds

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

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.API_TIMEOUT);
    
    try {
      console.log(`🔄 Fetching: ${url}`);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'X-Api-Key': this.API_KEY || '',
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

  private async fetchTicketData(ticketId: string): Promise<{ price: number; available: boolean } | null> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`📍 Fetching ticket ${ticketId} - attempt ${attempt}/${this.MAX_RETRIES}`);
        
        const url = `${this.API_BASE_URL}/tickets/${ticketId}`;
        const response = await this.fetchWithTimeout(url);

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
        
        // Ticket is available if status is "available" and stock > 4
        const available = data.ticket_status === 'available' && data.stock > 4;
        
        // Convert EUR cents to EUR, add 40 EUR markup, convert to USD, then round to nearest 9
        const priceInEur = data.local_rates.net_rate_eur / 100;
        const priceWithMarkup = priceInEur + 40;
        
        // Convert EUR to USD using exchange rate
        const eurUsdRate = exchangeRateService.getEurUsdRate();
        const priceInUsd = priceWithMarkup * eurUsdRate.rate;
        const finalPrice = this.roundToNearest9(priceInUsd);
        
        console.log(`✅ Ticket ${ticketId}: $${finalPrice} (€${priceInEur} + €40 = €${priceWithMarkup} * ${eurUsdRate.rate}), available: ${available}, stock: ${data.stock}`);
        
        return {
          price: finalPrice,
          available: available
        };
      } catch (error) {
        console.error(`❌ Attempt ${attempt} failed for ticket ${ticketId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        if (attempt < this.MAX_RETRIES) {
          console.log(`⏳ Retrying in ${this.RETRY_DELAY}ms...`);
          await this.delay(this.RETRY_DELAY);
        }
      }
    }

    console.error(`🚫 All ${this.MAX_RETRIES} attempts failed for ticket ${ticketId}`);
    return null;
  }

  private async getDynamicSportsEvents(): Promise<Event[]> {
    try {
      console.log('🔍 Fetching dynamic sports events...');
      
      const { data: events, error } = await supabase
        .from('events')
        .select('*')
        .eq('type', 'sports_event_dynamic')
        .is('is_deleted', null)
        .gte('date', new Date().toISOString()) // Only future events
        .order('date', { ascending: true });

      if (error) {
        console.error('❌ Error fetching dynamic sports events:', error);
        return [];
      }

      const eventCount = events?.length || 0;
      console.log(`📊 Found ${eventCount} dynamic sports events`);
      
      return (events as Event[]) || [];
    } catch (error) {
      console.error('❌ Error in getDynamicSportsEvents:', error);
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
          // Add availability status to description if not available
          description: ticketData.available 
            ? ticket.description.replace(' - לא זמין', '') 
            : ticket.description.includes('לא זמין') 
              ? ticket.description 
              : ticket.description + ' - לא זמין'
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

  private async processTicket(eventId: number, ticket: EventTicket, eventName: string): Promise<TicketUpdateResult> {
    const originalPrice = ticket.price;
    
    try {
      console.log(`🎫 Processing ticket ${ticket.id} for event "${eventName}" (${ticket.category})`);
      
      const ticketData = await this.fetchTicketData(ticket.id);
      
      if (ticketData !== null) {
        await this.updateTicketInDatabase(eventId, ticket.id, ticketData);
        
        console.log(`✅ Updated ticket ${ticket.id}: $${originalPrice} → $${ticketData.price}, available: ${ticketData.available}`);
        
        return {
          ticketId: ticket.id,
          eventId,
          success: true,
          updatedPrice: ticketData.price,
          available: ticketData.available,
          originalPrice
        };
      } else {
        return {
          ticketId: ticket.id,
          eventId,
          success: false,
          error: 'Failed to fetch ticket data from API',
          originalPrice
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error updating ticket ${ticket.id}:`, errorMessage);
      
      return {
        ticketId: ticket.id,
        eventId,
        success: false,
        error: errorMessage,
        originalPrice
      };
    }
  }

  public async syncAllTicketPrices(): Promise<SyncSummary> {
    const startTime = new Date();
    console.log(`🚀 Starting ticket price sync at ${startTime.toISOString()}`);
    
    // Update EUR/USD exchange rate before processing tickets
    console.log('💱 Updating EUR/USD exchange rate...');
    await exchangeRateService.updateEurUsdRate();
    
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
      const dynamicEvents = await this.getDynamicSportsEvents();
      
      if (dynamicEvents.length === 0) {
        console.log('ℹ️ No dynamic sports events found');
        summary.endTime = new Date();
        return summary;
      }

      for (const event of dynamicEvents) {
        try {
          console.log(`\n📅 Processing event: "${event.name}" (ID: ${event.id})`);
          summary.eventsProcessed++;
          
          if (!event.tickets_and_rates || !Array.isArray(event.tickets_and_rates)) {
            console.log(`⚠️ Event ${event.id} has no tickets to process`);
            continue;
          }

          for (const ticket of event.tickets_and_rates) {
            summary.totalTickets++;
            
            const result = await this.processTicket(event.id, ticket, event.name);
            
            if (result.success) {
              summary.successfulUpdates++;
            } else {
              summary.failedUpdates++;
              if (result.error) {
                summary.errors.push(`Ticket ${result.ticketId}: ${result.error}`);
              }
            }
            
            // Wait between API calls to be respectful to the third-party service
            console.log(`⏳ Waiting ${this.REQUEST_DELAY}ms before next request...`);
            await this.delay(this.REQUEST_DELAY);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Error processing event ${event.id}:`, errorMessage);
          summary.errors.push(`Event ${event.id}: ${errorMessage}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Fatal error in syncAllTicketPrices:', errorMessage);
      summary.errors.push(`Fatal error: ${errorMessage}`);
    }

    summary.endTime = new Date();
    const durationMs = summary.endTime.getTime() - summary.startTime.getTime();
    const durationMinutes = Math.round(durationMs / 60000);
    
    console.log(`\n🏁 Ticket price sync completed in ${durationMinutes} minutes`);
    console.log(`📊 Summary: ${summary.successfulUpdates}/${summary.totalTickets} tickets updated successfully`);
    console.log(`📅 Events processed: ${summary.eventsProcessed}`);
    
    if (summary.errors.length > 0) {
      console.log(`⚠️ ${summary.errors.length} errors occurred`);
    }

    return summary;
  }
}

// Export a singleton instance
export const ticketPriceSyncService = new TicketPriceSyncService();

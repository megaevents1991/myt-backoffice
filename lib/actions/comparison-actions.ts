import { supabase } from "@/lib/supabase-client";
import { getLiveEvents } from "./live-events-actions";
import { getP1Events, getP1Tickets } from "./p1-events-actions";
import { getLiveTickets } from "./sports-events-actions";
import { XS2Event } from "@/types/sports-events.types";
import { LiveEventDB, CURRENCIES } from "@/types/live-events.types";
import { P1EventDB } from "@/types/p1-events.types";

export interface ComparisonEvent {
  id: string;
  name: string;
  date: string;
  venue: string;
  city: string;
  minPrice?: number;
  currency?: string;
  vendor: "LiveEvents" | "P1Events" | "SportsEvents";
  originalData: any;
}

export interface ComparisonTicket {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  stock: number;
  type?: string;
}

function mapLiveCurrency(currencyId: number): string {
  switch (currencyId) {
    case CURRENCIES.USD:
      return "USD";
    case CURRENCIES.EUR:
      return "EUR";
    case CURRENCIES.GBP:
      return "GBP";
    case CURRENCIES.ILS:
      return "ILS";
    default:
      return "EUR"; // Default fallback
  }
}

export async function getComparisonEventTickets(
  event: ComparisonEvent,
): Promise<ComparisonTicket[]> {
  try {
    if (event.vendor === "SportsEvents") {
      // Fetch from API
      const tickets = await getLiveTickets(event.id);
      return tickets.map((t) => ({
        id: t.ticket_id,
        name: t.ticket_title || t.category_name,
        description: t.description_supplier,
        // XS2 provides prices in cents, need to divide by 100
        // Use original currency and rate from API as requested
        price: t.net_rate / 100,
        currency: t.currency_code,
        stock: t.stock,
        type: t.type_ticket,
      }));
    } else if (event.vendor === "LiveEvents") {
      // Extract from originalData
      const e = event.originalData as LiveEventDB;
      return (e.ticket_categories || []).map((t) => ({
        id: t.id.toString(),
        name: t.title,
        description: t.engComments,
        price: t.cost,
        currency: mapLiveCurrency(e.currency),
        stock: t.maxTicketAmount || 0,
        type: "Paper/E-Ticket", // Generic fallback
      }));
    } else if (event.vendor === "P1Events") {
      // Extract from originalData - slim list rows don't embed tickets, fetch on demand
      const e = event.originalData as P1EventDB;
      const p1Tickets =
        Array.isArray(e.tickets) && e.tickets.length
          ? e.tickets
          : await getP1Tickets(e.event_id);
      return p1Tickets.map((t) => ({
        id: t.id,
        name: t.seatingplan_category_name || t.category,
        description: t.seatingplan_category_description,
        price: t.price_ticket,
        currency: t.currency,
        stock: t.stock,
        type: t.possible_ticket_types?.[0],
      }));
    }
  } catch (error) {
    console.error(
      `Error getting tickets for ${event.vendor} event ${event.id}:`,
      error,
    );
  }
  return [];
}

export async function searchComparisonEvents(
  query: string,
  vendors: string[] = ["LiveEvents", "P1Events", "SportsEvents"],
  date?: string,
): Promise<ComparisonEvent[]> {
  const results: ComparisonEvent[] = [];
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  // Helper to check date match
  const isDateMatch = (eventDate: string) => {
    if (!date) return true;
    // Compare YYYY-MM-DD parts
    return eventDate.split("T")[0] === date.split("T")[0];
  };

  // 1. Search Sports Events (Direct DB Query)
  if (vendors.includes("SportsEvents")) {
    let queryBuilder = supabase
      .from("xs2e_events")
      .select("*")
      .or(`event_name.ilike.%${query}%,venue_name.ilike.%${query}%`)
      .gte("date_start", new Date().toISOString()) // Only future events
      .limit(50);

    if (date) {
      // For DB query, we can be more specific if needed, but filtering in memory is safer for mixed formats
      // However, for performance, let's try to filter by day range in DB if possible.
      // But xs2e_events.date_start is likely a timestamp.
      // Let's just fetch and filter in memory for now to be safe with timezones, or add a simple range check.
      // Actually, let's just filter in memory after fetching for consistency with other vendors,
      // unless the result set is huge. 50 limit might miss the date if we don't filter in DB.
      // Let's try to filter in DB.
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      queryBuilder = queryBuilder
        .gte("date_start", date)
        .lt("date_start", nextDay.toISOString().split("T")[0]);
    }

    const { data: sportsEvents, error: sportsError } = await queryBuilder;

    if (!sportsError && sportsEvents) {
      const mapped: ComparisonEvent[] = sportsEvents.map((e: XS2Event) => ({
        id: e.event_id,
        name: e.event_name,
        date: e.date_start,
        venue: e.venue_name,
        city: e.city || "",
        minPrice: e.min_ticket_price_eur,
        currency: "EUR",
        vendor: "SportsEvents",
        originalData: e,
      }));
      results.push(...mapped);
    }
  }

  // 2. Search Live Events (Fetch All & Filter)
  if (vendors.includes("LiveEvents")) {
    try {
      const liveEvents = await getLiveEvents();
      const filteredLive = liveEvents.filter((e) => {
        return (
          ((e.event_name || "").toLowerCase().includes(normalizedQuery) ||
            (e.venues?.[0]?.name &&
              e.venues[0].name.toLowerCase().includes(normalizedQuery))) &&
          isDateMatch(e.show_date)
        );
      });

      const mappedLive: ComparisonEvent[] = filteredLive.map((e) => ({
        id: e.event_id.toString(),
        name: e.event_name,
        date: e.show_date,
        venue: e.venues?.[0]?.name || "",
        city: e.city_name || "",
        minPrice: undefined,
        currency: "EUR",
        vendor: "LiveEvents",
        originalData: e,
      }));
      results.push(...mappedLive);
    } catch (err) {
      console.error("Error fetching LiveEvents for comparison", err);
    }
  }

  // 3. Search P1 Events (Fetch All & Filter)
  if (vendors.includes("P1Events")) {
    try {
      const p1Events = await getP1Events();
      const filteredP1 = p1Events.filter((e) => {
        return (
          ((e.title || "").toLowerCase().includes(normalizedQuery) ||
            (e.venue_name &&
              e.venue_name.toLowerCase().includes(normalizedQuery))) &&
          isDateMatch(e.date_start)
        );
      });

      const mappedP1: ComparisonEvent[] = filteredP1.map((e) => ({
        id: e.event_id.toString(),
        name: e.title,
        date: e.date_start,
        venue: e.venue_name || "",
        city: e.venue_city || "",
        minPrice: e.compare_price_ticket_only,
        currency: "EUR",
        vendor: "P1Events",
        originalData: e,
      }));
      results.push(...mappedP1);
    } catch (err) {
      console.error("Error fetching P1Events for comparison", err);
    }
  }

  return results;
}

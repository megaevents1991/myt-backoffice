// lib/services/p1-events-sync.ts
// Server-only sync service - called by cron/API routes. Deliberately NOT a
// Server Action ("use server" removed): exports must not be client-dispatchable.

import { supabase } from "@/lib/supabase-server";
import { P1Event, P1Ticket, P1EventDB } from "@/types/p1-events.types";
import { XMLParser } from "fast-xml-parser";

// P1 XML Feed URLs
const P1_EVENTS_FEED_URL =
  process.env.NEXT_SECRET_P1_EVENTS_FEED_URL ||
  "https://travelware-backend-files-production.s3.eu-central-1.amazonaws.com/8n4477jwzxq0w15e77wnxmuf6183l6zf3ik4mk64zms7mln.xml";

const P1_TICKETS_FEED_URL =
  process.env.NEXT_SECRET_P1_TICKETS_FEED_URL ||
  "https://travelware-backend-files-production.s3.eu-central-1.amazonaws.com/udaics0gg9tl2jp7rrdnn6o0730jbz4z02f57y1nm199htg.xml";

// Types for sync results
export interface P1SyncResult {
  count: number;
  status: "success" | "error";
  error?: string;
  details?: string;
}

export interface P1SyncResults {
  events?: P1SyncResult;
  tickets?: P1SyncResult;
}

// XML Parser configuration
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
});

// Helper to normalize arrays from XML (single item might not be an array)
function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// Fetch and parse XML feed
async function fetchXMLFeed<T>(url: string, rootKey: string): Promise<T[]> {
  console.log(`🔗 Fetching P1 XML feed: ${url}`);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/xml, text/xml",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    console.log(`📄 Received XML (${xmlText.length} chars)`);

    const parsed = xmlParser.parse(xmlText);
    console.log(`✅ Parsed XML structure:`, Object.keys(parsed));

    // Handle different possible XML structures
    let items: T[] = [];

    if (parsed[rootKey]) {
      // Direct access to events/tickets
      const root = parsed[rootKey];
      if (root.event) {
        items = normalizeArray(root.event);
      } else if (root.ticket) {
        items = normalizeArray(root.ticket);
      }
    } else if (parsed.event) {
      items = normalizeArray(parsed.event);
    } else if (parsed.ticket) {
      items = normalizeArray(parsed.ticket);
    }

    console.log(`✅ Extracted ${items.length} items from XML`);
    return items;
  } catch (error) {
    console.error(`❌ Failed to fetch XML feed (${url}):`, error);
    throw error;
  }
}

// Parse tags from XML (might be comma-separated string or array)
function parseTags(tags: any): string[] {
  if (!tags) return [];
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  if (tags.tag) {
    return normalizeArray(tags.tag);
  }
  return [];
}

// Parse possible ticket types (JSON array string)
function parseTicketTypes(types: any): string[] {
  if (!types) return [];
  if (typeof types === "string") {
    try {
      const parsed = JSON.parse(types);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(types)) return types;
  return [];
}

// Normalize event data from XML
function normalizeP1Event(rawEvent: any): P1Event {
  return {
    event_id: String(rawEvent.event_id || ""),
    checkout_link: String(rawEvent.checkout_link || ""),
    title: String(rawEvent.title || ""),
    category: String(rawEvent.category || "OTHER").toUpperCase(),
    compare_price_ticket_only: rawEvent.compare_price_ticket_only
      ? parseFloat(rawEvent.compare_price_ticket_only)
      : undefined,
    compare_price_ticket_hotel: rawEvent.compare_price_ticket_hotel
      ? parseFloat(rawEvent.compare_price_ticket_hotel)
      : undefined,
    series: rawEvent.series
      ? {
          id: String(rawEvent.series.id || ""),
          name: String(rawEvent.series.name || ""),
        }
      : undefined,
    has_available_tickets:
      rawEvent.has_available_tickets === true ||
      rawEvent.has_available_tickets === "true",
    is_advertisable:
      rawEvent.is_advertisable === true || rawEvent.is_advertisable === "true",
    date_start: String(rawEvent.date_start || ""),
    date_end: rawEvent.date_end ? String(rawEvent.date_end) : undefined,
    date_confirmed:
      rawEvent.date_confirmed === true || rawEvent.date_confirmed === "true",
    stock: parseInt(String(rawEvent.stock || 0)),
    venue: {
      name: String(rawEvent.venue?.name || ""),
      location: {
        lat: parseFloat(String(rawEvent.venue?.location?.lat || 0)),
        lng: parseFloat(String(rawEvent.venue?.location?.lng || 0)),
      },
      country_code: String(rawEvent.venue?.country_code || ""),
      city: String(rawEvent.venue?.city || ""),
    },
  };
}

// Normalize ticket data from XML
function normalizeP1Ticket(rawTicket: any): P1Ticket {
  return {
    checkout_link: String(rawTicket.checkout_link || ""),
    id: String(rawTicket.id || ""),
    event_id: String(rawTicket.event_id || ""),
    tags: parseTags(rawTicket.tags),
    seatingplan_category_name: String(
      rawTicket.seatingplan_category_name || "",
    ),
    currency: String(rawTicket.currency || "EUR"),
    price_ticket: parseFloat(String(rawTicket.price_ticket || 0)),
    price_ticket_hotel: rawTicket.price_ticket_hotel
      ? parseFloat(String(rawTicket.price_ticket_hotel))
      : undefined,
    seatingplan_category_image: rawTicket.seatingplan_category_image
      ? String(rawTicket.seatingplan_category_image)
      : undefined,
    seatingplan_category_description: rawTicket.seatingplan_category_description
      ? String(rawTicket.seatingplan_category_description)
      : undefined,
    category: String(
      rawTicket.category || rawTicket.seatingplan_category_name || "",
    ),
    stock: parseInt(String(rawTicket.stock || 0)),
    possible_ticket_types: parseTicketTypes(rawTicket.possible_ticket_types),
  };
}

// Main sync function
export async function syncP1Events(): Promise<P1SyncResult> {
  try {
    console.log("🎫 Starting P1 events sync...");

    // Fetch events and tickets in parallel
    const [rawEvents, rawTickets] = await Promise.all([
      fetchXMLFeed<any>(P1_EVENTS_FEED_URL, "events"),
      fetchXMLFeed<any>(P1_TICKETS_FEED_URL, "tickets"),
    ]);

    console.log(
      `📊 Fetched ${rawEvents.length} events and ${rawTickets.length} tickets`,
    );

    // Normalize events
    const events = rawEvents.map(normalizeP1Event);

    // Normalize tickets
    const tickets = rawTickets.map(normalizeP1Ticket);

    // Group tickets by event_id
    const ticketsByEvent = new Map<string, P1Ticket[]>();
    tickets.forEach((ticket) => {
      if (!ticketsByEvent.has(ticket.event_id)) {
        ticketsByEvent.set(ticket.event_id, []);
      }
      ticketsByEvent.get(ticket.event_id)!.push(ticket);
    });

    console.log(`🗂️ Grouped tickets into ${ticketsByEvent.size} events`);

    // Filter: only future events with available tickets
    const now = new Date();
    const processedEvents = events
      .filter((event) => {
        // Only future events
        const eventDate = new Date(event.date_start);
        if (eventDate <= now) return false;

        // Only advertisable events with available tickets
        if (!event.is_advertisable || !event.has_available_tickets)
          return false;

        return true;
      })
      .map((event) => {
        const eventTickets = ticketsByEvent.get(event.event_id) || [];

        const dbEvent: P1EventDB = {
          event_id: event.event_id,
          title: event.title,
          title_english: event.title, // P1 doesn't have separate translations
          category: event.category,
          series_id: event.series?.id,
          series_name: event.series?.name,
          has_available_tickets: event.has_available_tickets,
          is_advertisable: event.is_advertisable,
          date_start: event.date_start,
          date_end: event.date_end,
          date_confirmed: event.date_confirmed,
          stock: event.stock,
          venue_name: event.venue.name,
          venue_city: event.venue.city,
          venue_country_code: event.venue.country_code,
          venue_latitude: event.venue.location.lat,
          venue_longitude: event.venue.location.lng,
          compare_price_ticket_only: event.compare_price_ticket_only,
          compare_price_ticket_hotel: event.compare_price_ticket_hotel,
          checkout_link: event.checkout_link,
          tickets: eventTickets,
          is_active: true,
          last_synced: new Date().toISOString(),
        };

        return dbEvent;
      });

    console.log(
      `✅ Processed ${processedEvents.length} valid events for storage`,
    );

    // Upsert to database in batches
    if (processedEvents.length > 0) {
      const BATCH_SIZE = 500;
      const batches: P1EventDB[][] = [];

      for (let i = 0; i < processedEvents.length; i += BATCH_SIZE) {
        batches.push(processedEvents.slice(i, i + BATCH_SIZE));
      }

      console.log(
        `🗃️ Upserting ${processedEvents.length} events in ${batches.length} batches`,
      );

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const { error } = await supabase
          .from("p1_events")
          .upsert(batch as any, {
            onConflict: "event_id",
            ignoreDuplicates: false,
          });

        if (error) {
          throw new Error(
            `Batch ${i + 1}/${batches.length} upsert failed: ${error.message}`,
          );
        }
        console.log(
          `✅ Batch ${i + 1}/${batches.length} (${batch.length} events) upserted`,
        );
      }
    }

    console.log(`🎫 Successfully synced ${processedEvents.length} P1 events`);
    return {
      count: processedEvents.length,
      status: "success",
      details: `Synced ${processedEvents.length} events with ${tickets.length} total tickets`,
    };
  } catch (error) {
    console.error("❌ Failed to sync P1 events:", error);
    return {
      status: "error",
      error: String(error),
      count: 0,
    };
  }
}

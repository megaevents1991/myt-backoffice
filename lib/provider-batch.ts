// Batch-create mappers for every provider (spec 2026-09-02, section 7).
//
// The TixStock batch flow generalized: each provider's table multi-select
// stashes `{ provider, rows }` and the shared wizard maps a row to a new-event
// payload per step. These mappers are IDENTITY-ONLY - name, date, venue,
// coords, smart flight dates. Tickets start empty on purpose: stadium memory
// copies the structure from the last event at the venue, and the auto-fill
// effect quotes base prices. (The per-provider live-ticket pull with currency
// conversion stays on the single-event pages, where it always lived.)
import type { Event } from "@/types/app.types";
import type { LiveEventDB } from "@/types/live-events.types";
import type { P1EventDB } from "@/types/p1-events.types";
import type { XS2Event } from "@/types/sports-events.types";
import type { TixStockEventDB } from "@/types/tixstock.types";
import {
  calculateSmartDates,
  tixstockToEvent,
} from "@/app/(dashboard)/tixstock-events/batch/tixstock-to-event";

export type BatchProvider = "tixstock" | "live" | "p1" | "sports";

export type BatchRow = TixStockEventDB | LiveEventDB | P1EventDB | XS2Event;

export interface BatchEnvelope {
  provider: BatchProvider;
  rows: BatchRow[];
}

/** Shared tail of every identity mapping. */
function baseEvent(date: string): Pick<
  Omit<Event, "id">,
  | "card_image_url"
  | "tickets_and_rates"
  | "def_date_depart"
  | "def_date_return"
  | "usual_price"
  | "base_flight_price"
  | "base_hotel_price"
  | "is_prioritized"
  | "skip_flight"
  | "event_additional_markup"
  | "is_deleted"
> {
  const smart = calculateSmartDates(date);
  return {
    card_image_url: "",
    tickets_and_rates: [],
    def_date_depart: smart.departure,
    def_date_return: smart.return,
    usual_price: 0,
    base_flight_price: 0,
    base_hotel_price: 0,
    is_prioritized: false,
    skip_flight: true,
    event_additional_markup: null,
    is_deleted: "",
  };
}

export function liveRowToEvent(row: LiveEventDB): Omit<Event, "id"> {
  const date = new Date(row.show_date).toISOString().split("T")[0];
  return {
    name: row.event_name_heb || row.event_name,
    name_english: row.event_name,
    type: row.event_type,
    date,
    location: {
      latitude: 0,
      longitude: 0,
      name: row.city_name || "Unknown Location",
      city_iata: row.iata || "",
      country_code: undefined,
    },
    map_image_url: row.venue_map_url || "",
    description:
      row.show_date_remarks || `${row.event_name} at ${row.city_name}`,
    tags: "",
    ...baseEvent(date),
  };
}

export function p1RowToEvent(row: P1EventDB): Omit<Event, "id"> {
  const date = new Date(row.date_start).toISOString().split("T")[0];
  return {
    name: row.title,
    name_english: row.title_english || row.title,
    type: "sports_event",
    date,
    location: {
      latitude: row.venue_latitude || 0,
      longitude: row.venue_longitude || 0,
      name: row.venue_name || row.venue_city || "Unknown Venue",
      city_iata: "", // nearest-location effect resolves it from the coords
      country_code: row.venue_country_code || undefined,
    },
    map_image_url: "",
    description: row.series_name ? `${row.title} - ${row.series_name}` : row.title,
    tags: row.category ?? "",
    ...baseEvent(date),
  };
}

export function sportsRowToEvent(row: XS2Event): Omit<Event, "id"> {
  const date = new Date(row.date_start).toISOString().split("T")[0];
  return {
    name: row.event_name,
    name_english: row.event_name,
    type: "sports_event_dynamic",
    date,
    location: {
      latitude: Number.parseFloat(row.latitude ?? "") || 0,
      longitude: Number.parseFloat(row.longitude ?? "") || 0,
      name: row.venue_name || "Unknown Venue",
      city_iata: "", // nearest-location effect resolves it from the coords
      country_code: undefined,
    },
    map_image_url: `https://cdn.xs2event.com/venues/static/${row.venue_id}-legend.png`,
    description: row.event_description || `${row.event_name} - ${row.tournament_name}`,
    tags: "",
    ...baseEvent(date),
  };
}

/** The wizard picks the mapper by the stash envelope's provider. */
export function mapBatchRow(
  provider: BatchProvider,
  row: BatchRow,
): Omit<Event, "id"> {
  switch (provider) {
    case "tixstock":
      return tixstockToEvent(row as TixStockEventDB);
    case "live":
      return liveRowToEvent(row as LiveEventDB);
    case "p1":
      return p1RowToEvent(row as P1EventDB);
    case "sports":
      return sportsRowToEvent(row as XS2Event);
  }
}

/** Step label bits the wizard shows per provider row. */
export function batchRowIdentity(
  provider: BatchProvider,
  row: BatchRow,
): { key: string; name: string; date: string; group: string } {
  const mapped = mapBatchRow(provider, row);
  const key =
    provider === "tixstock" || provider === "live"
      ? String((row as TixStockEventDB | LiveEventDB).event_id)
      : (row as P1EventDB | XS2Event).event_id;
  return { key, name: mapped.name, date: mapped.date, group: mapped.location.name };
}

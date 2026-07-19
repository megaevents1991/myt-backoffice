import type { Event } from "@/types/app.types";
import type { TixStockEventDB } from "@/types/tixstock.types";

/**
 * Smart departure/return dates for an event date.
 * Departure: 2 days before, moved to Thursday if it lands on Fri/Sat.
 * Return: 1 day after, moved to Sunday if it lands on Saturday.
 * (Extracted verbatim from the single-create flow so both paths match.)
 */
export function calculateSmartDates(eventDate: string): {
  departure: string;
  return: string;
} {
  const event = new Date(eventDate);

  const departure = new Date(event);
  departure.setDate(event.getDate() - 2);
  const departureDay = departure.getDay();
  if (departureDay === 5) {
    departure.setDate(departure.getDate() - 1); // Friday -> Thursday
  } else if (departureDay === 6) {
    departure.setDate(departure.getDate() - 2); // Saturday -> Thursday
  }

  const returnDate = new Date(event);
  returnDate.setDate(event.getDate() + 1);
  if (returnDate.getDay() === 6) {
    returnDate.setDate(returnDate.getDate() + 1); // Saturday -> Sunday
  }

  return {
    departure: departure.toISOString().split("T")[0],
    return: returnDate.toISOString().split("T")[0],
  };
}

/**
 * Maps a TixStock event row to a new-event payload (`Omit<Event,"id">`),
 * pre-filling per-event values TixStock knows (name, date, venue, coords, map).
 * Shared by single-create and batch-create.
 */
export function tixstockToEvent(event: TixStockEventDB): Omit<Event, "id"> {
  const dateISO = new Date(event.show_date).toISOString().split("T")[0];
  const smart = calculateSmartDates(dateISO);

  return {
    name: event.event_name,
    name_english: event.event_name,
    type: "tx_event",
    date: dateISO,
    location: {
      latitude: event.venue_data?.latitude || 0,
      longitude: event.venue_data?.longitude || 0,
      name: event.venue_name || "Unknown Venue",
      city_iata: "", // not provided by TixStock — admin enters (needed for flight search)
      country_code: event.country_code || undefined,
    },
    map_image_url: event.venue_map_url || "",
    description: `${event.event_name} at ${event.venue_name}`,
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
    tags: "",
  };
}

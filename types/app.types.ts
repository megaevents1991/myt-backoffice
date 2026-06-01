import type { EntryFieldTypes } from "contentful";

export type EventType =
  | "sports_event"
  | "music_event"
  | "sports_event_dynamic"
  | "sports_live_event_dynamic"
  | "music_live_event_dynamic"
  | "tx_event";

export type Event = {
  id: number;
  name: string;
  name_english: string;
  type: EventType;
  date: string;
  location: {
    latitude: number;
    longitude: number;
    name: string;
    city_iata: string;
    country_code?: string;
  };
  map_image_url: string;
  description: string;
  card_image_url: string;
  tickets_and_rates: EventTicket[];
  def_date_depart: string;
  def_date_return: string;
  usual_price: number;
  base_flight_price: number;
  base_hotel_price: number;
  is_prioritized: boolean;
  skip_flight?: boolean;
  // Extra per-ticket markup (USD) added when skip_flight is true.
  // Compensates for the markup normally embedded in base_flight_price.
  skip_flight_markup?: number | null;
  is_deleted: string;
  tags: string;
  tx_excluded_sections?: string[];
  // Extra event-level markup (USD) added to this event.
  event_additional_markup?: number | null;
};

export type Flight = {
  id: string;
  airline: string;
  price: number;
  duration: string;
  stops: number;
  metadata: string;
  outbound: FlightSegment;
  inbound: FlightSegment;
  numOfTravelers: number;
  offer: FlightOffer;
  penalties?: string;
  bags?: object;
  virtualOfferType?: boolean;
  isOffline?: boolean;
  offlineId?: number;
  offlineRawPrice?: number;
};

export type FlightSegment = {
  [x: string]: any;
  departureTime: string;
  arrivalTime: string;
  departureAirport: string;
  arrivalAirport: string;
  stops: { iataCode: string; duration: number | null }[];
  duration: string;
  checkBagsIncluded: boolean;
  flightNumber?: string;
};

export type OrderHotel = {
  // Full WorldOTA rate object saved by the main app. Meal info lives here,
  // NOT at the top level (kept in sync with main app lib/app.types.ts).
  rate: {
    meal_data: { value: string; has_breakfast: boolean };
    meal: string;
    room_name?: string;
    [key: string]: unknown;
  };
  address: string;
  name: string;
  id: string;
  price: string;
  guests: { adults: number; children: JSON[] }[];
  checkin: string;
  checkout: string;
  isOffline?: boolean;
  offlineId?: number;
  offlineRawPrice?: number;
};

export type Order = {
  eventId: string;
  ticketType: string;
  quantity: number;
  flightId: string;
  hotelId: string;
  totalPrice: number;
};

export type FlightSearchOptions = {
  originLocationCode: "TLV";
  destinationLocationCode: string;
  departureDate: string;
  returnDate: string;
  adults: number;
  children: string;
  infants: string;
  destination: string;
  nonStop: boolean;
};

export type TimeRange = [
  {
    hours: number;
    minutes: number;
  },
  {
    hours: number;
    minutes: number;
  },
];

export type AffiliateTracking = {
  id: string;
  affiliate_id: string;
  stage:
    | "VISIT"
    | "EVENT_SELECTED"
    | "TICKET_SELECTED"
    | "FLIGHT_SELECTED"
    | "HOTEL_SELECTED"
    | "CONFIRMED";
  data: object;
  timestamp: string;
};

export type SortOptions = "price_asc" | "rating";

export type HotelSearchCriteria =
  | {
      type: "rating";
      value: boolean[];
    }
  | {
      type: "priceRange";
      value: [number, number];
    }
  | {
      type: "hotelName";
      value: string;
    }
  | {
      type: "meal";
      value: ["withMeal", "withoutMeal"];
    }
  | {
      type: "kind";
      value: [
        "Resort",
        "Sanatorium",
        "Guesthouse",
        "Mini-hotel",
        "Castle",
        "Hotel",
        "Boutique_and_Design",
        "Apartment",
        "Cottages_and_Houses",
        "Farm",
        "Villas_and_Bungalows",
        "Camping",
        "Hostel",
        "BNB",
        "Glamping",
        "Apart-hotel",
      ];
    }
  | {
      type: "sortOption";
      value: SortOptions;
    }
  | {
      type: "region";
      value: string[];
    }
  | {
      type: "distanceFromCenter";
      value: [number, number];
    }
  | {
      type: "freeCancellation";
      value: ("withFreeCancellation" | "withoutFreeCancellation")[];
    };

export type FlightSearchCriteria =
  | {
      type: "departureRanges" | "arrivalRanges";
      value: TimeRange[];
    }
  | {
      type: "maxPrice";
      value: number;
    }
  | {
      type: "flightDuration";
      value: number;
    }
  | {
      type: "airline";
      value: string[];
    }
  | {
      type: "numOfStops";
      value: string[];
    }
  | {
      type: "luggage";
      value: string[];
    };

export type VipConfig = {
  enabled: boolean;
  details: string;
};

export type EventTicket = {
  category: string;
  price: number;
  id: string;
  description: string;
  colorOnTheMap: string;
  vendor?: string;
  eid?: string;
  available?: boolean;
  vip?: VipConfig;
};

export type OrderTicket = Omit<EventTicket, "description" | "colorOnTheMap"> & {
  quantity: number;
};

export type ArtistFields = {
  contentTypeId: "artistTemplate";
  fields: {
    bio: EntryFieldTypes.Object<{
      content: {
        content: {
          value?: string;
        }[];
      }[];
    }>;
    previewText: string;
    heroBanner: EntryFieldTypes.Object<{
      fields?: {
        file?: {
          url?: string;
          details?: {
            image?: {
              height?: number;
              width?: number;
            };
          };
        };
        description?: string;
        title?: string;
      };
    }>;
    name: string;
    nameDBenglish: string;
    sys: EntryFieldTypes.Object<{
      id: string;
    }>;
  };
};

export type FootballFields = {
  contentTypeId: "footballTeamTemplate";
  fields: {
    bio: EntryFieldTypes.Object<{
      content: {
        content: {
          value?: string;
        }[];
      }[];
    }>;
    previewText: string;
    heroBanner: EntryFieldTypes.Object<{
      fields?: {
        file?: {
          url?: string;
          details?: {
            image?: {
              height?: number;
              width?: number;
            };
          };
        };
        description?: string;
        title?: string;
      };
    }>;
    name: string;
    nameDBenglish: string;
    sys: EntryFieldTypes.Object<{
      id: string;
    }>;
  };
};

export type Log = {
  type?: "error" | "warn" | "log";
  data: Record<string, unknown> | string;
};

export type FlightOffer = any; // Define this type if needed

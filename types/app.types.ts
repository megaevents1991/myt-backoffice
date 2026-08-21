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
  // Card "blob" art (synced with main app). art_image_url = transparent cut-out
  // PNG (background removed on upload). art_color_index (0-5) + art_shape_index
  // (0-5) pick the neon blob colour + shape. Omitted = derived from event id.
  art_image_url?: string | null;
  art_color_index?: number | null;
  art_shape_index?: number | null;
  // Match "logo VS logo" art - COMPUTED at read time by the MAIN APP's
  // fallback-image enrichment (myt-main lib/events/fallbackImage.ts) when both
  // sides of a fixture name resolve in the football_logos library. NOT
  // database columns - never persisted; unused in the backoffice.
  match_home_logo_url?: string | null;
  match_away_logo_url?: string | null;
  // Zoom (1 = 100%): cut-out scale + background (blob/photo) scale.
  art_image_scale?: number | null;
  art_bg_scale?: number | null;
  // Cut-out position, % of frame (null/0 = default bottom-center). X+ = right, Y+ = down.
  art_image_offset_x?: number | null;
  art_image_offset_y?: number | null;
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
  // LOCKFLIGHT: when set, the main app offers ONLY this offline flight and
  // never calls Amadeus for this event. skip_flight still applies. When the
  // flight's allocation for this event is exhausted the package is sold out -
  // there is deliberately no fallback to a dynamic search.
  locked_flight_id?: number | null;
  // Derived at read time in the MAIN app (markLockedPackagesSoldOut), NOT a
  // column: the locked flight has no seats left for this event, so the catalog
  // card reads sold out. Mirrored here only to keep the shared type identical -
  // the backoffice never sets it.
  locked_flight_sold_out?: boolean;
  is_deleted: string;
  // QA-only events: main keeps them orderable by direct /order/{id} link but
  // filters them from every listing, search, category and feed surface.
  is_test?: boolean;
  tags: string;
  tx_excluded_sections?: string[];
  // Extra event-level markup (USD) added to this event.
  event_additional_markup?: number | null;
  // Per-event component markups (USD). When ANY of the three markup_* fields
  // is set the main app uses composed pricing: markup_ticket always charged;
  // markup_flight/markup_hotel only when that component is included;
  // skip_flight_markup/skip_hotel_markup only when it's skipped.
  // All null → legacy pricing (global 175 + env hotel-skip fee), unchanged.
  markup_ticket?: number | null;
  markup_flight?: number | null;
  markup_hotel?: number | null;
  skip_hotel_markup?: number | null;
  // Ticket-only override (USD per ticket). Set when skip-flight is allowed;
  // when the customer skips BOTH flight and hotel the main app charges exactly
  // ticket_cost + this value (no other markup at all). Every other path is
  // unchanged. Empty/null = no override.
  ticket_only_markup?: number | null;
  // Auto-generated campaign creative for the Meta product feed (nightly cron;
  // square = feed image_link, banner = additional_image_link). Synced to main.
  campaign_image_url?: string | null;
  campaign_banner_url?: string | null;
  campaign_input_hash?: string | null;
  campaign_generated_at?: string | null;
  // Direct video FILE url (mp4/mov/…) for the Meta activities feed's
  // video[0].url. Player/YouTube links are rejected by Meta. Set manually in
  // the event editor; synced to main.
  campaign_video_url?: string | null;
  comp_pricing?: {
    price: number;
    name: string;
    date: string;
    /** Date found by the comp scraper (may differ from event date on date-mismatch) */
    foundDate?: string;
    /** 'ok' = confirmed match, 'no_result' = comp doesn't have it, 'date_mismatch' = user-resolved mismatch */
    status?: "ok" | "no_result" | "date_mismatch";
    /** User-chosen color override for date_mismatch results */
    colorOverride?: "green" | "yellow" | "red" | "blue";
  } | null;
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
  // Paid baggage upsell chosen on main's order summary - rides into
  // reservations.flight_order_info so ops can fulfill it (mirrors main).
  added_bags?: AddedBagsInfo | null;
  // Branded-fare upgrade ("שדרוג כרטיס" - El Al Classic) applied on main's
  // summary. Persisted WITHOUT the in-session prev_offer anchor (mirrors main).
  fare_upgrade?: { brand: string; delta_total_usd: number } | null;
};

/** Mirrors main lib/app.types.ts - keep in sync. */
export type AddedBagsInfo = {
  /** TOTAL checked bags on the booking (new shape, 20.8 quantity fix). */
  checked_qty?: number;
  /** LEGACY (older reservations): bags per traveler - total is
   *  checked_qty_per_pax × numOfTravelers. */
  checked_qty_per_pax?: number;
  /** Effective per-bag price (total / qty). */
  unit_price_usd: number;
  /** Checked-bag component total. */
  total_usd: number;
  /** Optional cabin/trolley add-on, priced independently (per traveler). */
  cabin?: {
    qty_per_pax: number;
    unit_price_usd: number;
    total_usd: number;
  };
};

export type FlightSegment = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [x: string]: any;
  departureTime: string;
  arrivalTime: string;
  departureAirport: string;
  arrivalAirport: string;
  stops: { iataCode: string; duration: number | null }[];
  duration: string;
  checkBagsIncluded: boolean;
  cabinBagsIncluded: boolean;
  flightNumber?: string;
  // Codeshare disclosure: name of the airline actually flying this leg when
  // it differs from the carrier shown on the card (e.g. an LY-marketed
  // Saturday flight operated by Air France). Undefined when they match.
  operatedBy?: string;
  // Offline flights only: the weight allowance behind checkBagsIncluded /
  // cabinBagsIncluded, when the supplier gave us one.
  checkedBagKg?: number | null;
  cabinBagKg?: number | null;
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
  // When isOffline: every offline_hotels.id consumed (one per room unit);
  // offlineId kept as the first for legacy paths - mirrors main.
  offlineId?: number;
  offlineIds?: number[];
  offlineRawPrice?: number;
  // Breakfast upsell applied on main's summary (rate swap). Persisted WITHOUT
  // prev_rate (in-session only on main) - ops sees the delta it added.
  breakfast_upgrade?: { delta_usd: number; prev_price: string } | null;
  // Display block main renders on the summary; the portal's package builder
  // writes it too (buildHotelSnapshot).
  hotelInformation?: {
    hotelName: string;
    roomName: string;
    stars: number;
    amenities: string[];
    distance: number;
  };
};

/**
 * How an agent-entered booking gets settled - mirror of main's
 * lib/app.types.ts (resolveAgentSettlement there). Stored on
 * reservations.partner_settlement_method.
 *
 * "payment_link" added 2026-08-20 (main "wave3-main-paylink"): "אשראי הלקוח"
 * removed from the agent settlement UI (legal - an agent must never type the
 * customer's card) and replaced with a copyable link the customer pays
 * through themselves; the underlying reservation is created exactly like a
 * 24Save hold. "customer_card" itself is kept for historical rows only - it
 * is no longer written by main's agent settlement UI. Backoffice display
 * surfaces (reservations table/detail) have no dedicated case for it yet -
 * they fall through to the generic "Customer's card" label - flagged as a
 * follow-up, not fixed here (out of this task's main-only scope).
 */
export const SETTLEMENT_METHODS = [
  "customer_card",
  "agent_card",
  "voucher",
  "payment_link",
] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

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

/**
 * Customer-facing discount code (shared `coupons` table - this app writes,
 * myt-main validates + applies). Does NOT stack with the affiliate discount:
 * the bigger single discount wins.
 */
export type Coupon = {
  id: number;
  /** Stored UPPERCASE; matched case-insensitively. */
  code: string;
  /** 'percent' = % off package total; 'fixed' = USD off package total. */
  discount_type: "percent" | "fixed";
  discount_value: number;
  /** null = valid on every event. */
  event_id: number | null;
  /** ISO date; null = never expires. */
  valid_until: string | null;
  /** null = unlimited. */
  max_uses: number | null;
  times_used: number;
  /** Redemptions whose reservation reached status 'Paid' (DB trigger). */
  times_paid: number;
  /**
   * Partner (affiliate) this coupon is attributed to. Orders redeeming the
   * coupon credit this partner only when they have no affiliate of their own.
   */
  partner_tracking_code: string | null;
  is_active: boolean;
  created_at: string;
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

export type Log = {
  type?: "error" | "warn" | "log";
  data: Record<string, unknown> | string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FlightOffer = any; // Define this type if needed

// types/sports-events.types.ts

// XS2Event API Response Types
export interface XS2Sport {
  sport_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface XS2Tournament {
  tournament_id: string;
  official_name: string;
  season: string;
  tournament_type: string;
  region: string;
  sport_type: string; // This should match the XS2Sport ID
  date_start: string;
  date_stop: string;
  slug?: string;
  number_events?: number;
  created?: string;
  updated?: string;
  created_at?: string;
  updated_at?: string;
}

// Sales period type for events
export interface SalesPeriod {
  date_start: string;
  date_stop: string;
  label: string;
}

export interface XS2Event {
  event_id: string;
  event_name: string;
  event_name_heb?: string;
  date_start: string;
  date_stop: string;
  date_confirmed: boolean;
  event_status: string;
  event_description?: string;
  event_description_heb?: string;
  slug?: string;
  number_of_tickets?: number;
  sales_periods?: SalesPeriod[];
  is_popular: boolean;
  min_ticket_price_eur?: number;
  max_ticket_price_eur?: number;
  tournament_id: string; // NOT NULL in schema
  tournament_name: string;
  tournament_name_heb?: string;
  venue_id: string; // NOT NULL in schema
  venue_name: string;
  venue_name_heb?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
  hometeam_name?: string;
  visiting_name?: string;
  created?: string;
  updated?: string;
  created_at?: string;
  updated_at?: string;
}

export interface XS2Venue {
  id: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  created_at?: string;
  updated_at?: string;
}

export interface XS2Team {
  id: string;
  name: string;
  short_name?: string;
  country?: string;
  created_at?: string;
  updated_at?: string;
}

// API Response Types
export interface SportsEventsApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface LiveTicketsResponse {
  tickets: XS2Ticket[];
}

export interface SyncStatusResponse {
  results: {
    sports: { count: number | null };
    tournaments: { count: number | null };
    events: { count: number | null };
  };
}


// Local rates sub-object interface
export interface LocalRates {
  package_rate: boolean;
  net_rate_eur: number;
  face_value_eur: number;
}

// Complete ticket schema interface based on XS2Event API
export interface XS2Ticket {
  /** Special conditions to consider when ordering these tickets */
  flags?: string[];
  /** Ticket delivery type */
  type_ticket: 'eticket' | 'appticket' | 'paper-ticket' | 'collection-stadium' | 'other';
  /** Current ticket availability status */
  ticket_status: 'available' | 'disabled' | 'error' | 'returned';
  /** Duration/validity period of the ticket */
  ticket_validity: 'singleday' | 'twoday' | 'other' | 'weekend' | 'fourday';
  /** Seating/area type (grandstand, general admission, camping, transfer, carparking, busparking) */
  category_type: string;
  /** Whether extended category information is available */
  category_information_available: boolean;
  /** Net price in ticket.currency_code the distributor pays to XS2Event (required for purchasing) */
  net_rate: number;
  /** Price mentioned on ticket/offered by supplier (should not be used when buying tickets) */
  face_value: number;
  /** XS2Event ID (36char) of this ticket's event */
  event_id: string;
  /** Additional supplier description */
  description_supplier?: string;
  /** Shipping/delivery information */
  information_shipping?: string;
  /** The currency of this ticket (required for purchasing) */
  currency_code: string;
  /** End datetime of when this ticket is valid */
  ticket_validuntil: string; // ISO 8601 date-time format
  /** Start datetime of when this ticket is valid */
  ticket_validfrom: string; // ISO 8601 date-time format
  /** Minimum order quantity */
  min_order: number;
  /** The currently available number of tickets */
  stock: number;
  /** Supplier identifier */
  supplier_id?: string;
  /** External ticket identifier from supplier system */
  external_ticket_id?: string;
  /** XS2Event ID (36char) of this ticket */
  ticket_id: string;
  /** XS2Event ID (36char) of the category this ticket belongs to */
  category_id: string;
  /** Name of ticket (usually category name + child/parent) */
  ticket_title: string;
  /** Target audience for the ticket */
  ticket_targetgroup: 'retired' | 'youth' | 'disabled' | 'regular';
  /** Combination of ticket_validity and ticket_targetgroup */
  sub_category: string;
  /** Category name (Gold/Bronze/etc) */
  category_name: string;
  /** Creation timestamp */
  created?: string;
  /** Last time the ticket was updated with data from supplier */
  updated?: string;
  /** General terms of the suppliers */
  supplier_terms?: string;
  /** Supplier role */
  supplier_role?: string;
  /** Event duration information */
  eventdays?: string;
  /** Whether this is an XS2Event supplier */
  is_xs2event_supplier: boolean;
  /** Additional options */
  sales_periods?: string;
  /** Local rate information with EUR conversions */
  local_rates: LocalRates;
  /** VAT category information */
  vat_category?: string;
}

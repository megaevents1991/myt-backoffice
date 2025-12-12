// types/tixstock.types.ts

// --- TixStock API Response Types ---

export interface TixStockVenue {
  id: string;
  name: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  postcode: string;
  country_code: string;
  latitude: number;
  longitude: number;
}

export interface TixStockPerformer {
  id: string;
  name: string;
}

export interface TixStockCategory {
  id: string;
  name: string;
  upcoming_events: number;
  parent: any[]; // Often empty array in docs
  children?: TixStockCategory[];
}

export interface TixStockEvent {
  id: string;
  name: string;
  currency: string; // e.g. "EUR"
  datetime: string; // ISO-8601 e.g. "2022-11-05T15:00:00+0000"
  status: string; // e.g. "Active"
  map_url: string;
  venue: TixStockVenue;
  performers: TixStockPerformer[];
  category: TixStockCategory;
  // Listings are optional in the feed, usually fetched separately
  listings?: TixStockListing[];
}

export interface TixStockTicketInfo {
  general_admission: string; // "true" | "false"
  type: string; // "Paper", "E-Ticket", "Mobile"
  allow_last_minute_sales: string;
  split_type: string; // "No Preferences", "Avoid Leaving One Ticket"
  etickets: any[];
  upload_later: string;
  instant_download: string;
}

export interface TixStockQuantityInfo {
  quantity_available: number;
  quantity_sold: number;
  display_quantity: number;
  split_quantity: number;
  quantity_on_hold: number;
}

export interface TixStockSeatDetails {
  category: string; // e.g. "Longside Lower Tier"
  section: string;
  row: string;
  first_seat: string;
}

export interface TixStockPrice {
  currency: string;
  amount: string; // API returns string "2.00"
}

export interface TixStockDeliveryOption {
  name: string;
  value: string;
}

export interface TixStockDelivery {
  type: string; // "SHIPPING", "E_TICKET"
  hand_delivered: string;
  shipped_date_or_date_in_hand: string;
  options: TixStockDeliveryOption[];
}

export interface TixStockListing {
  id: string;
  seller_id: number;
  seller_name: string;
  ticket: TixStockTicketInfo;
  number_of_tickets_for_sale: TixStockQuantityInfo;
  seat_details: TixStockSeatDetails;
  face_value: TixStockPrice;
  display_price?: TixStockPrice;
  proceed_price: TixStockPrice; // This is the cost price to the partner
  restrictions_benefits: {
    options: any[];
    other: string;
  };
  delivery: TixStockDelivery;
  face_value_percentage?: string;
}

export interface TixStockFeedResponse {
  data: TixStockEvent[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
    per_page: number;
    // ... other meta fields
  };
  links: {
    first: string;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
}

export interface TixStockTicketsResponse {
  data: TixStockListing[];
  meta: {
    min_price: string;
    max_price: string;
    total_tickets: number;
    // ... other meta fields
  };
}

// --- Database Model Types ---

export interface TixStockEventDB {
  event_id: string; // TixStock uses UUID strings
  event_name: string;
  show_date: string; // ISO string
  event_status: string;
  
  // Venue & Location
  venue_name: string;
  city_name: string;
  country_code: string;
  venue_data: TixStockVenue; // Store full venue object for reference
  
  // Classification
  category_name: string; // Top level category name
  sub_categories: TixStockCategory; // Full category object
  
  // Metadata
  performers: TixStockPerformer[];
  venue_map_url?: string;
  last_synced: string;
  is_active: boolean;
  
  created_at?: string;
  updated_at?: string;
}

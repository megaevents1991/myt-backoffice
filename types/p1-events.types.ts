// types/p1-events.types.ts

// P1 Tickets XML Feed Response Types

export interface P1Series {
  id: string;
  name: string;
}

export interface P1Venue {
  name: string;
  location: {
    lat: number;
    lng: number;
  };
  country_code: string;
  city: string;
}

export interface P1Event {
  event_id: string;
  checkout_link: string;
  title: string;
  category: string;
  compare_price_ticket_only?: number;
  compare_price_ticket_hotel?: number;
  series?: P1Series;
  has_available_tickets: boolean;
  is_advertisable: boolean;
  date_start: string;
  date_end?: string;
  date_confirmed: boolean;
  stock: number;
  venue: P1Venue;
}

export interface P1Ticket {
  checkout_link: string;
  id: string;
  event_id: string;
  tags: string[];
  seatingplan_category_name: string;
  currency: string;
  price_ticket: number;
  price_ticket_hotel?: number;
  seatingplan_category_image?: string;
  seatingplan_category_description?: string;
  category: string;
  stock: number;
  possible_ticket_types: string[];
}

// Database model types (snake_case to match database)
export interface P1EventDB {
  event_id: string; // UUID from P1
  title: string;
  title_english: string;
  category: string;
  series_id?: string;
  series_name?: string;
  has_available_tickets: boolean;
  is_advertisable: boolean;
  date_start: string;
  date_end?: string;
  date_confirmed: boolean;
  stock: number;
  venue_name: string;
  venue_city: string;
  venue_country_code: string;
  venue_latitude: number;
  venue_longitude: number;
  compare_price_ticket_only?: number;
  compare_price_ticket_hotel?: number;
  checkout_link: string;
  tickets: P1Ticket[]; // Embedded tickets as JSONB
  is_active: boolean;
  last_synced: string;
  created_at?: string;
  updated_at?: string;
}

// API Response Types
export interface P1EventsApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

// Currency constants for P1
export const P1_CURRENCIES = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  CHF: 'CHF',
} as const;

// Category constants - common categories from P1
export const P1_CATEGORIES = {
  FOOTBALL: 'FOOTBALL',
  TENNIS: 'TENNIS',
  RUGBY: 'RUGBY',
  FORMULA_1: 'FORMULA_1',
  BASKETBALL: 'BASKETBALL',
  AMERICAN_FOOTBALL: 'AMERICAN_FOOTBALL',
  BASEBALL: 'BASEBALL',
  GOLF: 'GOLF',
  MOTORSPORT: 'MOTORSPORT',
  BOXING: 'BOXING',
  OLYMPICS: 'OLYMPICS',
  MUSIC: 'MUSIC',
  OTHER: 'OTHER',
} as const;

// Ticket type constants
export const P1_TICKET_TYPES = {
  MOBILE: 'Mobile',
  PAPER: 'Paper',
  ETICKET: 'E-Ticket',
  COLLECTION: 'Collection',
} as const;

// Tag constants
export const P1_TAGS = {
  HOSPITALITY: 'hospitality',
  VIP: 'vip',
  PREMIUM: 'premium',
  STANDARD: 'standard',
} as const;

export type P1Currency = typeof P1_CURRENCIES[keyof typeof P1_CURRENCIES];
export type P1Category = typeof P1_CATEGORIES[keyof typeof P1_CATEGORIES];
export type P1TicketType = typeof P1_TICKET_TYPES[keyof typeof P1_TICKET_TYPES];
export type P1Tag = typeof P1_TAGS[keyof typeof P1_TAGS];

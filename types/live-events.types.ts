// types/live-events.types.ts

// LIVE API (doctorticket.com) Response Types

export interface LiveCategory {
  id: number;
  name: string;
  hebName: string;
}

export interface LivePerformer {
  id: number;
  name: string;
  hebName: string;
  isDtPerformer: boolean;
  performerClassificationId: number;
  amount: number;
}

// Raw endpoint variants (global lists) differ in field names
export interface RawLiveCategory {
  id: number;
  categoryId?: number; // duplicate id sometimes
  categoryTNName?: string; // e.g. "SPORTS"
  categoryDTName?: string; // e.g. "SPORTS"
  categoryHebName?: string; // Hebrew
  numberofDTSelectedPerformers?: number;
  numberofHebSelectedPerformers?: number;
}

export interface RawLivePerformer {
  id: number;
  performerName: string;
  performerHebName?: string;
  classificationName?: string | null;
  isDtPerformer: boolean;
  performerClassificationId?: number | null;
  amount?: number; // occurrences / events count
  firstCategory?: string | null;
  secondCategory?: string | null;
  thirdCategory?: string | null;
}

export interface RawLiveCity {
  id: number;
  hebFullName?: string | null;
  engFullName?: string | null;
  iata?: string | null;
  cityName: string;
}

export interface LiveVenue {
  id: number;
  name: string;
  isDtVenue: boolean;
  hebName: string;
}

export interface LiveTicketCategory {
  title: string;
  engComments: string;
  hebComments: string;
  cost: number;
  specialCost: number;
  brt: number;
  maxTicketAmount: number;
  seatingMethodId: number; // 1=GA, 2=Singles, 3=Doubles, 4=Group
  seatingGroupMAXSize: number;
  seatingGroupFee: number;
  isOfficial: boolean;
  shippingOptions: number;
  hotelDetailsRequired: boolean;
  id: number;
  apiImmediatePurchase: boolean;
  hebTitle: string;
}

export interface LiveEvent {
  id: number;
  showDate: string;
  isShowDateFinale: boolean;
  showDateRemarks: string;
  currency: number; // 1=USD, 2=EUR, 3=GBP, 4=ILS, 5=OTHER
  stopSaleingMargin: number;
  streetAddress: string;
  eventName: string;
  streetAddressHeb: string;
  eventHebName: string;
  cityId: number;
  cityName: string;
  countryID: number;
  countryName: string;
  iata: string;
  passportRequired: boolean;
  venueMapWithBase: string;
  venueHebMapWithBase: string;
  category1: LiveCategory[];
  category2: LiveCategory[];
  category3: LiveCategory[];
  performers: LivePerformer[];
  venue: LiveVenue[];
  ticketCategory: LiveTicketCategory[];
}

// Database model types (snake_case to match database)
export interface LiveEventDB {
  event_id: number;
  event_name: string;
  event_name_heb?: string;
  show_date: string;
  is_show_date_finale: boolean;
  show_date_remarks?: string;
  street_address: string;
  street_address_heb?: string;
  city_id: number;
  city_name: string;
  country_id: number;
  country_name: string;
  iata: string;
  passport_required: boolean;
  venue_map_url?: string;
  venue_map_heb_url?: string;
  currency: number;
  stop_selling_margin: number;
  event_type: 'sports_live_event_dynamic' | 'music_live_event_dynamic';
  primary_category: string;
  categories: {
    category1: LiveCategory[];
    category2: LiveCategory[];
    category3: LiveCategory[];
  };
  performers: LivePerformer[];
  venues: LiveVenue[];
  ticket_categories: LiveTicketCategory[];
  is_active: boolean;
  last_synced: string;
  created_at?: string;
  updated_at?: string;
}

// API Response Types
export interface LiveEventsApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

// Mapping types for internal use
export interface LiveEventProcessed extends LiveEvent {
  processedType: 'sports_live_event_dynamic' | 'music_live_event_dynamic';
  internalCategories: string[];
}

// Seating method constants
export const SEATING_METHODS = {
  GA: 1,           // General Admission
  SINGLES: 2,      // Singles - no pairs guaranteed
  DOUBLES: 3,      // Doubles - pairs guaranteed
  GROUP: 4         // Group seating
} as const;

// Currency constants
export const CURRENCIES = {
  USD: 1,
  EUR: 2,
  GBP: 3,
  ILS: 4,
  OTHER: 5
} as const;

// Shipping options constants
export const SHIPPING_OPTIONS = {
  LOCAL_DELIVERY: 1,              // Price: 5
  INTERNATIONAL_SHIPPING: 2,      // Price: 5
  SPECIAL_LOCAL_DELIVERY: 3,      // Price: 5
  E_TICKET: 4,                    // Price: 5
  WORLD_CUP_INTERNATIONAL: 5,     // Price: 5
  LOCAL_PICKUP: 6                 // Price: Free
} as const;

// Category classification helpers
export interface CategoryClassification {
  isSports: boolean;
  isMusic: boolean;
  primaryCategory: string;
  subcategories: string[];
}

-- Sports table
CREATE TABLE IF NOT EXISTS xs2e_sports (
  sport_id VARCHAR PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tournaments table  
CREATE TABLE IF NOT EXISTS xs2e_tournaments (
  tournament_id VARCHAR PRIMARY KEY,
  official_name VARCHAR NOT NULL,
  season VARCHAR NOT NULL,
  tournament_type VARCHAR NOT NULL,
  region VARCHAR NOT NULL,
  sport_type VARCHAR NOT NULL, -- This should match the XS2Sport ID
  date_start TIMESTAMP WITH TIME ZONE NOT NULL,
  date_stop TIMESTAMP WITH TIME ZONE NOT NULL,
  slug VARCHAR,
  number_events INTEGER,
  created TIMESTAMP WITH TIME ZONE,
  updated TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Events table with all fields from eventSchema + Hebrew fields
CREATE TABLE IF NOT EXISTS xs2e_events (
  -- Primary fields (uncommented in schema)
  event_id VARCHAR PRIMARY KEY,
  event_name VARCHAR NOT NULL,
  event_name_heb VARCHAR,
  date_start TIMESTAMP WITH TIME ZONE NOT NULL,
  date_stop TIMESTAMP WITH TIME ZONE NOT NULL,
  event_status VARCHAR NOT NULL,
  tournament_id VARCHAR NOT NULL,
  tournament_name VARCHAR NOT NULL,
  tournament_name_heb VARCHAR,
  venue_id VARCHAR NOT NULL,
  venue_name VARCHAR NOT NULL,
  venue_name_heb VARCHAR,
  city VARCHAR,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  date_confirmed BOOLEAN DEFAULT false,
  hometeam_name VARCHAR,
  visiting_name VARCHAR,
  created TIMESTAMP WITH TIME ZONE,
  updated TIMESTAMP WITH TIME ZONE,
  event_description TEXT,
  event_description_heb TEXT,
  min_ticket_price_eur DECIMAL(10, 2),
  max_ticket_price_eur DECIMAL(10, 2),
  slug VARCHAR,
  number_of_tickets INTEGER,
  sales_periods JSONB,
  is_popular BOOLEAN DEFAULT false,
  
  -- Additional fields (commented out in schema but should be stored)
  location_id VARCHAR,
  iso_country VARCHAR(3),
  sport_type VARCHAR,
  season VARCHAR,
  tournament_type VARCHAR,
  date_start_main_event TIMESTAMP WITH TIME ZONE,
  date_stop_main_event TIMESTAMP WITH TIME ZONE,
  hometeam_id VARCHAR,
  visiting_id VARCHAR,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for sports
CREATE INDEX IF NOT EXISTS idx_xs2e_sports_sport_id ON xs2e_sports(sport_id);

-- Indexes for tournaments
CREATE INDEX IF NOT EXISTS idx_xs2e_tournaments_tournament_id ON xs2e_tournaments(tournament_id);
CREATE INDEX IF NOT EXISTS idx_xs2e_tournaments_sport_type ON xs2e_tournaments(sport_type);
CREATE INDEX IF NOT EXISTS idx_xs2e_tournaments_date_start ON xs2e_tournaments(date_start);
CREATE INDEX IF NOT EXISTS idx_xs2e_tournaments_date_stop ON xs2e_tournaments(date_stop);

-- Indexes for events
CREATE INDEX IF NOT EXISTS idx_xs2e_events_date_start ON xs2e_events(date_start);
CREATE INDEX IF NOT EXISTS idx_xs2e_events_tournament_id ON xs2e_events(tournament_id);
CREATE INDEX IF NOT EXISTS idx_xs2e_events_venue_id ON xs2e_events(venue_id);
CREATE INDEX IF NOT EXISTS idx_xs2e_events_status ON xs2e_events(event_status);
CREATE INDEX IF NOT EXISTS idx_xs2e_events_popular ON xs2e_events(is_popular);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_xs2e_sports_updated_at BEFORE UPDATE ON xs2e_sports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_xs2e_tournaments_updated_at BEFORE UPDATE ON xs2e_tournaments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_xs2e_events_updated_at BEFORE UPDATE ON xs2e_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Locations table
CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  city_iata VARCHAR(3),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for locations
CREATE INDEX IF NOT EXISTS idx_locations_latitude ON locations(latitude);
CREATE INDEX IF NOT EXISTS idx_locations_longitude ON locations(longitude);
CREATE INDEX IF NOT EXISTS idx_locations_city_iata ON locations(city_iata);

-- Update trigger for locations
CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===================================
-- LIVE API Events Schema Extension
-- ===================================

-- LIVE Events main table
CREATE TABLE IF NOT EXISTS live_events (
  -- Primary event data
  event_id INTEGER PRIMARY KEY,
  event_name VARCHAR NOT NULL,
  event_name_heb VARCHAR,
  show_date TIMESTAMP WITH TIME ZONE NOT NULL,
  is_show_date_finale BOOLEAN DEFAULT false,
  show_date_remarks TEXT,
  
  -- Location and venue
  street_address TEXT,
  street_address_heb TEXT,
  city_id INTEGER,
  city_name VARCHAR,
  country_id INTEGER,
  country_name VARCHAR,
  iata VARCHAR(3),
  passport_required BOOLEAN DEFAULT false,
  
  -- Venue information
  venue_map_url TEXT,
  venue_map_heb_url TEXT,
  
  -- Event metadata
  currency INTEGER NOT NULL, -- 1=USD, 2=EUR, 3=GBP, 4=ILS, 5=OTHER
  stop_selling_margin INTEGER DEFAULT 0,
  
  -- Classification (derived from categories)
  event_type VARCHAR NOT NULL, -- 'sports_live_event_dynamic' or 'music_live_event_dynamic'
  primary_category VARCHAR,
  categories JSONB, -- Store all category arrays
  
  -- Related data (stored as JSONB for flexibility)
  performers JSONB,
  venues JSONB,
  ticket_categories JSONB,
  
  -- Sync metadata
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for live_events
CREATE INDEX IF NOT EXISTS idx_live_events_show_date ON live_events(show_date);
CREATE INDEX IF NOT EXISTS idx_live_events_event_type ON live_events(event_type);
CREATE INDEX IF NOT EXISTS idx_live_events_city_id ON live_events(city_id);
CREATE INDEX IF NOT EXISTS idx_live_events_country_id ON live_events(country_id);
CREATE INDEX IF NOT EXISTS idx_live_events_currency ON live_events(currency);
CREATE INDEX IF NOT EXISTS idx_live_events_is_active ON live_events(is_active);
CREATE INDEX IF NOT EXISTS idx_live_events_primary_category ON live_events(primary_category);

-- Full-text search indexes
CREATE INDEX IF NOT EXISTS idx_live_events_name_search ON live_events USING gin(to_tsvector('english', event_name));

-- Update triggers for LIVE tables
CREATE TRIGGER live_events_updated_at 
    BEFORE UPDATE ON live_events 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- P1 Tickets Events Table
-- Store events from P1 Tickets XML feeds
CREATE TABLE IF NOT EXISTS p1_events (
  -- Primary identifier (UUID from P1)
  event_id VARCHAR PRIMARY KEY,
  
  -- Event information
  title VARCHAR NOT NULL,
  title_english VARCHAR NOT NULL,
  category VARCHAR NOT NULL, -- FOOTBALL, TENNIS, etc.
  
  -- Series information (optional)
  series_id VARCHAR,
  series_name VARCHAR,
  
  -- Event status flags
  has_available_tickets BOOLEAN DEFAULT true,
  is_advertisable BOOLEAN DEFAULT true,
  
  -- Event dates
  date_start TIMESTAMP WITH TIME ZONE NOT NULL,
  date_end TIMESTAMP WITH TIME ZONE,
  date_confirmed BOOLEAN DEFAULT false,
  
  -- Stock
  stock INTEGER DEFAULT 0,
  
  -- Venue information
  venue_name VARCHAR NOT NULL,
  venue_city VARCHAR NOT NULL,
  venue_country_code VARCHAR(2),
  venue_latitude DECIMAL(10, 8),
  venue_longitude DECIMAL(11, 8),
  
  -- Pricing (optional compare prices)
  compare_price_ticket_only DECIMAL(10, 2),
  compare_price_ticket_hotel DECIMAL(10, 2),
  
  -- External links
  checkout_link TEXT,
  
  -- Tickets (stored as JSONB array)
  tickets JSONB,
  
  -- Sync metadata
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for p1_events
CREATE INDEX IF NOT EXISTS idx_p1_events_date_start ON p1_events(date_start);
CREATE INDEX IF NOT EXISTS idx_p1_events_category ON p1_events(category);
CREATE INDEX IF NOT EXISTS idx_p1_events_series_name ON p1_events(series_name);
CREATE INDEX IF NOT EXISTS idx_p1_events_venue_city ON p1_events(venue_city);
CREATE INDEX IF NOT EXISTS idx_p1_events_venue_country ON p1_events(venue_country_code);
CREATE INDEX IF NOT EXISTS idx_p1_events_is_active ON p1_events(is_active);
CREATE INDEX IF NOT EXISTS idx_p1_events_has_tickets ON p1_events(has_available_tickets);
CREATE INDEX IF NOT EXISTS idx_p1_events_is_advertisable ON p1_events(is_advertisable);

-- Full-text search indexes for P1 events
CREATE INDEX IF NOT EXISTS idx_p1_events_title_search ON p1_events USING gin(to_tsvector('english', title));

-- Update trigger for p1_events
CREATE TRIGGER p1_events_updated_at 
    BEFORE UPDATE ON p1_events 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ===================================
-- TixStock Events Schema
-- ===================================

CREATE TABLE IF NOT EXISTS tixstock_events (
  -- Primary identifier (UUID from TixStock)
  event_id VARCHAR PRIMARY KEY,
  
  -- Event information
  event_name VARCHAR NOT NULL,
  show_date TIMESTAMP WITH TIME ZONE NOT NULL,
  event_status VARCHAR,
  
  -- Venue & Location
  venue_name VARCHAR,
  city_name VARCHAR,
  country_code VARCHAR(2),
  venue_data JSONB, -- Store full venue object
  venue_map_url TEXT,
  
  -- Classification
  category_name VARCHAR, -- Top level category
  sub_categories JSONB, -- Full category tree
  
  -- Metadata
  performers JSONB, -- Store performers array
  
  -- Sync metadata
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for tixstock_events
CREATE INDEX IF NOT EXISTS idx_tixstock_events_show_date ON tixstock_events(show_date);
CREATE INDEX IF NOT EXISTS idx_tixstock_events_city_name ON tixstock_events(city_name);
CREATE INDEX IF NOT EXISTS idx_tixstock_events_country_code ON tixstock_events(country_code);
CREATE INDEX IF NOT EXISTS idx_tixstock_events_category_name ON tixstock_events(category_name);
CREATE INDEX IF NOT EXISTS idx_tixstock_events_is_active ON tixstock_events(is_active);

-- Full-text search indexes for TixStock events
CREATE INDEX IF NOT EXISTS idx_tixstock_events_name_search ON tixstock_events USING gin(to_tsvector('english', event_name));

-- Update trigger for tixstock_events
CREATE TRIGGER tixstock_events_updated_at 
    BEFORE UPDATE ON tixstock_events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- offline_hotel_rooms — per-room detail for offline_hotels batches
-- (created 2026-06-08; see db/migrations/2026-06-08-offline-hotel-rooms.sql)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offline_hotel_rooms (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hotel_id               BIGINT NOT NULL REFERENCES offline_hotels(id) ON DELETE CASCADE,
  room_type              TEXT NOT NULL,
  price                  NUMERIC NOT NULL,
  meal_plan              TEXT,
  last_cancellation_date DATE,
  supplier               TEXT,
  is_booked              BOOLEAN NOT NULL DEFAULT false,
  order_no               TEXT,
  acc_no                 TEXT,
  reservation_id         BIGINT,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_offline_hotel_rooms_hotel_id ON offline_hotel_rooms(hotel_id);
CREATE INDEX IF NOT EXISTS idx_offline_hotel_rooms_is_booked ON offline_hotel_rooms(is_booked);
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
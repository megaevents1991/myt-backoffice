export interface OfflineFlight {
  id: number; // INTEGER PRIMARY KEY AUTOINCREMENT
  initial_quantity: number; // INTEGER NOT NULL
  consumed_quantity: number; // INTEGER NOT NULL DEFAULT 0
  is_deleted: boolean | null; // BOOLEAN NOT NULL DEFAULT FALSE
  price: number; // NUMERIC(10, 2) NOT NULL
  duration: string; // INTERVAL NOT NULL (e.g., "PT4H5M")
  stops: number; // INTEGER NOT NULL CHECK (stops = 0)
  airline_code: string; // VARCHAR(3) NOT NULL

  // outbound
  outbound_departure_time: string; // TIMESTAMP NOT NULL
  outbound_departure_airport: string; // VARCHAR(3) NOT NULL
  outbound_arrival_airport: string; // VARCHAR(3) NOT NULL
  outbound_arrival_time: string; // TIMESTAMP NOT NULL
  outbound_duration: string; // INTERVAL NOT NULL
  outbound_check_bags_included: boolean; // BOOLEAN NOT NULL
  outbound_cabin_bags_included: boolean; // BOOLEAN NOT NULL
  outbound_flight_number: string; // VARCHAR(10) NOT NULL

  // inbound
  inbound_departure_time: string; // TIMESTAMP NOT NULL
  inbound_departure_airport: string; // VARCHAR(3) NOT NULL
  inbound_arrival_airport: string; // VARCHAR(3) NOT NULL
  inbound_arrival_time: string; // TIMESTAMP NOT NULL
  inbound_duration: string; // INTERVAL NOT NULL
  inbound_check_bags_included: boolean; // BOOLEAN NOT NULL
  inbound_cabin_bags_included: boolean; // BOOLEAN NOT NULL
  inbound_flight_number: string; // VARCHAR(10) NOT NULL

  // metadata
  metadata_iata: string; // VARCHAR(3) NOT NULL
  metadata_name: string; // TEXT NOT NULL
  metadata_logo: string; // TEXT NOT NULL

  // relationships
  event_ids: number[]; // integer[] NOT NULL DEFAULT '{}'
}

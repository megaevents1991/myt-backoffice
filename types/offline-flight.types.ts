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

  // --- supplier / commercial (backoffice-only, never in the customer price chain)
  cost_price?: number | null; // NUMERIC(10,2) - what we pay the supplier
  cost_currency?: string | null; // VARCHAR(3)
  supplier?: string | null;
  pnr?: string | null;
  group_code?: string | null;

  // --- deadlines
  ticketing_deadline?: string | null; // DATE "YYYY-MM-DD"
  last_cancellation_date?: string | null; // DATE
  payment_deadline?: string | null; // DATE
  option_expiry?: string | null; // DATE

  // --- operations
  checked_bag_kg?: number | null;
  cabin_bag_kg?: number | null;
  cabin_class?: string | null;
  aircraft_type?: string | null;
  block_status?: "option" | "confirmed" | "ticketed" | null;

  // --- misc
  notes?: string | null;
  handled_by?: string | null;

  // --- series (set by createOfflineFlightSeries; shared by one batch)
  series_id?: string | null; // uuid
  series_name?: string | null;

  // --- single stopover per leg (null = non-stop)
  outbound_stop_airport?: string | null; // VARCHAR(3)
  outbound_stop_duration?: string | null; // INTERVAL, rendered "HH:MM:SS"
  inbound_stop_airport?: string | null;
  inbound_stop_duration?: string | null;
}

/** One flight↔event seat quota. Consumed seats are never stored here - they
 *  come from the `flight_event_consumed` view over active reservations. */
export interface FlightEventAllocation {
  id: number;
  flight_id: number;
  event_id: number;
  allocated_seats: number;
  created_at: string;
}

/** One row of the allocations panel: the quota joined with derived consumption. */
export interface FlightAllocationRow {
  event_id: number;
  event_name: string;
  event_date: string;
  /** null = no allocation row; this event draws on the global pool. */
  allocated_seats: number | null;
  consumed_seats: number;
}

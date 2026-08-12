import type { FlightWritableColumn } from "@/lib/actions/offline-flight-columns";

export type FlightFieldType =
  | "text"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "boolean"
  | "iata"
  | "duration"
  | "select";

export type FlightField = {
  key: FlightWritableColumn;
  label: string;
  group: string;
  type: FlightFieldType;
  options?: string[]; // only for type "select"
  bulkEditable: boolean; // false for per-flight identity fields like flight number
};

export const FLIGHT_FIELD_GROUPS = [
  "Inventory",
  "Airline",
  "Outbound",
  "Inbound",
  "Supplier",
  "Deadlines",
  "Operations",
  "Misc",
] as const;

export const FLIGHT_FIELDS: FlightField[] = [
  { key: "initial_quantity", label: "ORG (seats)", group: "Inventory", type: "number", bulkEditable: true },
  { key: "price", label: "Price (USD)", group: "Inventory", type: "money", bulkEditable: true },

  { key: "airline_code", label: "Airline code", group: "Airline", type: "text", bulkEditable: true },
  { key: "metadata_name", label: "Airline name", group: "Airline", type: "text", bulkEditable: true },
  { key: "metadata_iata", label: "Airline IATA", group: "Airline", type: "iata", bulkEditable: true },
  { key: "metadata_logo", label: "Airline logo URL", group: "Airline", type: "text", bulkEditable: true },

  { key: "outbound_flight_number", label: "Out flight no.", group: "Outbound", type: "text", bulkEditable: false },
  { key: "outbound_departure_airport", label: "Out from", group: "Outbound", type: "iata", bulkEditable: true },
  { key: "outbound_arrival_airport", label: "Out to", group: "Outbound", type: "iata", bulkEditable: true },
  { key: "outbound_departure_time", label: "Out departure", group: "Outbound", type: "datetime", bulkEditable: false },
  { key: "outbound_arrival_time", label: "Out arrival", group: "Outbound", type: "datetime", bulkEditable: false },
  { key: "outbound_duration", label: "Out duration", group: "Outbound", type: "duration", bulkEditable: false },
  { key: "outbound_check_bags_included", label: "Out checked bag", group: "Outbound", type: "boolean", bulkEditable: true },
  { key: "outbound_cabin_bags_included", label: "Out cabin bag", group: "Outbound", type: "boolean", bulkEditable: true },
  // Setting the stopover airport is what makes a leg a connection - the legacy
  // round-trip `stops` count is derived from these two (`flights_derive_stops`),
  // so it is deliberately absent from this list: an editable copy of a derived
  // value can only ever disagree with it.
  { key: "outbound_stop_airport", label: "Out stopover", group: "Outbound", type: "iata", bulkEditable: true },
  { key: "outbound_stop_duration", label: "Out stop duration", group: "Outbound", type: "duration", bulkEditable: true },

  { key: "inbound_flight_number", label: "In flight no.", group: "Inbound", type: "text", bulkEditable: false },
  { key: "inbound_departure_airport", label: "In from", group: "Inbound", type: "iata", bulkEditable: true },
  { key: "inbound_arrival_airport", label: "In to", group: "Inbound", type: "iata", bulkEditable: true },
  { key: "inbound_departure_time", label: "In departure", group: "Inbound", type: "datetime", bulkEditable: false },
  { key: "inbound_arrival_time", label: "In arrival", group: "Inbound", type: "datetime", bulkEditable: false },
  { key: "inbound_duration", label: "In duration", group: "Inbound", type: "duration", bulkEditable: false },
  { key: "inbound_check_bags_included", label: "In checked bag", group: "Inbound", type: "boolean", bulkEditable: true },
  { key: "inbound_cabin_bags_included", label: "In cabin bag", group: "Inbound", type: "boolean", bulkEditable: true },
  { key: "inbound_stop_airport", label: "In stopover", group: "Inbound", type: "iata", bulkEditable: true },
  { key: "inbound_stop_duration", label: "In stop duration", group: "Inbound", type: "duration", bulkEditable: true },

  { key: "cost_price", label: "Cost price", group: "Supplier", type: "money", bulkEditable: true },
  { key: "cost_currency", label: "Cost currency", group: "Supplier", type: "select", options: ["USD", "EUR", "GBP", "ILS"], bulkEditable: true },
  { key: "supplier", label: "Supplier", group: "Supplier", type: "text", bulkEditable: true },
  { key: "pnr", label: "PNR", group: "Supplier", type: "text", bulkEditable: false },
  { key: "group_code", label: "Contract / group", group: "Supplier", type: "text", bulkEditable: true },

  { key: "ticketing_deadline", label: "Ticketing deadline", group: "Deadlines", type: "date", bulkEditable: true },
  { key: "last_cancellation_date", label: "Cancellation deadline", group: "Deadlines", type: "date", bulkEditable: true },
  { key: "payment_deadline", label: "Payment deadline", group: "Deadlines", type: "date", bulkEditable: true },
  { key: "option_expiry", label: "Option expiry", group: "Deadlines", type: "date", bulkEditable: true },

  { key: "checked_bag_kg", label: "Checked bag kg", group: "Operations", type: "number", bulkEditable: true },
  { key: "cabin_bag_kg", label: "Cabin bag kg", group: "Operations", type: "number", bulkEditable: true },
  { key: "cabin_class", label: "Cabin class", group: "Operations", type: "select", options: ["economy", "premium", "business"], bulkEditable: true },
  { key: "aircraft_type", label: "Aircraft", group: "Operations", type: "text", bulkEditable: true },
  { key: "block_status", label: "Block status", group: "Operations", type: "select", options: ["option", "confirmed", "ticketed"], bulkEditable: true },

  { key: "notes", label: "Notes", group: "Misc", type: "text", bulkEditable: true },
  { key: "handled_by", label: "Handled by", group: "Misc", type: "text", bulkEditable: true },
  { key: "series_name", label: "Series", group: "Misc", type: "text", bulkEditable: true },
];

export const FLIGHT_FIELD_BY_KEY = new Map<string, FlightField>(
  FLIGHT_FIELDS.map((field) => [field.key, field]),
);

// What the list shows before the user touches the column picker - the columns
// the old table displayed, plus block status.
export const DEFAULT_VISIBLE_COLUMNS: FlightWritableColumn[] = [
  "airline_code",
  "outbound_flight_number",
  "outbound_departure_airport",
  "outbound_arrival_airport",
  "outbound_departure_time",
  "inbound_departure_time",
  "price",
  "block_status",
];

export function formatFlightValue(field: FlightField, value: unknown): string {
  if (value == null || value === "") return "-";
  switch (field.type) {
    case "money":
      return `$${Number(value).toFixed(2)}`;
    case "boolean":
      return value ? "Yes" : "No";
    case "datetime":
      return new Date(String(value)).toLocaleString();
    default:
      return String(value);
  }
}

/** `datetime-local` inputs need "YYYY-MM-DDTHH:mm" - trim anything longer. */
export function toInputValue(field: FlightField, value: unknown): string {
  if (value == null) return "";
  if (field.type === "datetime") return String(value).slice(0, 16);
  if (field.type === "date") return String(value).slice(0, 10);
  return String(value);
}

/** Turns a raw input string back into what the column expects. */
export function fromInputValue(field: FlightField, raw: string): unknown {
  if (raw === "") return null;
  switch (field.type) {
    case "number":
      return Number.parseInt(raw, 10);
    case "money":
      return Number(raw);
    case "datetime":
      return raw.length === 16 ? `${raw}:00` : raw;
    case "iata":
      return raw.toUpperCase();
    default:
      return raw;
  }
}

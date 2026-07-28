import type { OfflineFlight } from "@/types/offline-flight.types";

// Every column a client is allowed to write. `id`, `consumed_quantity`,
// `is_deleted` and `series_id` are deliberately absent: they are set by the
// server or by a dedicated action, never by a form payload.
export const FLIGHT_WRITABLE_COLUMNS = [
  "initial_quantity", "price", "duration", "stops", "airline_code",
  "outbound_departure_time", "outbound_departure_airport",
  "outbound_arrival_airport", "outbound_arrival_time", "outbound_duration",
  "outbound_check_bags_included", "outbound_cabin_bags_included",
  "outbound_flight_number",
  "inbound_departure_time", "inbound_departure_airport",
  "inbound_arrival_airport", "inbound_arrival_time", "inbound_duration",
  "inbound_check_bags_included", "inbound_cabin_bags_included",
  "inbound_flight_number",
  "metadata_iata", "metadata_name", "metadata_logo",
  "event_ids",
  "cost_price", "cost_currency", "supplier", "pnr", "group_code",
  "ticketing_deadline", "last_cancellation_date", "payment_deadline",
  "option_expiry",
  "checked_bag_kg", "cabin_bag_kg", "cabin_class", "aircraft_type",
  "block_status",
  "notes", "handled_by", "series_name",
  "outbound_stop_airport", "outbound_stop_duration",
  "inbound_stop_airport", "inbound_stop_duration",
] as const satisfies readonly (keyof OfflineFlight)[];

export type FlightWritableColumn = (typeof FLIGHT_WRITABLE_COLUMNS)[number];

const WRITABLE = new Set<string>(FLIGHT_WRITABLE_COLUMNS);

/**
 * Drops every key that is not an allowed column. Undefined values are skipped
 * so a partial update never blanks a column the caller did not mention.
 */
export function pickFlightColumns(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (WRITABLE.has(key) && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Numeric/positive guards for the money and inventory columns. Throws so the
 * action fails loudly instead of writing a NaN price.
 */
export function assertFlightValues(row: Record<string, unknown>): void {
  for (const key of ["price", "cost_price"] as const) {
    if (row[key] == null) continue;
    const n = Number(row[key]);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${key} must be a non-negative number`);
    }
  }
  for (const key of [
    "initial_quantity",
    "stops",
    "checked_bag_kg",
    "cabin_bag_kg",
  ] as const) {
    if (row[key] == null) continue;
    const n = Number(row[key]);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
}

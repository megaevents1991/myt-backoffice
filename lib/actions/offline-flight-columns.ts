import {
  EVENTS_BLOCK_STATUSES,
  type OfflineFlight,
} from "@/types/offline-flight.types";
import { BLOCK_STATUSES } from "@/types/tours.types";

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

// The group-block operations columns. Writable only while the active company
// sells tours - a Mega Events write that names one of them drops it, so these
// stay null on Mega Events rows. `company_id`, `contract_id`, `reviewed_at`,
// `reviewed_by` and `import_ref` are absent on purpose: the server or a
// dedicated action sets them, never a form payload.
export const FLIGHT_TOURS_WRITABLE_COLUMNS = [
  "original_quantity", "cost_child_price", "cost_tax", "inbound_airline_code",
  "season_label", "requested_at", "first_cancellation_date", "names_deadline",
  "cancelled_at", "cancel_reason", "cancellation_fee",
] as const satisfies readonly (keyof OfflineFlight)[];

export type FlightToursWritableColumn =
  (typeof FLIGHT_TOURS_WRITABLE_COLUMNS)[number];

/** What the active company is allowed to write. Default = Mega Events. */
export type FlightWriteMode = { tours?: boolean };

const WRITABLE = new Set<string>(FLIGHT_WRITABLE_COLUMNS);
const TOURS_WRITABLE = new Set<string>(FLIGHT_TOURS_WRITABLE_COLUMNS);

/**
 * The status of a group block of a tours company moves only through its
 * lifecycle actions (lib/actions/tours-flight-actions.ts): they check the
 * allowed transition and the owner's approval and write the timeline. The
 * generic edit form and the bulk edit therefore never change it on an existing
 * block - the key is dropped from their patch. Mega Events is untouched.
 */
export function withoutLifecycleStatus(
  patch: Record<string, unknown>,
  { tours = false }: FlightWriteMode = {},
): Record<string, unknown> {
  if (!tours || !("block_status" in patch)) return patch;
  const { block_status: _lifecycle, ...rest } = patch;
  void _lifecycle;
  return rest;
}

/**
 * Drops every key that is not an allowed column. Undefined values are skipped
 * so a partial update never blanks a column the caller did not mention.
 */
export function pickFlightColumns(
  input: Record<string, unknown>,
  { tours = false }: FlightWriteMode = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (WRITABLE.has(key) || (tours && TOURS_WRITABLE.has(key))) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Numeric/positive guards for the money and inventory columns. Throws so the
 * action fails loudly instead of writing a NaN price.
 */
export function assertFlightValues(
  row: Record<string, unknown>,
  { tours = false }: FlightWriteMode = {},
): void {
  for (const key of [
    "price",
    "cost_price",
    "cost_child_price",
    "cost_tax",
    "cancellation_fee",
  ] as const) {
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
    "original_quantity",
  ] as const) {
    if (row[key] == null) continue;
    const n = Number(row[key]);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
  // The lifecycle of a group block (approved, requested, operational, ...)
  // belongs to a tours company. A Mega Events flight keeps its three statuses.
  if (row.block_status != null) {
    const allowed: readonly string[] = tours
      ? BLOCK_STATUSES
      : EVENTS_BLOCK_STATUSES;
    if (!allowed.includes(String(row.block_status))) {
      throw new Error(`block_status "${String(row.block_status)}" is not allowed here`);
    }
  }
}

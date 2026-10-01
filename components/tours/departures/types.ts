/**
 * Shapes that travel between the departures server actions and the board / card
 * components. Kept apart from the actions file because a "use server" module
 * may only export async functions.
 */
import type { PriceMatrix } from "@/lib/tours/pricing";
import type { TourDeparture, TourDepartureOption, TourPromotion, TourSeries } from "@/types/tours.types";

export type ActionResult<T = undefined> =
  | { success: true; data: T; warning?: string }
  | { success: false; error: string };

export type AllocationLegs = "both" | "outbound" | "inbound";

export const LEGS_LABELS: Record<AllocationLegs, string> = {
  both: "הלוך וחזור",
  outbound: "הלוך בלבד",
  inbound: "חזור בלבד",
};

export type BoardSeries = Pick<
  TourSeries,
  | "id"
  | "code"
  | "label"
  | "package_id"
  | "arrival_airport"
  | "arrival_weekday"
  | "return_airport"
  | "return_weekday"
  | "default_nights"
  | "default_capacity"
  | "default_currency"
  | "child_max_age"
  | "senior_min_age"
  | "senior_discount"
  | "is_active"
>;

export interface BoardPackage {
  id: string;
  name: string;
  kind: string;
  slug: string;
}

export interface BoardPeriod {
  id: string;
  name: string;
  kind: string;
  year: number;
  holiday_date: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface BoardPromotion {
  id: string;
  kind: string;
  value: number | null;
  label: string | null;
  valid_until: string | null;
  show_on_card: boolean;
  is_active: boolean;
  /** `series` = set on the series, applies to all its departures (read-only in the card). */
  scope: "departure" | "series";
}

export interface BoardOption {
  kind: string;
  position: number;
  price: number | null;
  room_prices: unknown;
}

export interface BoardFlight {
  allocationId: string;
  flightId: number;
  seats: number;
  legs: AllocationLegs;
  airline: string;
  blockStatus: string | null;
  /** confirmed / operational / ticketed and not deleted. */
  isLive: boolean;
}

export interface BoardStats {
  allocated: number;
  liveBlocks: number;
  totalBlocks: number;
  sold: number;
  remaining: number;
}

export interface BoardRow
  extends Pick<
    TourDeparture,
    | "id"
    | "code"
    | "series_id"
    | "package_id"
    | "season_year"
    | "start_date"
    | "end_date"
    | "season"
    | "currency"
    | "is_published"
    | "sale_status"
    | "card_badge"
    | "date_labels"
    | "arrival_airport"
    | "return_airport"
    | "docket_no"
    | "flight_mode"
    | "flight_price"
    | "markup_fixed"
    | "is_deleted"
  > {
  prices: PriceMatrix;
  options: BoardOption[];
  /** Active promotions that apply to this departure (its own and its series'). */
  promotions: BoardPromotion[];
  flights: BoardFlight[];
  stats: BoardStats;
}

export interface BoardData {
  rows: BoardRow[];
  series: BoardSeries[];
  packages: BoardPackage[];
  periods: BoardPeriod[];
  /** First and last season year that has departures - the range of the year filter. */
  yearRange: { min: number; max: number } | null;
  /** The season years `rows` was loaded for; empty = every year. */
  loadedYears: number[];
}

// ---------------------------------------------------------------- card
export interface CardFlight {
  id: number;
  airline_code: string;
  inbound_airline_code: string | null;
  block_status: string | null;
  is_deleted: boolean;
  outbound_departure_airport: string;
  outbound_arrival_airport: string;
  inbound_departure_airport: string;
  inbound_arrival_airport: string;
  outbound_flight_number: string;
  inbound_flight_number: string;
  outbound_departure_time: string;
  outbound_arrival_time: string;
  inbound_departure_time: string;
  initial_quantity: number;
  season_label: string | null;
  pnr: string | null;
  /** Seats of this block already given to departures, per direction. */
  allocatedOutbound: number;
  allocatedInbound: number;
}

export interface CardAllocation {
  id: string;
  seats: number;
  legs: AllocationLegs;
  created_at: string;
  flight: CardFlight;
}

export interface CardSalesEntry {
  id: string;
  pax: number;
  docket_no: string | null;
  note: string | null;
  flight_id: number | null;
  entered_by: string | null;
  entered_by_name: string | null;
  created_at: string;
}

export type CardDeparture = Omit<TourDeparture, "data">;

export type CardOption = Pick<
  TourDepartureOption,
  "id" | "kind" | "position" | "ref_code" | "label" | "board" | "nights" | "price" | "price_unit" | "room_prices"
>;

export type CardPromotion = Pick<
  TourPromotion,
  "id" | "kind" | "value" | "label" | "valid_until" | "show_on_card" | "is_active" | "departure_id" | "series_id"
>;

export interface CardItinerary {
  id: string;
  key: string;
  label: string | null;
  arrival_city: string | null;
  return_city: string | null;
}

export interface CardHotel {
  code: string;
  name: string;
  city: string | null;
}

export interface DepartureCardData {
  departure: CardDeparture;
  series: BoardSeries | null;
  package: BoardPackage | null;
  itineraries: CardItinerary[];
  hotels: CardHotel[];
  prices: { pax_type: string; room_position: number; price: number }[];
  options: CardOption[];
  promotions: CardPromotion[];
  allocations: CardAllocation[];
  sales: CardSalesEntry[];
  stats: BoardStats;
}

// ---------------------------------------------------------------- inputs
export interface DepartureGeneralInput {
  start_date?: string;
  end_date?: string;
  season?: string | null;
  currency?: string;
  sale_status?: string;
  card_badge?: string | null;
  date_labels?: string[];
  arrival_airport?: string | null;
  return_airport?: string | null;
  itinerary_id?: string | null;
  capacity?: number | null;
  docket_no?: string | null;
  meeting_at?: string | null;
  flight_mode?: string;
  flight_price?: number;
  baggage_included?: boolean;
  meal_included?: boolean;
  transfers_included?: boolean;
  connection_out?: string | null;
  connection_back?: string | null;
  child_max_age?: number | null;
  senior_min_age?: number | null;
  senior_discount?: number | null;
  notes?: string | null;
}

export interface PromotionInput {
  kind: string;
  value: number | null;
  label: string | null;
  valid_until: string | null;
  show_on_card: boolean;
  is_active: boolean;
}

export interface PriceCellInput {
  paxType: string;
  position: number;
  /** null removes the row. */
  price: number | null;
}

export interface HotelOptionInput {
  id?: string;
  ref_code: string | null;
  label: string | null;
  board: string | null;
  nights: number | null;
  double: number | null;
  triple: number | null;
  quad: number | null;
}

export interface TicketOptionInput {
  id?: string;
  label: string | null;
  price: number | null;
}

export interface VacationPricingInput {
  hotels: HotelOptionInput[];
  tickets: TicketOptionInput[];
  markup_percent: number | null;
  markup_fixed: number | null;
}

export interface BulkOutcome {
  /** Ids that were changed. */
  done: string[];
  /** Departures left untouched, with the reason shown to the operator. */
  skipped: { code: string; reason: string }[];
  /** Changed, but worth a look (published with no live flight). */
  warnings: { code: string; reason: string }[];
}

export interface CandidateBlock extends CardFlight {
  /** This block is already allocated to the departure. */
  alreadyAllocated: boolean;
}

import type { Flight, OrderHotel } from "./app.types"

export type ReservationEventOrderInfoItem = {
  event_id: number
  date: string | Date
  name: string
  location_name: string
  number_of_ticket: number
  category: string
  event_type?: string
  event_tags?: string
  price_per_ticket: number
  total_tickets_price: number
  vendor?: string
  id?: string
}

export type ReservationEventOrderInfo =
  | ReservationEventOrderInfoItem
  | { events: ReservationEventOrderInfoItem[] }

export type PaxInfo = {
  first_name: string
  last_name: string
  // Completed by staff in the backoffice for ticketing. The main app writes only
  // first/last name at checkout, so every field below is optional.
  passport_number?: string | null
  passport_expiry?: string | null // "YYYY-MM-DD"
  date_of_birth?: string | null // "YYYY-MM-DD"
  gender?: "M" | "F" | "X" | null
  nationality?: string | null // ISO-3166 alpha-2
}

export type Reservation = {
  id: number
  created_at: string
  main_contact_first_name: string
  main_contact_last_name: string
  main_contact_phone_number: string
  main_contact_email: string
  more_pax_info: PaxInfo[]
  event_order_info: ReservationEventOrderInfo
  flight_order_info: Flight | Record<string, never>
  hotel_order_info: OrderHotel | Record<string, never>
  user_shown_price: number
  aff_partner_tracking_code: string
  event_id: number
  status: string
  accounting_number: number
  payment_info: any;
  comments: string
  final_purchase_price_ils: number;
  exchange_rate_usd_ils_100: number;
  // Offline inventory linkage — populated when the reservation consumed a
  // Mega-owned flight / hotel row. Top-level for cheap JOINs and filtering.
  // offline_hotel_ids holds every row consumed by the booking (may repeat when
  // one row covers multiple requested rooms). offline_hotel_id mirrors [0]
  // for backwards compatibility with pre-2026-04-19 reservations.
  offline_flight_id?: number | null;
  offline_flight_cost?: number | null;
  offline_hotel_id?: number | null;
  offline_hotel_ids?: number[] | null;
  offline_hotel_cost?: number | null;
  // Set only for bookings an agent entered on a customer's behalf — see
  // myt-main's confirm-order/utils.ts (resolveAgentSettlement). Never shown
  // to the customer; staff-only context for why a Pending row is Pending.
  partner_settlement_method?: "customer_card" | "agent_card" | "voucher" | null;
}


import type { Flight, OrderHotel } from "./app.types"

export type Reservation = {
  id: number
  created_at: string
  main_contact_first_name: string
  main_contact_last_name: string
  main_contact_phone_number: string
  main_contact_email: string
  more_pax_info: {
    first_name: string
    last_name: string
  }[]
  event_order_info: {
    event_id: number
    date: Date
    name: string
    location_name: string
    number_of_ticket: number
    category: string
    vendor?: string
    id?: string
    price_per_ticket: number
    total_tickets_price: number
  }
  flight_order_info: Flight
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
}


import type { Flight, OrderHotel } from "./app.types";

export type ReservationEventOrderInfoItem = {
  event_id: number;
  date: string | Date;
  name: string;
  location_name: string;
  number_of_ticket: number;
  category: string;
  event_type?: string;
  event_tags?: string;
  price_per_ticket: number;
  total_tickets_price: number;
  vendor?: string;
  id?: string;
};

export type ReservationEventOrderInfo =
  | ReservationEventOrderInfoItem
  | { events: ReservationEventOrderInfoItem[] };

export type PaxInfo = {
  first_name: string;
  last_name: string;
  // Completed by staff in the backoffice for ticketing. The main app writes only
  // first/last name at checkout, so every field below is optional.
  passport_number?: string | null;
  passport_expiry?: string | null; // "YYYY-MM-DD"
  date_of_birth?: string | null; // "YYYY-MM-DD"
  gender?: "M" | "F" | "X" | null;
  nationality?: string | null; // ISO-3166 alpha-2
};

export type Reservation = {
  id: number;
  created_at: string;
  main_contact_first_name: string;
  main_contact_last_name: string;
  main_contact_phone_number: string;
  main_contact_email: string;
  more_pax_info: PaxInfo[];
  event_order_info: ReservationEventOrderInfo;
  flight_order_info: Flight | Record<string, never>;
  hotel_order_info: OrderHotel | Record<string, never>;
  user_shown_price: number;
  aff_partner_tracking_code: string;
  event_id: number;
  status: string;
  accounting_number: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payment_info: any;
  comments: string;
  final_purchase_price_ils: number;
  exchange_rate_usd_ils_100: number;
  // Offline inventory linkage - populated when the reservation consumed a
  // Mega-owned flight / hotel row. Top-level for cheap JOINs and filtering.
  // offline_hotel_ids holds every row consumed by the booking (may repeat when
  // one row covers multiple requested rooms). offline_hotel_id mirrors [0]
  // for backwards compatibility with pre-2026-04-19 reservations.
  offline_flight_id?: number | null;
  offline_flight_cost?: number | null;
  offline_hotel_id?: number | null;
  offline_hotel_ids?: number[] | null;
  offline_hotel_cost?: number | null;
  // Frozen partner terms (migration 20260811120000): stamped onto existing
  // rows when the partner's commission changes, so the change applies from
  // then on. NULL = no snapshot → the partner's current rate applies.
  commission_type?: string | null;
  commission_rate?: number | null;
  // Set only for bookings an agent entered on a customer's behalf - see
  // myt-main's confirm-order/utils.ts (resolveAgentSettlement). Never shown
  // to the customer; staff-only context for why a Pending row is Pending.
  partner_settlement_method?: import("./app.types").SettlementMethod | null;
  // ILS subtracted from final_purchase_price_ils before charging, agent_card only.
  agent_card_discount_ils?: number | null;
  // Voucher lifecycle, separate from `status` (backoffice-only): sent → received → collected.
  voucher_state?: "sent" | "received" | "collected" | null;
  // Staff stamp - travel material sent to the customer (חומר ללקוח in the portal).
  travel_materials_sent_at?: string | null;
  // Manager-set override (migration 20260820104625, QA wave 2): which office
  // user (user_profiles.id) this booking is credited to. Wins over the
  // UTM-derived attribution everywhere - see lib/portal-attribution.ts. Null
  // = let the UTM attribution decide / unattributed. Main never writes this.
  agent_user_id?: string | null;
  // Soft delete, same convention as events - "MM-DD-YYYY" date string, null =
  // not deleted. See softDeleteReservation/bulkSoftDeleteReservations.
  is_deleted?: string | null;
};

/**
 * Slim row for the reservations LIST page (reservations-table.tsx). The fat
 * JSONB blobs (event/flight/hotel order info, pax list, payment_info) stay on
 * the per-row detail fetch (getReservation) - they were ~90% of the old
 * select("*") list payload. `has_payment_info` stands in for `payment_info`,
 * which the list only ever read as a truthiness flag ("Card" vs "Phone").
 */
export type ReservationListRow = Pick<
  Reservation,
  | "id"
  | "created_at"
  | "main_contact_first_name"
  | "main_contact_last_name"
  | "main_contact_phone_number"
  | "main_contact_email"
  | "user_shown_price"
  | "aff_partner_tracking_code"
  | "event_id"
  | "status"
  | "accounting_number"
  | "comments"
  | "offline_flight_id"
  | "offline_hotel_id"
  | "partner_settlement_method"
  | "is_deleted"
> & {
  has_payment_info: boolean;
  /** Which office agent the booking is credited to (utm_touches, resolved
   *  across every office) - null when unattributed. See getAgentLabelsForReservations. */
  agent_label: string | null;
};

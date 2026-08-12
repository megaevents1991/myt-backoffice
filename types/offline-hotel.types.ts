export interface OfflineHotel {
  id: number;
  hid: number | null; // WorldOTA hotel ID - links to hotels table for images/stars/amenities
  hotel_name: string;
  city: string;
  check_in: string; // DATE → "YYYY-MM-DD"
  check_out: string; // DATE → "YYYY-MM-DD"
  price: number; // total per room for the stay
  room_type: string;
  num_rooms: number;
  consumed_rooms: number;
  meal_plan: string | null;
  notes: string | null;
  last_cancellation_date: string | null; // DATE "YYYY-MM-DD" - earliest free-cancel deadline across rooms
  guest_rating: number | null; // manual guest score (0–10); null = inherit from linked hotels.hid
  guest_review_count: number | null; // manual review count; null = inherit
  event_ids: number[];
  flight_ids: number[];
  is_deleted: boolean | null;
  created_at: string;
}

export interface OfflineHotelRoom {
  id: number;
  hotel_id: number;
  room_type: string;
  price: number;
  meal_plan: string | null;
  last_cancellation_date: string | null; // DATE "YYYY-MM-DD"
  supplier: string | null;
  is_booked: boolean;
  order_no: string | null;
  acc_no: string | null;
  reservation_id: number | null;
  notes: string | null;
  created_at: string;
}

// Shape sent from the form to create/replace a hotel's rooms.
// No id/hotel_id/is_booked/created_at - server owns those.
export type NewOfflineHotelRoom = {
  room_type: string;
  price: number;
  meal_plan: string | null;
  last_cancellation_date: string | null;
  supplier: string | null;
};

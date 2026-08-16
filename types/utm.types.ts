/**
 * A row of `utm_touches` - attribution touches captured from the `myt_utm`
 * cookie when a reservation is created. position 0 is the primary
 * (attributed) touch; 1..n are older history touches, newest first.
 * Written by myt-main's confirm-order; read here for the reservation
 * detail's attribution section. Keep in sync with myt-main's lib/utm.ts
 * (UtmTouchInsert is the insert-side subset of this row).
 */
export type UtmTouch = {
  id: number;
  reservation_id: number;
  position: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  is_influencer: boolean;
  visited_at: string | null;
  created_at: string;
};

// MEGA CLUB - shapes the backoffice reads (spec docs/superpowers/specs/2026-11-09-members-club-design.md §7, §10).
// Pure types: no server imports, so the selftest and the client components can use them.

export type ClubSettings = {
  enabled: boolean;
  discount_per_traveler_usd: number;
  popup_delay_seconds: number;
};

/** The `club_members` columns the screen reads. */
export type ClubMemberRow = {
  id: string;
  member_no: number;
  email: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  coupon_code: string;
  status: string;
  marketing: string;
  unsubscribed_at: string | null;
  source: string | null;
  event_id: number | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  welcome_sent_at: string | null;
  welcome_error: string | null;
  created_at: string;
};

/** A reservation whose coupon is a member code. */
export type ClubOrderRow = {
  coupon_code: string;
  status: string;
  created_at: string;
  user_shown_price: number | null;
  coupon_discount_usd: number | null;
};

export type ClubMemberView = ClubMemberRow & {
  ordersAll: number;
  ordersPaid: number;
  paidRevenueUsd: number;
  eventName: string | null;
};

export type ClubLogRow = {
  id: number;
  action: string;
  consent_text: string | null;
  consent_version: string | null;
  ip: string | null;
  user_agent: string | null;
  source: string | null;
  at: string;
};

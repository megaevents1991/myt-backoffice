"use server";

import { requirePartner } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import {
  commissionForReservation,
  commissionForReservations,
  countReservationTickets,
  countTickets,
  describeCommission,
  isPaid,
  round2,
  sumSales,
  type CommissionTerms,
} from "@/lib/partner-commission";
import { fundedCouponCodesFor } from "@/lib/actions/portal-coupon-actions";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import type { CommissionType } from "@/types/partner.types";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";

export interface PortalProfile {
  name_hebrew: string | null;
  partner_tracking_code: string;
  commission: number | null;
  logo_url: string | null;
  display_name: string | null;
  email: string;
}

export interface PortalStats {
  totalReservations: number;
  paidReservations: number;
  totalSalesUsd: number;
  /** Ready-to-display rate, e.g. "$25 per ticket" or "8% of sales". */
  commissionLabel: string;
  paidTickets: number;
  estimatedCommissionUsd: number;
  activeCoupons: number;
  couponUses: number;
}

export interface PortalCoupon {
  id: number;
  code: string;
  discount_type: string;
  discount_value: number;
  valid_until: string | null;
  max_uses: number | null;
  times_used: number | null;
  times_paid: number | null;
  is_active: boolean;
  event_id: number | null;
  /** True for coupons whose discount comes out of the partner's commission. */
  funded_by_commission?: boolean;
}

/** How the order arrived at the site — the portal's per-row source label. */
export type PortalReservationSource = "voucher" | "package" | "quote" | "link";

export interface PortalReservation {
  id: number;
  created_at: string;
  customer_name: string;
  status: string;
  user_shown_price: number;
  event_id: number;
  event_title: string | null;
  event_date: string | null;
  event_location: string | null;
  ticket_category: string | null;
  /** Tickets across every event on the booking. */
  tickets: number;
  /** Travellers on the booking, including the person who booked it. */
  pax: number;
  /** Ours to quote back at us — staff-entered, may be empty. */
  booking_reference: string | null;
  /** Travel material sent — the staff stamp, falling back to the
   *  confirmation-email flag for rows from before the stamp existed. */
  materials_sent: boolean;
  /** Voucher lifecycle for voucher-settled orders (sent/received/collected). */
  voucher_state: "sent" | "received" | "collected" | null;
  /** What this booking earns the partner. Zero until it is paid. */
  commission_usd: number;
  /** True once it has gone out in a monthly report. */
  billed: boolean;
  /** A 24-hour price hold the customer saved but never paid for. */
  is_hold: boolean;
  /** When the hold stops working. Null unless `is_hold`. */
  hold_expires_at: string | null;
  /** How the order arrived: voucher settlement / package link / signed quote /
   *  plain tracking link. Older rows (before the attribution columns) read
   *  as "link". */
  source: PortalReservationSource;
}

export interface PortalReservationsPage {
  rows: PortalReservation[];
  /** True when older bookings exist beyond the page returned. */
  truncated: boolean;
}

export async function getPortalProfile(): Promise<PortalProfile | null> {
  const session = await requirePartner();
  const [{ data: partner, error: pErr }, { data: profile, error: prErr }] =
    await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("partners")
        .select("name_hebrew,partner_tracking_code,commission")
        .eq("partner_tracking_code", session.partner_code)
        .maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("user_profiles")
        .select("logo_url,display_name,email")
        .eq("id", session.sub)
        .maybeSingle(),
    ]);
  if (pErr) console.error("getPortalProfile partner:", JSON.stringify(pErr));
  if (prErr) console.error("getPortalProfile profile:", JSON.stringify(prErr));
  if (!partner) return null;
  return {
    name_hebrew: partner.name_hebrew ?? null,
    partner_tracking_code: partner.partner_tracking_code,
    commission: partner.commission ?? null,
    logo_url: profile?.logo_url ?? null,
    display_name: profile?.display_name ?? null,
    email: profile?.email ?? session.email,
  };
}

export async function getPortalStats(): Promise<PortalStats> {
  const session = await requirePartner();
  const empty: PortalStats = {
    totalReservations: 0,
    paidReservations: 0,
    totalSalesUsd: 0,
    commissionLabel: "—",
    paidTickets: 0,
    estimatedCommissionUsd: 0,
    activeCoupons: 0,
    couponUses: 0,
  };

  const [resResult, couponResult, partnerResult] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("reservations")
      .select("id,status,user_shown_price,event_order_info")
      .eq("aff_partner_tracking_code", session.partner_code),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("coupons")
      .select("id,is_active,times_used")
      .eq("partner_tracking_code", session.partner_code),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("partners")
      .select("commission,commission_type")
      .eq("partner_tracking_code", session.partner_code)
      .maybeSingle(),
  ]);

  if (resResult.error) {
    console.error("getPortalStats reservations:", JSON.stringify(resResult.error));
    return empty;
  }
  if (couponResult.error) {
    console.error("getPortalStats coupons:", JSON.stringify(couponResult.error));
  }
  if (partnerResult.error) {
    // Don't fail the page, but never let a broken lookup quietly become "$0".
    console.error("getPortalStats partner:", JSON.stringify(partnerResult.error));
  }

  const reservations = (resResult.data ?? []) as {
    id: number;
    status: string;
    user_shown_price: number | null;
    event_order_info: ReservationEventOrderInfo | null;
  }[];
  const coupons = (couponResult.data ?? []) as {
    id: number;
    is_active: boolean;
    times_used: number | null;
  }[];
  const terms: CommissionTerms = {
    type: (partnerResult.data?.commission_type as CommissionType | null) ?? "fixed_per_ticket",
    rate: partnerResult.data?.commission ?? null,
  };

  const paid = reservations.filter(isPaid);

  return {
    totalReservations: reservations.length,
    paidReservations: paid.length,
    totalSalesUsd: sumSales(paid),
    commissionLabel: describeCommission(terms),
    paidTickets: countTickets(paid),
    estimatedCommissionUsd: commissionForReservations(paid, terms),
    activeCoupons: coupons.filter((c) => c.is_active).length,
    couponUses: coupons.reduce((sum, c) => sum + (c.times_used ?? 0), 0),
  };
}

export async function getPortalCoupons(): Promise<PortalCoupon[]> {
  const session = await requirePartner();
  const fetchCoupons = (columns: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("coupons")
      .select(columns)
      .eq("partner_tracking_code", session.partner_code)
      .order("created_at", { ascending: false });

  let { data, error } = await fetchCoupons(
    "id,code,discount_type,discount_value,valid_until,max_uses,times_used,times_paid,is_active,event_id,funded_by_commission"
  );
  if (error?.code === "42703") {
    // funded_by_commission not migrated yet — the badge simply doesn't show.
    ({ data, error } = await fetchCoupons(
      "id,code,discount_type,discount_value,valid_until,max_uses,times_used,times_paid,is_active,event_id"
    ));
  }
  if (error) {
    console.error("getPortalCoupons:", JSON.stringify(error));
    return [];
  }
  return (data as PortalCoupon[]) ?? [];
}

const RESERVATIONS_PAGE_SIZE = 500;

/** The status the main app writes for a 24-hour price hold. */
const HOLD_STATUS = "24Save";

/**
 * When a hold stops being resumable.
 *
 * The main app's recovery endpoint allows 25 hours, not the 24 it advertises.
 * The partner is shown the real cut-off — telling them 24 would have them chase
 * a customer whose link still works, or give up an hour early.
 */
const HOLD_WINDOW_MS = 25 * 60 * 60 * 1000;

function holdExpiry(createdAt: string): string | null {
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created)
    ? new Date(created + HOLD_WINDOW_MS).toISOString()
    : null;
}

/**
 * Columns a partner may see on their own bookings.
 *
 * Listed explicitly, never "everything except" — a column added to
 * `reservations` later must not start leaking on its own. Deliberately absent:
 * `main_contact_phone_number` and `main_contact_email` (the customer is ours,
 * not the partner's), `payment_info`, `offline_flight_cost` /
 * `offline_hotel_cost` / `final_purchase_price_ils` (our cost — showing them
 * hands the partner our margin on every booking), `accounting_number`, and
 * `comments`, which is the staff's internal note field.
 */
const PORTAL_RESERVATION_COLUMNS =
  "id,created_at,main_contact_first_name,main_contact_last_name,status,user_shown_price,event_id,event_order_info,more_pax_info,booking_reference,confirmation_email_sent,billed_at,coupon_code,coupon_discount_usd";

/** Source-attribution columns (migration 20260805170000 + the pre-existing
 *  settlement marker). Selected separately so a not-yet-migrated DB can fall
 *  back to the legacy select instead of blanking the whole page. */
const PORTAL_RESERVATION_SOURCE_COLUMNS =
  ",partner_settlement_method,source_share_token,quote_id,voucher_state,travel_materials_sent_at";

export async function getPortalReservations(): Promise<PortalReservationsPage> {
  const session = await requirePartner();

  const fetchReservations = (columns: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("reservations")
      .select(columns)
      .eq("aff_partner_tracking_code", session.partner_code)
      .order("created_at", { ascending: false })
      // One more than the page, purely to detect that older rows exist.
      .limit(RESERVATIONS_PAGE_SIZE + 1);

  const [initialReservationsResult, partnerResult, fundedCodes] = await Promise.all([
    fetchReservations(PORTAL_RESERVATION_COLUMNS + PORTAL_RESERVATION_SOURCE_COLUMNS),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("partners")
      .select("commission,commission_type")
      .eq("partner_tracking_code", session.partner_code)
      .maybeSingle(),
    fundedCouponCodesFor(session.partner_code),
  ]);
  let reservationsResult = initialReservationsResult;

  if (reservationsResult.error?.code === "42703") {
    // Attribution columns not migrated yet — every row simply reads as "link".
    reservationsResult = await fetchReservations(PORTAL_RESERVATION_COLUMNS);
  }

  if (reservationsResult.error) {
    console.error("getPortalReservations:", JSON.stringify(reservationsResult.error));
    return { rows: [], truncated: false };
  }
  if (partnerResult.error) {
    // Never let a lookup failure quietly render every booking as $0 commission.
    console.error("getPortalReservations partner:", JSON.stringify(partnerResult.error));
  }

  const terms: CommissionTerms = {
    type: (partnerResult.data?.commission_type as CommissionType | null) ?? "fixed_per_ticket",
    rate: partnerResult.data?.commission ?? null,
    // Commission-funded coupons deduct from the row they were spent on — the
    // per-row figure here must match what the monthly report will pay.
    fundedCouponCodes: fundedCodes,
  };

  type Row = {
    id: number;
    created_at: string;
    main_contact_first_name: string | null;
    main_contact_last_name: string | null;
    status: string;
    user_shown_price: number | null;
    event_id: number;
    event_order_info: ReservationEventOrderInfo | null;
    more_pax_info: unknown;
    booking_reference: string | null;
    confirmation_email_sent: boolean | null;
    billed_at: string | null;
    coupon_code: string | null;
    coupon_discount_usd: number | null;
    partner_settlement_method?: string | null;
    source_share_token?: string | null;
    quote_id?: number | null;
    voucher_state?: "sent" | "received" | "collected" | null;
    travel_materials_sent_at?: string | null;
  };

  const all = (reservationsResult.data ?? []) as Row[];
  const truncated = all.length > RESERVATIONS_PAGE_SIZE;
  const rows = all.slice(0, RESERVATIONS_PAGE_SIZE).map((r) => {
    // The order-info JSON holds one item or { events: [...] }; the title field
    // is `name`. Ticket counts and category are already in here — the portal
    // used to fetch this and throw all but the title away.
    const events = normalizeReservationEventOrderInfo(r.event_order_info);
    const first = events[0];
    return {
      id: r.id,
      created_at: r.created_at,
      customer_name: [r.main_contact_first_name, r.main_contact_last_name]
        .filter(Boolean)
        .join(" "),
      status: r.status,
      user_shown_price: r.user_shown_price ?? 0,
      event_id: r.event_id,
      event_title: first?.name ?? null,
      // `date` is typed string | Date on the order-info item.
      event_date: first?.date == null ? null : String(first.date),
      event_location: first?.location_name ?? null,
      ticket_category: first?.category ?? null,
      tickets: countReservationTickets(r),
      // `more_pax_info` is the ADDITIONAL passengers — the main contact is not
      // in it (the main app writes `passengers.slice(1)`), so the +1 is the
      // booker. Every other pax count in this repo does the same.
      pax: 1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0),
      booking_reference: r.booking_reference,
      // Real staff stamp when set; the confirmation-email flag is the legacy
      // stand-in (מאיפה המידע? — אלון, 2026-08-06).
      materials_sent:
        r.travel_materials_sent_at != null || r.confirmation_email_sent === true,
      voucher_state: r.voucher_state ?? null,
      commission_usd: round2(commissionForReservation(r, terms)),
      billed: !!r.billed_at,
      is_hold: r.status === HOLD_STATUS,
      hold_expires_at:
        r.status === HOLD_STATUS ? holdExpiry(r.created_at) : null,
      // Priority: a voucher settlement outranks everything (it also overwrites
      // coupon_code), then the signed quote, then the package link. A plain
      // tracking link — and every pre-attribution row — reads "link".
      source: (r.partner_settlement_method === "voucher"
        ? "voucher"
        : r.quote_id != null
          ? "quote"
          : r.source_share_token
            ? "package"
            : "link") as PortalReservationSource,
      // Deliberately NOT the customer's recovery link. Opening it loads the
      // saved order through the main app's find-order endpoint, which returns
      // the customer's phone, email and every passenger name — the exact data
      // PORTAL_RESERVATION_COLUMNS above refuses to select. The partner would
      // open it just to check it works. They already have the customer's name
      // and the event, which is what they need to make the call.
    };
  });

  return { rows, truncated };
}

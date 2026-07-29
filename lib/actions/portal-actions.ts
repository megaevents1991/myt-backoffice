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
}

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
  /** Whether the customer's confirmation went out. */
  materials_sent: boolean;
  /** What this booking earns the partner. Zero until it is paid. */
  commission_usd: number;
  /** True once it has gone out in a monthly report. */
  billed: boolean;
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
      (supabase as any)
        .from("partners")
        .select("name_hebrew,partner_tracking_code,commission")
        .eq("partner_tracking_code", session.partner_code)
        .maybeSingle(),
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
    (supabase as any)
      .from("reservations")
      .select("id,status,user_shown_price,event_order_info")
      .eq("aff_partner_tracking_code", session.partner_code),
    (supabase as any)
      .from("coupons")
      .select("id,is_active,times_used")
      .eq("partner_tracking_code", session.partner_code),
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
  const { data, error } = await (supabase as any)
    .from("coupons")
    .select(
      "id,code,discount_type,discount_value,valid_until,max_uses,times_used,times_paid,is_active,event_id"
    )
    .eq("partner_tracking_code", session.partner_code)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getPortalCoupons:", JSON.stringify(error));
    return [];
  }
  return (data as PortalCoupon[]) ?? [];
}

const RESERVATIONS_PAGE_SIZE = 500;

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
  "id,created_at,main_contact_first_name,main_contact_last_name,status,user_shown_price,event_id,event_order_info,more_pax_info,booking_reference,confirmation_email_sent,billed_at";

export async function getPortalReservations(): Promise<PortalReservationsPage> {
  const session = await requirePartner();

  const [reservationsResult, partnerResult] = await Promise.all([
    (supabase as any)
      .from("reservations")
      .select(PORTAL_RESERVATION_COLUMNS)
      .eq("aff_partner_tracking_code", session.partner_code)
      .order("created_at", { ascending: false })
      // One more than the page, purely to detect that older rows exist.
      .limit(RESERVATIONS_PAGE_SIZE + 1),
    (supabase as any)
      .from("partners")
      .select("commission,commission_type")
      .eq("partner_tracking_code", session.partner_code)
      .maybeSingle(),
  ]);

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
      materials_sent: r.confirmation_email_sent === true,
      commission_usd: round2(commissionForReservation(r, terms)),
      billed: !!r.billed_at,
    };
  });

  return { rows, truncated };
}

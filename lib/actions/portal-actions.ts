"use server";

import { requirePartner } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

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
  commissionPercent: number | null;
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
    commissionPercent: null,
    estimatedCommissionUsd: 0,
    activeCoupons: 0,
    couponUses: 0,
  };

  const [resResult, couponResult, partnerResult] = await Promise.all([
    (supabase as any)
      .from("reservations")
      .select("id,status,user_shown_price")
      .eq("aff_partner_tracking_code", session.partner_code),
    (supabase as any)
      .from("coupons")
      .select("id,is_active,times_used")
      .eq("partner_tracking_code", session.partner_code),
    (supabase as any)
      .from("partners")
      .select("commission")
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

  const reservations = (resResult.data ?? []) as {
    id: number;
    status: string;
    user_shown_price: number | null;
  }[];
  const coupons = (couponResult.data ?? []) as {
    id: number;
    is_active: boolean;
    times_used: number | null;
  }[];
  const commissionPercent = partnerResult.data?.commission ?? null;

  const paid = reservations.filter((r) => (r.status ?? "").toLowerCase() === "paid");
  const totalSalesUsd = paid.reduce((sum, r) => sum + (r.user_shown_price ?? 0), 0);

  return {
    totalReservations: reservations.length,
    paidReservations: paid.length,
    totalSalesUsd,
    commissionPercent,
    estimatedCommissionUsd: commissionPercent
      ? Math.round(totalSalesUsd * (commissionPercent / 100))
      : 0,
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

export async function getPortalReservations(): Promise<PortalReservation[]> {
  const session = await requirePartner();
  const { data, error } = await (supabase as any)
    .from("reservations")
    .select(
      "id,created_at,main_contact_first_name,main_contact_last_name,status,user_shown_price,event_id,event_order_info"
    )
    .eq("aff_partner_tracking_code", session.partner_code)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("getPortalReservations:", JSON.stringify(error));
    return [];
  }
  type Row = {
    id: number;
    created_at: string;
    main_contact_first_name: string | null;
    main_contact_last_name: string | null;
    status: string;
    user_shown_price: number | null;
    event_id: number;
    event_order_info: unknown;
  };
  return ((data ?? []) as Row[]).map((r) => {
    // Event title lives inside the order-info JSON when present. Shape is
    // ReservationEventOrderInfoItem ({ name, ... }) or { events: ReservationEventOrderInfoItem[] }
    // (see types/reservation.types.ts) — the title field is `name`, not `event_name`.
    let event_title: string | null = null;
    const info = r.event_order_info as
      | { events?: { name?: string }[] }
      | { name?: string }
      | null;
    if (info && typeof info === "object") {
      if (Array.isArray((info as { events?: unknown }).events)) {
        const first = (info as { events: { name?: string }[] }).events[0];
        event_title = first?.name ?? null;
      } else if ("name" in info && typeof info.name === "string") {
        event_title = info.name;
      }
    }
    return {
      id: r.id,
      created_at: r.created_at,
      customer_name: [r.main_contact_first_name, r.main_contact_last_name]
        .filter(Boolean)
        .join(" "),
      status: r.status,
      user_shown_price: r.user_shown_price ?? 0,
      event_id: r.event_id,
      event_title,
    };
  });
}

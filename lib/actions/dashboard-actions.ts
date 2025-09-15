"use server"

import { supabase } from "@/lib/supabase-server"

export async function getDashboardCounts() {
  try {
    let eventsCount = 0;
    let agentsCount = 0;
    let partnersCount = 0;
    let paidReservationsCount = 0;
    let pendingReservationsCount = 0;

    // 1. Events
    try {
      const oneWeekFromNow = new Date();
      oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
      const { count, error } = await supabase
        .from("events")
        .select("*", { count: "exact", head: true })
        .is("is_deleted", null)
        .gte("date", oneWeekFromNow.toISOString());
      if (error) throw error;
      eventsCount = count || 0;
    } catch (e) {
      console.error("DashboardCounts: events query failed", e);
    }

    // 2 & 3. Partners classification (fallback if no explicit type column)
    try {
      type PartnerRow = { partner_tracking_code?: string | null; type?: string | null }
      const { data: partnersRaw, error } = await supabase
        .from("partners")
        .select("partner_tracking_code, type, type");
      if (error) throw error;
      const rows: PartnerRow[] = (partnersRaw as PartnerRow[]) || [];
      const hasType = rows.some(r => typeof r.type === "string");
      const hasPartnerType = rows.some(r => typeof r.type === "string");
      const deriveAgent = (code: string | null | undefined) => /AGT|AGENT/i.test(code || "");
      const agentRows = rows.filter(r => (hasType ? r.type === "agent" : hasPartnerType ? r.type === "agent" : deriveAgent(r.partner_tracking_code)));
      const affiliateRows = rows.filter(r => (hasType ? r.type === "affiliate" : hasPartnerType ? r.type === "affiliate" : !deriveAgent(r.partner_tracking_code)));
      agentsCount = agentRows.length;
      partnersCount = affiliateRows.filter(r => !/_\d{3}$/.test(r.partner_tracking_code || "")).length;
    } catch (e) {
      console.error("DashboardCounts: partners query failed", e);
    }

    // 4. Paid reservations
    try {
      const { count, error } = await supabase
        .from("reservations")
        .select("*", { count: "exact", head: true })
        .eq("status", "Paid");
      if (error) throw error;
      paidReservationsCount = count || 0;
    } catch (e) {
      console.error("DashboardCounts: paid reservations query failed", e);
    }

    // 5. Pending reservations
    try {
      const { count, error } = await supabase
        .from("reservations")
        .select("*", { count: "exact", head: true })
        .eq("status", "Pending");
      if (error) throw error;
      pendingReservationsCount = count || 0;
    } catch (e) {
      console.error("DashboardCounts: pending reservations query failed", e);
    }

    return {
      events: eventsCount,
      agents: agentsCount,
      partners: partnersCount,
      paidReservations: paidReservationsCount,
      pendingReservations: pendingReservationsCount,
    };
  } catch (error) {
    console.error("Error fetching dashboard counts:", error);
    throw error;
  }
}

export async function getDashboardStats() {
  try {
    type ReservationRow = { user_shown_price: number | null | undefined }
    const { data: reservations, error: reservationsError } = await supabase
      .from("reservations")
      .select("user_shown_price") as unknown as { data: ReservationRow[]; error: any }
    if (reservationsError) throw reservationsError
    const totalRevenue = (reservations || []).reduce<number>((sum, r) => sum + (Number(r.user_shown_price) || 0), 0)

    type EventRow = { usual_price: number | null | undefined }
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("usual_price") as unknown as { data: EventRow[]; error: any }
    if (eventsError) throw eventsError
    const avgTicketPrice = events && events.length > 0
      ? events.reduce<number>((sum, e) => sum + (Number(e.usual_price) || 0), 0) / events.length
      : 0

    type PartnerRow = { commission: number | null | undefined }
    const { data: partners, error: partnersError } = await supabase
      .from("partners")
      .select("commission")
      .order("commission", { ascending: false })
      .limit(1) as unknown as { data: PartnerRow[]; error: any }
    if (partnersError) throw partnersError
    const topPartnerCommission = partners && partners.length > 0 ? Number(partners[0].commission) || 0 : 0

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const { count, error: recentError } = await supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo.toISOString())
    if (recentError) throw recentError

    return {
      totalRevenue,
      avgTicketPrice,
      topPartnerCommission,
      recentReservations: count || 0,
    }
  } catch (error) {
    console.error("Error fetching dashboard stats:", error)
    throw error
  }
}


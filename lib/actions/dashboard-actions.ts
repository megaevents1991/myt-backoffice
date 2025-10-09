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
    type ReservationRow = { created_at?: string; more_pax_info: { first_name?: string; last_name?: string }[] | null; status?: string; event_order_info?: { name?: string } | null; aff_partner_tracking_code?: string | null }
    const { data: paidReservations, error: paidError } = await supabase
      .from("reservations")
      .select("more_pax_info,status")
      .eq("status", "Paid") as unknown as { data: ReservationRow[]; error: any }
    if (paidError) throw paidError
    const totalRevenue = (paidReservations || []).reduce<number>((sum, r) => {
      const pax = 1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0)
      return sum + pax * 175
    }, 0)

    type PartnerRow = { commission: number | null | undefined }
    const { data: partners, error: partnersError } = await supabase
      .from("partners")
      .select("commission")
      .order("commission", { ascending: false })
      .limit(1) as unknown as { data: PartnerRow[]; error: any }
    if (partnersError) throw partnersError
    const topPartnerCommission = partners && partners.length > 0 ? Number(partners[0].commission) || 0 : 0

    // Recent (last 30 days from now)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const { data: recentRows, error: recentError } = await supabase
      .from("reservations")
      .select("created_at,more_pax_info,event_order_info,aff_partner_tracking_code")
      .gte("created_at", thirtyDaysAgo.toISOString())
      .eq("status", "Paid") as unknown as { data: ReservationRow[]; error: any }
    if (recentError) throw recentError
    const recentReservations = (recentRows || []).length
    const recentReservationsPax = (recentRows || []).reduce<number>((sum, r) => sum + 1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0), 0)

    // Last calendar month
    const now = new Date()
    const firstOfCurrent = new Date(now.getFullYear(), now.getMonth(), 1)
    const firstOfLast = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const { data: lastMonthRows, error: lastMonthError } = await supabase
      .from("reservations")
      .select("created_at,more_pax_info,event_order_info,aff_partner_tracking_code")
      .gte("created_at", firstOfLast.toISOString())
      .lt("created_at", firstOfCurrent.toISOString())
      .eq("status", "Paid") as unknown as { data: ReservationRow[]; error: any }
    if (lastMonthError) throw lastMonthError
    const reservationsLastMonth = (lastMonthRows || []).length
    const paxLastMonth = (lastMonthRows || []).reduce<number>((sum, r) => sum + 1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0), 0)

    // Last 7 days
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const { data: last7Rows, error: last7Error } = await supabase
      .from("reservations")
      .select("created_at,more_pax_info")
      .gte("created_at", sevenDaysAgo.toISOString())
      .eq("status", "Paid") as unknown as { data: ReservationRow[]; error: any }
    if (last7Error) throw last7Error
    const reservationsLast7Days = (last7Rows || []).length
    const paxLast7Days = (last7Rows || []).reduce<number>((sum, r) => sum + 1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0), 0)

    // Current calendar month
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const { data: currentMonthRows, error: currentMonthError } = await supabase
      .from("reservations")
      .select("created_at,more_pax_info,event_order_info,aff_partner_tracking_code")
      .gte("created_at", firstOfThisMonth.toISOString())
      .lt("created_at", firstOfNextMonth.toISOString())
      .eq("status", "Paid") as unknown as { data: ReservationRow[]; error: any }
    if (currentMonthError) throw currentMonthError
    const reservationsCurrentMonth = (currentMonthRows || []).length
    const paxCurrentMonth = (currentMonthRows || []).reduce<number>((sum, r) => sum + 1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0), 0)

    // Helper to aggregate top counts by normalized key while preserving a display label
    function topCounts(rows: ReservationRow[] | null | undefined, key: (r: ReservationRow) => string, limit = 3) {
      const map = new Map<string, number>()
      ;(rows||[]).forEach(r => {
        const k = key(r) || "Unknown"
        map.set(k, (map.get(k) || 0) + 1)
      })
      return Array.from(map.entries())
        .sort((a,b)=> b[1]-a[1])
        .slice(0, limit)
        .map(([label,count])=> ({ label, count }))
    }

    // Normalize event names to aggregate identical names regardless of case/spacing, but keep a nice label
    function normalizeEventName(name: string | null | undefined) {
      const s = (name || "Unknown").trim().replace(/\s+/g, " ")
      return s.toLowerCase()
    }
    function topEventsByName(rows: ReservationRow[] | null | undefined, limit = 3) {
      const map = new Map<string, { count: number; label: string }>()
      ;(rows || []).forEach(r => {
        const raw = (r.event_order_info?.name ?? "Unknown").toString()
        const norm = normalizeEventName(raw)
        const prev = map.get(norm)
        if (prev) {
          prev.count += 1
          // Optionally, prefer the longest label encountered for display
          if (raw.trim().length > prev.label.length) prev.label = raw.trim()
        } else {
          map.set(norm, { count: 1, label: raw.trim() || "Unknown" })
        }
      })
      return Array.from(map.values())
        .sort((a,b) => b.count - a.count)
        .slice(0, limit)
    }

    const topEventsLast30 = topEventsByName(recentRows)
    const topEventsThisMonth = topEventsByName(currentMonthRows)
    const topEventsLastMonth = topEventsByName(lastMonthRows)

    const normalizeSource = (r: ReservationRow) => {
      const raw = r.aff_partner_tracking_code
      if (!raw || typeof raw !== 'string' || raw.trim()==='') return 'Organic'
      return raw
    }
    const topSourcesLast30 = topCounts(recentRows, normalizeSource)
    const topSourcesThisMonth = topCounts(currentMonthRows, normalizeSource)
    const topSourcesLastMonth = topCounts(lastMonthRows, normalizeSource)

    return {
      totalRevenue,
      topPartnerCommission,
      recentReservations,
      recentReservationsPax,
      reservationsLastMonth,
      paxLastMonth,
      reservationsLast7Days,
      paxLast7Days,
      reservationsCurrentMonth,
      paxCurrentMonth,
      topEventsLast30,
      topEventsThisMonth,
      topEventsLastMonth,
      topSourcesLast30,
      topSourcesThisMonth,
      topSourcesLastMonth,
    }
  } catch (error) {
    console.error("Error fetching dashboard stats:", error)
    throw error
  }
}


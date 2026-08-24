"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { getReservationEventOrderInfoPrimaryName } from "@/lib/utils";
import { isCustomerRefundPartner } from "@/types/partner.types";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";

async function countReservationsByStatus(status: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("reservations")
      .select("*", { count: "exact", head: true })
      .is("is_deleted", null)
      .eq("status", status);
    if (error) throw error;
    return count || 0;
  } catch (e) {
    console.error(`DashboardCounts: ${status} reservations query failed`, e);
    return 0;
  }
}

export async function getDashboardCounts() {
  await requireStaff();
  const oneWeekFromNow = new Date();
  oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);

  // Independent queries - run in parallel; each falls back to 0 on failure so
  // one bad query doesn't blank the whole header row.
  const [
    eventsCount,
    partnerSplit,
    paidReservationsCount,
    pendingReservationsCount,
  ] = await Promise.all([
    (async () => {
      try {
        const { count, error } = await supabase
          .from("events")
          .select("*", { count: "exact", head: true })
          .is("is_deleted", null)
          .gte("date", oneWeekFromNow.toISOString());
        if (error) throw error;
        return count || 0;
      } catch (e) {
        console.error("DashboardCounts: events query failed", e);
        return 0;
      }
    })(),
    (async () => {
      try {
        type PartnerRow = { type: string | null; name_hebrew: string | null };
        const { data: partnersRaw, error } = await supabase
          .from("partners")
          .select("type, name_hebrew")
          .eq("is_active", true);
        if (error) throw error;
        const rows: PartnerRow[] = (partnersRaw as PartnerRow[]) || [];
        // Customer-refund rows are their own type and belong in neither count.
        const marketing = rows.filter((r) => !isCustomerRefundPartner(r));
        return {
          agents: marketing.filter((r) => r.type === "agent").length,
          partners: marketing.filter(
            (r) => (r.type ?? "affiliate") === "affiliate",
          ).length,
        };
      } catch (e) {
        console.error("DashboardCounts: partners query failed", e);
        return { agents: 0, partners: 0 };
      }
    })(),
    countReservationsByStatus("Paid"),
    countReservationsByStatus("Pending"),
  ]);

  return {
    events: eventsCount,
    agents: partnerSplit.agents,
    partners: partnerSplit.partners,
    paidReservations: paidReservationsCount,
    pendingReservations: pendingReservationsCount,
  };
}

export async function getDashboardStats() {
  await requireStaff();
  try {
    type ReservationRow = {
      created_at?: string;
      more_pax_info: { first_name?: string; last_name?: string }[] | null;
      status?: string;
      event_order_info?: ReservationEventOrderInfo | null;
      aff_partner_tracking_code?: string | null;
    };

    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const firstOfCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Six independent queries - run in parallel (was sequential).
    const [
      paidRes,
      partnersRes,
      recentRes,
      lastMonthRes,
      last7Res,
      currentMonthRes,
    ] = await Promise.all([
      supabase
        .from("reservations")
        .select("more_pax_info")
        .is("is_deleted", null)
        .eq("status", "Paid"),
      supabase
        .from("partners")
        .select("commission")
        .order("commission", { ascending: false })
        .limit(1),
      supabase
        .from("reservations")
        .select(
          "created_at,more_pax_info,event_order_info,aff_partner_tracking_code",
        )
        .is("is_deleted", null)
        .gte("created_at", thirtyDaysAgo.toISOString())
        .eq("status", "Paid"),
      supabase
        .from("reservations")
        .select(
          "created_at,more_pax_info,event_order_info,aff_partner_tracking_code",
        )
        .is("is_deleted", null)
        .gte("created_at", firstOfLast.toISOString())
        .lt("created_at", firstOfCurrent.toISOString())
        .eq("status", "Paid"),
      supabase
        .from("reservations")
        .select("created_at,more_pax_info")
        .is("is_deleted", null)
        .gte("created_at", sevenDaysAgo.toISOString())
        .eq("status", "Paid"),
      supabase
        .from("reservations")
        .select(
          "created_at,more_pax_info,event_order_info,aff_partner_tracking_code",
        )
        .is("is_deleted", null)
        .gte("created_at", firstOfCurrent.toISOString())
        .lt("created_at", firstOfNextMonth.toISOString())
        .eq("status", "Paid"),
    ]);

    if (paidRes.error) throw paidRes.error;
    if (partnersRes.error) throw partnersRes.error;
    if (recentRes.error) throw recentRes.error;
    if (lastMonthRes.error) throw lastMonthRes.error;
    if (last7Res.error) throw last7Res.error;
    if (currentMonthRes.error) throw currentMonthRes.error;

    const paidReservations = (paidRes.data ||
      []) as unknown as ReservationRow[];
    const totalRevenue = paidReservations.reduce<number>((sum, r) => {
      const pax =
        1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0);
      return sum + pax * 175;
    }, 0);

    type PartnerRow = { commission: number | null | undefined };
    const partners = (partnersRes.data || []) as unknown as PartnerRow[];
    const topPartnerCommission =
      partners.length > 0 ? Number(partners[0].commission) || 0 : 0;

    const recentRows = (recentRes.data || []) as unknown as ReservationRow[];
    const recentReservations = recentRows.length;
    const recentReservationsPax = recentRows.reduce<number>(
      (sum, r) =>
        sum + 1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0),
      0,
    );

    const lastMonthRows = (lastMonthRes.data ||
      []) as unknown as ReservationRow[];
    const reservationsLastMonth = lastMonthRows.length;
    const paxLastMonth = lastMonthRows.reduce<number>(
      (sum, r) =>
        sum + 1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0),
      0,
    );

    const last7Rows = (last7Res.data || []) as unknown as ReservationRow[];
    const reservationsLast7Days = last7Rows.length;
    const paxLast7Days = last7Rows.reduce<number>(
      (sum, r) =>
        sum + 1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0),
      0,
    );

    const currentMonthRows = (currentMonthRes.data ||
      []) as unknown as ReservationRow[];
    const reservationsCurrentMonth = currentMonthRows.length;
    const paxCurrentMonth = currentMonthRows.reduce<number>(
      (sum, r) =>
        sum + 1 + (Array.isArray(r.more_pax_info) ? r.more_pax_info.length : 0),
      0,
    );

    // Helper to aggregate top counts by normalized key while preserving a display label
    function topCounts(
      rows: ReservationRow[] | null | undefined,
      key: (r: ReservationRow) => string,
      limit = 3,
    ) {
      const map = new Map<string, number>();
      (rows || []).forEach((r) => {
        const k = key(r) || "Unknown";
        map.set(k, (map.get(k) || 0) + 1);
      });
      return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([label, count]) => ({ label, count }));
    }

    // Normalize event names to aggregate identical names regardless of case/spacing, but keep a nice label
    function normalizeEventName(name: string | null | undefined) {
      const s = (name || "Unknown").trim().replace(/\s+/g, " ");
      return s.toLowerCase();
    }
    function topEventsByName(
      rows: ReservationRow[] | null | undefined,
      limit = 3,
    ) {
      const map = new Map<string, { count: number; label: string }>();
      (rows || []).forEach((r) => {
        const raw = getReservationEventOrderInfoPrimaryName(r.event_order_info);
        const norm = normalizeEventName(raw);
        const prev = map.get(norm);
        if (prev) {
          prev.count += 1;
          // Optionally, prefer the longest label encountered for display
          if (raw.trim().length > prev.label.length) prev.label = raw.trim();
        } else {
          map.set(norm, { count: 1, label: raw.trim() || "Unknown" });
        }
      });
      return Array.from(map.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    }

    const topEventsLast30 = topEventsByName(recentRows);
    const topEventsThisMonth = topEventsByName(currentMonthRows);
    const topEventsLastMonth = topEventsByName(lastMonthRows);

    const normalizeSource = (r: ReservationRow) => {
      const raw = r.aff_partner_tracking_code;
      if (!raw || typeof raw !== "string" || raw.trim() === "")
        return "Organic";
      return raw;
    };
    const topSourcesLast30 = topCounts(recentRows, normalizeSource);
    const topSourcesThisMonth = topCounts(currentMonthRows, normalizeSource);
    const topSourcesLastMonth = topCounts(lastMonthRows, normalizeSource);

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
    };
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    throw error;
  }
}

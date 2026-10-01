"use server";

/**
 * The dashboard of a tours company (/tours) - the counterpart of the Mega
 * Events dashboard, drawn with the same cards (components/dashboard/*).
 * Read only. Every query is scoped to the active company.
 *
 * "Reservations" are the sales rows operations type in
 * (tours.departure_sales_entries): a row with +pax is a booking, a row with
 * -pax gives seats back and is not counted as a reservation.
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { toursDb } from "@/lib/tours/db";
import { addDays, todayIso } from "@/lib/tours/deadlines";
import { dailySeries, seriesWindow } from "@/lib/dashboard-series";
import { LEAD_KIND_LABELS } from "@/types/tours.types";
import type { ActionResult } from "@/lib/tours/action-kit";
import type { TopItem } from "@/components/dashboard/top-list-card";
import type { TrendPoint, TrendRange } from "@/components/dashboard/trend-chart";

/** "Soon" for departures, in days. */
const DEPARTURES_WINDOW_DAYS = 60;
/** departure_stats is asked for these many departures at a time (the ids travel in the URL). */
const STATS_CHUNK = 100;
/** Rows a dashboard list or count may read; past it the number is marked as cut. */
const ROWS_MAX = 20000;
/** Lines of a top list - the Mega Events dashboard shows three. */
const TOP_N = 3;

export interface Tally {
  /** Reservation rows (bookings). */
  count: number;
  /** Travelers on those rows. */
  travelers: number;
}

export interface ToursDashboard {
  /** yyyy-mm-dd in Israel - what "future" and "this month" were measured from. */
  today: string;
  departuresWindowDays: number;
  /** Tour pages with at least one published departure still to come. */
  toursOnSale: number;
  publishedDepartures: number;
  departuresInWindow: number;
  publishedInWindow: number;
  /** Over published future departures that fly: seats on live blocks, and what is left of them. */
  seatsAllocated: number;
  seatsLeft: number;
  reservationsTotal: Tally;
  reservationsLastMonth: Tally;
  reservationsThisMonth: Tally;
  reservationsLast7: Tally;
  reservationsLast30: Tally;
  newLeads: number;
  leadsLast7: number;
  leadsLast30: number;
  topToursByReservations: TopItem[];
  topToursByLeads: TopItem[];
  leadsByType: TopItem[];
  /** A list or count hit ROWS_MAX - the numbers are a floor, not the total. */
  truncated: boolean;
}

const top = (counts: Map<string, number>): TopItem[] =>
  [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_N)
    .map(([label, count]) => ({ label, count }));

const bump = (counts: Map<string, number>, key: string, by = 1) =>
  counts.set(key, (counts.get(key) ?? 0) + by);

/** First day of the month `months` before the month of `today` (yyyy-mm-dd). */
function monthStart(today: string, months = 0): string {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - months, 1));
  return d.toISOString().slice(0, 10);
}

/** The tour page a site lead was sent from: /package/<slug>/... */
function packageSlugOf(sourcePath: string | null): string | null {
  const match = /^\/package\/([^/?#]+)/.exec(sourcePath ?? "");
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export async function getToursDashboard(): Promise<ActionResult<ToursDashboard>> {
  const { company } = await requireCompany("tours");
  const today = todayIso();
  const windowEnd = addDays(today, DEPARTURES_WINDOW_DAYS);
  const thisMonth = monthStart(today);
  const lastMonth = monthStart(today, 1);
  const last30 = addDays(today, -30);
  const last7 = addDays(today, -7);

  try {
    const [published, windowCount, packages, bookings, recentLeads, newLeads] = await Promise.all([
      fetchPaged<{ id: string; package_id: string | null; start_date: string; flight_mode: string }>(
        () =>
          toursDb()
            .from("departures")
            .select("id, package_id, start_date, flight_mode")
            .eq("company_id", company.id)
            .eq("is_published", true)
            .is("is_deleted", null)
            .gte("start_date", today)
            .order("start_date", { ascending: true }),
        ROWS_MAX,
      ),
      toursDb()
        .from("departures")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .is("is_deleted", null)
        .gte("start_date", today)
        .lte("start_date", windowEnd),
      fetchPaged<{ id: string; slug: string; name: string }>(
        () => toursDb().from("packages").select("id, slug, name").eq("company_id", company.id).order("id"),
        ROWS_MAX,
      ),
      fetchPaged<{
        id: string;
        pax: number;
        created_at: string;
        departures: { package_id: string | null } | null;
      }>(
        () =>
          toursDb()
            .from("departure_sales_entries")
            .select("id, pax, created_at, departures(package_id)")
            .eq("company_id", company.id)
            .is("is_deleted", null)
            .gt("pax", 0)
            .order("created_at", { ascending: false }),
        ROWS_MAX,
      ),
      fetchPaged<{ id: string; kind: string; source_path: string | null; created_at: string }>(
        () =>
          supabaseTyped
            .from("leads")
            .select("id, kind, source_path, created_at")
            .eq("company_id", company.id)
            .gte("created_at", last30)
            .order("created_at", { ascending: false }),
        ROWS_MAX,
      ),
      supabaseTyped
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .eq("status", "new"),
    ]);
    for (const [where, res] of [
      ["departures", published],
      ["packages", packages],
      ["reservations", bookings],
      ["leads", recentLeads],
    ] as const) {
      if (res.error) throw new Error(`${where}: ${res.error.message}`);
    }
    if (windowCount.error) throw new Error(`departures count: ${windowCount.error.message}`);
    if (newLeads.error) throw new Error(`new leads: ${newLeads.error.message}`);

    // --- seats on the published departures that fly
    const flying = published.rows.filter((d) => d.flight_mode !== "none").map((d) => d.id);
    let seatsAllocated = 0;
    let seatsLeft = 0;
    for (let i = 0; i < flying.length; i += STATS_CHUNK) {
      const { data, error } = await toursDb()
        .from("departure_stats")
        .select("allocated_seats, remaining")
        .eq("company_id", company.id)
        .in("departure_id", flying.slice(i, i + STATS_CHUNK));
      if (error) throw new Error(`departure_stats: ${error.message}`);
      for (const row of data) {
        seatsAllocated += row.allocated_seats ?? 0;
        // An oversold departure counts as none left, not as negative seats.
        seatsLeft += Math.max(0, row.remaining ?? 0);
      }
    }

    // --- reservations
    const packageName = new Map(packages.rows.map((p) => [p.id, p.name]));
    const tally = (from: string, until?: string): Tally => {
      const rows = bookings.rows.filter(
        (r) => r.created_at.slice(0, 10) >= from && (!until || r.created_at.slice(0, 10) < until),
      );
      return { count: rows.length, travelers: rows.reduce((sum, r) => sum + r.pax, 0) };
    };
    const toursByReservations = new Map<string, number>();
    for (const row of bookings.rows) {
      if (row.created_at.slice(0, 10) < last30) continue;
      const name = packageName.get(row.departures?.package_id ?? "") ?? "Unknown tour";
      bump(toursByReservations, name, row.pax);
    }

    // --- leads
    const packageBySlug = new Map(packages.rows.map((p) => [p.slug, p.name]));
    const toursByLeads = new Map<string, number>();
    const leadsByType = new Map<string, number>();
    for (const lead of recentLeads.rows) {
      bump(leadsByType, LEAD_KIND_LABELS[lead.kind] ?? lead.kind);
      const slug = packageSlugOf(lead.source_path);
      if (slug) bump(toursByLeads, packageBySlug.get(slug) ?? slug);
    }

    return {
      success: true,
      data: {
        today,
        departuresWindowDays: DEPARTURES_WINDOW_DAYS,
        toursOnSale: new Set(published.rows.map((d) => d.package_id).filter(Boolean)).size,
        publishedDepartures: published.rows.length,
        departuresInWindow: windowCount.count ?? 0,
        publishedInWindow: published.rows.filter((d) => d.start_date <= windowEnd).length,
        seatsAllocated,
        seatsLeft,
        reservationsTotal: tally("0000-01-01"),
        reservationsLastMonth: tally(lastMonth, thisMonth),
        reservationsThisMonth: tally(thisMonth),
        reservationsLast7: tally(last7),
        reservationsLast30: tally(last30),
        newLeads: newLeads.count ?? 0,
        leadsLast7: recentLeads.rows.filter((l) => l.created_at.slice(0, 10) >= last7).length,
        leadsLast30: recentLeads.rows.length,
        topToursByReservations: top(toursByReservations),
        topToursByLeads: top(toursByLeads),
        leadsByType: top(leadsByType),
        truncated: [published, packages, bookings, recentLeads].some((r) => r.truncated),
      },
    };
  } catch (e) {
    console.error("getToursDashboard:", e);
    return { success: false, error: e instanceof Error ? e.message : "Failed to load the dashboard" };
  }
}

/** Site leads per day, for the dashboard chart. */
export async function getToursLeadsSeries(range: TrendRange): Promise<TrendPoint[]> {
  const { company } = await requireCompany("tours");
  const { start, end } = seriesWindow(range);
  const { rows, error } = await fetchPaged<{ id: string; created_at: string }>(
    () =>
      supabaseTyped
        .from("leads")
        .select("id, created_at")
        .eq("company_id", company.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString())
        .order("created_at", { ascending: true }),
    ROWS_MAX,
  );
  if (error) throw new Error(`leads: ${error.message}`);
  return dailySeries(
    rows.map((row) => row.created_at),
    start,
    end,
  );
}

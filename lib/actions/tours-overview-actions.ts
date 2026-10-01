"use server";

/**
 * Numbers and "needs attention" lists of the Tours landing page (/tours).
 * Read only. Every query is scoped to the active company.
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { toursDb, TOURS_PAGE_SIZE } from "@/lib/tours/db";
import { addDays, toDateOnly, todayIso } from "@/lib/tours/deadlines";
import { BLOCK_STATUSES, type BlockStatus } from "@/types/tours.types";

/** "Soon" for departures, in days. */
const DEPARTURES_WINDOW_DAYS = 60;
/** How far ahead a cancellation deadline is worth a line on the landing page, in days. */
const DEADLINE_WINDOW_DAYS = 14;
/** A cancellation deadline still matters only while the block holds seats that can be given back. */
const DEADLINE_STATUSES: BlockStatus[] = ["confirmed", "operational"];
const DEADLINE_ROWS_LIMIT = 200;
/** departure_stats is asked for these many departures at a time (the ids travel in the URL). */
const STATS_CHUNK = 100;

export interface OverviewBlockStatusCount {
  /** null = a block saved with no status yet. */
  status: BlockStatus | null;
  total: number;
  /** Of `total`, blocks whose outbound flight is today or later. */
  upcoming: number;
}

export interface OverviewDeparture {
  id: string;
  code: string;
  startDate: string;
  packageName: string | null;
}

export interface OverviewDeadline {
  flightId: number;
  status: BlockStatus;
  /** The nearest cancellation deadline inside the window. */
  deadline: string;
  deadlineKind: "first" | "last";
  airlineCode: string | null;
  flightNumber: string | null;
  from: string | null;
  to: string | null;
  departureDate: string | null;
  seriesName: string | null;
}

export interface ToursOverview {
  /** yyyy-mm-dd in Israel - what "future" and "next N days" were measured from. */
  today: string;
  departuresWindowDays: number;
  deadlineWindowDays: number;
  publishedFutureDepartures: number;
  departuresInWindow: number;
  publishedDeparturesInWindow: number;
  newLeads: number;
  blocksTotal: number;
  blocksByStatus: OverviewBlockStatusCount[];
  /** Published future departures that need a flight and have no live block. */
  departuresWithoutBlock: OverviewDeparture[];
  deadlines: OverviewDeadline[];
  /** May be larger than deadlines.length when the list was cut. */
  deadlinesTotal: number;
}

export type ToursOverviewResult =
  | { success: true; data: ToursOverview }
  | { success: false; error: string };

const isBlockStatus = (value: string | null): value is BlockStatus =>
  value !== null && (BLOCK_STATUSES as readonly string[]).includes(value);

export async function getToursOverview(): Promise<ToursOverviewResult> {
  const { company } = await requireCompany("tours");
  const today = todayIso();
  const departuresUntil = addDays(today, DEPARTURES_WINDOW_DAYS);
  const deadlinesUntil = addDays(today, DEADLINE_WINDOW_DAYS);

  try {
    // --- published departures that have not left yet (paged: the list can pass 1000)
    const published: {
      id: string;
      code: string;
      start_date: string;
      flight_mode: string;
      packages: { name: string } | null;
    }[] = [];
    for (let from = 0; ; from += TOURS_PAGE_SIZE) {
      const { data, error } = await toursDb()
        .from("departures")
        .select("id, code, start_date, flight_mode, packages(name)")
        .eq("company_id", company.id)
        .eq("is_published", true)
        .is("is_deleted", null)
        .gte("start_date", today)
        .order("start_date", { ascending: true })
        .order("code", { ascending: true })
        .range(from, from + TOURS_PAGE_SIZE - 1);
      if (error) throw new Error(`departures: ${error.message}`);
      published.push(...data);
      if (data.length < TOURS_PAGE_SIZE) break;
    }

    // --- which of them have no live flight block (a land-only departure needs none)
    const needFlight = published.filter((d) => d.flight_mode !== "none");
    const withoutBlock = new Set<string>();
    for (let i = 0; i < needFlight.length; i += STATS_CHUNK) {
      const ids = needFlight.slice(i, i + STATS_CHUNK).map((d) => d.id);
      const { data, error } = await toursDb()
        .from("departure_stats")
        .select("departure_id")
        .eq("company_id", company.id)
        .eq("live_blocks", 0)
        .in("departure_id", ids);
      if (error) throw new Error(`departure_stats: ${error.message}`);
      for (const row of data) if (row.departure_id) withoutBlock.add(row.departure_id);
    }

    // --- every flight block of the company, counted by status (paged)
    const blockRows: { block_status: string | null; outbound_departure_time: string | null }[] = [];
    for (let from = 0; ; from += TOURS_PAGE_SIZE) {
      const { data, error } = await supabaseTyped
        .from("flights")
        .select("block_status, outbound_departure_time")
        .eq("company_id", company.id)
        .not("is_deleted", "is", true)
        .order("id", { ascending: true })
        .range(from, from + TOURS_PAGE_SIZE - 1);
      if (error) throw new Error(`flights: ${error.message}`);
      blockRows.push(...data);
      if (data.length < TOURS_PAGE_SIZE) break;
    }
    const byStatus = new Map<BlockStatus | null, OverviewBlockStatusCount>();
    for (const row of blockRows) {
      const status = isBlockStatus(row.block_status) ? row.block_status : null;
      const entry = byStatus.get(status) ?? { status, total: 0, upcoming: 0 };
      entry.total += 1;
      const day = toDateOnly(row.outbound_departure_time);
      if (day && day >= today) entry.upcoming += 1;
      byStatus.set(status, entry);
    }
    const blocksByStatus = [...BLOCK_STATUSES, null]
      .map((status) => byStatus.get(status))
      .filter((entry): entry is OverviewBlockStatusCount => entry !== undefined);

    // --- the rest in parallel: two counts and the cancellation deadlines
    const inWindow = (column: string) =>
      `and(${column}.gte.${today},${column}.lte.${deadlinesUntil})`;
    const [windowCount, leadsCount, deadlineRows] = await Promise.all([
      toursDb()
        .from("departures")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .is("is_deleted", null)
        .gte("start_date", today)
        .lte("start_date", departuresUntil),
      supabaseTyped
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .eq("status", "new"),
      supabaseTyped
        .from("flights")
        .select(
          "id, block_status, airline_code, outbound_flight_number, outbound_departure_airport, outbound_arrival_airport, outbound_departure_time, first_cancellation_date, last_cancellation_date, series_name",
          { count: "exact" },
        )
        .eq("company_id", company.id)
        .not("is_deleted", "is", true)
        .in("block_status", DEADLINE_STATUSES)
        .or(`${inWindow("first_cancellation_date")},${inWindow("last_cancellation_date")}`)
        .order("id", { ascending: true })
        .limit(DEADLINE_ROWS_LIMIT),
    ]);
    if (windowCount.error) throw new Error(`departures count: ${windowCount.error.message}`);
    if (leadsCount.error) throw new Error(`leads: ${leadsCount.error.message}`);
    if (deadlineRows.error) throw new Error(`flight deadlines: ${deadlineRows.error.message}`);

    const within = (date: string | null) => !!date && date >= today && date <= deadlinesUntil;
    const deadlines: OverviewDeadline[] = [];
    for (const row of deadlineRows.data) {
      if (!isBlockStatus(row.block_status)) continue;
      // The first deadline comes first in time; when both are in the window the nearer one is shown.
      const kind = within(row.first_cancellation_date) ? "first" : "last";
      const deadline = kind === "first" ? row.first_cancellation_date : row.last_cancellation_date;
      if (!deadline) continue;
      deadlines.push({
        flightId: row.id,
        status: row.block_status,
        deadline,
        deadlineKind: kind,
        airlineCode: row.airline_code,
        flightNumber: row.outbound_flight_number,
        from: row.outbound_departure_airport,
        to: row.outbound_arrival_airport,
        departureDate: toDateOnly(row.outbound_departure_time),
        seriesName: row.series_name,
      });
    }
    deadlines.sort((a, b) => a.deadline.localeCompare(b.deadline) || a.flightId - b.flightId);

    return {
      success: true,
      data: {
        today,
        departuresWindowDays: DEPARTURES_WINDOW_DAYS,
        deadlineWindowDays: DEADLINE_WINDOW_DAYS,
        publishedFutureDepartures: published.length,
        departuresInWindow: windowCount.count ?? 0,
        publishedDeparturesInWindow: published.filter((d) => d.start_date <= departuresUntil).length,
        newLeads: leadsCount.count ?? 0,
        blocksTotal: blockRows.length,
        blocksByStatus,
        departuresWithoutBlock: needFlight
          .filter((d) => withoutBlock.has(d.id))
          .map((d) => ({
            id: d.id,
            code: d.code,
            startDate: d.start_date,
            packageName: d.packages?.name ?? null,
          })),
        deadlines,
        deadlinesTotal: deadlineRows.count ?? deadlines.length,
      },
    };
  } catch (e) {
    console.error("getToursOverview:", e);
    return { success: false, error: e instanceof Error ? e.message : "טעינת הנתונים נכשלה" };
  }
}

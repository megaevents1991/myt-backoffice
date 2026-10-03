/**
 * A sub-tour follows its flight (mega-family docs/plans/TOUR-SETUP-FLOW-PLAN.md,
 * section D). Called by the flight update actions of Offline Flights
 * (updateOfflineFlight, bulkUpdateOfflineFlights) after a flight of a tours
 * company was saved with other dates - the same place where a Mega Events
 * flight pushes its dates to its events.
 *
 * Only departures created from the flight (`origin_flight_id`) follow it. The
 * rule is flightMoveDecision (lib/tours/sub-tours.ts): nobody bought the date ->
 * its dates, code and season year move; sales, bookings or a code that belongs
 * to another departure -> nothing moves and a task opens on the company's board,
 * once per date the flight moved to. Approvals lists every sub-tour whose dates
 * left its flight, whatever path changed the flight.
 *
 * Never throws: the flight is already saved, and a failure here is logged and
 * caught by the Approvals list.
 */
import { logAudit } from "@/lib/audit";
import type { Company } from "@/lib/company";
import { PLAIN_TASK_BOARD } from "@/lib/services/task-company";
import { tasksOf, type TaskResult } from "@/lib/tasks-scope";
import { must } from "@/lib/tours/action-kit";
import { companyAudit } from "@/lib/tours/company-kit";
import { toursDb } from "@/lib/tours/db";
import { fmtDate } from "@/lib/tours/format";
import { departureHref } from "@/lib/tours/links";
import { flightMoveDecision, subTourFromFlight, type FlightSpanInput } from "@/lib/tours/sub-tours";
import type { TaskSourceRef } from "@/types/task.types";

/** Bookings in these statuses hold nobody's seat. */
const BOOKING_GONE = new Set(["cancelled", "failed"]);

type MovedFlight = FlightSpanInput & { id: number };

interface SubTour {
  id: string;
  code: string;
  start_date: string;
  end_date: string;
  season_year: number;
  series_id: string;
  origin_flight_id: number;
}

export async function syncSubToursFromFlights(
  company: Company,
  actorId: string | null,
  flights: MovedFlight[],
): Promise<{ moved: string[]; tasks: string[] }> {
  const out = { moved: [] as string[], tasks: [] as string[] };
  try {
    const byId = new Map(flights.filter((f) => Number.isInteger(f.id)).map((f) => [f.id, f]));
    if (byId.size === 0) return out;
    const db = toursDb();
    const deps = (must(
      await db
        .from("departures")
        .select("id, code, start_date, end_date, season_year, series_id, origin_flight_id")
        .eq("company_id", company.id)
        .is("is_deleted", null)
        .in("origin_flight_id", [...byId.keys()]),
    ) ?? []) as SubTour[];
    if (deps.length === 0) return out;

    const depIds = deps.map((d) => d.id);
    const [series, sales, bookings] = await Promise.all([
      db.from("series").select("id, code").eq("company_id", company.id).in("id", [...new Set(deps.map((d) => d.series_id))]),
      db.from("departure_sales_entries").select("departure_id").eq("company_id", company.id).is("is_deleted", null).in("departure_id", depIds),
      db.from("bookings").select("departure_id, status").eq("company_id", company.id).is("is_deleted", null).in("departure_id", depIds),
    ]);
    const seriesCode = new Map((must(series) ?? []).map((s) => [s.id, s.code as string]));
    const sold = new Set<string>((must(sales) ?? []).map((s) => s.departure_id as string));
    for (const b of must(bookings) ?? []) if (!BOOKING_GONE.has(String(b.status))) sold.add(b.departure_id as string);

    // the codes the sub-tours would move to, and who holds them now
    const targets = new Map<string, { code: string; year: number }>();
    for (const d of deps) {
      const code = seriesCode.get(d.series_id);
      const f = byId.get(d.origin_flight_id);
      if (!code || !f) continue;
      const draft = subTourFromFlight(code, {
        ...f,
        outbound_arrival_airport: null,
        inbound_departure_airport: null,
        initial_quantity: 0,
        season_label: null,
      });
      if (!("error" in draft)) targets.set(d.id, { code: draft.code, year: draft.seasonYear });
    }
    const holders = new Map<string, string[]>();
    const codes = [...new Set([...targets.values()].map((t) => t.code))];
    if (codes.length) {
      const rows =
        must(await db.from("departures").select("id, code, season_year").eq("company_id", company.id).in("code", codes)) ?? [];
      for (const r of rows) {
        const key = `${r.code}|${r.season_year}`;
        holders.set(key, [...(holders.get(key) ?? []), r.id as string]);
      }
    }

    for (const d of deps) {
      const code = seriesCode.get(d.series_id);
      const f = byId.get(d.origin_flight_id);
      if (!code || !f) continue;
      const decision = flightMoveDecision(d, code, f, {
        hasSales: sold.has(d.id),
        codeTaken: (c, y) => (holders.get(`${c}|${y}`) ?? []).some((id) => id !== d.id),
      });
      if (decision.kind === "none") continue;

      if (decision.kind === "move") {
        const { error } = await db
          .from("departures")
          .update({ start_date: decision.start, end_date: decision.end, code: decision.code, season_year: decision.seasonYear })
          .eq("company_id", company.id)
          .eq("id", d.id);
        if (!error) {
          await logAudit({
            action: "update",
            entityType: "tours_departure",
            entityId: d.id,
            changes: { start_date: decision.start, end_date: decision.end, code: decision.code, season_year: decision.seasonYear },
            metadata: { ...companyAudit(company), code: d.code, source: "flight_moved", flight_id: d.origin_flight_id },
          });
          out.moved.push(decision.code);
          continue;
        }
        if (error.code !== "23505") throw new Error(error.message);
        // someone took the code in between: the same as a taken code
      }

      const reason = decision.kind === "task" ? decision.reason : "code_taken";
      const id = await openTask(company, actorId, d, { start: decision.start, end: decision.end, code: decision.code, reason });
      if (id) out.tasks.push(id);
    }
  } catch (e) {
    console.error("[flight-sync] sub-tours did not follow their flights:", e instanceof Error ? e.message : e);
  }
  return out;
}

/** One task per sub-tour and date the flight moved to; null when it exists already. */
async function openTask(
  company: Company,
  actorId: string | null,
  d: SubTour,
  move: { start: string; end: string; code: string; reason: "sales" | "code_taken" },
): Promise<string | null> {
  const ref: TaskSourceRef = {
    kind: `subtour_flight_moved:${move.start}:${move.end}`,
    table: "departures",
    row_id: d.id,
    label: d.code,
    url: departureHref(d.code, "flights"),
  };
  const { data: existing, error: readError } = (await tasksOf(company)
    .select("id")
    .eq("source_ref->>table", "departures")
    .eq("source_ref->>row_id", d.id)
    .eq("source_ref->>kind", ref.kind)
    .limit(1)) as TaskResult<{ id: string }[]>;
  if (readError) throw new Error(readError.message);
  if ((existing ?? []).length) return null;

  const why =
    move.reason === "sales"
      ? "The sub-tour has customers, so its dates were not changed."
      : `Code ${move.code} already belongs to another departure, so the sub-tour was not moved.`;
  const { data, error } = (await tasksOf(company)
    .insert({
      title: `${company.name}: the flight of ${d.code} moved to ${fmtDate(move.start)} - check the sub-tour`,
      description: [
        `The flight block #${d.origin_flight_id} now flies out on ${fmtDate(move.start)} and back on ${fmtDate(move.end)}.`,
        `Sub-tour ${d.code}: ${fmtDate(d.start_date)} - ${fmtDate(d.end_date)}.`,
        why,
        move.reason === "sales"
          ? "Tell the customers, then change the sub-tour's dates on its card (or move the flight back)."
          : "Fix the codes on the Departures board, then change the sub-tour's dates on its card.",
      ].join("\n"),
      priority: "high",
      assignee_id: actorId,
      created_by: actorId,
      source: "manual",
      source_ref: ref,
      board: PLAIN_TASK_BOARD,
    })
    .select("id")) as TaskResult<{ id: string }[]>;
  if (error) throw new Error(error.message);
  return data?.[0]?.id ?? null;
}

"use server";

/**
 * Reports and data problems of a tours company (functional spec 5.8, 5.9).
 *
 * Everything is computed live from the database on every load - nothing here is
 * stored. All reads carry the company filter; the views (tours.flight_realization,
 * tours.departure_stats) expose company_id for exactly that.
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { toursDb } from "@/lib/tours/db";
import { fetchPaged } from "@/lib/supabase-paged";
import { logAudit } from "@/lib/audit";
import { notifyTasksAssigned, type TaskMailOutcome } from "@/lib/services/task-notify";
import { checkBlockFitsDeparture, departureRouteLabel, flightRouteLabel } from "@/lib/tours/routes";
import {
  DEADLINE_FIELDS,
  DEADLINE_LABELS,
  addDays,
  daysBetween,
  formatDateShort,
  toDateOnly,
  todayIso,
  type DeadlineField,
} from "@/lib/tours/deadlines";
import { stageLabel } from "@/components/tours/flights/block-rules";
import { STAFF_ROLES, type Role } from "@/types/auth.types";
import { LIVE_BLOCK_STATUSES } from "@/types/tours.types";
import type { TaskSourceRef } from "@/types/task.types";
import type { ToursResult } from "@/lib/actions/tours-flight-actions";

// ------------------------------------------------------------------ types

export interface RealizationRow {
  /** First day of the month, `yyyy-mm-dd`. */
  month: string;
  airline_code: string;
  groups_ordered: number;
  pax_ordered: number;
  groups_realized: number;
  seats_realized: number;
  groups_cancelled: number;
  fees_paid: number;
  potential_cost: number;
  actual_cost: number;
}

export interface UpcomingDeadline {
  flight_id: number;
  field: DeadlineField;
  label: string;
  date: string;
  days_left: number;
  /** The timeline already shows it was dealt with (names sent / ticketed). */
  done: boolean;
  status: string | null;
  route: string;
  outbound_date: string;
  airline_code: string;
  pnr: string | null;
  season_label: string | null;
  seats: number;
}

export interface PoolBlock {
  id: number;
  status: string | null;
  route: string;
  outbound_date: string;
  inbound_date: string;
  airline_code: string;
  seats: number;
  pnr: string | null;
  series_name: string | null;
}

export interface PoolGroup {
  /** The season label, or "" for blocks that carry none. */
  label: string;
  seats: number;
  blocks: PoolBlock[];
}

export interface ToursReportsData {
  today: string;
  year: number;
  /** Years that have flight blocks - the year filter of the realisation table. */
  years: number[];
  realization: RealizationRow[];
  deadlines: UpcomingDeadline[];
  pool: PoolGroup[];
}

export interface DepartureProblem {
  departure_id: string;
  code: string;
  start_date: string;
  end_date: string;
  route: string;
  is_published: boolean;
  detail: string | null;
}

export interface AllocationProblem {
  allocation_id: string;
  flight_id: number;
  flight_route: string;
  flight_date: string;
  departure_code: string;
  departure_date: string;
  seats: number;
  detail: string;
}

export interface BlockProblem {
  flight_id: number;
  status: string | null;
  route: string;
  outbound_date: string;
  airline_code: string;
  detail: string;
}

export interface DataProblems {
  today: string;
  includePast: boolean;
  /** Published departures that no live flight block serves. */
  noLiveBlock: DepartureProblem[];
  /** Departures whose every allocated block was cancelled or declined. */
  allBlocksDead: DepartureProblem[];
  /** Allocations whose flight date is not the departure's date. */
  dateMismatch: AllocationProblem[];
  /** Allocations whose block lands or returns in another city than the departure. */
  routeMismatch: AllocationProblem[];
  /** Departures with no price for an adult in a double room. */
  noDoublePrice: DepartureProblem[];
  /** Departures that sold more seats than their live blocks hold. */
  negativeRemaining: DepartureProblem[];
  /** Confirmed / operational blocks with no PNR or no contract. */
  blocksMissingData: BlockProblem[];
}

// ------------------------------------------------------------------ helpers

const ROWS_MAX = 50_000;
const UPCOMING_DAYS = 30;
/** A task opens this many days before a deadline (functional spec 4.3). */
const DEADLINE_TASK_LEAD_DAYS = 7;
const DEAD_STATUSES: readonly string[] = ["cancelled", "declined"];
const IN_CHUNK = 200;

const fail = (error: string): { success: false; error: string } => ({ success: false, error });

function dbFail(where: string, error: unknown): { success: false; error: string } {
  console.error(`tours-reports-actions: ${where} failed`, JSON.stringify(error));
  return fail("טעינת הנתונים נכשלה. נסו שוב, ואם זה חוזר פנו לתמיכה.");
}

// One literal so the typed client can parse the column list.
const REPORT_BLOCK_COLUMNS =
  "id,block_status,airline_code,outbound_departure_airport,outbound_arrival_airport,inbound_departure_airport,inbound_arrival_airport,outbound_departure_time,inbound_departure_time,pnr,contract_id,season_label,series_name,initial_quantity,first_cancellation_date,last_cancellation_date,names_deadline,ticketing_deadline,payment_deadline,option_expiry";

interface ReportBlock {
  id: number;
  block_status: string | null;
  airline_code: string;
  outbound_departure_airport: string;
  outbound_arrival_airport: string;
  inbound_departure_airport: string;
  inbound_arrival_airport: string;
  outbound_departure_time: string;
  inbound_departure_time: string;
  pnr: string | null;
  contract_id: string | null;
  season_label: string | null;
  series_name: string | null;
  initial_quantity: number;
  first_cancellation_date: string | null;
  last_cancellation_date: string | null;
  names_deadline: string | null;
  ticketing_deadline: string | null;
  payment_deadline: string | null;
  option_expiry: string | null;
}

/** Blocks of the company that are not deleted. `fromDate` keeps only flights that depart on or after it. */
async function loadBlocks(companyId: string, fromDate: string | null) {
  return fetchPaged<ReportBlock>(() => {
    const query = supabaseTyped
      .from("flights")
      .select(REPORT_BLOCK_COLUMNS)
      .eq("company_id", companyId)
      .eq("is_deleted", false);
    return (fromDate ? query.gte("outbound_departure_time", fromDate) : query).order("id", { ascending: true });
  }, ROWS_MAX);
}

interface AllocationRow {
  id: string;
  flight_id: number;
  departure_id: string;
  seats: number;
  legs: string;
}

async function loadAllocations(companyId: string) {
  return fetchPaged<AllocationRow>(
    () =>
      toursDb()
        .from("flight_allocations")
        .select("id,flight_id,departure_id,seats,legs")
        .eq("company_id", companyId)
        .order("id", { ascending: true }),
    ROWS_MAX,
  );
}

/** Flight ids whose timeline has a "names sent" or a "ticketed" row. */
async function loadDoneMarks(flightIds: number[]): Promise<{ names: Set<number>; ticketed: Set<number> }> {
  const names = new Set<number>();
  const ticketed = new Set<number>();
  for (let i = 0; i < flightIds.length; i += IN_CHUNK) {
    const { data, error } = await supabaseTyped
      .from("flight_block_events")
      .select("flight_id,kind")
      .in("flight_id", flightIds.slice(i, i + IN_CHUNK))
      .in("kind", ["names_sent", "ticketed"]);
    if (error) {
      console.error("tours-reports-actions: done marks read failed", JSON.stringify(error));
      continue;
    }
    for (const row of data ?? []) (row.kind === "names_sent" ? names : ticketed).add(row.flight_id);
  }
  return { names, ticketed };
}

/** Deadlines of live blocks that fall between `today` and `today + days`, soonest first. */
async function upcomingDeadlines(
  companyId: string,
  today: string,
  days: number,
): Promise<{ rows: UpcomingDeadline[] } | { error: unknown }> {
  const blocks = await loadBlocks(companyId, today);
  if (blocks.error) return { error: blocks.error };
  const live = blocks.rows.filter((b) => b.block_status && (LIVE_BLOCK_STATUSES as string[]).includes(b.block_status));
  const until = addDays(today, days);

  const hits: { block: ReportBlock; field: DeadlineField; date: string }[] = [];
  for (const block of live) {
    for (const field of DEADLINE_FIELDS) {
      const date = toDateOnly(block[field]);
      if (date && date >= today && date <= until) hits.push({ block, field, date });
    }
  }
  const done = await loadDoneMarks([...new Set(hits.map((h) => h.block.id))]);

  const rows = hits
    .map(({ block, field, date }) => ({
      flight_id: block.id,
      field,
      label: DEADLINE_LABELS[field],
      date,
      days_left: daysBetween(today, date),
      done:
        (field === "names_deadline" && done.names.has(block.id)) ||
        (field === "ticketing_deadline" && (block.block_status === "ticketed" || done.ticketed.has(block.id))),
      status: block.block_status,
      route: flightRouteLabel(block),
      outbound_date: toDateOnly(block.outbound_departure_time) ?? "",
      airline_code: block.airline_code,
      pnr: block.pnr,
      season_label: block.season_label,
      seats: block.initial_quantity,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.flight_id - b.flight_id);
  return { rows };
}

// ------------------------------------------------------------------ reports

/** The three reports of /tours/reports. `year` filters the realisation table only. */
export async function getToursReports(year?: number): Promise<ToursResult<ToursReportsData>> {
  const { company } = await requireCompany("tours");
  const today = todayIso();

  // Years that have blocks: the first and the last flight of the company.
  const edge = (ascending: boolean) =>
    supabaseTyped
      .from("flights")
      .select("outbound_departure_time")
      .eq("company_id", company.id)
      .eq("is_deleted", false)
      .order("outbound_departure_time", { ascending })
      .limit(1)
      .maybeSingle();
  const [first, last] = await Promise.all([edge(true), edge(false)]);
  if (first.error) return dbFail("years", first.error);
  if (last.error) return dbFail("years", last.error);
  const currentYear = Number(today.slice(0, 4));
  const firstYear = Number(first.data?.outbound_departure_time.slice(0, 4) ?? currentYear);
  const lastYear = Number(last.data?.outbound_departure_time.slice(0, 4) ?? currentYear);
  const years: number[] = [];
  for (let y = Math.min(firstYear, currentYear); y <= Math.max(lastYear, currentYear); y++) years.push(y);
  const wanted = year !== undefined && Number.isInteger(year) && years.includes(year) ? year : currentYear;

  const [realizationRes, deadlines, blocks, allocations] = await Promise.all([
    toursDb()
      .from("flight_realization")
      .select("*")
      .eq("company_id", company.id)
      .gte("month", `${wanted}-01-01`)
      .lte("month", `${wanted}-12-31`)
      .order("month", { ascending: true })
      .order("airline_code", { ascending: true }),
    upcomingDeadlines(company.id, today, UPCOMING_DAYS),
    loadBlocks(company.id, today),
    loadAllocations(company.id),
  ]);
  if (realizationRes.error) return dbFail("realization", realizationRes.error);
  if ("error" in deadlines) return dbFail("deadlines", deadlines.error);
  if (blocks.error) return dbFail("blocks", blocks.error);
  if (allocations.error) return dbFail("allocations", allocations.error);

  const realization: RealizationRow[] = (realizationRes.data ?? []).map((r) => ({
    month: r.month ?? "",
    airline_code: r.airline_code ?? "",
    groups_ordered: r.groups_ordered ?? 0,
    pax_ordered: r.pax_ordered ?? 0,
    groups_realized: r.groups_realized ?? 0,
    seats_realized: r.seats_realized ?? 0,
    groups_cancelled: r.groups_cancelled ?? 0,
    fees_paid: Number(r.fees_paid ?? 0),
    potential_cost: Number(r.potential_cost ?? 0),
    actual_cost: Number(r.actual_cost ?? 0),
  }));

  // The pool: upcoming blocks that still hold seats in the plan and serve no departure.
  const allocated = new Set(allocations.rows.map((a) => a.flight_id));
  const groups = new Map<string, PoolGroup>();
  for (const block of blocks.rows) {
    if (allocated.has(block.id)) continue;
    if (block.block_status && DEAD_STATUSES.includes(block.block_status)) continue;
    const label = block.season_label?.trim() ?? "";
    const group = groups.get(label) ?? { label, seats: 0, blocks: [] };
    group.seats += block.initial_quantity;
    group.blocks.push({
      id: block.id,
      status: block.block_status,
      route: flightRouteLabel(block),
      outbound_date: toDateOnly(block.outbound_departure_time) ?? "",
      inbound_date: toDateOnly(block.inbound_departure_time) ?? "",
      airline_code: block.airline_code,
      seats: block.initial_quantity,
      pnr: block.pnr,
      series_name: block.series_name,
    });
    groups.set(label, group);
  }
  const pool = [...groups.values()]
    .map((g) => ({ ...g, blocks: g.blocks.sort((a, b) => a.outbound_date.localeCompare(b.outbound_date)) }))
    // Unlabelled blocks last; the rest by name.
    .sort((a, b) => (a.label === "" ? 1 : 0) - (b.label === "" ? 1 : 0) || a.label.localeCompare(b.label, "he"));

  return { success: true, data: { today, year: wanted, years, realization, deadlines: deadlines.rows, pool } };
}

// ------------------------------------------------------------------ deadline tasks

export interface DeadlineTaskAssignee {
  id: string;
  name: string;
}

/** Staff the deadline tasks may be assigned to: active members of this company, and the caller. */
async function loadAssignees(
  companyId: string,
  caller: { sub: string; email: string },
): Promise<DeadlineTaskAssignee[]> {
  const { data: members, error: membersError } = await supabaseTyped
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId);
  if (membersError) console.error("tours-reports-actions: members read failed", JSON.stringify(membersError));
  const ids = [...new Set([caller.sub, ...(members ?? []).map((m) => m.user_id)])];
  const { data: users, error: usersError } = await supabaseTyped
    .from("user_profiles")
    .select("id,display_name,email,role,is_active")
    .in("id", ids);
  if (usersError) console.error("tours-reports-actions: users read failed", JSON.stringify(usersError));
  const staff = (users ?? [])
    .filter((u) => u.is_active && STAFF_ROLES.includes(u.role as Role))
    .map((u) => ({ id: u.id, name: u.display_name?.trim() || u.email }));
  if (!staff.some((u) => u.id === caller.sub)) staff.push({ id: caller.sub, name: caller.email });
  return staff.sort((a, b) => (a.id === caller.sub ? -1 : b.id === caller.sub ? 1 : a.name.localeCompare(b.name, "he")));
}

/** Who the deadline tasks can go to. The caller comes first (the default). */
export async function getDeadlineTaskAssignees(): Promise<ToursResult<DeadlineTaskAssignee[]>> {
  const { session, company } = await requireCompany("tours");
  return { success: true, data: await loadAssignees(company.id, session) };
}

const taskKind = (field: DeadlineField) => `flight_deadline:${field}`;

/**
 * Opens a task for every deadline of a live block that falls in the next seven days
 * and has no task yet. Safe to press again: one task per block and deadline kind,
 * recognised by `source_ref` (table "flights", row_id = the block, kind = the deadline).
 *
 * The tasks table has no company column and no "flight deadline" source, so the
 * tasks are ordinary manual tasks on the operations board, assigned to one person.
 */
export async function syncDeadlineTasks(
  input: { assigneeId?: string | null } = {},
): Promise<ToursResult<{ created: number; existing: number; skippedDone: number; mail?: TaskMailOutcome }>> {
  const { session, company } = await requireCompany("tours");
  const today = todayIso();

  const assignees = await loadAssignees(company.id, session);
  const assigneeId = input.assigneeId || session.sub;
  if (!assignees.some((a) => a.id === assigneeId)) return fail("אפשר לשייך רק לאיש צוות פעיל של החברה");

  const upcoming = await upcomingDeadlines(company.id, today, DEADLINE_TASK_LEAD_DAYS);
  if ("error" in upcoming) return dbFail("deadlines", upcoming.error);
  const open = upcoming.rows.filter((d) => !d.done);
  const skippedDone = upcoming.rows.length - open.length;
  if (open.length === 0) return { success: true, data: { created: 0, existing: 0, skippedDone } };

  // Tasks that already exist for these blocks - any status, deleted ones included:
  // a task someone closed or removed must not come back on the next press.
  const taken = new Set<string>();
  const flightIds = [...new Set(open.map((d) => String(d.flight_id)))];
  for (let i = 0; i < flightIds.length; i += IN_CHUNK) {
    const { data, error } = await supabaseTyped
      .from("tasks")
      .select("source_ref")
      .eq("source_ref->>table", "flights")
      .like("source_ref->>kind", "flight_deadline:%")
      .in("source_ref->>row_id", flightIds.slice(i, i + IN_CHUNK));
    if (error) return dbFail("existing tasks", error);
    for (const row of data ?? []) {
      const ref = row.source_ref as TaskSourceRef | null;
      if (ref) taken.add(`${ref.row_id}:${ref.kind}`);
    }
  }

  const fresh = open.filter((d) => !taken.has(`${d.flight_id}:${taskKind(d.field)}`));
  if (fresh.length === 0) return { success: true, data: { created: 0, existing: open.length, skippedDone } };

  const rows = fresh.map((d) => {
    const label = `${d.airline_code} ${d.route} · ${formatDateShort(d.outbound_date)}`;
    const ref: TaskSourceRef = {
      kind: taskKind(d.field),
      table: "flights",
      row_id: d.flight_id,
      label,
      url: `/tours/flights/${d.flight_id}`,
    };
    return {
      title: `${company.name}: מועד ${d.label} ב-${formatDateShort(d.date)} · ${label}`,
      description: [
        `מועד ${d.label} של קבוצת הטיסה חל ב-${formatDateShort(d.date)} (בעוד ${d.days_left} ימים).`,
        `טיסה: ${d.airline_code} ${d.route}, יציאה ${formatDateShort(d.outbound_date)}, ${d.seats} מושבים.`,
        d.pnr ? `PNR: ${d.pnr}` : null,
        d.season_label ? `תווית: ${d.season_label}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      priority: d.days_left <= 2 ? "urgent" : "high",
      assignee_id: assigneeId,
      created_by: session.sub,
      due_date: d.date,
      source: "manual",
      source_ref: ref,
      board: "ops",
    };
  });

  const { data: inserted, error } = await supabaseTyped.from("tasks").insert(rows).select("id,title");
  if (error) return dbFail("tasks insert", error);
  const created = inserted ?? [];

  await logAudit({
    action: "tours.deadline_tasks.sync",
    entityType: "task",
    entityId: null,
    changes: { created: created.map((t) => t.id), assignee_id: assigneeId },
    metadata: { company_id: company.id },
  });

  // Same as the task board: handing tasks to someone else mails them once, with the list.
  let mail: TaskMailOutcome | undefined;
  if (assigneeId !== session.sub && created.length > 0) {
    mail = await notifyTasksAssigned({ assigneeId, titles: created.map((t) => t.title) });
  }
  return {
    success: true,
    data: { created: created.length, existing: open.length - fresh.length, skippedDone, ...(mail ? { mail } : {}) },
  };
}

// ------------------------------------------------------------------ data problems

interface ProblemDeparture {
  id: string;
  code: string;
  start_date: string;
  end_date: string;
  arrival_airport: string | null;
  return_airport: string | null;
  series_id: string;
  is_published: boolean;
  flight_mode: string;
}

/**
 * The lists of /tours/exceptions. `includePast` adds departures and flights whose
 * date already passed (off by default: nothing there can still be fixed for a customer).
 */
export async function getDataProblems(includePast = false): Promise<ToursResult<DataProblems>> {
  const { company } = await requireCompany("tours");
  const today = todayIso();
  const past = includePast === true;

  const [departures, stats, allocations, blocks, prices, seriesRes] = await Promise.all([
    fetchPaged<ProblemDeparture>(() => {
      const query = toursDb()
        .from("departures")
        .select("id,code,start_date,end_date,arrival_airport,return_airport,series_id,is_published,flight_mode")
        .eq("company_id", company.id)
        .is("is_deleted", null);
      return (past ? query : query.gte("end_date", today)).order("id", { ascending: true });
    }, ROWS_MAX),
    // The view has no `id`; fetchPaged dedupes pages by it, so the departure id stands in.
    fetchPaged<{ id: string; live_blocks: number | null; total_blocks: number | null; remaining: number | null; sold: number | null; allocated_seats: number | null }>(
      () =>
        toursDb()
          .from("departure_stats")
          .select("id:departure_id,live_blocks,total_blocks,remaining,sold,allocated_seats")
          .eq("company_id", company.id)
          .order("departure_id", { ascending: true }),
      ROWS_MAX,
    ),
    loadAllocations(company.id),
    loadBlocks(company.id, null),
    fetchPaged<{ id: string; price: number }>(
      () =>
        toursDb()
          .from("departure_prices")
          .select("id:departure_id,price")
          .eq("company_id", company.id)
          .eq("pax_type", "adult")
          .eq("room_position", 2)
          .order("departure_id", { ascending: true }),
      ROWS_MAX,
    ),
    toursDb().from("series").select("id,arrival_airport,return_airport").eq("company_id", company.id).limit(1000),
  ]);
  if (departures.error) return dbFail("departures", departures.error);
  if (stats.error) return dbFail("stats", stats.error);
  if (allocations.error) return dbFail("allocations", allocations.error);
  if (blocks.error) return dbFail("blocks", blocks.error);
  if (prices.error) return dbFail("prices", prices.error);
  if (seriesRes.error) return dbFail("series", seriesRes.error);

  const series = new Map((seriesRes.data ?? []).map((s) => [s.id, s]));
  const routeOf = (d: ProblemDeparture) => ({
    arrival_airport: d.arrival_airport ?? series.get(d.series_id)?.arrival_airport ?? null,
    return_airport: d.return_airport ?? series.get(d.series_id)?.return_airport ?? null,
  });
  const statsById = new Map(stats.rows.map((s) => [s.id, s]));
  const blockById = new Map(blocks.rows.map((b) => [b.id, b]));
  const departureById = new Map(departures.rows.map((d) => [d.id, d]));
  const priced = new Set(prices.rows.filter((p) => Number(p.price) > 0).map((p) => p.id));
  const allocationsByDeparture = new Map<string, AllocationRow[]>();
  for (const a of allocations.rows) {
    const list = allocationsByDeparture.get(a.departure_id) ?? [];
    list.push(a);
    allocationsByDeparture.set(a.departure_id, list);
  }
  const isDead = (flightId: number) => {
    const block = blockById.get(flightId);
    return !block || (block.block_status !== null && DEAD_STATUSES.includes(block.block_status));
  };

  const asProblem = (d: ProblemDeparture, detail: string | null): DepartureProblem => {
    const route = routeOf(d);
    return {
      departure_id: d.id,
      code: d.code,
      start_date: d.start_date,
      end_date: d.end_date,
      route: departureRouteLabel(route.arrival_airport, route.return_airport),
      is_published: d.is_published,
      detail,
    };
  };
  const byDate = (a: DepartureProblem, b: DepartureProblem) =>
    a.start_date.localeCompare(b.start_date) || a.code.localeCompare(b.code);

  const noLiveBlock: DepartureProblem[] = [];
  const allBlocksDead: DepartureProblem[] = [];
  const noDoublePrice: DepartureProblem[] = [];
  const negativeRemaining: DepartureProblem[] = [];
  for (const d of departures.rows) {
    const s = statsById.get(d.id);
    const own = allocationsByDeparture.get(d.id) ?? [];
    const needsFlight = d.flight_mode !== "none";
    if (d.is_published && needsFlight && (s?.live_blocks ?? 0) === 0) {
      noLiveBlock.push(asProblem(d, own.length ? `${own.length} בלוקים משויכים, אף אחד לא חי` : "אין בלוק משויך"));
    }
    if (own.length > 0 && own.every((a) => isDead(a.flight_id))) {
      allBlocksDead.push(asProblem(d, `${own.length} בלוקים משויכים, כולם בוטלו או נדחו`));
    }
    if (!priced.has(d.id)) noDoublePrice.push(asProblem(d, null));
    if ((s?.remaining ?? 0) < 0) {
      negativeRemaining.push(asProblem(d, `נמכרו ${s?.sold ?? 0}, משויכים ${s?.allocated_seats ?? 0}, יתרה ${s?.remaining}`));
    }
  }

  const dateMismatch: AllocationProblem[] = [];
  const routeMismatch: AllocationProblem[] = [];
  for (const a of allocations.rows) {
    const d = departureById.get(a.departure_id);
    const block = blockById.get(a.flight_id);
    // A cancelled block is already listed above; its dates and route no longer matter.
    if (!d || !block || isDead(a.flight_id)) continue;
    const inboundOnly = a.legs === "inbound";
    const flightDate = toDateOnly(inboundOnly ? block.inbound_departure_time : block.outbound_departure_time) ?? "";
    const departureDate = inboundOnly ? d.end_date : d.start_date;
    const base = {
      allocation_id: a.id,
      flight_id: block.id,
      flight_route: flightRouteLabel(block),
      flight_date: flightDate,
      departure_code: d.code,
      departure_date: departureDate,
      seats: a.seats,
    };
    if (flightDate && flightDate !== departureDate) {
      const gap = daysBetween(flightDate, departureDate);
      const side = inboundOnly ? "הטיסה חזרה" : "הטיסה";
      dateMismatch.push({
        ...base,
        detail: `${side} ב-${formatDateShort(flightDate)}, היציאה ב-${formatDateShort(departureDate)} (הפרש ${Math.abs(gap)} ימים)`,
      });
    }
    const legs = a.legs === "outbound" || a.legs === "inbound" ? a.legs : "both";
    const fit = checkBlockFitsDeparture(block, routeOf(d), legs);
    if (!fit.ok) routeMismatch.push({ ...base, detail: fit.reason ?? "המסלול לא תואם" });
  }
  const byFlightDate = (a: AllocationProblem, b: AllocationProblem) =>
    a.flight_date.localeCompare(b.flight_date) || a.departure_code.localeCompare(b.departure_code);

  const blocksMissingData: BlockProblem[] = [];
  for (const block of blocks.rows) {
    if (block.block_status !== "confirmed" && block.block_status !== "operational") continue;
    const outbound = toDateOnly(block.outbound_departure_time) ?? "";
    if (!past && outbound < today) continue;
    const missing = [!block.pnr?.trim() ? "PNR" : null, !block.contract_id ? "חוזה" : null].filter(Boolean);
    if (missing.length === 0) continue;
    blocksMissingData.push({
      flight_id: block.id,
      status: stageLabel(block.block_status),
      route: flightRouteLabel(block),
      outbound_date: outbound,
      airline_code: block.airline_code,
      detail: `חסר: ${missing.join(", ")}`,
    });
  }
  blocksMissingData.sort((a, b) => a.outbound_date.localeCompare(b.outbound_date) || a.flight_id - b.flight_id);

  return {
    success: true,
    data: {
      today,
      includePast: past,
      noLiveBlock: noLiveBlock.sort(byDate),
      allBlocksDead: allBlocksDead.sort(byDate),
      dateMismatch: dateMismatch.sort(byFlightDate),
      routeMismatch: routeMismatch.sort(byFlightDate),
      noDoublePrice: noDoublePrice.sort(byDate),
      negativeRemaining: negativeRemaining.sort(byDate),
      blocksMissingData,
    },
  };
}

"use server";

/**
 * Flight block operations of a tours company (functional spec 4.1-4.3, 4.5, 5.5).
 *
 * A "block" is a row of public.flights that belongs to the active company. The
 * service-role client bypasses RLS, so EVERY read and write of flights here goes
 * through `loadBlock` / `.eq("company_id", company.id)`: a block of another
 * company answers "not found", whatever id the client sends.
 *
 * The rules themselves (who may do what, what a step requires) are the pure
 * functions in components/tours/flights/block-rules.ts and lib/tours/deadlines.ts.
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { toursDb } from "@/lib/tours/db";
import { logAudit } from "@/lib/audit";
import { checkBlockFitsDeparture, departureRouteLabel } from "@/lib/tours/routes";
import {
  CONTRACT_DEADLINE_FIELDS,
  DEADLINE_FIELDS,
  DEADLINE_LABELS,
  addDays,
  computeDeadlines,
  daysBetween,
  isDateOnly,
  pickDeadlines,
  toDateOnly,
  todayIso,
  type ContractDeadlineField,
  type DeadlineField,
} from "@/lib/tours/deadlines";
import {
  ALLOCATION_LEGS,
  ALLOCATION_MAX_DAY_GAP,
  TRANSITION_EVENT_KIND,
  allocatedSeats,
  checkTransition,
  isManagerRole,
  stageOf,
  type AllocationLegs,
  type CancelledBy,
  type TransitionInput,
} from "@/components/tours/flights/block-rules";
import {
  BLOCK_STATUSES,
  BLOCK_STATUS_LABELS,
  CURRENCIES,
  LIVE_BLOCK_STATUSES,
  type BlockEventKind,
  type BlockStatus,
  type FlightBlockEvent,
  type FlightContract,
} from "@/types/tours.types";
import type { Database } from "@/types/database.types";
import { dbFail as databaseFail, plainFail as fail } from "@/lib/tours/action-kit";

const dbFail = (where: string, error: unknown) => databaseFail("tours-flight-actions", where, error);

type FlightRow = Database["public"]["Tables"]["flights"]["Row"];
type FlightUpdate = Database["public"]["Tables"]["flights"]["Update"];

export type ToursResult<T = null> =
  | { success: true; data: T; warning?: string }
  | { success: false; error: string };

// One literal (not concatenated) so the typed client can parse the column list.
const BLOCK_COLUMNS =
  "id,company_id,block_status,airline_code,inbound_airline_code,metadata_name,outbound_departure_airport,outbound_arrival_airport,inbound_departure_airport,inbound_arrival_airport,outbound_departure_time,outbound_arrival_time,inbound_departure_time,inbound_arrival_time,outbound_flight_number,inbound_flight_number,pnr,group_code,supplier,series_name,season_label,notes,initial_quantity,original_quantity,consumed_quantity,cost_price,cost_child_price,cost_tax,cost_currency,contract_id,requested_at,first_cancellation_date,last_cancellation_date,names_deadline,ticketing_deadline,payment_deadline,option_expiry,reviewed_at,reviewed_by,cancelled_at,cancel_reason,cancellation_fee";

export type TourBlock = Pick<
  FlightRow,
  | "id"
  | "company_id"
  | "block_status"
  | "airline_code"
  | "inbound_airline_code"
  | "metadata_name"
  | "outbound_departure_airport"
  | "outbound_arrival_airport"
  | "inbound_departure_airport"
  | "inbound_arrival_airport"
  | "outbound_departure_time"
  | "outbound_arrival_time"
  | "inbound_departure_time"
  | "inbound_arrival_time"
  | "outbound_flight_number"
  | "inbound_flight_number"
  | "pnr"
  | "group_code"
  | "supplier"
  | "series_name"
  | "season_label"
  | "notes"
  | "initial_quantity"
  | "original_quantity"
  | "consumed_quantity"
  | "cost_price"
  | "cost_child_price"
  | "cost_tax"
  | "cost_currency"
  | "contract_id"
  | "requested_at"
  | "first_cancellation_date"
  | "last_cancellation_date"
  | "names_deadline"
  | "ticketing_deadline"
  | "payment_deadline"
  | "option_expiry"
  | "reviewed_at"
  | "reviewed_by"
  | "cancelled_at"
  | "cancel_reason"
  | "cancellation_fee"
>;

export interface TourBlockAllocation {
  id: string;
  departure_id: string;
  code: string;
  start_date: string;
  end_date: string;
  seats: number;
  legs: AllocationLegs;
  /** "LHR → CDG" of the departure (its own route, or the series' when it has none). */
  route: string;
  is_published: boolean;
  /** Both ends checked by city; `reason` says what does not fit. */
  fits: boolean;
  fitReason: string | null;
  /** Days between the block's flight date and the departure's date (0 = same day). */
  dayGap: number;
}

export interface TourBlockEventView extends FlightBlockEvent {
  created_by_name: string | null;
}

export type TourBlockContractOption = Pick<FlightContract, "id" | "name" | "airline_group" | "kind" | "is_active">;

export interface TourBlockData {
  block: TourBlock;
  /** The block's contract (day offsets + wording), or null when none is chosen. */
  contract: FlightContract | null;
  /** Contracts of the company the block may be given. */
  contracts: TourBlockContractOption[];
  /** The company's original conditions document - shown when the contract itself has no wording. */
  sourceTerms: string | null;
  allocations: TourBlockAllocation[];
  /** Seats spoken for by departures (see allocatedSeats in block-rules). */
  allocatedSeats: number;
  /** Newest first. */
  events: TourBlockEventView[];
  reviewedByName: string | null;
  /** May the viewer do the two manager-only actions (approve to order, cancel a confirmed block) and mark "reviewed". */
  isManager: boolean;
  /** `yyyy-mm-dd` in the operators' timezone - the screen counts days left from it. */
  today: string;
}

export interface AllocatableDeparture {
  id: string;
  code: string;
  start_date: string;
  end_date: string;
  route: string;
  is_published: boolean;
  /** Seats its live blocks already hold, and what was sold. */
  allocated_seats: number;
  sold: number;
  /** Per direction: does the block fit, and if not why. */
  fit: Record<AllocationLegs, { ok: boolean; reason: string | null }>;
}

/** The row that holds the original conditions document of the company (import). */
const SOURCE_TERMS_CONTRACT_NAME = "תנאי ביטול והתחייבות (מסמך מקור)";
const NOT_FOUND = "Flight block not found";
/** Who cancelled, in the Hebrew wording the stored cancel reason has always used (data, not screen copy). */
const CANCELLED_BY_DATA_TEXT: Record<CancelledBy, string> = { airline: "חברת התעופה", us: "אנחנו" };
const EVENTS_MAX = 500;
/** Timeline kinds an operator may add by hand (the rest are written by the lifecycle actions). */
const MANUAL_EVENT_KINDS: readonly BlockEventKind[] = ["note", "quoted", "names_sent", "schedule_change"];
const EVENT_CURRENCIES: readonly string[] = [...CURRENCIES, "ILS"];

const validId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

/** A block of THIS company, or null. The company filter is what keeps other tenants' flights out. */
async function loadBlock(companyId: string, flightId: unknown): Promise<TourBlock | null> {
  if (!validId(flightId)) return null;
  const { data, error } = await supabaseTyped
    .from("flights")
    .select(BLOCK_COLUMNS)
    .eq("id", flightId)
    .eq("company_id", companyId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) {
    console.error("tours-flight-actions: block read failed", JSON.stringify(error));
    return null;
  }
  return data;
}

async function loadContract(companyId: string, contractId: string | null): Promise<FlightContract | null> {
  if (!contractId) return null;
  const { data, error } = await supabaseTyped
    .from("flight_contracts")
    .select("*")
    .eq("id", contractId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    console.error("tours-flight-actions: contract read failed", JSON.stringify(error));
    return null;
  }
  return data;
}

async function loadAllocationRows(companyId: string, flightId: number) {
  return toursDb()
    .from("flight_allocations")
    .select("id,departure_id,seats,legs,created_at")
    .eq("company_id", companyId)
    .eq("flight_id", flightId)
    .order("created_at", { ascending: true });
}

interface EventInput {
  flightId: number;
  kind: BlockEventKind;
  happenedOn: string;
  seatsAfter?: number | null;
  amount?: number | null;
  currency?: string | null;
  note?: string | null;
  createdBy: string;
}

/** Writes one timeline row. Returns false (and logs) when the insert fails. */
async function writeEvent(input: EventInput): Promise<boolean> {
  const { error } = await supabaseTyped.from("flight_block_events").insert({
    flight_id: input.flightId,
    kind: input.kind,
    happened_on: input.happenedOn,
    seats_after: input.seatsAfter ?? null,
    amount: input.amount ?? null,
    currency: input.currency ?? null,
    note: input.note?.trim() || null,
    created_by: input.createdBy,
  });
  if (error) {
    console.error("tours-flight-actions: event insert failed", JSON.stringify(error));
    return false;
  }
  return true;
}

const EVENT_NOT_WRITTEN = "The change was saved, but it was not recorded on the timeline.";

/** A date the client sent: a real `yyyy-mm-dd`, or today when nothing was sent. null = bad value. */
function dateOrToday(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return todayIso();
  return isDateOnly(value) ? value : null;
}

/** The route of a departure: its own airports, else the pattern of its series. */
function effectiveRoute(
  departure: { arrival_airport: string | null; return_airport: string | null; series_id: string },
  series: Map<string, { arrival_airport: string | null; return_airport: string | null }>,
): { arrival_airport: string | null; return_airport: string | null } {
  const pattern = series.get(departure.series_id);
  return {
    arrival_airport: departure.arrival_airport ?? pattern?.arrival_airport ?? null,
    return_airport: departure.return_airport ?? pattern?.return_airport ?? null,
  };
}

async function loadSeriesRoutes(
  companyId: string,
  seriesIds: string[],
): Promise<Map<string, { arrival_airport: string | null; return_airport: string | null }>> {
  const map = new Map<string, { arrival_airport: string | null; return_airport: string | null }>();
  const ids = [...new Set(seriesIds)];
  if (ids.length === 0) return map;
  const { data, error } = await toursDb()
    .from("series")
    .select("id,arrival_airport,return_airport")
    .eq("company_id", companyId)
    .in("id", ids);
  if (error) {
    console.error("tours-flight-actions: series read failed", JSON.stringify(error));
    return map;
  }
  for (const row of data ?? []) map.set(row.id, row);
  return map;
}

/** Days between the block's flight and the departure, on the side the allocation uses. */
function dayGapOf(
  block: Pick<TourBlock, "outbound_departure_time" | "inbound_departure_time">,
  departure: { start_date: string; end_date: string },
  legs: AllocationLegs,
): number | null {
  const flightDate = toDateOnly(legs === "inbound" ? block.inbound_departure_time : block.outbound_departure_time);
  const tripDate = toDateOnly(legs === "inbound" ? departure.end_date : departure.start_date);
  if (!flightDate || !tripDate) return null;
  return daysBetween(flightDate, tripDate);
}

const asLegs = (value: string): AllocationLegs =>
  (ALLOCATION_LEGS as readonly string[]).includes(value) ? (value as AllocationLegs) : "both";

// ------------------------------------------------------------------ read

/** Everything the block panel shows. */
export async function getTourBlock(flightId: number): Promise<ToursResult<TourBlockData>> {
  const { session, company } = await requireCompany("tours");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);

  const [contractsRes, allocRes, eventsRes] = await Promise.all([
    supabaseTyped.from("flight_contracts").select("*").eq("company_id", company.id).order("name", { ascending: true }),
    loadAllocationRows(company.id, block.id),
    supabaseTyped
      .from("flight_block_events")
      .select("*")
      .eq("flight_id", block.id)
      .order("happened_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(EVENTS_MAX),
  ]);
  if (contractsRes.error) return dbFail("contracts read", contractsRes.error);
  if (allocRes.error) return dbFail("allocations read", allocRes.error);
  if (eventsRes.error) return dbFail("events read", eventsRes.error);

  const allContracts = contractsRes.data ?? [];
  const contract = allContracts.find((c) => c.id === block.contract_id) ?? null;
  const sourceTerms = allContracts.find((c) => c.name === SOURCE_TERMS_CONTRACT_NAME)?.terms_text ?? null;
  const contracts: TourBlockContractOption[] = allContracts
    .filter((c) => (c.is_active && c.name !== SOURCE_TERMS_CONTRACT_NAME) || c.id === block.contract_id)
    .map((c) => ({ id: c.id, name: c.name, airline_group: c.airline_group, kind: c.kind, is_active: c.is_active }));

  // Departures this block serves.
  const allocRows = allocRes.data ?? [];
  const allocations: TourBlockAllocation[] = [];
  if (allocRows.length > 0) {
    const { data: departures, error: depError } = await toursDb()
      .from("departures")
      .select("id,code,start_date,end_date,arrival_airport,return_airport,series_id,is_published")
      .eq("company_id", company.id)
      .in("id", [...new Set(allocRows.map((a) => a.departure_id))]);
    if (depError) return dbFail("departures read", depError);
    const byId = new Map((departures ?? []).map((d) => [d.id, d]));
    const series = await loadSeriesRoutes(company.id, (departures ?? []).map((d) => d.series_id));
    for (const row of allocRows) {
      const departure = byId.get(row.departure_id);
      if (!departure) continue;
      const legs = asLegs(row.legs);
      const route = effectiveRoute(departure, series);
      const check = checkBlockFitsDeparture(block, route, legs);
      allocations.push({
        id: row.id,
        departure_id: row.departure_id,
        code: departure.code,
        start_date: departure.start_date,
        end_date: departure.end_date,
        seats: row.seats,
        legs,
        route: departureRouteLabel(route.arrival_airport, route.return_airport),
        is_published: departure.is_published,
        fits: check.ok,
        fitReason: check.reason ?? null,
        dayGap: dayGapOf(block, departure, legs) ?? 0,
      });
    }
    allocations.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.code.localeCompare(b.code));
  }

  // Who wrote each event, who reviewed the row.
  const eventRows = eventsRes.data ?? [];
  const userIds = [
    ...new Set([...eventRows.map((e) => e.created_by), block.reviewed_by].filter((id): id is string => !!id)),
  ];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabaseTyped
      .from("user_profiles")
      .select("id,display_name,email")
      .in("id", userIds);
    if (usersError) console.error("tours-flight-actions: users read failed", JSON.stringify(usersError));
    for (const u of users ?? []) names.set(u.id, u.display_name?.trim() || u.email);
  }

  return {
    success: true,
    data: {
      block,
      contract,
      contracts,
      sourceTerms,
      allocations,
      allocatedSeats: allocatedSeats(allocRows),
      events: eventRows.map((e) => ({ ...e, created_by_name: e.created_by ? (names.get(e.created_by) ?? null) : null })),
      reviewedByName: block.reviewed_by ? (names.get(block.reviewed_by) ?? null) : null,
      isManager: isManagerRole(session.role),
      today: todayIso(),
    },
  };
}

// ------------------------------------------------------------------ lifecycle

/**
 * Moves a block one step along its lifecycle. Every rule of functional spec 4.1 is
 * checked here, on the server; the step is written to the timeline with who did it.
 */
export async function transitionTourBlock(
  flightId: number,
  to: BlockStatus,
  input: TransitionInput = {},
): Promise<ToursResult<{ status: BlockStatus }>> {
  const { session, company } = await requireCompany("tours");
  if (!(BLOCK_STATUSES as readonly string[]).includes(to)) return fail("Unknown status");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);

  const check = checkTransition(block, to, session.role, input);
  if (!check.ok) return fail(check.error);
  const date = dateOrToday(input.date);
  if (!date) return fail("Invalid date");

  const patch: FlightUpdate = { block_status: to };
  let eventNote = input.note?.trim() || null;
  let eventAmount: number | null = null;
  const warnings: string[] = [];

  if (to === "requested") patch.requested_at = date;

  if (to === "declined") eventNote = `נדחה: ${eventNote}`;

  if (to === "confirmed") {
    if (!block.pnr?.trim() && input.pnr?.trim()) patch.pnr = input.pnr.trim();
    // The contract must be one of this company's - a stale or foreign id counts as "no contract".
    const contract = await loadContract(company.id, block.contract_id);
    if (!contract) return fail('Missing for "Confirmed by airline": Contract');
    // Entering "confirmed" computes the deadlines from the contract - but only the
    // ones the block does not have yet. A date someone typed in stays.
    const computed = computeDeadlines(block.outbound_departure_time, contract);
    Object.assign(patch, pickDeadlines(computed, block, "missing"));
  }

  if (to === "operational") {
    const { data: allocRows, error: allocError } = await loadAllocationRows(company.id, block.id);
    if (allocError) return dbFail("allocations read", allocError);
    if ((allocRows ?? []).length === 0) warnings.push("The flight block was handed to operations with no allocation to any departure.");
  }

  if (to === "cancelled") {
    const who = input.cancelledBy ? CANCELLED_BY_DATA_TEXT[input.cancelledBy] : "";
    const reason = `בוטל על ידי ${who}: ${eventNote}`;
    patch.cancelled_at = date;
    patch.cancel_reason = reason;
    if (input.fee !== null && input.fee !== undefined) {
      patch.cancellation_fee = input.fee;
      eventAmount = input.fee;
    }
    eventNote = reason;
  }

  // Guarded by the status we read: two people pressing at once cannot both win.
  const update = supabaseTyped.from("flights").update(patch).eq("id", block.id).eq("company_id", company.id);
  const { data: updated, error } = await (block.block_status === null
    ? update.is("block_status", null)
    : update.eq("block_status", block.block_status)
  ).select("id");
  if (error) return dbFail("transition", error);
  if (!updated || updated.length === 0) return fail("The status of the flight block changed in the meantime. Refresh and try again.");

  const eventWritten = await writeEvent({
    flightId: block.id,
    kind: TRANSITION_EVENT_KIND[to],
    happenedOn: date,
    seatsAfter: to === "confirmed" ? block.initial_quantity : null,
    amount: eventAmount,
    currency: eventAmount !== null ? block.cost_currency : null,
    note: eventNote,
    createdBy: session.sub,
  });
  if (!eventWritten) warnings.push(EVENT_NOT_WRITTEN);

  await logAudit({
    action: "tours.flight.transition",
    entityType: "flight",
    entityId: block.id,
    changes: { from: stageOf(block.block_status), to, patch },
    metadata: { company_id: company.id },
  });

  return { success: true, data: { status: to }, ...(warnings.length ? { warning: warnings.join(" ") } : {}) };
}

/** The "נבדק" mark: a manager went over this row. Separate from the status. */
export async function setTourBlockReviewed(flightId: number, reviewed: boolean): Promise<ToursResult> {
  const { session, company } = await requireCompany("tours");
  if (!isManagerRole(session.role)) return fail("Only the company manager can mark a row Reviewed");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);

  const patch: FlightUpdate = reviewed
    ? { reviewed_at: new Date().toISOString(), reviewed_by: session.sub }
    : { reviewed_at: null, reviewed_by: null };
  const { error } = await supabaseTyped.from("flights").update(patch).eq("id", block.id).eq("company_id", company.id);
  if (error) return dbFail("reviewed flag", error);

  await logAudit({
    action: reviewed ? "tours.flight.reviewed" : "tours.flight.unreviewed",
    entityType: "flight",
    entityId: block.id,
    metadata: { company_id: company.id },
  });
  return { success: true, data: null };
}

// ------------------------------------------------------------------ seats

/**
 * "עדכון מושבים" (functional spec 4.2): a new seat count with a date and a reason.
 * The first change freezes the original order in `original_quantity`.
 */
export async function updateTourBlockSeats(
  flightId: number,
  input: { quantity: number; date?: string | null; reason: string; cleaned?: boolean },
): Promise<ToursResult<{ seats: number }>> {
  const { session, company } = await requireCompany("tours");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);

  const quantity = input.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0) {
    return fail("The seat count must be a whole number, 0 or more");
  }
  const reason = input.reason?.trim();
  if (!reason) return fail("A seat update needs a reason");
  const date = dateOrToday(input.date);
  if (!date) return fail("Invalid date");
  if (quantity === block.initial_quantity) return fail("That is already the seat count of the flight block");

  const { data: allocRows, error: allocError } = await loadAllocationRows(company.id, block.id);
  if (allocError) return dbFail("allocations read", allocError);
  const allocated = allocatedSeats(allocRows ?? []);
  if (quantity < allocated) {
    return fail(`${allocated} seats are already allocated to departures. Reduce the allocation before cutting the flight block to ${quantity}.`);
  }

  const reduced = quantity < block.initial_quantity;
  const { data: updated, error } = await supabaseTyped
    .from("flights")
    .update({
      initial_quantity: quantity,
      // Keep the original order. Set once, from what the block held before its first change.
      original_quantity: block.original_quantity ?? block.initial_quantity,
    })
    .eq("id", block.id)
    .eq("company_id", company.id)
    .eq("initial_quantity", block.initial_quantity)
    .select("id");
  if (error) return dbFail("seats update", error);
  if (!updated || updated.length === 0) return fail("The seat count changed in the meantime. Refresh and try again.");

  // The events vocabulary knows reductions only; an increase is written as a note that says so.
  const eventWritten = await writeEvent({
    flightId: block.id,
    kind: reduced ? (input.cleaned ? "cleaned" : "reduced") : "note",
    happenedOn: date,
    seatsAfter: quantity,
    note: reduced ? reason : `הגדלת מושבים מ-${block.initial_quantity} ל-${quantity}: ${reason}`,
    createdBy: session.sub,
  });

  await logAudit({
    action: "tours.flight.seats",
    entityType: "flight",
    entityId: block.id,
    changes: { initial_quantity: { from: block.initial_quantity, to: quantity }, reason },
    metadata: { company_id: company.id },
  });
  return { success: true, data: { seats: quantity }, ...(eventWritten ? {} : { warning: EVENT_NOT_WRITTEN }) };
}

// ------------------------------------------------------------------ deadlines

/** Inline edit of one deadline. null clears it. */
export async function updateTourBlockDeadline(
  flightId: number,
  field: DeadlineField,
  value: string | null,
): Promise<ToursResult> {
  const { company } = await requireCompany("tours");
  if (!(DEADLINE_FIELDS as readonly string[]).includes(field)) return fail("Unknown field");
  if (value !== null && !isDateOnly(value)) return fail("Invalid date");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);
  if (block[field] === value) return { success: true, data: null };

  const patch: FlightUpdate = { [field]: value };
  const { error } = await supabaseTyped.from("flights").update(patch).eq("id", block.id).eq("company_id", company.id);
  if (error) return dbFail("deadline update", error);

  await logAudit({
    action: "tours.flight.deadline",
    entityType: "flight",
    entityId: block.id,
    changes: { [field]: { from: block[field], to: value } },
    metadata: { company_id: company.id, label: DEADLINE_LABELS[field] },
  });
  return { success: true, data: null };
}

/**
 * "חשב מחדש מהחוזה": writes the contract's dates into the fields the operator
 * ticked - and only those. Nothing else on the block is touched.
 */
export async function recomputeTourBlockDeadlines(
  flightId: number,
  fields: ContractDeadlineField[],
): Promise<ToursResult<{ updated: ContractDeadlineField[] }>> {
  const { company } = await requireCompany("tours");
  const wanted = [...new Set(fields ?? [])];
  if (wanted.length === 0) return fail("Pick at least one deadline to compute");
  if (wanted.some((f) => !(CONTRACT_DEADLINE_FIELDS as readonly string[]).includes(f))) return fail("Unknown field");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);
  const contract = await loadContract(company.id, block.contract_id);
  if (!contract) return fail("The flight block has no contract. Pick a contract before computing the deadlines.");

  const patch = pickDeadlines(computeDeadlines(block.outbound_departure_time, contract), block, wanted);
  const updatedFields = Object.keys(patch) as ContractDeadlineField[];
  if (updatedFields.length === 0) return fail("The contract has no days set for the selected deadlines");

  const { error } = await supabaseTyped.from("flights").update(patch).eq("id", block.id).eq("company_id", company.id);
  if (error) return dbFail("deadlines recompute", error);

  await logAudit({
    action: "tours.flight.deadlines_recomputed",
    entityType: "flight",
    entityId: block.id,
    changes: Object.fromEntries(updatedFields.map((f) => [f, { from: block[f], to: patch[f] }])),
    metadata: { company_id: company.id, contract_id: contract.id },
  });
  return { success: true, data: { updated: updatedFields } };
}

/** "רישום מקדמה": a deposit that was paid, with its amount, currency and date. */
export async function recordTourBlockDeposit(
  flightId: number,
  input: { amount: number; currency: string; date?: string | null; note?: string | null },
): Promise<ToursResult> {
  const { session, company } = await requireCompany("tours");
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) {
    return fail("The deposit amount must be above zero");
  }
  if (!EVENT_CURRENCIES.includes(input.currency)) return fail("Unknown currency");
  const date = dateOrToday(input.date);
  if (!date) return fail("Invalid date");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);

  const written = await writeEvent({
    flightId: block.id,
    kind: "deposit_paid",
    happenedOn: date,
    amount: input.amount,
    currency: input.currency,
    note: input.note,
    createdBy: session.sub,
  });
  if (!written) return fail("Could not record the deposit. Try again.");

  await logAudit({
    action: "tours.flight.deposit",
    entityType: "flight",
    entityId: block.id,
    changes: { amount: input.amount, currency: input.currency, date },
    metadata: { company_id: company.id },
  });
  return { success: true, data: null };
}

// ------------------------------------------------------------------ contract and costs

/** Gives the block a contract of this company. Deadlines are NOT touched (a hand edit survives a contract change). */
export async function setTourBlockContract(flightId: number, contractId: string | null): Promise<ToursResult> {
  const { company } = await requireCompany("tours");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);
  if (contractId === block.contract_id) return { success: true, data: null };

  if (contractId === null) {
    const stage = stageOf(block.block_status);
    if (stage !== "draft" && LIVE_BLOCK_STATUSES.includes(stage)) {
      return fail(`A flight block in "${BLOCK_STATUS_LABELS[stage]}" needs a contract. You can switch contracts, not remove one.`);
    }
  } else {
    const contract = await loadContract(company.id, contractId);
    if (!contract) return fail("Contract not found");
  }

  const { error } = await supabaseTyped
    .from("flights")
    .update({ contract_id: contractId })
    .eq("id", block.id)
    .eq("company_id", company.id);
  if (error) return dbFail("contract update", error);

  await logAudit({
    action: "tours.flight.contract",
    entityType: "flight",
    entityId: block.id,
    changes: { contract_id: { from: block.contract_id, to: contractId } },
    metadata: { company_id: company.id },
  });
  return { success: true, data: null };
}

const money = (value: unknown): number | null | undefined => {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
};

/** Cost of the block per seat: adult fare, child fare, tax, and their currency. */
export async function updateTourBlockCosts(
  flightId: number,
  input: { cost_price: number | null; cost_child_price: number | null; cost_tax: number | null; cost_currency: string | null },
): Promise<ToursResult> {
  const { company } = await requireCompany("tours");
  const adult = money(input.cost_price);
  const child = money(input.cost_child_price);
  const tax = money(input.cost_tax);
  if (adult === undefined || child === undefined || tax === undefined) return fail("A cost must be a number, 0 or more");
  const currency = input.cost_currency || null;
  if (currency !== null && !(CURRENCIES as readonly string[]).includes(currency)) return fail("Unknown currency");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);

  const stage = stageOf(block.block_status);
  if (stage !== "draft" && LIVE_BLOCK_STATUSES.includes(stage) && (adult === null || currency === null)) {
    return fail(`A flight block in "${BLOCK_STATUS_LABELS[stage]}" needs an adult cost and a currency`);
  }

  const patch = { cost_price: adult, cost_child_price: child, cost_tax: tax, cost_currency: currency };
  const { error } = await supabaseTyped.from("flights").update(patch).eq("id", block.id).eq("company_id", company.id);
  if (error) return dbFail("costs update", error);

  await logAudit({
    action: "tours.flight.costs",
    entityType: "flight",
    entityId: block.id,
    changes: {
      from: {
        cost_price: block.cost_price,
        cost_child_price: block.cost_child_price,
        cost_tax: block.cost_tax,
        cost_currency: block.cost_currency,
      },
      to: patch,
    },
    metadata: { company_id: company.id },
  });
  return { success: true, data: null };
}

// ------------------------------------------------------------------ allocations

/**
 * Departures this block could serve: the company's departures that start within
 * two days of the outbound flight (or end within two days of the return flight,
 * for a departure that takes only the way back).
 */
export async function listAllocatableDepartures(flightId: number): Promise<ToursResult<AllocatableDeparture[]>> {
  const { company } = await requireCompany("tours");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);
  const outbound = toDateOnly(block.outbound_departure_time);
  const inbound = toDateOnly(block.inbound_departure_time);
  if (!outbound || !inbound) return fail("The flight block has no flight dates");

  const columns = "id,code,start_date,end_date,arrival_airport,return_airport,series_id,is_published";
  const [byStart, byEnd] = await Promise.all([
    toursDb()
      .from("departures")
      .select(columns)
      .eq("company_id", company.id)
      .is("is_deleted", null)
      .gte("start_date", addDays(outbound, -ALLOCATION_MAX_DAY_GAP))
      .lte("start_date", addDays(outbound, ALLOCATION_MAX_DAY_GAP)),
    toursDb()
      .from("departures")
      .select(columns)
      .eq("company_id", company.id)
      .is("is_deleted", null)
      .gte("end_date", addDays(inbound, -ALLOCATION_MAX_DAY_GAP))
      .lte("end_date", addDays(inbound, ALLOCATION_MAX_DAY_GAP)),
  ]);
  if (byStart.error) return dbFail("departures read", byStart.error);
  if (byEnd.error) return dbFail("departures read", byEnd.error);

  const departures = [...new Map([...(byStart.data ?? []), ...(byEnd.data ?? [])].map((d) => [d.id, d])).values()];
  if (departures.length === 0) return { success: true, data: [] };

  const [series, statsRes] = await Promise.all([
    loadSeriesRoutes(company.id, departures.map((d) => d.series_id)),
    toursDb()
      .from("departure_stats")
      .select("departure_id,allocated_seats,sold")
      .eq("company_id", company.id)
      .in("departure_id", departures.map((d) => d.id)),
  ]);
  if (statsRes.error) console.error("tours-flight-actions: stats read failed", JSON.stringify(statsRes.error));
  const stats = new Map((statsRes.data ?? []).map((s) => [s.departure_id, s]));

  const fitFor = (
    departure: (typeof departures)[number],
    route: { arrival_airport: string | null; return_airport: string | null },
    legs: AllocationLegs,
  ): { ok: boolean; reason: string | null } => {
    const gap = dayGapOf(block, departure, legs);
    if (gap === null || Math.abs(gap) > ALLOCATION_MAX_DAY_GAP) {
      return { ok: false, reason: `The date is more than ${ALLOCATION_MAX_DAY_GAP} days from the flight` };
    }
    const check = checkBlockFitsDeparture(block, route, legs);
    return { ok: check.ok, reason: check.reason ?? null };
  };

  const data: AllocatableDeparture[] = departures
    .map((d) => {
      const route = effectiveRoute(d, series);
      const s = stats.get(d.id);
      return {
        id: d.id,
        code: d.code,
        start_date: d.start_date,
        end_date: d.end_date,
        route: departureRouteLabel(route.arrival_airport, route.return_airport),
        is_published: d.is_published,
        allocated_seats: s?.allocated_seats ?? 0,
        sold: s?.sold ?? 0,
        fit: {
          both: fitFor(d, route, "both"),
          outbound: fitFor(d, route, "outbound"),
          inbound: fitFor(d, route, "inbound"),
        },
      };
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.code.localeCompare(b.code));
  return { success: true, data };
}

/**
 * Allocates seats of the block to a departure (or changes the seats of an existing
 * allocation with the same direction). Checks both ends by city, the date distance
 * and that the block is not overbooked.
 */
export async function allocateTourBlock(
  flightId: number,
  input: { departureId: string; seats: number; legs?: AllocationLegs },
): Promise<ToursResult> {
  const { company } = await requireCompany("tours");
  const legs = input.legs ?? "both";
  if (!ALLOCATION_LEGS.includes(legs)) return fail("Unknown direction");
  if (typeof input.seats !== "number" || !Number.isInteger(input.seats) || input.seats < 1) {
    return fail("Seats to allocate must be a whole number, 1 or more");
  }
  if (typeof input.departureId !== "string" || !input.departureId) return fail("Select a departure");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);
  const stage = stageOf(block.block_status);
  if (stage === "cancelled" || stage === "declined") {
    return fail(`A flight block in "${BLOCK_STATUS_LABELS[stage]}" cannot be allocated`);
  }

  const { data: departure, error: depError } = await toursDb()
    .from("departures")
    .select("id,code,start_date,end_date,arrival_airport,return_airport,series_id")
    .eq("id", input.departureId)
    .eq("company_id", company.id)
    .is("is_deleted", null)
    .maybeSingle();
  if (depError) return dbFail("departure read", depError);
  if (!departure) return fail("Departure not found");

  const gap = dayGapOf(block, departure, legs);
  if (gap === null || Math.abs(gap) > ALLOCATION_MAX_DAY_GAP) {
    return fail(`Departure ${departure.code} is more than ${ALLOCATION_MAX_DAY_GAP} days from the flight date`);
  }
  const series = await loadSeriesRoutes(company.id, [departure.series_id]);
  const fit = checkBlockFitsDeparture(block, effectiveRoute(departure, series), legs);
  if (!fit.ok) return fail(fit.reason ?? "The flight block does not fit the route of the departure");

  const { data: allocRows, error: allocError } = await loadAllocationRows(company.id, block.id);
  if (allocError) return dbFail("allocations read", allocError);
  const existing = (allocRows ?? []).find((a) => a.departure_id === departure.id && a.legs === legs);
  const others = (allocRows ?? []).filter((a) => a.id !== existing?.id);
  const total = allocatedSeats([...others, { seats: input.seats, legs }]);
  if (total > block.initial_quantity) {
    return fail(`The flight block holds ${block.initial_quantity} seats. With this allocation ${total} would be allocated.`);
  }

  if (existing) {
    const { error } = await toursDb()
      .from("flight_allocations")
      .update({ seats: input.seats })
      .eq("id", existing.id)
      .eq("company_id", company.id);
    if (error) return dbFail("allocation update", error);
  } else {
    const { error } = await toursDb().from("flight_allocations").insert({
      company_id: company.id,
      flight_id: block.id,
      departure_id: departure.id,
      seats: input.seats,
      legs,
    });
    if (error) return dbFail("allocation insert", error);
  }

  await logAudit({
    action: existing ? "tours.flight.allocation_update" : "tours.flight.allocation_create",
    entityType: "flight",
    entityId: block.id,
    changes: { departure: departure.code, seats: input.seats, legs, previous_seats: existing?.seats ?? null },
    metadata: { company_id: company.id, departure_id: departure.id },
  });
  return {
    success: true,
    data: null,
    ...(gap !== 0 ? { warning: `Note: the flight and departure ${departure.code} are ${Math.abs(gap)} days apart.` } : {}),
  };
}

/** Removes one allocation of this block (the seats go back to the pool). */
export async function removeTourBlockAllocation(flightId: number, allocationId: string): Promise<ToursResult> {
  const { company } = await requireCompany("tours");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);
  if (typeof allocationId !== "string" || !allocationId) return fail("Allocation not found");

  const { data: removed, error } = await toursDb()
    .from("flight_allocations")
    .delete()
    .eq("id", allocationId)
    .eq("company_id", company.id)
    .eq("flight_id", block.id)
    .select("id,departure_id,seats,legs");
  if (error) return dbFail("allocation delete", error);
  if (!removed || removed.length === 0) return fail("Allocation not found");

  await logAudit({
    action: "tours.flight.allocation_delete",
    entityType: "flight",
    entityId: block.id,
    changes: removed[0],
    metadata: { company_id: company.id },
  });
  return { success: true, data: null };
}

// ------------------------------------------------------------------ timeline

/** A row the operator adds to the timeline by hand: a note, a quote, "names sent", a schedule change. */
export async function addTourBlockEvent(
  flightId: number,
  input: { kind?: BlockEventKind; note: string; date?: string | null; amount?: number | null; currency?: string | null },
): Promise<ToursResult> {
  const { session, company } = await requireCompany("tours");
  const kind = input.kind ?? "note";
  if (!MANUAL_EVENT_KINDS.includes(kind)) return fail("Unknown event type");
  const note = input.note?.trim();
  if (!note && kind === "note") return fail("Enter the note");
  const date = dateOrToday(input.date);
  if (!date) return fail("Invalid date");
  const amount = input.amount ?? null;
  if (amount !== null && !(typeof amount === "number" && Number.isFinite(amount) && amount >= 0)) return fail("Invalid amount");
  const currency = amount !== null ? (input.currency ?? null) : null;
  if (currency !== null && !EVENT_CURRENCIES.includes(currency)) return fail("Unknown currency");
  const block = await loadBlock(company.id, flightId);
  if (!block) return fail(NOT_FOUND);

  const written = await writeEvent({
    flightId: block.id,
    kind,
    happenedOn: date,
    amount,
    currency,
    note,
    createdBy: session.sub,
  });
  if (!written) return fail("Could not save the entry. Try again.");

  await logAudit({
    action: "tours.flight.event",
    entityType: "flight",
    entityId: block.id,
    changes: { kind, note, date, amount, currency },
    metadata: { company_id: company.id },
  });
  return { success: true, data: null };
}

"use server";

/**
 * The Offline Flights sheet of a tours company (Alon, 04.10.2026): every flight
 * block as one spreadsheet, series by series, with a Details / Operations switch
 * over the same rows and the tour code of each flight.
 *
 * getFlightsSheet reads the rows; saveFlightsSheet writes the changed cells of
 * many rows at once. A row is written only when every changed cell still holds
 * the value the sheet showed (`before`). Nothing is written around the rules of
 * a block: plain details go through updateOfflineFlight (which also moves the
 * sub-tours of a flight whose date changed), and the operations go through the
 * block actions of the flight's page - seats (a release is written to the
 * timeline), deadlines, costs, the Reviewed mark and the lifecycle step - so the
 * sheet can do nothing the flight's page would refuse.
 *
 * Tours companies only (requireCompany("tours")); Mega Events keeps its table.
 */
import { revalidatePath } from "next/cache";

import { requireCompany, type Company } from "@/lib/company";
import { flightsOf } from "@/lib/flights-scope";
import { toursDb } from "@/lib/tours/db";
import { actionFail, actionOk, chunk, fetchAll, must, UserError, type ActionResult } from "@/lib/tours/action-kit";
import { fmtDate, todayIso } from "@/lib/tours/format";
import type { DeadlineField } from "@/lib/tours/deadlines";
import { allocatedSeats, isManagerRole } from "@/components/tours/flights/block-rules";
import { updateOfflineFlight } from "@/lib/actions/offline-flight-actions";
import {
  setTourBlockReviewed,
  transitionTourBlock,
  updateTourBlockCosts,
  updateTourBlockDeadline,
  updateTourBlockSeats,
} from "@/lib/actions/tours-flight-actions";
import type { BlockStatus } from "@/types/tours.types";
import { sameValue, type SheetRowChange, type SheetSaveResult, type SheetValue } from "@/components/tours/sheet/sheet-core";
import {
  FLIGHT_EDITABLE_KEYS,
  flightCellValue,
  statusOptions,
  type FlightSheetRow,
  type FlightsSheetData,
} from "@/components/tours/flights/flights-sheet-model";

const fail = (e: unknown) => actionFail(e, "tours-flights-sheet-actions");
const MAX_ROWS_PER_SAVE = 500;
const ID_CHUNK = 150;

// One literal so the typed client can parse the column list.
const FLIGHT_SELECT =
  "id, is_deleted, block_status, series_name, season_label, airline_code, inbound_airline_code, outbound_flight_number, outbound_departure_airport, outbound_arrival_airport, outbound_departure_time, outbound_arrival_time, inbound_flight_number, inbound_departure_airport, inbound_arrival_airport, inbound_departure_time, inbound_arrival_time, checked_bag_kg, cabin_bag_kg, outbound_stop_airport, inbound_stop_airport, cabin_class, aircraft_type, cost_price, cost_child_price, cost_tax, cost_currency, supplier, pnr, group_code, notes, initial_quantity, original_quantity, requested_at, option_expiry, first_cancellation_date, last_cancellation_date, names_deadline, ticketing_deadline, payment_deadline, handled_by, reviewed_at, cancelled_at, cancel_reason";

interface FlightDb {
  id: number;
  is_deleted: boolean | null;
  block_status: string | null;
  series_name: string | null;
  season_label: string | null;
  airline_code: string;
  inbound_airline_code: string | null;
  outbound_flight_number: string;
  outbound_departure_airport: string;
  outbound_arrival_airport: string;
  outbound_departure_time: string;
  outbound_arrival_time: string;
  inbound_flight_number: string;
  inbound_departure_airport: string;
  inbound_arrival_airport: string;
  inbound_departure_time: string;
  inbound_arrival_time: string;
  checked_bag_kg: number | null;
  cabin_bag_kg: number | null;
  outbound_stop_airport: string | null;
  inbound_stop_airport: string | null;
  cabin_class: string | null;
  aircraft_type: string | null;
  cost_price: number | null;
  cost_child_price: number | null;
  cost_tax: number | null;
  cost_currency: string | null;
  supplier: string | null;
  pnr: string | null;
  group_code: string | null;
  notes: string | null;
  initial_quantity: number;
  original_quantity: number | null;
  requested_at: string | null;
  option_expiry: string | null;
  first_cancellation_date: string | null;
  last_cancellation_date: string | null;
  names_deadline: string | null;
  ticketing_deadline: string | null;
  payment_deadline: string | null;
  handled_by: string | null;
  reviewed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

/** A flight's wall time as the sheet keeps it: "2026-07-03T06:10". */
const wall = (value: string | null): string => (value ?? "").slice(0, 16).replace(" ", "T");
const num = (value: number | null): number | null => (value == null ? null : Number(value));
const day = (value: string | null): string | null => (value ? value.slice(0, 10) : null);

/** The sheet rows of some flight blocks of the company (not deleted), with the sub-tours each serves. */
async function loadFlightRows(company: Company, filter: { ids?: number[]; from?: string | null }): Promise<FlightSheetRow[]> {
  let flights: FlightDb[] = [];
  if (filter.ids) {
    for (const part of chunk(filter.ids, ID_CHUNK)) {
      const { data, error } = await flightsOf(company).select(FLIGHT_SELECT).eq("is_deleted", false).in("id", part);
      if (error) throw new Error(error.message);
      flights = flights.concat((data ?? []) as unknown as FlightDb[]);
    }
  } else {
    flights = (await fetchAll((from, to) => {
      let q = flightsOf(company).select(FLIGHT_SELECT).eq("is_deleted", false);
      if (filter.from) q = q.gte("inbound_departure_time", filter.from);
      return q.order("outbound_departure_time").order("id").range(from, to);
    })) as unknown as FlightDb[];
  }
  if (flights.length === 0) return [];
  flights.sort((a, b) => a.outbound_departure_time.localeCompare(b.outbound_departure_time) || a.id - b.id);

  // which sub-tours each block serves: its allocations, and the sub-tour created from it
  const wanted = new Set(flights.map((f) => f.id));
  const db = toursDb();
  const [allocations, born] = await Promise.all([
    fetchAll<{ flight_id: number; departure_id: string; seats: number; legs: string }>((from, to) =>
      db
        .from("flight_allocations")
        .select("flight_id, departure_id, seats, legs")
        .eq("company_id", company.id)
        .order("id")
        .range(from, to),
    ),
    fetchAll<{ id: string; code: string; origin_flight_id: number | null }>((from, to) =>
      db
        .from("departures")
        .select("id, code, origin_flight_id")
        .eq("company_id", company.id)
        .not("origin_flight_id", "is", null)
        .is("is_deleted", null)
        .order("id")
        .range(from, to),
    ),
  ]);
  const mine = allocations.filter((a) => wanted.has(a.flight_id));
  const codes = new Map<string, string>();
  for (const part of chunk([...new Set(mine.map((a) => a.departure_id))], ID_CHUNK)) {
    const rows = must(await db.from("departures").select("id, code").eq("company_id", company.id).is("is_deleted", null).in("id", part)) ?? [];
    for (const d of rows) codes.set(d.id, d.code);
  }
  const byFlight = new Map<number, typeof mine>();
  for (const a of mine) byFlight.set(a.flight_id, [...(byFlight.get(a.flight_id) ?? []), a]);

  return flights.map((f): FlightSheetRow => {
    const allocs = byFlight.get(f.id) ?? [];
    const tours: FlightSheetRow["tours"] = [];
    for (const a of allocs) {
      const code = codes.get(a.departure_id);
      if (!code) continue;
      const same = tours.find((t) => t.code === code);
      if (same) same.seats = Math.max(same.seats, a.seats);
      else tours.push({ code, seats: a.seats, legs: a.legs });
    }
    for (const d of born) {
      if (d.origin_flight_id === f.id && !tours.some((t) => t.code === d.code)) tours.push({ code: d.code, seats: 0, legs: "both" });
    }
    tours.sort((a, b) => a.code.localeCompare(b.code));
    return {
      id: String(f.id),
      flightId: f.id,
      tours,
      series: f.series_name,
      seasonLabel: f.season_label,
      airline: f.airline_code,
      inboundAirline: f.inbound_airline_code,
      outNumber: f.outbound_flight_number,
      outFrom: f.outbound_departure_airport,
      outTo: f.outbound_arrival_airport,
      outDepart: wall(f.outbound_departure_time),
      outArrive: wall(f.outbound_arrival_time),
      inNumber: f.inbound_flight_number,
      inFrom: f.inbound_departure_airport,
      inTo: f.inbound_arrival_airport,
      inDepart: wall(f.inbound_departure_time),
      inArrive: wall(f.inbound_arrival_time),
      checkedBagKg: f.checked_bag_kg,
      cabinBagKg: f.cabin_bag_kg,
      outStop: f.outbound_stop_airport,
      inStop: f.inbound_stop_airport,
      cabinClass: f.cabin_class,
      aircraft: f.aircraft_type,
      costAdult: num(f.cost_price),
      costChild: num(f.cost_child_price),
      costTax: num(f.cost_tax),
      costCurrency: f.cost_currency,
      supplier: f.supplier,
      pnr: f.pnr,
      groupCode: f.group_code,
      notes: f.notes,
      status: f.block_status,
      seats: f.initial_quantity,
      originalSeats: f.original_quantity,
      allocated: allocatedSeats(allocs),
      requestedAt: day(f.requested_at),
      optionExpiry: day(f.option_expiry),
      firstCancel: day(f.first_cancellation_date),
      lastCancel: day(f.last_cancellation_date),
      namesDeadline: day(f.names_deadline),
      ticketingDeadline: day(f.ticketing_deadline),
      paymentDeadline: day(f.payment_deadline),
      handledBy: f.handled_by,
      reviewed: !!f.reviewed_at,
      cancelled: f.cancelled_at ? `${fmtDate(f.cancelled_at)}${f.cancel_reason ? ` · ${f.cancel_reason}` : ""}` : null,
    };
  });
}

/** The flight blocks of the company. Flights that already came back are left out unless asked. */
export async function getFlightsSheet(input: { includePast?: boolean } = {}): Promise<ActionResult<FlightsSheetData>> {
  try {
    const { session, company } = await requireCompany("tours");
    const today = todayIso();
    const rows = await loadFlightRows(company, { from: input.includePast ? null : today });
    return actionOk({ today, rows, isManager: isManagerRole(session.role) });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- save
/** Cells that are plain columns of the flight, written by updateOfflineFlight. */
const PLAIN: Record<string, string> = {
  series: "series_name",
  seasonLabel: "season_label",
  airline: "airline_code",
  inboundAirline: "inbound_airline_code",
  outNumber: "outbound_flight_number",
  outFrom: "outbound_departure_airport",
  outTo: "outbound_arrival_airport",
  outDepart: "outbound_departure_time",
  outArrive: "outbound_arrival_time",
  inNumber: "inbound_flight_number",
  inFrom: "inbound_departure_airport",
  inTo: "inbound_arrival_airport",
  inDepart: "inbound_departure_time",
  inArrive: "inbound_arrival_time",
  checkedBagKg: "checked_bag_kg",
  cabinBagKg: "cabin_bag_kg",
  outStop: "outbound_stop_airport",
  inStop: "inbound_stop_airport",
  cabinClass: "cabin_class",
  aircraft: "aircraft_type",
  supplier: "supplier",
  pnr: "pnr",
  groupCode: "group_code",
  notes: "notes",
  handledBy: "handled_by",
  requestedAt: "requested_at",
};
const TIMES = new Set(["outDepart", "outArrive", "inDepart", "inArrive"]);
const NEVER_EMPTY = new Set(["airline", "outNumber", "outFrom", "outTo", "inNumber", "inFrom", "inTo", ...TIMES]);
const AIRPORTS = new Set(["outFrom", "outTo", "inFrom", "inTo", "outStop", "inStop"]);
const COSTS = ["costAdult", "costChild", "costTax", "costCurrency"] as const;
const DEADLINES: Record<string, DeadlineField> = {
  optionExpiry: "option_expiry",
  firstCancel: "first_cancellation_date",
  lastCancel: "last_cancellation_date",
  namesDeadline: "names_deadline",
  ticketingDeadline: "ticketing_deadline",
  paymentDeadline: "payment_deadline",
};

/** Writes one row; returns why it stopped, or null when all of it was saved. */
async function applyFlightRow(row: FlightSheetRow, cells: SheetRowChange["cells"]): Promise<string | null> {
  const done: string[] = [];
  const stop = (reason: string) => (done.length ? `${reason} (already saved: ${done.join(", ")})` : reason);
  const after = (key: string): SheetValue => (key in cells ? cells[key].after : flightCellValue(row, key));

  // --- the flight's own details
  const patch: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(PLAIN)) {
    if (!(key in cells)) continue;
    const value = cells[key].after;
    if (value !== null && typeof value !== "string" && typeof value !== "number") return stop(`Invalid value in ${key}`);
    if ((value === null || value === "") && NEVER_EMPTY.has(key)) return stop(`${key} can't be empty`);
    if (AIRPORTS.has(key) && value !== null && !/^[A-Z]{3}$/.test(String(value))) return stop("An airport code is three letters A-Z (e.g. LHR)");
    if (TIMES.has(key)) {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return stop("A flight time is a date and an hour, e.g. 2026-07-03 06:10");
      patch[column] = `${value}:00`;
    } else {
      patch[column] = value;
    }
  }
  if (Object.keys(patch).length) {
    const [outDepart, outArrive, inDepart, inArrive] = ["outDepart", "outArrive", "inDepart", "inArrive"].map((k) => String(after(k)));
    if (outArrive < outDepart) return stop("The outbound flight lands before it leaves");
    if (inArrive < inDepart) return stop("The return flight lands before it leaves");
    if (inDepart < outDepart) return stop("The return flight leaves before the outbound one");
    try {
      await updateOfflineFlight(row.flightId, patch as Parameters<typeof updateOfflineFlight>[1]);
    } catch (e) {
      return stop(e instanceof Error ? e.message : "The flight was not saved");
    }
    done.push("details");
  }

  // --- costs: the four go together, by the rule of a live block
  if (COSTS.some((key) => key in cells)) {
    const cost = (key: string): number | null => {
      const v = after(key);
      return typeof v === "number" ? v : null;
    };
    const currency = after("costCurrency");
    const res = await updateTourBlockCosts(row.flightId, {
      cost_price: cost("costAdult"),
      cost_child_price: cost("costChild"),
      cost_tax: cost("costTax"),
      cost_currency: typeof currency === "string" ? currency : null,
    });
    if (!res.success) return stop(res.error);
    done.push("costs");
  }

  // --- deadlines
  for (const [key, field] of Object.entries(DEADLINES)) {
    if (!(key in cells)) continue;
    const value = cells[key].after;
    const res = await updateTourBlockDeadline(row.flightId, field, typeof value === "string" ? value : null);
    if (!res.success) return stop(res.error);
    done.push(field);
  }

  // --- seats: a lower count is a release back to the airline, written to the block's timeline
  if ("seats" in cells) {
    const quantity = cells.seats.after;
    if (typeof quantity !== "number") return stop("The seat count must be a whole number");
    const res = await updateTourBlockSeats(row.flightId, {
      quantity,
      reason: quantity < row.seats ? "שחרור מקומות (עודכן בטבלת הטיסות)" : "עודכן בטבלת הטיסות",
      cleaned: quantity < row.seats,
    });
    if (!res.success) return stop(res.error);
    done.push("seats");
  }

  if ("reviewed" in cells) {
    const res = await setTourBlockReviewed(row.flightId, cells.reviewed.after === true);
    if (!res.success) return stop(res.error);
    done.push("reviewed");
  }

  // --- the lifecycle step last: what it needs (PNR, costs, seats) may have come in this same save
  if ("status" in cells) {
    const to = String(cells.status.after ?? "");
    if (!statusOptions(row.status).some((o) => o.value === to)) {
      return stop("This step is not open from the block's status - declining or cancelling a block is done on its page");
    }
    const res = await transitionTourBlock(row.flightId, to as BlockStatus, {});
    if (!res.success) return stop(res.error);
  }
  return null;
}

export async function saveFlightsSheet(
  changes: SheetRowChange[],
): Promise<ActionResult<SheetSaveResult & { rows: FlightSheetRow[] }>> {
  try {
    const { company } = await requireCompany("tours");
    if (!Array.isArray(changes) || changes.length === 0) throw new UserError("Nothing to save");
    if (changes.length > MAX_ROWS_PER_SAVE) throw new UserError(`Up to ${MAX_ROWS_PER_SAVE} rows in one save`);
    const ids: number[] = [];
    for (const change of changes) {
      const id = Number(change?.id);
      if (!change || !Number.isInteger(id) || id <= 0 || !change.cells || typeof change.cells !== "object") {
        throw new UserError("Invalid change in the sheet");
      }
      for (const key of Object.keys(change.cells)) {
        if (!FLIGHT_EDITABLE_KEYS.has(key)) throw new UserError(`The column ${key} can't be edited here`);
      }
      ids.push(id);
    }

    const unique = [...new Set(ids)];
    const current = new Map((await loadFlightRows(company, { ids: unique })).map((r) => [r.id, r]));
    const outcome: SheetSaveResult & { rows: FlightSheetRow[] } = { saved: [], skipped: [], rows: [] };
    for (const change of changes) {
      const row = current.get(String(Number(change.id)));
      if (!row) {
        outcome.skipped.push({ id: change.id, code: `#${change.id}`, reason: "Not found - it was deleted" });
        continue;
      }
      const name = `#${row.flightId}`;
      const stale = Object.entries(change.cells).some(([key, cell]) => !sameValue(flightCellValue(row, key), cell.before));
      if (stale) {
        outcome.skipped.push({
          id: row.id,
          code: name,
          reason: "Changed by someone else since the sheet was opened - your edits are kept; reload to see theirs",
        });
        continue;
      }
      const stopped = await applyFlightRow(row, change.cells);
      if (stopped) outcome.skipped.push({ id: row.id, code: name, reason: stopped });
      else outcome.saved.push(row.id);
    }

    outcome.rows = await loadFlightRows(company, { ids: unique });
    revalidatePath("/offline-flights");
    revalidatePath("/tours/departures");
    return actionOk(outcome);
  } catch (e) {
    return fail(e);
  }
}

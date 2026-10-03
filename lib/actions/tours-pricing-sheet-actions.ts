"use server";

/**
 * Tours > Pricing and the tour page's sheet (mega-family
 * docs/plans/TOUR-SETUP-FLOW-PLAN.md, steps 4-6): every sub-tour of the
 * organized tours as one spreadsheet, tour by tour.
 *
 * getPricingSheet reads the rows; savePricingSheet writes the changed cells of
 * many rows at once. A row is written only when every changed cell still holds
 * the value the sheet showed (`before`) - otherwise someone changed it in the
 * meantime and it is skipped with the reason. The writes go through the actions
 * the departure card uses (updateDeparture, saveDeparturePrices,
 * setDeparturesPublished), so a published sub-tour keeps what the site needs by
 * the same rules.
 */
import { revalidatePath } from "next/cache";

import { requireCompany, type Company } from "@/lib/company";
import { flightsOf } from "@/lib/flights-scope";
import { toursDb } from "@/lib/tours/db";
import { actionFail, actionOk, chunk, fetchAll, must, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { todayIso } from "@/lib/tours/format";
import { departureRouteLabel } from "@/lib/tours/routes";
import { siteSaleStatus } from "@/components/tours/departures/departure-utils";
import type { DepartureGeneralInput } from "@/components/tours/departures/types";
import { PRICE_MATRIX_ROWS } from "@/types/tours.types";
import { saveDeparturePrices, setDeparturesPublished, updateDeparture } from "@/lib/actions/tours-departure-actions";
import {
  cellValue,
  EDITABLE_KEYS,
  priceIndexOf,
  sameValue,
  type PricingSheetData,
  type SheetRow,
  type SheetRowChange,
  type SheetSaveOutcome,
  type SheetTour,
  type SheetValue,
} from "@/components/tours/pricing/sheet-model";

const fail = (e: unknown) => actionFail(e, "tours-pricing-sheet-actions");

const MAX_ROWS_PER_SAVE = 1000;
const ID_CHUNK = 150;
const SHEET_SELECT =
  "id, code, package_id, series_id, start_date, end_date, season, currency, is_published, sale_status, arrival_airport, return_airport, capacity, date_labels, meeting_at, baggage_included, meal_included, transfers_included, connection_out, connection_back, child_max_age, senior_min_age, senior_discount, notes, origin_flight_id, departure_prices(pax_type, room_position, price), flight_allocations(flight_id, legs)";

interface RawRow {
  id: string;
  code: string;
  package_id: string;
  series_id: string;
  start_date: string;
  end_date: string;
  season: string | null;
  currency: string;
  is_published: boolean;
  sale_status: string;
  arrival_airport: string | null;
  return_airport: string | null;
  capacity: number | null;
  date_labels: string[] | null;
  meeting_at: string | null;
  baggage_included: boolean;
  meal_included: boolean;
  transfers_included: boolean;
  connection_out: string | null;
  connection_back: string | null;
  child_max_age: number | null;
  senior_min_age: number | null;
  senior_discount: number | null;
  notes: string | null;
  origin_flight_id: number | null;
  departure_prices: { pax_type: string; room_position: number; price: number }[];
  flight_allocations: { flight_id: number; legs: string }[];
}

/** The sheet rows of some departures (not deleted), with seats, site status and flight cost. */
async function loadSheetRows(
  company: Company,
  filter: { packageIds?: string[]; ids?: string[]; from?: string | null },
): Promise<SheetRow[]> {
  const base = () => {
    let q = toursDb()
      .from("departures")
      .select(SHEET_SELECT)
      .eq("company_id", company.id)
      .eq("departure_prices.company_id", company.id)
      .eq("flight_allocations.company_id", company.id)
      .is("is_deleted", null);
    if (filter.from) q = q.gte("end_date", filter.from);
    return q;
  };
  let raw: RawRow[] = [];
  if (filter.ids) {
    for (const part of chunk(filter.ids, ID_CHUNK)) {
      raw = raw.concat((must(await base().in("id", part)) ?? []) as unknown as RawRow[]);
    }
  } else if (filter.packageIds) {
    for (const part of chunk(filter.packageIds, ID_CHUNK)) {
      raw = raw.concat(
        (await fetchAll((from, to) => base().in("package_id", part).order("start_date").order("id").range(from, to))) as unknown as RawRow[],
      );
    }
  }
  if (raw.length === 0) return [];
  raw.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.code.localeCompare(b.code));

  const ids = raw.map((d) => d.id);
  const seriesIds = [...new Set(raw.map((d) => d.series_id))];
  const flightIds = [...new Set(raw.flatMap((d) => d.flight_allocations.map((a) => a.flight_id)))];
  const stats = new Map<string, { allocated: number; sold: number; remaining: number }>();
  const series = new Map<string, { code: string; arrival: string | null; ret: string | null }>();
  const flights = new Map<number, { cost: number | null; currency: string | null }>();
  await Promise.all([
    (async () => {
      for (const part of chunk(ids, ID_CHUNK)) {
        const rows =
          must(
            await toursDb()
              .from("departure_stats")
              .select("departure_id, allocated_seats, sold, remaining")
              .eq("company_id", company.id)
              .in("departure_id", part),
          ) ?? [];
        for (const s of rows) {
          if (s.departure_id) {
            stats.set(s.departure_id, { allocated: s.allocated_seats ?? 0, sold: s.sold ?? 0, remaining: s.remaining ?? 0 });
          }
        }
      }
    })(),
    (async () => {
      for (const part of chunk(seriesIds, ID_CHUNK)) {
        const rows =
          must(await toursDb().from("series").select("id, code, arrival_airport, return_airport").eq("company_id", company.id).in("id", part)) ?? [];
        for (const s of rows) series.set(s.id, { code: s.code, arrival: s.arrival_airport, ret: s.return_airport });
      }
    })(),
    (async () => {
      for (const part of chunk(flightIds, ID_CHUNK)) {
        const { data, error } = await flightsOf(company).select("id, cost_price, cost_currency").in("id", part);
        if (error) throw new Error(error.message);
        for (const f of (data ?? []) as { id: number; cost_price: number | null; cost_currency: string | null }[]) {
          flights.set(f.id, { cost: f.cost_price == null ? null : Number(f.cost_price), currency: f.cost_currency });
        }
      }
    })(),
  ]);

  return raw.map((d): SheetRow => {
    const s = series.get(d.series_id);
    const seats = stats.get(d.id) ?? { allocated: 0, sold: 0, remaining: 0 };
    const prices = PRICE_MATRIX_ROWS.map((m) => {
      const cell = d.departure_prices.find((p) => p.pax_type === m.paxType && p.room_position === m.position);
      return cell ? Number(cell.price) : null;
    });
    // the block it was made from, else the first one flying out
    const blocks = [...new Set(d.flight_allocations.filter((a) => a.legs !== "inbound").map((a) => a.flight_id))];
    const main = d.origin_flight_id != null && blocks.includes(d.origin_flight_id) ? d.origin_flight_id : blocks[0];
    const cost = main != null ? flights.get(main) : undefined;
    const arrival = d.arrival_airport ?? s?.arrival ?? null;
    return {
      id: d.id,
      code: d.code,
      packageId: d.package_id,
      seriesCode: s?.code ?? "",
      startDate: d.start_date,
      endDate: d.end_date,
      season: d.season,
      route: departureRouteLabel(arrival, d.return_airport ?? s?.ret ?? arrival),
      isPublished: d.is_published,
      saleStatus: d.sale_status,
      siteStatus: siteSaleStatus({ sale_status: d.sale_status, allocated: seats.allocated, remaining: seats.remaining }),
      currency: d.currency,
      capacity: d.capacity,
      seats,
      flightCost:
        cost && cost.cost != null
          ? { amount: cost.cost, currency: cost.currency || "USD", more: Math.max(0, blocks.length - 1) }
          : null,
      prices,
      labels: d.date_labels ?? [],
      meetingAt: d.meeting_at,
      baggage: d.baggage_included,
      meal: d.meal_included,
      transfers: d.transfers_included,
      connectionOut: d.connection_out,
      connectionBack: d.connection_back,
      childMaxAge: d.child_max_age,
      seniorMinAge: d.senior_min_age,
      seniorDiscount: d.senior_discount == null ? null : Number(d.senior_discount),
      notes: d.notes,
      originFlightId: d.origin_flight_id,
    };
  });
}

/**
 * The organized tours and their sub-tours. `packageId` = one tour (its page's
 * sheet), else every organized tour. Past sub-tours are left out unless asked.
 */
export async function getPricingSheet(
  input: { packageId?: string | null; includePast?: boolean } = {},
): Promise<ActionResult<PricingSheetData>> {
  try {
    const { company } = await requireCompany("tours");
    const today = todayIso();
    const db = toursDb();
    const [packages, series] = await Promise.all([
      fetchAll<{ id: string; name: string; slug: string; kind: string; is_active: boolean; is_deleted: string | null }>((from, to) =>
        db.from("packages").select("id, name, slug, kind, is_active, is_deleted").eq("company_id", company.id).order("id").range(from, to),
      ),
      fetchAll<{ code: string; package_id: string | null }>((from, to) =>
        db.from("series").select("code, package_id").eq("company_id", company.id).order("code").range(from, to),
      ),
    ]);
    const organized = packages.filter((p) => p.kind === "organized" && !p.is_deleted);
    const wanted = input.packageId ? organized.filter((p) => p.id === input.packageId) : organized;
    if (input.packageId && wanted.length === 0) {
      if (!UUID.test(input.packageId)) throw new UserError("Tour not found");
      return actionOk({ today, tours: [], rows: [] });
    }

    const rows = await loadSheetRows(company, { packageIds: wanted.map((p) => p.id), from: input.includePast ? null : today });
    const first = new Map<string, string>();
    for (const r of rows) if (!first.has(r.packageId)) first.set(r.packageId, r.startDate);
    const tours: SheetTour[] = wanted
      .filter((p) => input.packageId || first.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        codes: series.filter((s) => s.package_id === p.id).map((s) => s.code),
        isActive: p.is_active,
      }))
      .sort((a, b) => (first.get(a.id) ?? "9999").localeCompare(first.get(b.id) ?? "9999") || a.name.localeCompare(b.name, "he"));
    return actionOk({ today, tours, rows });
  } catch (e) {
    return fail(e);
  }
}

const asNumber = (v: SheetValue): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asText = (v: SheetValue): string | null => (typeof v === "string" ? v : null);

/** The departure fields one row's changed cells set (prices and publishing go their own way). */
function fieldsOf(cells: SheetRowChange["cells"]): DepartureGeneralInput {
  const out: DepartureGeneralInput = {};
  for (const [key, { after }] of Object.entries(cells)) {
    switch (key) {
      case "saleStatus":
        out.sale_status = String(after ?? "");
        break;
      case "currency":
        out.currency = String(after ?? "");
        break;
      case "capacity":
        out.capacity = asNumber(after);
        break;
      case "labels":
        out.date_labels = Array.isArray(after) ? after.map(String) : [];
        break;
      case "meetingAt":
        out.meeting_at = asText(after);
        break;
      case "baggage":
        out.baggage_included = after === true;
        break;
      case "meal":
        out.meal_included = after === true;
        break;
      case "transfers":
        out.transfers_included = after === true;
        break;
      case "connectionOut":
        out.connection_out = asText(after);
        break;
      case "connectionBack":
        out.connection_back = asText(after);
        break;
      case "childMaxAge":
        out.child_max_age = asNumber(after);
        break;
      case "seniorMinAge":
        out.senior_min_age = asNumber(after);
        break;
      case "seniorDiscount":
        out.senior_discount = asNumber(after);
        break;
      case "notes":
        out.notes = asText(after);
        break;
    }
  }
  return out;
}

/** Writes one row; returns why it stopped, or null when all of it was saved. */
async function applyRow(row: SheetRow, cells: SheetRowChange["cells"]): Promise<string | null> {
  const done: string[] = [];
  const stop = (reason: string) => (done.length ? `${reason} (already saved: ${done.join(", ")})` : reason);
  const publish = "isPublished" in cells ? cells.isPublished.after === true : null;

  // off the site first, so the checks below no longer hold the row as published
  if (publish === false && row.isPublished) {
    const res = await setDeparturesPublished([row.id], false);
    if (!res.success) return stop(res.error);
    if (res.data.skipped[0]) return stop(res.data.skipped[0].reason);
    done.push("taken off the site");
  }

  const fields = fieldsOf(cells);
  if (Object.keys(fields).length) {
    const res = await updateDeparture(row.id, fields);
    if (!res.success) return stop(res.error);
    done.push("details");
  }

  const priceKeys = Object.keys(cells).filter((k) => priceIndexOf(k) !== null);
  if (priceKeys.length) {
    const prices = [...row.prices];
    for (const key of priceKeys) {
      const value = cells[key].after;
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) return stop(`Invalid price in ${key}`);
      prices[priceIndexOf(key)!] = value as number | null;
    }
    const res = await saveDeparturePrices(
      row.id,
      PRICE_MATRIX_ROWS.map((m, i) => ({ paxType: m.paxType, position: m.position, price: prices[i] })),
    );
    if (!res.success) return stop(res.error);
    done.push("prices");
  }

  // on the site last, once it has everything the site needs
  if (publish === true && !row.isPublished) {
    const res = await setDeparturesPublished([row.id], true);
    if (!res.success) return stop(res.error);
    if (res.data.skipped[0]) return stop(`Not put on the site: ${res.data.skipped[0].reason}`);
  }
  return null;
}

export async function savePricingSheet(changes: SheetRowChange[]): Promise<ActionResult<SheetSaveOutcome>> {
  try {
    const { company } = await requireCompany("tours");
    if (!Array.isArray(changes) || changes.length === 0) throw new UserError("Nothing to save");
    if (changes.length > MAX_ROWS_PER_SAVE) throw new UserError(`Up to ${MAX_ROWS_PER_SAVE} rows in one save`);
    for (const change of changes) {
      if (!change || !UUID.test(String(change.id)) || !change.cells || typeof change.cells !== "object") {
        throw new UserError("Invalid change in the sheet");
      }
      for (const key of Object.keys(change.cells)) {
        if (!EDITABLE_KEYS.has(key)) throw new UserError(`The column ${key} can't be edited here`);
      }
    }

    const ids = [...new Set(changes.map((c) => c.id))];
    const current = new Map((await loadSheetRows(company, { ids })).map((r) => [r.id, r]));
    const outcome: SheetSaveOutcome = { saved: [], skipped: [], rows: [] };
    for (const change of changes) {
      const row = current.get(change.id);
      if (!row) {
        outcome.skipped.push({ id: change.id, code: "", reason: "Not found - it was deleted" });
        continue;
      }
      const stale = Object.entries(change.cells).some(([key, cell]) => !sameValue(cellValue(row, key), cell.before));
      if (stale) {
        outcome.skipped.push({
          id: row.id,
          code: row.code,
          reason: "Changed by someone else since the sheet was opened - your edits are kept; reload to see theirs",
        });
        continue;
      }
      const stopped = await applyRow(row, change.cells);
      if (stopped) outcome.skipped.push({ id: row.id, code: row.code, reason: stopped });
      else outcome.saved.push(row.id);
    }

    outcome.rows = await loadSheetRows(company, { ids });
    if (outcome.saved.length || outcome.skipped.length) {
      revalidatePath("/tours/departures");
      revalidatePath("/tours/pricing");
    }
    return actionOk(outcome);
  } catch (e) {
    return fail(e);
  }
}

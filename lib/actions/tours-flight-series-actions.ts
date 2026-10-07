"use server";

/**
 * A flight series becomes the dates of a tour (mega-family
 * docs/plans/TOUR-SETUP-FLOW-PLAN.md, steps 2-3).
 *
 * Offline Flights > New Series in a tours company, ticked "Organized tour" with a
 * tour code: the flights are created as always (createOfflineFlightSeries, shared
 * with Mega Events and untouched), then the page calls
 * createSubToursFromFlightSeries. The code is a tours.series code: an existing
 * one brings its tour, a new one creates a draft tour (not on the site) and the
 * series. Every flight then gets its sub-tour - a draft departure with the
 * flight's dates, route and seats, the whole block allocated to it and
 * `origin_flight_id` pointing back, so it can follow the flight later
 * (lib/tours/flight-sync.ts).
 *
 * Each step runs through the action that owns it (createTourPackage, saveSeries,
 * createDeparture, addFlightAllocation), so the rules are the ones Add Tour and
 * the departure card apply. Nothing is rolled back: the flights exist whatever
 * happens here, and the answer lists what was created, what was joined and what
 * was skipped with the reason. Running it again on the same series is safe - a
 * sub-tour that exists is joined, never duplicated.
 *
 * The same step runs on chosen flights (`flightIds`) from the flights sheet's
 * "Create sub-tours": flights opened without a tour get their dates later,
 * without building the series again (Alon, 07.10.2026).
 */
import { revalidatePath } from "next/cache";

import { requireCompany } from "@/lib/company";
import { flightsOf } from "@/lib/flights-scope";
import { logAudit } from "@/lib/audit";
import { toursDb } from "@/lib/tours/db";
import { companyAudit } from "@/lib/tours/company-kit";
import { actionFail, actionOk, fetchAll, must, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { nightsBetween, weekdayOf } from "@/lib/tours/format";
import { subTourFromFlight, type FlightDates, type SubTourDraft } from "@/lib/tours/sub-tours";
import { createTourPackage } from "@/lib/actions/tours-content-actions";
import { saveSeries } from "@/lib/actions/tours-series-actions";
import { addFlightAllocation, createDeparture } from "@/lib/actions/tours-departure-actions";
import { EMPTY_PACKAGE_FORM, slugFromName } from "@/components/tours/content/shared";

const fail = (e: unknown) => actionFail(e, "tours-flight-series-actions");

const SERIES_CODE = /^[A-Z][A-Z0-9]{1,7}$/;
/** The most sub-tours one request creates - the limit Add Tour has too (the page checks it before the flights). */
const MAX_SUB_TOURS = 60;
const FLIGHT_COLUMNS =
  "id, outbound_departure_time, inbound_departure_time, outbound_arrival_airport, inbound_departure_airport, initial_quantity, season_label, is_deleted, block_status";

export interface TourCodeOption {
  code: string;
  seriesId: string;
  packageId: string | null;
  /** The tour the code sells, or null when it has none (or it was deleted). */
  tourName: string | null;
}

export interface SubToursResult {
  packageId: string;
  tourName: string;
  /** True when the code was new and the draft tour was created now. */
  createdTour: boolean;
  created: { id: string; code: string }[];
  /** Sub-tours that already existed and got the flight. */
  attached: { id: string; code: string }[];
  skipped: { flightId: number; reason: string }[];
  /** Steps that did not go through on a sub-tour that exists (a flight not linked, a warning). */
  problems: string[];
}

/** Tour codes in use, for the code field of New Series. */
export async function getTourCodes(): Promise<ActionResult<TourCodeOption[]>> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();
    const [series, packages] = await Promise.all([
      fetchAll<{ id: string; code: string; package_id: string | null }>((from, to) =>
        db.from("series").select("id, code, package_id").eq("company_id", company.id).order("code").range(from, to),
      ),
      fetchAll<{ id: string; name: string; is_deleted: string | null }>((from, to) =>
        db.from("packages").select("id, name, is_deleted").eq("company_id", company.id).order("id").range(from, to),
      ),
    ]);
    const live = new Map(packages.filter((p) => !p.is_deleted).map((p) => [p.id, p.name]));
    return actionOk(
      series.map((s) => ({
        code: s.code,
        seriesId: s.id,
        packageId: s.package_id,
        tourName: s.package_id ? (live.get(s.package_id) ?? null) : null,
      })),
    );
  } catch (e) {
    return fail(e);
  }
}

/** A free page address for a new tour: the name's, else with the code, else numbered. */
async function freeSlug(companyId: string, base: string, code: string): Promise<string> {
  const taken = new Set(
    (
      await fetchAll<{ slug: string }>((from, to) =>
        toursDb().from("packages").select("slug").eq("company_id", companyId).order("slug").range(from, to),
      )
    ).map((p) => p.slug),
  );
  const first = base || code.toLowerCase();
  if (!taken.has(first)) return first;
  const withCode = `${first}-${code.toLowerCase()}`;
  if (!taken.has(withCode)) return withCode;
  for (let n = 2; ; n++) if (!taken.has(`${withCode}-${n}`)) return `${withCode}-${n}`;
}

export async function createSubToursFromFlightSeries(input: {
  /** The whole flight series (New Series)... */
  flightSeriesId?: string;
  /** ...or these flights only: the flights sheet's "Create sub-tours" on flights that were opened without a tour. */
  flightIds?: number[];
  code: string;
  tourName?: string | null;
}): Promise<ActionResult<SubToursResult>> {
  try {
    const { company } = await requireCompany("tours");
    const code = String(input.code ?? "").trim().toUpperCase();
    if (!SERIES_CODE.test(code)) {
      throw new UserError("Tour code: 2 to 8 characters, letters (A-Z) and digits, starting with a letter (e.g. BBC)");
    }
    const flightIds = Array.isArray(input.flightIds) ? [...new Set(input.flightIds)] : null;
    if (flightIds) {
      if (flightIds.length === 0 || flightIds.some((id) => !Number.isInteger(id) || id < 1)) throw new UserError("Choose the flights");
      if (flightIds.length > MAX_SUB_TOURS) {
        throw new UserError(`Up to ${MAX_SUB_TOURS} flights become sub-tours at a time - filter the sheet and run it again`);
      }
    } else if (!UUID.test(String(input.flightSeriesId ?? ""))) throw new UserError("Flight series not found");
    const db = toursDb();

    // --- the flights of the series (or the chosen ones), in this company only
    const scoped = flightsOf(company).select(FLIGHT_COLUMNS);
    const { data: rows, error } = await (flightIds ? scoped.in("id", flightIds) : scoped.eq("series_id", input.flightSeriesId as string)).order(
      "outbound_departure_time",
      { ascending: true },
    );
    if (error) throw new Error(error.message);
    type SeriesFlight = FlightDates & { is_deleted: boolean | null; block_status: string | null };
    const flights = ((rows ?? []) as unknown as SeriesFlight[]).filter((f) => !f.is_deleted);
    if (flights.length === 0) {
      throw new UserError(flightIds ? "None of these flights is in the active company" : "The flight series has no flights in the active company");
    }
    if (flights.length > MAX_SUB_TOURS) {
      throw new UserError(`Up to ${MAX_SUB_TOURS} flights become sub-tours at a time - split the series`);
    }

    // --- the tour: the code's, or a new draft one
    const problems: string[] = [];
    let seriesId: string;
    let packageId: string;
    let tourName: string;
    let createdTour = false;
    const found = must(
      await db.from("series").select("id, code, package_id").eq("company_id", company.id).eq("code", code).maybeSingle(),
    );
    if (found) {
      if (!found.package_id) {
        throw new UserError(`Tour code ${code} has no tour. Link it to a tour on the Series screen, then create the sub-tours again.`);
      }
      const pkg = must(
        await db.from("packages").select("id, name, kind, is_deleted").eq("company_id", company.id).eq("id", found.package_id).maybeSingle(),
      );
      if (!pkg || pkg.is_deleted) throw new UserError(`Tour code ${code} belongs to a deleted tour - choose another code`);
      if (pkg.kind !== "organized") {
        throw new UserError(`Tour code ${code} sells a ${pkg.kind} package - sub-tours from flights are for organized tours`);
      }
      seriesId = found.id;
      packageId = pkg.id;
      tourName = pkg.name;
    } else {
      const name = String(input.tourName ?? "").trim();
      if (name.length < 2) throw new UserError(`Tour code ${code} is new - give the tour a name`);
      const first = flights
        .map((f) => subTourFromFlight(code, f))
        .find((d): d is SubTourDraft => !("error" in d));
      if (!first) throw new UserError("None of the flights flies out and back - there is no trip to build a tour from");
      const nights = nightsBetween(first.start, first.end);
      const slug = await freeSlug(company.id, slugFromName(name), code);
      const page = await createTourPackage(
        { ...EMPTY_PACKAGE_FORM, name, slug, nights, days: nights != null ? nights + 1 : null },
        code,
      );
      if (!page.success) return { success: false, error: `The tour was not created: ${page.error}` };
      if (page.warning) problems.push(page.warning);
      packageId = page.data.id;
      tourName = name;
      createdTour = true;
      const series = await saveSeries(null, {
        code,
        label: name,
        package_id: packageId,
        arrival_airport: first.arrival,
        arrival_weekday: weekdayOf(first.start),
        return_airport: first.ret,
        return_weekday: weekdayOf(first.end),
        default_nights: nights,
        default_capacity: first.capacity > 0 ? first.capacity : 45,
        default_currency: "USD",
        child_max_age: 16,
        senior_min_age: 65,
        senior_discount: 25,
        is_active: true,
        termIds: [],
      });
      if (!series.success) {
        return {
          success: false,
          error: `The draft tour "${name}" was created, but tour code ${code} was not: ${series.error}. Add the code on the Series screen with this tour, then create the sub-tours again.`,
        };
      }
      seriesId = series.data.id;
    }

    // --- one sub-tour per flight
    const created: SubToursResult["created"] = [];
    const attached: SubToursResult["attached"] = [];
    const skipped: SubToursResult["skipped"] = [];
    for (const f of flights) {
      const draft = subTourFromFlight(code, f);
      if ("error" in draft) {
        skipped.push({ flightId: f.id, reason: draft.error });
        continue;
      }
      if (f.block_status === "cancelled" || f.block_status === "declined") {
        skipped.push({ flightId: f.id, reason: `The block is ${f.block_status}` });
        continue;
      }

      const existing = must(
        await db
          .from("departures")
          .select("id, code, series_id, is_deleted, origin_flight_id")
          .eq("company_id", company.id)
          .eq("code", draft.code)
          .eq("season_year", draft.seasonYear)
          .maybeSingle(),
      );
      let departureId: string;
      if (existing) {
        if (existing.is_deleted) {
          skipped.push({
            flightId: f.id,
            reason: `A deleted sub-tour ${draft.code} exists - restore it on the Departures board, then create the sub-tours again`,
          });
          continue;
        }
        if (existing.series_id !== seriesId) {
          skipped.push({ flightId: f.id, reason: `Code ${draft.code} belongs to another series` });
          continue;
        }
        departureId = existing.id;
        if (existing.origin_flight_id == null) {
          must(await db.from("departures").update({ origin_flight_id: f.id }).eq("company_id", company.id).eq("id", departureId));
        }
        attached.push({ id: departureId, code: existing.code });
        const linked = must(
          await db
            .from("flight_allocations")
            .select("id")
            .eq("company_id", company.id)
            .eq("departure_id", departureId)
            .eq("flight_id", f.id)
            .limit(1),
        );
        if ((linked ?? []).length) continue;
      } else {
        const res = await createDeparture({ seriesId, start_date: draft.start, end_date: draft.end, season: draft.season });
        if (!res.success) {
          skipped.push({ flightId: f.id, reason: res.error });
          continue;
        }
        departureId = res.data.id;
        const route: Record<string, string> = {};
        if (draft.arrival) route.arrival_airport = draft.arrival;
        if (draft.ret) route.return_airport = draft.ret;
        must(
          await db
            .from("departures")
            .update({ ...route, capacity: draft.capacity, origin_flight_id: f.id })
            .eq("company_id", company.id)
            .eq("id", departureId),
        );
        created.push({ id: departureId, code: res.data.code });
      }

      if (draft.capacity < 1) {
        problems.push(`${draft.code}: the block has no seats yet - link it from the sub-tour's card once it has`);
        continue;
      }
      const link = await addFlightAllocation(departureId, f.id, draft.capacity, "both");
      if (!link.success) problems.push(`${draft.code}: the flight was not linked - ${link.error}`);
      else if (link.warning) problems.push(`${draft.code}: ${link.warning}`);
    }

    await logAudit({
      action: "create",
      entityType: "tours_flight_series",
      entityId: null,
      changes: { code, package_id: packageId, created: created.map((c) => c.code), attached: attached.map((a) => a.code) },
      metadata: {
        ...companyAudit(company),
        flight_series_id: flightIds ? null : input.flightSeriesId,
        flight_ids: flightIds,
        created_tour: createdTour,
        skipped: skipped.length,
      },
    });
    revalidatePath("/tours/packages");
    revalidatePath(`/tours/packages/${packageId}`);
    revalidatePath("/tours/departures");
    revalidatePath("/tours/pricing");
    revalidatePath("/offline-flights");
    return actionOk<SubToursResult>({ packageId, tourName, createdTour, created, attached, skipped, problems });
  } catch (e) {
    return fail(e);
  }
}

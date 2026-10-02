"use server";

/**
 * "Create Tour" of a tours company (Mega Family): the tour page, its series,
 * its first dates with their prices and the flight blocks that serve them,
 * saved in one go from /tours/packages/new - the tours side of "Add Event".
 *
 * Every step runs through the action that owns it (createTourPackage,
 * saveSeries, createDeparture, saveDeparturePrices, addFlightAllocation), so
 * the rules are the ones the tour page, the series screen and the departure
 * card apply. Nothing is rolled back: once the tour page exists the answer
 * carries its id, and a step that failed is listed in `problems` for the tour
 * page to show - the operator finishes it there.
 */
import { revalidatePath } from "next/cache";

import { requireCompany } from "@/lib/company";
import { actionFail, actionOk, UserError, type ActionResult } from "@/lib/tours/action-kit";
import { isDateOnly, nightsBetween, weekdayOf } from "@/lib/tours/format";
import { createTourPackage } from "@/lib/actions/tours-content-actions";
import { saveSeries } from "@/lib/actions/tours-series-actions";
import { addFlightAllocation, createDeparture, saveDeparturePrices } from "@/lib/actions/tours-departure-actions";
import type { NewTourInput, NewTourResult } from "@/components/tours/content/shared";

const MAX_DATES = 120;
const SERIES_CODE = /^[A-Z][A-Z0-9]{1,7}$/;

export async function createTour(input: NewTourInput): Promise<ActionResult<NewTourResult>> {
  try {
    await requireCompany("tours");

    // --- what can be checked before anything is written
    const code = String(input.series?.code ?? "").trim().toUpperCase();
    if (!SERIES_CODE.test(code)) {
      throw new UserError("Series code: 2 to 8 characters, letters (A-Z) and digits, starting with a letter (e.g. BBC)");
    }
    const dates = Array.isArray(input.dates) ? input.dates : [];
    if (dates.length > MAX_DATES) throw new UserError(`Up to ${MAX_DATES} dates at once`);
    for (const d of dates) {
      if (!isDateOnly(d.start) || !isDateOnly(d.end)) throw new UserError("Every date needs a departure date and a return date");
      if (d.end < d.start) throw new UserError(`The return date of ${d.start} is before its departure date`);
    }
    if (new Set(dates.map((d) => d.start)).size !== dates.length) {
      throw new UserError("Two dates start on the same day - each date of a series needs its own day");
    }

    // --- 1. the tour page
    const page = await createTourPackage(input.page, code);
    if (!page.success) return page;
    const id = page.data.id;
    const problems: string[] = page.warning ? [page.warning] : [];
    const done = (departures: number, flights: number) => {
      revalidatePath("/tours/packages");
      revalidatePath(`/tours/packages/${id}`);
      revalidatePath("/tours/departures");
      return actionOk<NewTourResult>({ id, departures, flights, problems });
    };

    // --- 2. its series: route, currency and capacity of every date
    const sorted = [...dates].sort((a, b) => a.start.localeCompare(b.start));
    const first = sorted[0];
    const series = await saveSeries(null, {
      code,
      label: input.series.label?.trim() || input.page.name.trim(),
      package_id: id,
      arrival_airport: input.series.arrivalAirport || null,
      arrival_weekday: first ? weekdayOf(first.start) : null,
      return_airport: input.series.returnAirport || null,
      return_weekday: first ? weekdayOf(first.end) : null,
      default_nights: input.page.nights ?? (first ? nightsBetween(first.start, first.end) : null),
      default_capacity: input.series.capacity,
      default_currency: input.series.currency,
      child_max_age: input.series.childMaxAge,
      senior_min_age: 65,
      senior_discount: 25,
      is_active: true,
      termIds: [],
    });
    if (!series.success) {
      problems.push(`Series ${code} was not created: ${series.error}`);
      return done(0, 0);
    }

    // --- 3. the dates, each with the same price list
    const season = input.page.seasons.map((s) => s.trim()).find(Boolean) ?? null;
    const cells = (input.prices ?? []).filter((p) => p.price !== null && Number.isFinite(p.price));
    const created: { id: string; start: string; code: string }[] = [];
    for (const d of sorted) {
      const res = await createDeparture({ seriesId: series.data.id, start_date: d.start, end_date: d.end, season });
      if (!res.success) {
        problems.push(`Date ${d.start} was not created: ${res.error}`);
        continue;
      }
      created.push({ id: res.data.id, start: d.start, code: res.data.code });
      if (cells.length) {
        const prices = await saveDeparturePrices(res.data.id, cells);
        if (!prices.success) problems.push(`Prices of ${res.data.code} were not saved: ${prices.error}`);
      }
    }

    // --- 4. the flight blocks, by the date they serve
    let flights = 0;
    for (const f of input.flights ?? []) {
      const departure = created.find((c) => c.start === f.start);
      if (!departure) continue;
      const res = await addFlightAllocation(departure.id, f.flightId, f.seats, f.legs);
      if (res.success) flights += 1;
      else problems.push(`Flight block #${f.flightId} was not linked to ${departure.code}: ${res.error}`);
    }

    return done(created.length, flights);
  } catch (e) {
    return actionFail(e, "tours-tour-actions", "Failed to create the tour");
  }
}

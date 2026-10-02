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
import { toursDb } from "@/lib/tours/db";
import { actionFail, actionOk, must, UserError, type ActionResult } from "@/lib/tours/action-kit";
import { isDateOnly, nightsBetween, weekdayOf } from "@/lib/tours/format";
import { normalizeAirport } from "@/components/tours/departures/departure-utils";
import { CURRENCIES } from "@/types/tours.types";
import { createTourPackage, saveTourItinerary } from "@/lib/actions/tours-content-actions";
import { saveSeries } from "@/lib/actions/tours-series-actions";
import { addFlightAllocation, createDeparture, saveDeparturePrices } from "@/lib/actions/tours-departure-actions";
import type { NewTourInput, NewTourResult } from "@/components/tours/content/shared";

/** A season beyond this is added from the tour page (Add Season), not in one request. */
const MAX_DATES = 60;
const MAX_NIGHTS = 60;
const SERIES_CODE = /^[A-Z][A-Z0-9]{1,7}$/;

export async function createTour(input: NewTourInput): Promise<ActionResult<NewTourResult>> {
  try {
    const { company } = await requireCompany("tours");

    // --- everything the later steps would refuse is checked before the tour page is written,
    // so a refusal leaves nothing behind (only a race with another operator still can)
    const code = String(input.series?.code ?? "").trim().toUpperCase();
    if (!SERIES_CODE.test(code)) {
      throw new UserError("Series code: 2 to 8 characters, letters (A-Z) and digits, starting with a letter (e.g. BBC)");
    }
    const arrival = normalizeAirport(input.series.arrivalAirport);
    const ret = normalizeAirport(input.series.returnAirport);
    if (!arrival || !ret) throw new UserError("Arrival and return airports are three letters A-Z (e.g. LHR)");
    if (!(CURRENCIES as readonly string[]).includes(input.series.currency)) throw new UserError("Unsupported currency");
    const capacity = input.series.capacity;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0 || capacity > 2000)) {
      throw new UserError("Seats per date: a whole number from 0 to 2000");
    }
    if (!Number.isInteger(input.series.childMaxAge) || input.series.childMaxAge < 0 || input.series.childMaxAge > 25) {
      throw new UserError("Child age: a whole number from 0 to 25");
    }
    if ((input.page.nights ?? 0) > MAX_NIGHTS) throw new UserError(`A tour of more than ${MAX_NIGHTS} nights - check the nights`);
    const dates = Array.isArray(input.dates) ? input.dates : [];
    if (dates.length > MAX_DATES) throw new UserError(`Up to ${MAX_DATES} dates here - add the rest from the tour page (Add Season)`);
    for (const d of dates) {
      if (!isDateOnly(d.start) || !isDateOnly(d.end)) throw new UserError("Every date needs a departure date and a return date");
      if (d.end < d.start) throw new UserError(`The return date of ${d.start} is before its departure date`);
      if ((nightsBetween(d.start, d.end) ?? 0) > MAX_NIGHTS) throw new UserError(`The date ${d.start} is more than ${MAX_NIGHTS} nights long`);
    }
    if (new Set(dates.map((d) => d.start)).size !== dates.length) {
      throw new UserError("Two dates start on the same day - each date of a series needs its own day");
    }
    const taken = must(await toursDb().from("series").select("id").eq("company_id", company.id).eq("code", code).limit(1)) ?? [];
    if (taken.length) throw new UserError(`Series ${code} already exists - choose another code`);

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

    // --- 1b. the day-by-day plan
    const days = (input.itinerary ?? []).filter((d) => d.title.trim() || d.subtitle.trim() || d.html.trim());
    if (days.length) {
      const itinerary = await saveTourItinerary(id, null, { label: "מסלול ראשי", arrivalCity: "", returnCity: "", days });
      if (!itinerary.success) problems.push(`The itinerary was not saved: ${itinerary.error}`);
    }

    // --- 2. its series: route, currency and capacity of every date
    const sorted = [...dates].sort((a, b) => a.start.localeCompare(b.start));
    const first = sorted[0];
    const series = await saveSeries(null, {
      code,
      label: input.series.label?.trim() || input.page.name.trim(),
      package_id: id,
      arrival_airport: arrival,
      arrival_weekday: first ? weekdayOf(first.start) : null,
      return_airport: ret,
      return_weekday: first ? weekdayOf(first.end) : null,
      default_nights: input.page.nights ?? (first ? nightsBetween(first.start, first.end) : null),
      default_capacity: capacity,
      default_currency: input.series.currency,
      child_max_age: input.series.childMaxAge,
      senior_min_age: 65,
      senior_discount: 25,
      is_active: true,
      termIds: [],
    });
    if (!series.success) {
      problems.push(`Series ${code} was not created: ${series.error}. Create it on the Series screen with this tour as its page, then add the dates.`);
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

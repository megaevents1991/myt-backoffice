/**
 * Where a show flies to (tour uploader, build step 2 - spec 9.2). PURE: the build reads the
 * `locations` table, the venue's memory, the LiveTickets city and an earlier run's answer, then
 * hands them here; `decidePlace` answers with the package / ticket-only placement, a skip, or the
 * `pick_location` question. Never a guessed flight city.
 *
 * The decision tree, in order:
 *   1. two-city chosen by staff (`twoCity`, the far-venue offer): fly to that row, lodging split
 *      with the venue's city.
 *   2. the item's own answered `pick_location`: "skip" skips; a known location is the package; an
 *      answer naming no location asks again (never throws - a rebuild must not fail on it).
 *   3. no venue coordinates (a LiveTickets-only show, or a TixStock row without coordinates):
 *      the venue memory's two-city setup -> LiveTickets' own city fields -> an earlier run's answer
 *      ("skip" skips) -> ask.
 *   4. the nearest location with an IATA within NEAR_LOCATION_KM (+ the memory's lodging when it
 *      is a real second city).
 *   5. the venue memory's two-city setup (decision 9: memory before the brief's fallback).
 *   6. the plan's `without_location` rule: ticket-only, or skip `no_location` - both carrying the
 *      nearest location within FAR_VENUE_KM as the two-city offer.
 *
 * `itemLocation` always holds the nearest location when one exists within FAR_VENUE_KM (`far` =
 * beyond NEAR) - on a ticket-only or skipped item it is the default flight city of the two-city
 * rebuild. Selftest: scripts/tour-uploader-selftest.ts ("Task 7 place").
 */
import { defaultSplit, hasEventCity, shortPlace } from "@/lib/lodging";
import { normalizeName } from "@/lib/on-tour";
import { distanceKm, findNearestLocation, type LocationRow } from "@/lib/services/nearest-location";
import { FAR_VENUE_KM, NEAR_LOCATION_KM } from "@/lib/uploader/constants";
import { decision } from "@/lib/uploader/decisions";
import { questionKey } from "@/lib/uploader/shows";
import type { Event } from "@/types/app.types";
import type { Decision, ShowIdentity, UploaderItem, UploaderQuestion } from "@/types/uploader.types";

export type LodgingFields = Partial<
  Pick<Event, "event_location" | "lodging_mode" | "lodging_default" | "lodging_note" | "split_default_nights">
>;
export type ItemLocation = NonNullable<UploaderItem["location"]>;
export type FarVenue = { id: number; city: string; km: number };
type Answer = { key: string | null; text: string | null };

/**
 * A two-city event's split default, taken from `lib/lodging.ts` itself: the event-city nights
 * `defaultSplit` assigns when `split_default_nights` is unset (lodging.ts is mirrored verbatim in
 * main, so the number is read from it, not copied).
 */
export const SPLIT_DEFAULT_NIGHTS = defaultSplit(
  {
    date: "2000-01-05",
    location: { name: "flight", latitude: 0, longitude: 0 },
    event_location: { name: "event", latitude: 1, longitude: 1 },
    lodging_mode: "choice_split",
    split_default_nights: null,
  },
  "2000-01-01",
  "2000-01-09",
).filter((night) => night.city === "event").length;

export interface PlaceInput {
  show: ShowIdentity;
  subject_en: string;
  /** Every `locations` row. */
  rows: LocationRow[];
  withoutLocation: "ticket_only" | "skip";
  /** The far-venue offer was clicked: fly to this row. */
  twoCity: { flightCityId: number } | null;
  /** The item's own answered `pick_location`. */
  answer: Answer | null;
  /** An earlier run's answer to the same `pick_location` (`priorAnswerFor`). */
  prior: (Answer & { by: string; run_no: number }) | null;
  /** `live_events.iata` / `city_name` of the show's LiveTickets row (no-coordinates shows only). */
  liveCity: { iata: string | null; city: string | null } | null;
  /** The venue's memory: the remembered event, its lodging, and the IATA of the city it flew to. */
  memory: { fromEventName: string; lodging: LodgingFields | null; flightIata: string | null } | null;
  now: Date;
}

export type PlaceResult =
  | {
      kind: "placed";
      mode: "package" | "ticket_only";
      location: Event["location"];
      lodging: LodgingFields;
      itemLocation: ItemLocation | null;
      farVenue: FarVenue | null;
      decisions: Decision[];
    }
  | { kind: "skip"; reason: "no_location" | "skipped_by_answer"; itemLocation: ItemLocation | null; farVenue: FarVenue | null; decisions: Decision[] }
  | { kind: "ask"; question: UploaderQuestion; decisions: Decision[] }
  | { kind: "error"; message: string };

type WithCoords = ShowIdentity & { lat: number; lon: number };
const hasCoords = (show: ShowIdentity): show is WithCoords =>
  typeof show.lat === "number" && typeof show.lon === "number" && Number.isFinite(show.lat) && Number.isFinite(show.lon);

const iataOf = (row: LocationRow): string => (row.city_iata ?? "").trim();
const flyable = (rows: LocationRow[]): LocationRow[] => rows.filter((r) => iataOf(r) !== "");
/** "2027-05-20" -> "20.05.2027". */
const dayLabel = (day: string): string => day.split("-").reverse().join(".");

const flightCity = (row: LocationRow): Event["location"] => ({
  name: row.name,
  city_iata: iataOf(row),
  latitude: row.latitude,
  longitude: row.longitude,
  ...(row.country_code ? { country_code: row.country_code } : {}),
});

const itemLocationOf = (row: LocationRow, km: number | null): ItemLocation => ({
  id: row.id,
  name: row.name,
  city_iata: iataOf(row),
  latitude: row.latitude,
  longitude: row.longitude,
  km: km === null ? 0 : Math.round(km),
  far: km !== null && km > NEAR_LOCATION_KM,
});

/** `location_found`, with the distance only when the venue's coordinates are known. */
const foundLine = (row: LocationRow, km: number | null): Decision =>
  decision("location_found", km === null ? { city: shortPlace(row.name), iata: iataOf(row) } : { city: shortPlace(row.name), iata: iataOf(row), km });

/**
 * The show's own city as an `event_location`: the nearest `locations` row of ANY kind (Liverpool
 * and Manchester have no IATA) within NEAR_LOCATION_KM of the venue, in the site's own spelling;
 * else the supplier's city name at the venue's coordinates.
 */
export function venueCity(show: WithCoords, rows: LocationRow[]): NonNullable<Event["event_location"]> {
  let best: { row: LocationRow; km: number } | null = null;
  for (const row of rows) {
    const km = distanceKm(show.lat, show.lon, row.latitude, row.longitude);
    if (km <= NEAR_LOCATION_KM && (!best || km < best.km)) best = { row, km };
  }
  if (best) return { name: best.row.name, latitude: best.row.latitude, longitude: best.row.longitude, country_code: best.row.country_code ?? show.country_code };
  return { name: show.city || show.venue || "", latitude: show.lat, longitude: show.lon, country_code: show.country_code };
}

/**
 * The location row an answer names: its id (an option's key), else its IATA or its name typed as
 * free text. Only rows with an IATA (a package must fly there). null = it names none - "skip"
 * included (the caller handles skip first).
 */
export function locationFromAnswer(answer: Answer, rows: LocationRow[]): LocationRow | null {
  const candidates = flyable(rows);
  if (answer.key !== null && /^\d+$/.test(answer.key)) return candidates.find((r) => r.id === Number(answer.key)) ?? null;
  const typed = normalizeName(answer.text);
  if (typed === "") return null;
  return (
    candidates.find((r) => iataOf(r).toLowerCase() === typed) ??
    candidates.find((r) => normalizeName(r.name) === typed || normalizeName(shortPlace(r.name)) === typed) ??
    null
  );
}

/** LiveTickets' own city fields against `locations`: a 3-letter airport code (their `iata` is usually a COUNTRY code), else the city name. */
function liveCityLocation(liveCity: { iata: string | null; city: string | null }, rows: LocationRow[]): LocationRow | null {
  const candidates = flyable(rows);
  const iata = (liveCity.iata ?? "").trim().toUpperCase();
  const byIata = iata.length === 3 ? candidates.find((r) => iataOf(r).toUpperCase() === iata) : undefined;
  if (byIata) return byIata;
  const city = normalizeName(liveCity.city);
  return city === "" ? null : (candidates.find((r) => normalizeName(shortPlace(r.name)) === city) ?? null);
}

/** "flight_city" / "choice_split" ... as the two-city decision line names the lodging. */
function lodgingLabel(mode: string | null | undefined): string {
  switch (mode) {
    case "choice_split":
      return "פיצול מלון";
    case "choice":
      return "בחירת עיר לינה";
    case "event_city_only":
      return "לינה בעיר ההופעה";
    default:
      return "לינה בעיר הטיסה";
  }
}

/**
 * The `pick_location` question: every location with an IATA (Munich / Krakow listed twice are
 * listed once) + skip, free text allowed. The text names LiveTickets only when it is the one
 * supplier that sells the show.
 */
export function pickLocationQuestion(show: ShowIdentity, subject_en: string, rows: LocationRow[], now: Date): UploaderQuestion {
  const seen = new Set<string>();
  const options: UploaderQuestion["options"] = [];
  for (const r of flyable(rows)) {
    const id = `${normalizeName(r.name)}|${iataOf(r)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({ key: String(r.id), label: `${r.name} (${iataOf(r)})` });
  }
  const where = `ב-${show.city || "עיר לא ידועה"} ב-${dayLabel(show.date)}`;
  const text =
    show.suppliers.tixstock === null
      ? `LiveTickets מוכר הופעה ${where} בלי קואורדינטות של האולם - לאיזה מיקום לטוס?`
      : `להופעה ${where} אין קואורדינטות של האולם - לאיזה מיקום לטוס?`;
  return {
    kind: "pick_location",
    key: questionKey(show, subject_en),
    text,
    options: [...options, { key: "skip", label: "דלג על ההופעה" }],
    free_text: true,
    asked_at: now.toISOString(),
    task_id: null,
  };
}

/** The memory's two-city setup as a placement, when its flight city is a location with an IATA and the event city is a real second city. */
function memoryTwoCity(input: PlaceInput, kmFrom: (row: LocationRow) => number | null): PlaceResult | null {
  const m = input.memory;
  const eventLocation = m?.lodging?.event_location;
  if (!m || !m.lodging || !eventLocation) return null;
  const code = (m.flightIata ?? "").trim().toUpperCase();
  const flight = code === "" ? undefined : flyable(input.rows).find((r) => iataOf(r).toUpperCase() === code);
  if (!flight) return null;
  const location = flightCity(flight);
  if (!hasEventCity({ location, event_location: eventLocation })) return null;
  return {
    kind: "placed",
    mode: "package",
    location,
    lodging: { ...m.lodging },
    itemLocation: itemLocationOf(flight, kmFrom(flight)),
    farVenue: null,
    decisions: [
      decision("two_city_from_memory", {
        event: m.fromEventName,
        show_city: shortPlace(eventLocation.name),
        flight_city: shortPlace(flight.name),
        lodging: lodgingLabel(m.lodging.lodging_mode),
      }),
    ],
  };
}

/** Spec 9.2 - see the file header for the order. */
export function decidePlace(input: PlaceInput): PlaceResult {
  const { show, rows } = input;
  const coords = hasCoords(show) ? show : null;
  const kmFrom = (row: LocationRow): number | null => (coords ? distanceKm(coords.lat, coords.lon, row.latitude, row.longitude) : null);
  const ask = (): PlaceResult => ({ kind: "ask", question: pickLocationQuestion(show, input.subject_en, rows, input.now), decisions: [] });
  const package_ = (row: LocationRow, decisions: Decision[]): PlaceResult => ({
    kind: "placed",
    mode: "package",
    location: flightCity(row),
    lodging: {},
    itemLocation: itemLocationOf(row, kmFrom(row)),
    farVenue: null,
    decisions,
  });

  // 1. Staff chose a two-city package through a flight city (the far-venue offer).
  if (input.twoCity) {
    const id = input.twoCity.flightCityId;
    const flight = flyable(rows).find((r) => r.id === id);
    if (!flight) return { kind: "error", message: `two-city: location ${id} is not a location with an IATA code` };
    if (!coords) return { kind: "error", message: "two-city: the show has no venue coordinates to split the stay with" };
    const km = distanceKm(coords.lat, coords.lon, flight.latitude, flight.longitude);
    const eventLocation = venueCity(coords, rows);
    return {
      kind: "placed",
      mode: "package",
      location: flightCity(flight),
      lodging: { event_location: eventLocation, lodging_mode: "choice_split", lodging_default: "event", split_default_nights: SPLIT_DEFAULT_NIGHTS },
      itemLocation: itemLocationOf(flight, km),
      farVenue: null,
      decisions: [decision("two_city_chosen", { show_city: shortPlace(eventLocation.name), flight_city: shortPlace(flight.name), km })],
    };
  }

  // 2. The item's own answered question.
  if (input.answer) {
    if (input.answer.key === "skip") return { kind: "skip", reason: "skipped_by_answer", itemLocation: null, farVenue: null, decisions: [] };
    const row = locationFromAnswer(input.answer, rows);
    if (row) return package_(row, [foundLine(row, kmFrom(row))]);
    return ask(); // names no location we can fly to: ask again
  }

  // 3. No venue coordinates: memory, LiveTickets' city, an earlier answer - then ask.
  if (!coords) {
    const fromMemory = memoryTwoCity(input, kmFrom);
    if (fromMemory) return fromMemory;
    const byLiveCity = input.liveCity ? liveCityLocation(input.liveCity, rows) : null;
    if (byLiveCity) return package_(byLiveCity, [foundLine(byLiveCity, null)]);
    const prior = input.prior;
    if (prior) {
      const by = decision("prior_answer", { name: prior.by, run: prior.run_no });
      if (prior.key === "skip") return { kind: "skip", reason: "skipped_by_answer", itemLocation: null, farVenue: null, decisions: [by] };
      const row = locationFromAnswer(prior, rows);
      if (row) return package_(row, [by, foundLine(row, null)]);
    }
    return ask();
  }

  // 4. The nearest location with flights, within the package radius.
  const near = findNearestLocation(coords.lat, coords.lon, rows, NEAR_LOCATION_KM);
  if (near) {
    const location = flightCity(near.row);
    const decisions = [foundLine(near.row, near.km)];
    let lodging: LodgingFields = {};
    const memory = input.memory;
    if (memory?.lodging?.event_location && hasEventCity({ location, event_location: memory.lodging.event_location })) {
      lodging = { ...memory.lodging };
      decisions.push(decision("lodging_from_memory", { event: memory.fromEventName }));
    }
    return { kind: "placed", mode: "package", location, lodging, itemLocation: itemLocationOf(near.row, near.km), farVenue: null, decisions };
  }

  // 5. Memory before the brief's fallback (decision 9).
  const fromMemory = memoryTwoCity(input, kmFrom);
  if (fromMemory) return fromMemory;

  // 6. The plan's rule, with the far-venue offer when a location is within reach.
  const far = findNearestLocation(coords.lat, coords.lon, rows, FAR_VENUE_KM);
  const itemLocation = far ? itemLocationOf(far.row, far.km) : null;
  const farVenue = far ? { id: far.row.id, city: shortPlace(far.row.name), km: Math.round(far.km) } : null;
  if (input.withoutLocation === "skip") return { kind: "skip", reason: "no_location", itemLocation, farVenue, decisions: [] };
  return {
    kind: "placed",
    mode: "ticket_only",
    location: {
      name: show.city || show.venue || "",
      city_iata: "",
      latitude: coords.lat,
      longitude: coords.lon,
      ...(show.country_code ? { country_code: show.country_code } : {}),
    },
    lodging: {},
    itemLocation,
    farVenue,
    decisions: [decision("location_missing_ticket_only")],
  };
}

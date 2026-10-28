/**
 * Where a show flies to (tour uploader, build step 2 - spec 9.2). PURE: the build reads the
 * `locations` table, the venue's memory, the LiveTickets city, the run's city rule (`cityKey`) and an
 * earlier run's answer, then hands them here; `decidePlace` answers with the package / ticket-only
 * placement, a skip, or a question (`pick_location` / `create_location`). Never a guessed flight city.
 *
 * The decision tree, in order:
 *   1. two-city chosen by staff (`twoCity`, the far-venue offer): fly to that row, lodging split
 *      with the venue's city.
 *   2. the item's own answered `pick_location` / `create_location`: "skip" skips; "ticket_only" builds
 *      step 6's ticket-only body; "two_city:<id>" is step 1 through that row (an id that is no flyable
 *      location is an error); a known location is the package; an answer naming no location (the
 *      `create` option included - its form answers with the new id) asks again (never throws - a
 *      rebuild must not fail on it).
 *   3. no venue coordinates (a LiveTickets-only show, or a TixStock row without coordinates):
 *      LiveTickets' own city fields (a found location is the package, the memory adds its lodging -
 *      as on the with-coordinates path) -> the venue memory's two-city setup -> an earlier run's
 *      `pick_location` answer ("skip" skips) -> ask `pick_location`.
 *   3b. the city beats bad coordinates (Alon round 2, spec 3.4): a flyable location whose name or
 *      alias is the show's city (`cityKey`; the country codes agree when both are known - the nearest
 *      to the venue, then the lowest id) is the package when it is FARTHER than NEAR_LOCATION_KM from
 *      the venue's coordinates (`location_by_city`, `coordsFar` -> the `venue_coords_far` warning);
 *      nearer, step 4 finds it by itself. TixStock put "Velodrome Berlin" in the middle of Germany.
 *   4. the nearest location with an IATA within NEAR_LOCATION_KM (+ the memory's lodging when it
 *      is a real second city).
 *   5. the venue memory's two-city setup (decision 9: memory before the brief's fallback).
 *   6. an earlier run's `create_location` answer (`prior_answer`, applied as step 2 applies it), else
 *      ASK `create_location` (D2 - never a silent ticket-only or skip): create a location / two-city
 *      through the nearest location within FAR_VENUE_KM / ticket only / skip; the plan's
 *      `without_location` rule only marks its option "(לפי הבריף)" and puts it first of the two.
 *
 * `itemLocation` always holds the nearest location when one exists within FAR_VENUE_KM (`far` =
 * beyond NEAR) - on a ticket-only item it is the default flight city of the two-city rebuild.
 * Selftest: scripts/tour-uploader-selftest.ts ("Task 7 place", "Alon round 2, Task 4").
 */
import { defaultSplit, hasEventCity, shortPlace } from "@/lib/lodging";
import { normalizeName } from "@/lib/on-tour";
import { distanceKm, findNearestLocation, type LocationRow } from "@/lib/services/nearest-location";
import { FAR_VENUE_KM, NEAR_LOCATION_KM } from "@/lib/uploader/constants";
import { decision } from "@/lib/uploader/decisions";
import { questionKey } from "@/lib/uploader/shows";
import type { Event } from "@/types/app.types";
import type { Decision, QuestionKind, ShowIdentity, UploaderItem, UploaderQuestion } from "@/types/uploader.types";

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
  /** The item's own answered `pick_location` / `create_location`. */
  answer: Answer | null;
  /**
   * An earlier run's answer to the same question key (`priorAnswerFor`). `kind` = the question it
   * answered: a `pick_location` answer only answers the no-coordinates path, a `create_location` one
   * only step 6 - never each other.
   */
  prior: (Answer & { by: string; run_no: number; kind: QuestionKind }) | null;
  /** `live_events.iata` / `city_name` of the show's LiveTickets row (no-coordinates shows only). */
  liveCity: { iata: string | null; city: string | null } | null;
  /** The venue's memory: the remembered event, its lodging, and the IATA of the city it flew to. */
  memory: { fromEventName: string; lodging: LodgingFields | null; flightIata: string | null } | null;
  /**
   * The run's city rule (`Equivalence.cityKey`, lib/uploader/equivalence.ts): two names of one city
   * share a key ("Berlin" / "ברלין" once a location lists the alias). A row's own short name and
   * aliases are matched through it too, so an empty rule still honours `locations.aliases`.
   */
  cityKey: (name: string | null) => string;
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
      /** Placed by the city's name although the venue's coordinates are this far from it (step 3b) - the `venue_coords_far` warning. */
      coordsFar: { city: string; km: number } | null;
      decisions: Decision[];
    }
  // Only a person's (or an earlier run's) "skip" skips: a show with no location asks (`create_location`). The old
  // `no_location` skip reason stays on items built before round 2 (`canRebuildTwoCity` still reads it).
  | { kind: "skip"; reason: "skipped_by_answer"; itemLocation: ItemLocation | null; farVenue: FarVenue | null; decisions: Decision[] }
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

/** The show's and the row's country codes agree: equal, or one side does not know its code. */
function countryAgrees(code: string | null, row: LocationRow): boolean {
  const a = (code ?? "").trim().toUpperCase();
  const b = (row.country_code ?? "").trim().toUpperCase();
  return a === "" || b === "" || a === b;
}

/**
 * The flyable rows of the city `city` names: its key (`cityKey`) is the key of the row's short name or
 * of one of its aliases, and the country codes agree. In `rows` order (the table's id order).
 */
function rowsOfCity(city: string | null, countryCode: string | null, rows: LocationRow[], cityKey: PlaceInput["cityKey"]): LocationRow[] {
  const key = cityKey(city);
  if (key === "") return [];
  return flyable(rows).filter(
    (r) => countryAgrees(countryCode, r) && [shortPlace(r.name), ...(r.aliases ?? [])].some((name) => cityKey(name) === key),
  );
}

/**
 * LiveTickets' own city fields against `locations`: a 3-letter airport code (their `iata` is usually a
 * COUNTRY code), else the city name - its short name or an alias, through the run's city rule.
 */
function liveCityLocation(
  liveCity: { iata: string | null; city: string | null },
  countryCode: string | null,
  rows: LocationRow[],
  cityKey: PlaceInput["cityKey"],
): LocationRow | null {
  const iata = (liveCity.iata ?? "").trim().toUpperCase();
  const byIata = iata.length === 3 ? flyable(rows).find((r) => iataOf(r).toUpperCase() === iata) : undefined;
  if (byIata) return byIata;
  return rowsOfCity(liveCity.city, countryCode, rows, cityKey)[0] ?? null;
}

/** Step 3b: the show's city as a location, the one nearest the venue (then the lowest id), with its distance. */
function cityLocation(show: WithCoords, rows: LocationRow[], cityKey: PlaceInput["cityKey"]): { row: LocationRow; km: number } | null {
  let best: { row: LocationRow; km: number } | null = null;
  for (const row of rowsOfCity(show.city, show.country_code, rows, cityKey)) {
    const km = distanceKm(show.lat, show.lon, row.latitude, row.longitude);
    if (!best || km < best.km || (km === best.km && row.id < best.row.id)) best = { row, km };
  }
  return best;
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
    options: [...options, { key: "create", label: "צור מיקום חדש" }, { key: "skip", label: "דלג על ההופעה" }],
    free_text: true,
    asked_at: now.toISOString(),
    task_id: null,
  };
}

/** The brief's own option among ticket_only / skip says so. */
const BY_THE_BRIEF = " (לפי הבריף)";

/**
 * The `create_location` question (Alon round 2, spec 4.1): a show with coordinates and no location
 * within NEAR_LOCATION_KM. Options, in order: create a location for the city (its form answers with
 * the new id), a two-city package through `far` (the nearest flyable location within FAR_VENUE_KM;
 * none = no such option), then ticket only / skip - the plan's `without_location` rule first of the
 * two and marked "(לפי הבריף)". Closed (no free text): an existing location farther away is the
 * two-city option, a new one is `create`. `rows` = the `locations` table, as `pickLocationQuestion`
 * takes it (the two-city offer is already resolved from it into `far`).
 */
export function createLocationQuestion(
  show: ShowIdentity,
  subject_en: string,
  rows: LocationRow[],
  withoutLocation: PlaceInput["withoutLocation"],
  far: FarVenue | null,
  now: Date,
): UploaderQuestion {
  const city = show.city.trim() || "עיר לא ידועה";
  const venue = (show.venue ?? "").trim();
  const ticketOnly = { key: "ticket_only", label: `כרטיס בלבד${withoutLocation === "ticket_only" ? BY_THE_BRIEF : ""}` };
  const skip = { key: "skip", label: `דלג${withoutLocation === "skip" ? BY_THE_BRIEF : ""}` };
  return {
    kind: "create_location",
    key: questionKey(show, subject_en),
    text: `אין לנו מיקום ל-${city}${venue ? ` (${venue})` : ""}. מה לעשות?`,
    options: [
      { key: "create", label: `צור מיקום ל-${city}` },
      ...(far ? [{ key: `two_city:${far.id}`, label: `חבילה דרך ${far.city} (${far.km} ק"מ) עם פיצול מלון` }] : []),
      ...(withoutLocation === "skip" ? [skip, ticketOnly] : [ticketOnly, skip]),
    ],
    free_text: false,
    asked_at: now.toISOString(),
    task_id: null,
  };
}

/** A found flight city keeps the venue memory's lodging when it names a real second city (decision `lodging_from_memory`). */
function memoryLodging(input: PlaceInput, location: Event["location"]): { lodging: LodgingFields; decisions: Decision[] } {
  const memory = input.memory;
  if (!memory?.lodging?.event_location || !hasEventCity({ location, event_location: memory.lodging.event_location })) return { lodging: {}, decisions: [] };
  return { lodging: { ...memory.lodging }, decisions: [decision("lodging_from_memory", { event: memory.fromEventName })] };
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
    coordsFar: null,
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

/** "two_city:<id>" -> the id; anything else -> null. */
const TWO_CITY_KEY = /^two_city:(\d+)$/;

/** Spec 9.2 - see the file header for the order. */
export function decidePlace(input: PlaceInput): PlaceResult {
  const { show, rows } = input;
  const coords = hasCoords(show) ? show : null;
  const kmFrom = (row: LocationRow): number | null => (coords ? distanceKm(coords.lat, coords.lon, row.latitude, row.longitude) : null);
  // The nearest flyable location within FAR (beyond NEAR on every path that reads it): the two-city offer.
  const farOf = (at: WithCoords): { row: LocationRow; km: number } | null => findNearestLocation(at.lat, at.lon, rows, FAR_VENUE_KM);
  const farVenueOf = (far: { row: LocationRow; km: number } | null): FarVenue | null =>
    far ? { id: far.row.id, city: shortPlace(far.row.name), km: Math.round(far.km) } : null;
  const ask = (): PlaceResult =>
    coords
      ? { kind: "ask", question: createLocationQuestion(show, input.subject_en, rows, input.withoutLocation, farVenueOf(farOf(coords)), input.now), decisions: [] }
      : { kind: "ask", question: pickLocationQuestion(show, input.subject_en, rows, input.now), decisions: [] };
  const skip = (decisions: Decision[]): PlaceResult => ({ kind: "skip", reason: "skipped_by_answer", itemLocation: null, farVenue: null, decisions });
  const package_ = (row: LocationRow, decisions: Decision[]): PlaceResult => ({
    kind: "placed",
    mode: "package",
    location: flightCity(row),
    lodging: {},
    itemLocation: itemLocationOf(row, kmFrom(row)),
    farVenue: null,
    coordsFar: null,
    decisions,
  });

  /** A two-city package flying to `flightCityId`, lodging split with the venue's city (step 1, and a `two_city:<id>` answer). */
  const twoCity = (flightCityId: number, before: Decision[]): PlaceResult => {
    const flight = flyable(rows).find((r) => r.id === flightCityId);
    if (!flight) return { kind: "error", message: `two-city: location ${flightCityId} is not a location with an IATA code` };
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
      coordsFar: null,
      decisions: [...before, decision("two_city_chosen", { show_city: shortPlace(eventLocation.name), flight_city: shortPlace(flight.name), km })],
    };
  };

  /** Ticket only at the venue, carrying the nearest location within FAR as the two-city offer (step 6's body). */
  const ticketOnly = (at: WithCoords, before: Decision[]): PlaceResult => {
    const far = farOf(at);
    return {
      kind: "placed",
      mode: "ticket_only",
      location: {
        name: show.city || show.venue || "",
        city_iata: "",
        latitude: at.lat,
        longitude: at.lon,
        ...(show.country_code ? { country_code: show.country_code } : {}),
      },
      lodging: {},
      itemLocation: far ? itemLocationOf(far.row, far.km) : null,
      farVenue: farVenueOf(far),
      coordsFar: null,
      decisions: [...before, decision("location_missing_ticket_only")],
    };
  };

  /**
   * An answer to a location question as a placement (the item's own, or an earlier run's with
   * `prior_answer` in `before`): skip, ticket only, two-city, a location; null = it names nothing we
   * can build (the caller asks). `strict` (the item's own answer): a two-city answer to a location
   * that is not there is an error, as the far-venue offer's is; an earlier run's is only no answer.
   */
  const applyAnswer = (answer: Answer, before: Decision[], strict: boolean): PlaceResult | null => {
    if (answer.key === "skip") return skip(before);
    if (answer.key === "ticket_only") return coords ? ticketOnly(coords, before) : null;
    if (answer.key !== null && answer.key.startsWith("two_city:")) {
      const id = TWO_CITY_KEY.exec(answer.key)?.[1];
      if (id === undefined) return strict ? { kind: "error", message: `two-city: "${answer.key}" names no location` } : null;
      const placed = twoCity(Number(id), before);
      return placed.kind === "error" && !strict ? null : placed;
    }
    const row = locationFromAnswer(answer, rows);
    return row ? package_(row, [...before, foundLine(row, kmFrom(row))]) : null;
  };
  const priorOf = (kind: QuestionKind): PlaceResult | null => {
    const prior = input.prior;
    if (!prior || prior.kind !== kind) return null;
    return applyAnswer(prior, [decision("prior_answer", { name: prior.by, run: prior.run_no })], false);
  };

  // 1. Staff chose a two-city package through a flight city (the far-venue offer).
  if (input.twoCity) return twoCity(input.twoCity.flightCityId, []);

  // 2. The item's own answered question (pick_location / create_location). Naming no location we can fly to: ask again.
  if (input.answer) return applyAnswer(input.answer, [], true) ?? ask();

  // 3. No venue coordinates: LiveTickets' city, memory, an earlier answer - then ask.
  if (!coords) {
    const byLiveCity = input.liveCity ? liveCityLocation(input.liveCity, show.country_code, rows, input.cityKey) : null;
    if (byLiveCity) {
      const { lodging, decisions } = memoryLodging(input, flightCity(byLiveCity));
      return {
        kind: "placed",
        mode: "package",
        location: flightCity(byLiveCity),
        lodging,
        itemLocation: itemLocationOf(byLiveCity, null),
        farVenue: null,
        coordsFar: null,
        decisions: [foundLine(byLiveCity, null), ...decisions],
      };
    }
    return memoryTwoCity(input, kmFrom) ?? priorOf("pick_location") ?? ask();
  }

  // 3b. The city's own name beats coordinates that put the venue far from it (TixStock's "Velodrome Berlin" at
  //     51.5, 10.5). Within NEAR the nearest step below finds the city by itself.
  const byCity = cityLocation(coords, rows, input.cityKey);
  if (byCity && byCity.km > NEAR_LOCATION_KM) {
    const location = flightCity(byCity.row);
    const city = shortPlace(byCity.row.name);
    const { lodging, decisions } = memoryLodging(input, location);
    return {
      kind: "placed",
      mode: "package",
      location,
      lodging,
      // The package flies here: never `far` (that flag means "no package of its own" - the two-city offer).
      itemLocation: { ...itemLocationOf(byCity.row, byCity.km), far: false },
      farVenue: null,
      coordsFar: { city, km: Math.round(byCity.km) },
      decisions: [decision("location_by_city", { city, iata: iataOf(byCity.row) }), ...decisions],
    };
  }

  // 4. The nearest location with flights, within the package radius.
  const near = findNearestLocation(coords.lat, coords.lon, rows, NEAR_LOCATION_KM);
  if (near) {
    const location = flightCity(near.row);
    const { lodging, decisions } = memoryLodging(input, location);
    return {
      kind: "placed",
      mode: "package",
      location,
      lodging,
      itemLocation: itemLocationOf(near.row, near.km),
      farVenue: null,
      coordsFar: null,
      decisions: [foundLine(near.row, near.km), ...decisions],
    };
  }

  // 5. Memory before the brief's fallback (decision 9).
  // 6. An earlier run's create_location answer, else ask create_location (D2: never a silent ticket-only / skip).
  return memoryTwoCity(input, kmFrom) ?? priorOf("create_location") ?? ask();
}

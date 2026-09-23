/**
 * Lodging cities - the ONE place the rules live (mirrored verbatim in main
 * `lib/events/lodging.ts`; keep both in sync, selftest: scripts/lodging-selftest.ts).
 *
 * Flight city = `event.location` (always offered, carries city_iata). Event city =
 * `event.event_location` (null = same city). A split stay assigns every night of the
 * CHOSEN travel dates to one of the two cities; consecutive nights in one city form a
 * segment (max 3, i.e. A → B → A). Dates never change here (spec v5.3).
 */

export const LODGING_MODES = ["flight_city", "event_city_only", "choice", "choice_split"] as const;
export type LodgingMode = (typeof LODGING_MODES)[number];
export const LODGING_CITIES = ["flight", "event"] as const;
export type LodgingCity = (typeof LODGING_CITIES)[number];
export const MAX_SEGMENTS = 3;

export type LodgingPoint = {
  name: string;
  latitude: number;
  longitude: number;
  country_code?: string | null;
  city_iata?: string | null;
};

export type LodgingEvent = {
  date?: string | null;
  location: LodgingPoint;
  event_location?: LodgingPoint | null;
  lodging_mode?: LodgingMode | string | null;
  lodging_default?: LodgingCity | string | null;
  lodging_note?: string | null;
  split_default_nights?: number | null;
};

export type NightAssign = { date: string; city: LodgingCity }; // date = the night's check-in day (YYYY-MM-DD)
export type StaySegment = { city: LodgingCity; checkin: string; checkout: string; nights: number };

const isPoint = (p: unknown): p is LodgingPoint =>
  !!p && typeof p === "object" &&
  Number.isFinite(Number((p as LodgingPoint).latitude)) &&
  Number.isFinite(Number((p as LodgingPoint).longitude)) &&
  typeof (p as LodgingPoint).name === "string" && (p as LodgingPoint).name.trim() !== "";

/** True when the event carries a usable second city that is not the flight city itself. */
export function hasEventCity(e: LodgingEvent): boolean {
  const ev = e.event_location;
  if (!isPoint(ev) || !isPoint(e.location)) return false;
  const same =
    Math.abs(Number(ev.latitude) - Number(e.location.latitude)) < 0.02 &&
    Math.abs(Number(ev.longitude) - Number(e.location.longitude)) < 0.02;
  return !same;
}

export function lodgingMode(e: LodgingEvent): LodgingMode {
  const m = e.lodging_mode;
  return (LODGING_MODES as readonly string[]).includes(m ?? "") ? (m as LodgingMode) : "flight_city";
}

/** The location the hotel search should run around for a city. Event city borrows the flight city's IATA. */
export function lodgingLocation(e: LodgingEvent, city: LodgingCity): LodgingPoint {
  if (city === "event" && hasEventCity(e) && e.event_location) {
    return { ...e.event_location, city_iata: e.location.city_iata ?? null };
  }
  return e.location;
}

export function cityName(e: LodgingEvent, city: LodgingCity): string {
  return lodgingLocation(e, city).name;
}

/** Cities the hotel step offers, in display order. Without a real event city everything collapses to the flight city. */
export function offeredCities(e: LodgingEvent): LodgingCity[] {
  if (!hasEventCity(e)) return ["flight"];
  switch (lodgingMode(e)) {
    case "event_city_only": return ["event"];
    case "choice":
    case "choice_split": return ["flight", "event"];
    default: return ["flight"];
  }
}

export function splitOffered(e: LodgingEvent): boolean {
  return hasEventCity(e) && lodgingMode(e) === "choice_split";
}

export function defaultCity(e: LodgingEvent): LodgingCity {
  const offered = offeredCities(e);
  const wanted = e.lodging_default === "event" ? "event" : "flight";
  return offered.includes(wanted) ? wanted : offered[0];
}

/** Human rules for the editor (empty = valid). */
export function lodgingProblems(e: LodgingEvent): string[] {
  const out: string[] = [];
  const mode = e.lodging_mode ?? "flight_city";
  if (!(LODGING_MODES as readonly string[]).includes(mode)) out.push(`Unknown lodging mode "${mode}".`);
  if (mode !== "flight_city" && !hasEventCity(e)) {
    out.push("Lodging mode needs an Event city (name + coordinates) different from the flight city.");
  }
  if (e.split_default_nights != null && ![1, 2].includes(Number(e.split_default_nights))) {
    out.push("Split default nights must be 1 or 2.");
  }
  return out;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Every night between checkin (inclusive) and checkout (exclusive), as check-in days. */
export function nightsBetween(checkin: string, checkout: string): string[] {
  const out: string[] = [];
  if (!checkin || !checkout || checkin >= checkout) return out;
  for (let d = checkin; d < checkout && out.length < 60; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Our proposed split: the event night (and, with 2 default nights, the night before) in the
 * event city, every other night in the flight city. Clamped to the travel window; an event
 * outside the window puts the last night(s) in the event city.
 */
export function defaultSplit(e: LodgingEvent, checkin: string, checkout: string): NightAssign[] {
  const nights = nightsBetween(checkin, checkout);
  if (!nights.length) return [];
  const want = Number(e.split_default_nights) === 1 ? 1 : 2;
  const eventDay = (e.date ?? "").slice(0, 10);
  let idx = nights.indexOf(eventDay);
  if (idx < 0) idx = eventDay && eventDay > nights[nights.length - 1] ? nights.length - 1 : Math.min(1, nights.length - 1);
  const evNights = new Set<number>();
  for (let k = 0; k < want; k++) { const i = idx - k; if (i >= 0) evNights.add(i); }
  return nights.map((date, i) => ({ date, city: evNights.has(i) ? "event" : "flight" }));
}

/** Consecutive nights in one city → one segment. */
export function segmentsFromNights(nights: NightAssign[]): StaySegment[] {
  const out: StaySegment[] = [];
  for (const n of nights) {
    const last = out[out.length - 1];
    if (last && last.city === n.city && last.checkout === n.date) {
      last.checkout = addDays(n.date, 1); last.nights += 1;
    } else {
      out.push({ city: n.city, checkin: n.date, checkout: addDays(n.date, 1), nights: 1 });
    }
  }
  return out;
}

/** Flip one night's city if the result stays within MAX_SEGMENTS; otherwise return null. */
export function flipNight(nights: NightAssign[], index: number): NightAssign[] | null {
  if (index < 0 || index >= nights.length) return null;
  const next = nights.map((n, i) => (i === index ? { ...n, city: n.city === "event" ? "flight" : "event" } as NightAssign : n));
  return segmentsFromNights(next).length <= MAX_SEGMENTS ? next : null;
}

export function allNights(nights: NightAssign[], city: LodgingCity): NightAssign[] {
  return nights.map((n) => ({ ...n, city }));
}

/**
 * Re-fit an existing assignment to new travel dates (the customer changed the flight):
 * kept nights keep their city, new edge nights take the city of the nearest kept edge.
 */
export function refitNights(prev: NightAssign[], checkin: string, checkout: string): NightAssign[] {
  const nights = nightsBetween(checkin, checkout);
  if (!prev.length) return nights.map((date) => ({ date, city: "flight" as LodgingCity }));
  const byDate = new Map(prev.map((n) => [n.date, n.city]));
  const first = prev[0], last = prev[prev.length - 1];
  return nights.map((date) => ({
    date,
    city: byDate.get(date) ?? (date < first.date ? first.city : last.city),
  }));
}

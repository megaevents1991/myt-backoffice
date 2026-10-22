/**
 * Feedback forms per series + a question per hotel - PURE rules, no I/O.
 * Spec: docs/superpowers/specs/2026-10-21-forms-series-hotels-design.md
 *
 * A form may belong to a tours SERIES (BBC, FPAR...); its trip links pick a departure of
 * that series. A "hotel question" is an ordinary star rating whose config names the city and
 * the hotel, so every average, the Google gate and the per-form report read it unchanged -
 * only the hotels report groups by it. Selftest: scripts/forms-series-selftest.ts.
 */

import type {
  AnswerMap,
  FormField,
  FormFieldConfig,
  FormLang,
  HotelSnapshot,
} from "@/types/form.types";

// ---------------------------------------------------------------- hotel question

export type HotelConfig = NonNullable<FormFieldConfig["hotel"]>;

const HOTEL_TEXT_MAX = 120;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, HOTEL_TEXT_MAX) : "";
}

/**
 * The hotel config as it may be stored: strings only, trimmed and capped. A config with
 * neither a city nor a name is no hotel question at all (undefined).
 */
export function normalizeHotelConfig(raw: unknown): HotelConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const city_he = cleanText(source.city_he);
  const city_en = cleanText(source.city_en);
  const name = cleanText(source.name);
  if (!city_he && !city_en && !name) return undefined;
  return { city_he, city_en: city_en || null, name };
}

/** The hotel a rating question asks about, or null for any other question. */
export function hotelOf(field: Pick<FormField, "type" | "config">): HotelConfig | null {
  if (field.type !== "rating") return null;
  return normalizeHotelConfig(field.config?.hotel) ?? null;
}

/** The wording a hotel question starts with - staff may rewrite it. */
export function hotelQuestionLabel(city: string, lang: FormLang): string {
  const place = city.trim();
  if (lang === "en") return place ? `How was the hotel in ${place}?` : "How was the hotel?";
  return place ? `איך היה המלון ב${place}?` : "איך היה המלון?";
}

/**
 * What a hotel question asked about when an answer came in - stored on the response
 * (`field_context.hotels`) so a later change of hotel never moves old answers. Only the
 * hotel questions that were ANSWERED are kept.
 */
export function hotelSnapshots(
  fields: Pick<FormField, "id" | "type" | "config" | "staff_only">[],
  values: AnswerMap,
): Record<string, HotelSnapshot> {
  const out: Record<string, HotelSnapshot> = {};
  for (const field of fields) {
    if (field.staff_only) continue;
    const hotel = hotelOf(field);
    if (!hotel) continue;
    const key = String(field.id);
    if (typeof values[key] !== "number") continue;
    out[key] = { city: hotel.city_he || hotel.city_en || "", name: hotel.name };
  }
  return out;
}

/** Read `field_context.hotels` back - anything malformed reads as "no snapshot". */
export function snapshotsOf(context: unknown): Record<string, HotelSnapshot> {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  const hotels = (context as { hotels?: unknown }).hotels;
  if (!hotels || typeof hotels !== "object" || Array.isArray(hotels)) return {};
  const out: Record<string, HotelSnapshot> = {};
  for (const [key, value] of Object.entries(hotels as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    out[key] = { city: cleanText(v.city), name: cleanText(v.name) };
  }
  return out;
}

/**
 * One hotel = one city + one name, however staff typed them on different series:
 * case, spaces ("DoubleTree" / "Double Tree"), quotes, dashes and accents do not split a
 * hotel in two - only letters and digits are compared.
 */
export function hotelKey(city: string, name: string): string {
  const norm = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  return `${norm(city)}|${norm(name)}`;
}

// ---------------------------------------------------------------- departures

export type SeriesDeparture = {
  id: string;
  /** "BBC703" = series code + MMDD. */
  code: string;
  /** yyyy-mm-dd */
  start_date: string;
  end_date: string | null;
  series_code: string;
  /** The tours.series row - a series form only takes its own series' departures. */
  series_id?: string;
};

/**
 * The trip code a departure gets on a trip link: the series letters + the number its own
 * code carries (BBC703 -> BBC / 703), else month + day (2026-10-14 -> 1014) - the way
 * staff have been typing them (CBEA-1014, BBC-923).
 */
export function departureTripCode(
  departure: Pick<SeriesDeparture, "code" | "start_date" | "series_code">,
): { prefix: string; num: string } | null {
  const prefix = departure.series_code.trim().toUpperCase();
  if (!/^[A-Z]{1,8}$/.test(prefix)) return null;
  const code = departure.code.trim().toUpperCase();
  const tail = code.startsWith(prefix) ? code.slice(prefix.length) : "";
  if (/^\d{1,8}$/.test(tail)) return { prefix, num: tail };
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(departure.start_date);
  if (!m) return null;
  return { prefix, num: `${Number(m[1])}${m[2]}` };
}

/**
 * The order the trip-link picker lists departures in: a link is made around the end of a
 * trip, so the ones that already left come first, newest first; then the coming ones,
 * soonest first.
 */
export function orderDepartures<T extends Pick<SeriesDeparture, "start_date" | "code">>(
  departures: T[],
  today: string,
): T[] {
  const left = departures
    .filter((d) => d.start_date <= today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date) || a.code.localeCompare(b.code));
  const coming = departures
    .filter((d) => d.start_date > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.code.localeCompare(b.code));
  return [...left, ...coming];
}

// ---------------------------------------------------------------- hotels report

export type HotelAnswer = {
  formId: number;
  fieldId: number;
  /** The star answer. */
  value: number;
  /** The question's star count - answers are read on a 5-point scale. */
  max: number;
  city: string;
  name: string;
  /** "BBC-703", null when the answer came through no trip link. */
  tripCode: string | null;
  /** The trip link it came through - a trip is one link. */
  inviteId: number | null;
  /** Series letters: the trip code's, else the form's series. */
  series: string | null;
  submittedAt: string;
};

export type HotelRow = {
  key: string;
  city: string;
  name: string;
  /** Mean on a 5-point scale, 2 decimals. */
  avg: number;
  answers: number;
  /** How many star answers of each value (1..5), index 0 = one star. */
  spread: number[];
  trips: number;
  series: string[];
  forms: number[];
  /** The trip with the lowest mean for this hotel - where to start the call. */
  worstTrip: { code: string; avg: number; answers: number } | null;
  lastAt: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A star answer on a 5-point scale (a 10-star question counts half per star). */
export function onFive(value: number, max: number): number {
  const top = Number.isFinite(max) && max > 0 ? max : 5;
  return (value / top) * 5;
}

/** Every hotel answer rolled up per hotel, the weakest hotel first. */
export function buildHotelRows(answers: HotelAnswer[]): HotelRow[] {
  const groups = new Map<string, HotelAnswer[]>();
  for (const answer of answers) {
    if (!Number.isFinite(answer.value)) continue;
    const key = hotelKey(answer.city, answer.name);
    const list = groups.get(key);
    if (list) list.push(answer);
    else groups.set(key, [answer]);
  }

  const rows: HotelRow[] = [];
  for (const [key, list] of groups) {
    const scores = list.map((a) => onFive(a.value, a.max));
    const spread = [0, 0, 0, 0, 0];
    for (const score of scores) {
      const star = Math.min(5, Math.max(1, Math.round(score)));
      spread[star - 1] += 1;
    }

    const byTrip = new Map<number, HotelAnswer[]>();
    for (const answer of list) {
      if (answer.inviteId == null) continue;
      const trip = byTrip.get(answer.inviteId);
      if (trip) trip.push(answer);
      else byTrip.set(answer.inviteId, [answer]);
    }
    let worstTrip: HotelRow["worstTrip"] = null;
    for (const trip of byTrip.values()) {
      const avg = round2(
        trip.reduce((sum, a) => sum + onFive(a.value, a.max), 0) / trip.length,
      );
      const code = trip[0].tripCode ?? "";
      if (!worstTrip || avg < worstTrip.avg || (avg === worstTrip.avg && trip.length > worstTrip.answers)) {
        worstTrip = { code, avg, answers: trip.length };
      }
    }

    // The newest answer names the hotel the way staff spell it today.
    const newest = [...list].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    rows.push({
      key,
      city: newest.city,
      name: newest.name,
      avg: round2(scores.reduce((sum, s) => sum + s, 0) / scores.length),
      answers: list.length,
      spread,
      trips: byTrip.size,
      series: [...new Set(list.map((a) => a.series).filter((s): s is string => Boolean(s)))].sort(),
      forms: [...new Set(list.map((a) => a.formId))].sort((a, b) => a - b),
      worstTrip,
      lastAt: newest.submittedAt,
    });
  }

  return rows.sort(
    (a, b) => a.avg - b.avg || b.answers - a.answers || a.key.localeCompare(b.key),
  );
}

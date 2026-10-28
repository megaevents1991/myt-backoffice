/**
 * Tour uploader (agent #3) - a location a person creates from a question (Alon's round 2, spec
 * docs/superpowers/specs/2026-10-28-uploader-alon-round-2-design.md section 4.2). A show with no location
 * near it asks `create_location` (or `pick_location` when it has no coordinates); the question card's
 * `create` option opens a form that the agent pre-fills (`propose_location`, lib/services/tour-uploader-location.ts)
 * and a person confirms. Everything the form may write to `locations` is checked here, in one place:
 *
 *  - `validateLocationInput`: the confirm. The Hebrew name ("<city>, <country>" like the existing rows), the
 *    IATA (3 letters), coordinates in range and not the (0, 0) placeholder, an optional ISO-2 country, the
 *    other spellings (deduped by `normalizeName`, at most `LOCATION_ALIASES_MAX`), and no existing row with
 *    the same IATA AND the same city.
 *  - `parseLocationProposal`: the model's answer, salvaged field by field over a fallback (the show's own
 *    coordinates, country and city spelling) - it never refuses, a bad field simply stays what the show knew.
 *  - `aiProposedFlags`: which fields the person kept exactly as proposed (the audit row the agent learns from).
 *
 * Pure - no DB, no network (a type import only); the selftest loads it with no server code.
 * Selftest: scripts/tour-uploader-selftest.ts (section "Alon round 2, Task 5").
 */
import { shortPlace } from "@/lib/lodging";
import { normalizeName } from "@/lib/on-tour";
import type { LocationRow } from "@/lib/services/nearest-location";
import type { ShowIdentity, UploaderItem, UploaderQuestion } from "@/types/uploader.types";

/** What the form writes to a `locations` row (the `aliases` column is the other spellings of the city). */
export type LocationInput = {
  name_he: string;
  iata: string;
  latitude: number;
  longitude: number;
  country_code: string | null;
  aliases: string[];
};

/** The Hebrew name's cap ("<city>, <country>" is a few words). */
export const LOCATION_NAME_MAX = 80;
/** One alias' cap, and how many a location keeps. */
export const LOCATION_ALIAS_MAX = 60;
export const LOCATION_ALIASES_MAX = 10;

/** Why a form is refused, in the dialog's words (shown under the form). */
export const LOCATION_PROBLEM = {
  shape: "הטופס לא תקין - סגרו אותו ופתחו מחדש",
  name: "שם המיקום חייב להיות בעברית, בצורה עיר, מדינה (למשל ולנסיה, ספרד)",
  iata: "קוד שדה התעופה הוא שלוש אותיות באנגלית (למשל VLC)",
  latitude: "קו הרוחב חייב להיות מספר בין -90 ל-90",
  longitude: "קו האורך חייב להיות מספר בין -180 ל-180",
  coordinates: "הקואורדינטות חסרות - הזינו את קו הרוחב והאורך של העיר",
  country: "קוד המדינה הוא שתי אותיות באנגלית (למשל ES), או ריק",
  aliases: `עד ${LOCATION_ALIASES_MAX} כינויים, כל אחד עד ${LOCATION_ALIAS_MAX} תווים`,
  exists: (id: number): string => `המיקום כבר קיים (#${id})`,
};

const HEBREW_LETTER = /[א-ת]/;
const IATA = /^[A-Z]{3}$/;
const COUNTRY = /^[A-Z]{2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Text with its whitespace collapsed and trimmed; null = not a string. */
const tidy = (v: unknown): string | null => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : null);

/** A finite number within +-`limit`. */
const inRange = (v: unknown, limit: number): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;

/** The (0, 0) point: what a show with no coordinates falls back to - never a city. */
const isOrigin = (lat: number, lon: number): boolean => lat === 0 && lon === 0;

/** A country code as ISO-2 upper case, or null (a supplier's longer code, a country name, nothing). */
const isoCountry = (v: string | null): string | null => {
  const code = (v ?? "").trim().toUpperCase();
  return COUNTRY.test(code) ? code : null;
};

/** A Hebrew name of an acceptable length, or null. */
const hebrewName = (v: unknown): string | null => {
  const name = tidy(v);
  return name !== null && name !== "" && name.length <= LOCATION_NAME_MAX && HEBREW_LETTER.test(name) ? name : null;
};

/** Three upper-case ASCII letters, or null. */
const iataOf = (v: unknown): string | null => {
  const code = typeof v === "string" ? v.trim().toUpperCase() : "";
  return IATA.test(code) ? code : null;
};

/** One spelling per `normalizeName` (the first one stays), blanks and spellings that normalize to nothing dropped. */
function distinctSpellings(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    const key = normalizeName(text);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** The form's aliases as written: absent = none; not a list, not text or over the cap = null (a refusal). */
function typedAliases(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const texts: string[] = [];
  for (const item of raw) {
    const text = tidy(item);
    if (text === null || text.length > LOCATION_ALIAS_MAX) return null;
    if (text !== "") texts.push(text);
  }
  const distinct = distinctSpellings(texts);
  return distinct.length > LOCATION_ALIASES_MAX ? null : distinct;
}

/**
 * The form a person confirmed -> the row to write, or the first problem in the form's order (name, IATA,
 * latitude, longitude, coordinates, country, aliases, then the duplicate). `existing` = the `locations` rows:
 * a row with the same IATA AND the same city (`shortPlace` of the name, `normalizeName`) is refused, naming it -
 * two cities may share an airport and a city may have two airports, only both together is "already there".
 * Pure; the action calls it once without rows (the shape, before any read) and once with them.
 */
export function validateLocationInput(
  raw: unknown,
  existing: Pick<LocationRow, "id" | "name" | "city_iata">[],
): { ok: true; value: LocationInput } | { ok: false; problem: string } {
  if (!isRecord(raw)) return { ok: false, problem: LOCATION_PROBLEM.shape };
  const refuse = (problem: string) => ({ ok: false as const, problem });

  const name_he = hebrewName(raw.name_he);
  if (name_he === null) return refuse(LOCATION_PROBLEM.name);
  const iata = iataOf(raw.iata);
  if (iata === null) return refuse(LOCATION_PROBLEM.iata);
  const { latitude, longitude } = raw;
  if (!inRange(latitude, 90)) return refuse(LOCATION_PROBLEM.latitude);
  if (!inRange(longitude, 180)) return refuse(LOCATION_PROBLEM.longitude);
  if (isOrigin(latitude, longitude)) return refuse(LOCATION_PROBLEM.coordinates);

  let country_code: string | null = null;
  if (raw.country_code !== undefined && raw.country_code !== null) {
    const code = typeof raw.country_code === "string" ? raw.country_code.trim().toUpperCase() : null;
    if (code === null) return refuse(LOCATION_PROBLEM.country);
    if (code !== "") {
      if (!COUNTRY.test(code)) return refuse(LOCATION_PROBLEM.country);
      country_code = code;
    }
  }
  const aliases = typedAliases(raw.aliases);
  if (aliases === null) return refuse(LOCATION_PROBLEM.aliases);

  const city = normalizeName(shortPlace(name_he));
  const same = existing.find((row) => (row.city_iata ?? "").trim().toUpperCase() === iata && normalizeName(shortPlace(row.name)) === city);
  if (same) return refuse(LOCATION_PROBLEM.exists(same.id));

  return { ok: true, value: { name_he, iata, latitude, longitude, country_code, aliases } };
}

/** An alias the model (or the show) offers that the form would accept: text, not blank, within the cap. */
const usableAlias = (v: unknown): v is string => {
  const text = tidy(v);
  return text !== null && text !== "" && text.length <= LOCATION_ALIAS_MAX;
};

/**
 * The model's `propose_location` input -> the form's starting values. Field by field, over `fallback` (what the
 * show itself knows: its coordinates, country and city spelling): a name with no Hebrew letter (or too long)
 * is dropped to the fallback's; a bad IATA to ""; coordinates only as a valid PAIR (never half the model's,
 * half the show's) and never the (0, 0) placeholder; the country is always the show's - the model is not asked
 * for one. The aliases are the show's own spelling first, then the model's, one per `normalizeName`, capped.
 * Not an object -> the fallback, copied. Pure; never throws.
 */
export function parseLocationProposal(raw: unknown, fallback: LocationInput): LocationInput {
  if (!isRecord(raw)) return { ...fallback, aliases: [...fallback.aliases] };
  const pair =
    inRange(raw.latitude, 90) && inRange(raw.longitude, 180) && !isOrigin(raw.latitude, raw.longitude)
      ? { latitude: raw.latitude, longitude: raw.longitude }
      : { latitude: fallback.latitude, longitude: fallback.longitude };
  const proposed = Array.isArray(raw.aliases) ? raw.aliases.filter(usableAlias) : [];
  const aliases = distinctSpellings([...fallback.aliases, ...proposed].filter(usableAlias).map((a) => tidy(a) ?? "")).slice(0, LOCATION_ALIASES_MAX);
  return {
    name_he: hebrewName(raw.name_he) ?? fallback.name_he,
    iata: iataOf(raw.iata) ?? "",
    ...pair,
    country_code: fallback.country_code,
    aliases,
  };
}

/** Which fields of the saved location are exactly what the AI proposed (the audit row's `ai_proposed`). */
export type AiProposedFlags = { name_he: boolean; iata: boolean; latitude: boolean; longitude: boolean; aliases: boolean };

const aliasKeys = (aliases: string[]): string => [...new Set(aliases.map((a) => normalizeName(a)).filter((k) => k !== ""))].sort().join("|");

/**
 * Per field: did the person keep what the dialog was filled with. `proposed` = the AI's proposal as the dialog
 * showed it (null = the AI gave none - nothing was proposed, every flag is false). A field the proposal left
 * empty is never "proposed". Aliases compare as spellings (`normalizeName`), order aside. Pure.
 */
export function aiProposedFlags(proposed: LocationInput | null, saved: LocationInput): AiProposedFlags {
  if (proposed === null) return { name_he: false, iata: false, latitude: false, longitude: false, aliases: false };
  return {
    name_he: proposed.name_he !== "" && proposed.name_he === saved.name_he,
    iata: proposed.iata !== "" && proposed.iata === saved.iata,
    latitude: !isOrigin(proposed.latitude, proposed.longitude) && proposed.latitude === saved.latitude,
    longitude: !isOrigin(proposed.latitude, proposed.longitude) && proposed.longitude === saved.longitude,
    aliases: aliasKeys(proposed.aliases) !== "" && aliasKeys(proposed.aliases) === aliasKeys(saved.aliases),
  };
}

// ---- the question side: what a location answer needs from the item ----------------------------------------------

/**
 * What the form starts from before the AI says anything (and what a proposal falls back to): the show's own
 * coordinates (0, 0 when it has none - the person must type them), its country when it is an ISO-2 code, and the
 * city as the supplier spells it as the first alias - the spelling the run's other shows are paired by.
 */
export function locationFallback(show: Pick<ShowIdentity, "city" | "country_code" | "lat" | "lon">): LocationInput {
  const city = tidy(show.city) ?? "";
  return {
    name_he: "",
    iata: "",
    latitude: show.lat ?? 0,
    longitude: show.lon ?? 0,
    country_code: isoCountry(show.country_code),
    aliases: city !== "" && city.length <= LOCATION_ALIAS_MAX ? [city] : [],
  };
}

/** An open question a created location answers: `create_location` (the show has coordinates) or `pick_location` (it has none). */
export function isLocationQuestion(item: Pick<UploaderItem, "status" | "question">): boolean {
  return item.status === "question" && (item.question?.kind === "create_location" || item.question?.kind === "pick_location");
}

/**
 * The question with the new location as one more option (`checkAnswer` accepts only an option the question
 * lists, and a question's options were written before the location existed). Already listed = unchanged; the
 * original is never mutated.
 */
export function withLocationOption(question: UploaderQuestion, key: string, label: string): UploaderQuestion {
  return question.options.some((o) => o.key === key) ? question : { ...question, options: [...question.options, { key, label }] };
}

type CityItem = Pick<UploaderItem, "id" | "status" | "question"> & { show: Pick<ShowIdentity, "city" | "country_code"> };

/**
 * The run's OTHER open location questions that are the same city as `item` - answered with the same new
 * location (spec 4.2). `cityKey` is the run's one rule for "the same city" (lib/uploader/equivalence.ts: "Roma" /
 * "Rome", a supplier's broken character); a show with no city matches nothing; two known country codes that
 * differ are two cities (Valencia in Spain, Valencia in Venezuela), an unknown one agrees with anything.
 */
export function sameCityItems<T extends CityItem>(item: T, open: readonly T[], cityKey: (name: string) => string): T[] {
  const mine = cityKey(item.show.city);
  if (mine === "") return [];
  const mineCountry = isoCountry(item.show.country_code);
  return open.filter((other) => {
    if (other.id === item.id || !isLocationQuestion(other) || cityKey(other.show.city) !== mine) return false;
    const country = isoCountry(other.show.country_code);
    return mineCountry === null || country === null || mineCountry === country;
  });
}
